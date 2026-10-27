import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { Authority } from "../src/reflectors/net.ts";
import { sha256, stableStringify } from "../src/core/ledger.ts";
import { MemoryStore } from "./helpers.ts";

const ref = { kind: "protected-value-ref" as const, version: 1 as const, slot: "api-key", purpose: "verify", requiredScope: "read:check" };
const spec = { openapi: "3.1.0", info: { title: "Protected" }, servers: [{ url: "https://service.test" }], paths: { "/check": { get: { operationId: "check", summary: "Check flag", parameters: [{ name: "x-api-key", in: "header", required: true, schema: { type: "string" } }], responses: { "200": { content: { "application/json": { schema: { type: "boolean" } } } } } } } } };
const capid = "openapi:protected:check";
function host(principal: string, state: { grant: boolean; calls: number; values: string[] }, value: string) {
  return { principal, allowBooleanOutput: true, async withAuthorizedValue<T>(req: any, consume: (value: string) => Promise<T>): Promise<T> {
    state.calls++;
    assert.equal(req.principal, principal); assert.equal(req.capability, capid);
    assert.equal(req.ref.requiredScope, "read:check"); assert.equal(req.origin, "https://service.test");
    if (!state.grant) throw new Error(`denied-${value}`);
    return consume(value);
  } };
}
async function fixture(state = { grant: true, calls: 0, values: [] as string[] }, value = "6543", response: (req: Request) => Response = () => Response.json(true)) {
  const store = new MemoryStore();
  const auth = new Authority(); auth.set("https://service.test", { Authorization: "CREATOR-FOREIGN-CANARY" });
  const rc = await RightClick.create({ store, auth, directories: [], sandbox: null, protectedValues: host("alice", state, value), fetch: async (input, init) => {
    const req = new Request(input, init); state.values.push(req.headers.get("x-api-key") ?? "");
    assert.equal(req.headers.get("Authorization"), null, "unrelated runtime credentials must not be mixed into protected requests");
    return response(req);
  } });
  rc.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  return { rc, store, state };
}

test("protected HTTP header is host scoped, no ambient credentials or value digest are persisted", async () => {
  const { rc, store, state } = await fixture();
  assert.equal(state.calls, 0);
  const r = await rc.run(capid, { "x-api-key": ref });
  assert.equal(r.status, "completed", r.error); assert.equal(r.output, true);
  assert.deepEqual(state.values, ["6543"]); assert.equal(state.calls, 1);
  await rc.flush();
  const view = JSON.stringify({ state: store.state, r, runs: [...rc.runs.values()], activity: rc.activity.snapshot() });
  assert.ok(!view.includes("6543")); assert.ok(!view.includes("CREATOR-FOREIGN-CANARY"));
  assert.ok(!view.includes(await sha256(stableStringify("6543"))), "public receipt must not hash the protected value");
  state.grant = false;
  const denied = await rc.run(capid, { "x-api-key": ref });
  assert.equal(denied.status, "failed"); assert.equal(state.calls, 2); assert.deepEqual(state.values, ["6543"]);
  assert.ok(!JSON.stringify(denied).includes("6543"));
});

test("provider echo, status errors and redirects never persist the protected value or retry", async () => {
  for (const response of [() => Response.json({ harmless: "6543" }), () => Response.json({ error: "6543" }, { status: 500 }), () => new Response("6543", { status: 302, headers: { location: "https://other.test/" } }), () => new Response("6543", { status: 202 }), () => Response.json("x".repeat(9000))]) {
    const { rc, store, state } = await fixture(undefined, "6543", response);
    const r = await rc.run(capid, { "x-api-key": ref });
    assert.equal(r.status, "failed"); assert.equal(state.values.length, 1, "no retry, redirect or polling");
    assert.match(r.error ?? "", /do not replay/); await rc.flush();
    assert.ok(!JSON.stringify({ r, state: store.state, runs: [...rc.runs.values()] }).includes("6543"));
  }
});

test("malformed, nested, unauthorized and protected-recovery cases stop before resolution or dispatch", async () => {
  const { rc, state } = await fixture();
  const malformed = { ...ref, bearer: "synthetic" };
  const denied = await rc.run(capid, { "x-api-key": malformed });
  assert.equal(denied.status, "failed"); assert.equal(state.calls, 0); assert.equal(state.values.length, 0);
  const nested = await rc.run(capid, { "x-api-key": { inner: ref } });
  assert.equal(nested.status, "failed"); assert.equal(state.calls, 0); assert.equal(state.values.length, 0);
  const recovery = await RightClick.create({ store: new MemoryStore(), workflowRecovery: true, directories: [], protectedValues: host("alice", state, "6543") });
  recovery.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  const r = await recovery.run(capid, { "x-api-key": ref }); assert.equal(r.status, "failed");
  assert.equal(state.calls, 0);
});

test("published protected slot survives restart and resolves only under the inheritor's authority", async () => {
  const { rc, store, state } = await fixture();
  const created = await rc.compose({ have: { "x-api-key": { type: "id", value: ref } }, want: "boolean", through: [capid], run: true, publish: "protected check", verify: [{ op: "equals", value: true }] });
  assert.equal(created.executed?.status, "completed"); assert.ok(created.published?.durable);
  await rc.flush();
  assert.ok(store.state!.requirements!.includes("protected-value-slots@1"));
  assert.deepEqual(store.state!.published![0].protectedInputs, { "x-api-key": ref });
  const seen: string[] = [], bobState = { grant: false, calls: 0, values: [] as string[] };
  const bob = await RightClick.create({ store, directories: [], sandbox: null, protectedValues: host("bob", bobState, "9876"), fetch: async (input, init) => { seen.push(new Headers(init?.headers).get("x-api-key") ?? ""); return Response.json(true); } });
  assert.ok(bob.graph.get("goal:protected-check")); assert.equal(bobState.calls, 0, "loading/listing never resolves");
  const denied = await bob.run("goal:protected-check", {}); assert.equal(denied.status, "failed"); assert.deepEqual(seen, []);
  bobState.grant = true;
  const approved = await bob.run("goal:protected-check", {}); assert.equal(approved.status, "completed", approved.error);
  assert.equal(approved.output, true); assert.equal(approved.verification.status, "checked"); assert.deepEqual(seen, ["9876"]);
  bobState.grant = false;
  const revoked = await bob.run("goal:protected-check", {}); assert.equal(revoked.status, "failed"); assert.deepEqual(seen, ["9876"]);
  await bob.flush();
  const all = JSON.stringify({ state: store.state, outputs: [denied, approved, revoked], runs: [...bob.runs.values()] });
  for (const secret of ["6543", "9876"]) { assert.ok(!all.includes(secret)); assert.ok(!all.includes(await sha256(stableStringify(secret)))); }
  assert.deepEqual(state.values, ["6543"]);
});

test("protected state requires a version marker and rejects malformed slot maps", async () => {
  const { rc, store } = await fixture();
  await rc.compose({ have: { "x-api-key": { type: "id", value: ref } }, want: "boolean", through: [capid], run: true, publish: "protected check", verify: [{ op: "equals", value: true }] });
  await rc.flush();
  const original = structuredClone(store.state!);
  const { decodeState } = await import("../src/core/state-format.ts");
  const legacy = structuredClone(original); legacy.requirements = legacy.requirements!.filter(x => x !== "protected-value-slots@1");
  assert.throws(() => decodeState(legacy), /missing the protected value slots requirement/);
  const malformed = structuredClone(original); (malformed.published![0].protectedInputs!["x-api-key"] as any).extra = "bad";
  assert.throws(() => decodeState(malformed), /invalid protected goal slots/);
});

test("current execution and egress authority are checked before any protected-value resolution", async () => {
  const state = { grant: true, calls: 0, values: [] as string[] };
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedOrigins: [] } }, protectedValues: host("alice", state, "6543"), fetch: async () => { throw new Error("must not dispatch"); } });
  rc.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  const result = await rc.run(capid, { "x-api-key": ref });
  assert.equal(result.status, "failed"); assert.equal(state.calls, 0);
});

test("untrusted per-call network transport cannot receive a protected credential", async () => {
  const { rc, state } = await fixture();
  let other = 0;
  const net = { ...rc.net, fetch: async () => { other++; return Response.json(true); } };
  const result = await rc.run(capid, { "x-api-key": ref }, { net });
  assert.equal(result.status, "failed"); assert.equal(state.calls, 0); assert.equal(other, 0);
});

test("protected execution holds provider mutation guard and never dispatches a second value", async () => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  let calls = 0, dispatches = 0;
  const h = { principal: "alice", allowBooleanOutput: true, async withAuthorizedValue<T>(_req: unknown, consume: (v: string) => Promise<T>) { calls++; return consume("6543"); } };
  const rc = await RightClick.create({ directories: [], sandbox: null, protectedValues: h, fetch: async () => { dispatches++; entered(); await gate; return Response.json(true); } });
  rc.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  const running = rc.run(capid, { "x-api-key": ref });
  try {
    await ready;
    await assert.rejects(rc.learn({ source: "https://service.test/openapi.json" }), /provider changes are blocked/);
    assert.throws(() => rc.forget("openapi:protected"), /provider revocation is blocked/);
  } finally { release(); }
  assert.equal((await running).status, "completed"); assert.equal(calls, 1); assert.equal(dispatches, 1);
});

test("a resolver returning before its in-flight callback settles cannot report success", async () => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const h = { principal: "alice", allowBooleanOutput: true, async withAuthorizedValue<T>(_req: unknown, consume: (v: string) => Promise<T>): Promise<T> {
    void consume("6543").catch(() => {}); return true as T;
  } };
  const rc = await RightClick.create({ directories: [], sandbox: null, protectedValues: h, fetch: async () => { entered(); await gate; return Response.json(true); } });
  rc.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  const running = rc.run(capid, { "x-api-key": ref });
  try { await ready; await assert.rejects(rc.learn({ source: "https://service.test/openapi.json" }), /provider changes are blocked/); }
  finally { release(); }
  const result = await running; assert.equal(result.status, "failed"); assert.match(result.error ?? "", /outcome unknown/);
});

test("protected published goal repeats an independent witness after a new runtime loads it", async () => {
  const audit = { openapi: "3.1.0", info: { title: "Audit" }, servers: [{ url: "https://audit.test" }], paths: { "/witness": { get: { operationId: "witness", summary: "Witness flag", responses: { "200": { content: { "application/json": { schema: { type: "boolean" } } } } } } } } };
  const store = new MemoryStore(), sent: string[] = [], auditCalls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname === "audit.test") { auditCalls.push(req.url); assert.equal(req.headers.get("x-api-key"), null); return Response.json(true); }
    sent.push(req.headers.get("x-api-key") ?? ""); return Response.json(true);
  };
  const aliceState = { grant: true, calls: 0, values: [] as string[] }, bobState = { grant: true, calls: 0, values: [] as string[] };
  const alice = await RightClick.create({ store, fetch, directories: [], sandbox: null, protectedValues: host("alice", aliceState, "6543") });
  alice.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
  alice.graph.add(reflectOpenAPI(audit, "https://audit.test/openapi.json"));
  const witness = [{ capability: "openapi:audit:witness", args: {}, verify: [{ op: "equals" as const, value: true }] }];
  const created = await alice.compose({ have: { "x-api-key": { type: "id", value: ref } }, want: "boolean", through: [capid], run: true, publish: "witnessed check", witnesses: witness });
  assert.equal(created.executed?.verification.status, "verified", JSON.stringify(created.executed)); assert.ok(created.published?.durable);
  await alice.flush();
  const bob = await RightClick.create({ store, fetch, directories: [], sandbox: null, protectedValues: host("bob", bobState, "9876") });
  const inherited = await bob.run("goal:witnessed-check", {});
  assert.equal(inherited.status, "completed", inherited.error); assert.equal(inherited.verification.status, "verified");
  assert.deepEqual(sent, ["6543", "9876"]); assert.equal(auditCalls.length, 2);
  await bob.flush(); assert.ok(!JSON.stringify({ state: store.state, inherited }).includes("6543")); assert.ok(!JSON.stringify({ state: store.state, inherited }).includes("9876"));
});
