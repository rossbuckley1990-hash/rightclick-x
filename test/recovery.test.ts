import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { RecoveringWorkflow, type FallbackAgent, type RecoveryContract } from "../src/recovery.ts";
import { MemoryStore } from "./helpers.ts";

const response = { "200": { content: { "application/json": { schema: { type: "object", properties: { result: { type: "string" } } } } } } };
const spec = (title: string, port: string, required: boolean) => ({ openapi: "3.0.0", info: { title }, paths: {
  "/transform": { get: { operationId: "uppercase", summary: "Uppercase supplied text", parameters: [{ name: port, in: "query", required, schema: { type: "string" } }], responses: response } },
} });

async function fixture(optional = true, corrupt = false) {
  const store = new MemoryStore();
  let calls = 0;
  const drift = { provider: false, checker: false };
  const fetcher: typeof fetch = async input => {
    const u = new URL(String(input));
    if (u.pathname === "/openapi.json") {
      const doc = spec(u.hostname === "provider.test" ? "Writer" : "Checker", u.hostname === "provider.test" ? (optional ? "payload" : "text") : "text", u.hostname !== "provider.test" || !optional);
      if (u.hostname === "provider.test" && drift.provider) doc.paths["/transform"].get.operationId = "uppercaseV2";
      if (u.hostname === "checker.test" && drift.checker) doc.paths["/transform"].get.parameters[0].name = "different_input";
      return Response.json(doc);
    }
    if (u.hostname === "provider.test") calls++;
    return Response.json({ result: corrupt && u.hostname === "provider.test" ? "WRONG" : (u.searchParams.get("payload") ?? u.searchParams.get("text") ?? "").toUpperCase() });
  };
  const create = () => RightClick.create({ store, fetch: fetcher, directories: [], workflowRecovery: true, authority: { publish: "verified" } });
  const rc = await create();
  const contract: RecoveryContract = { name: "uppercase", sources: ["https://provider.test/openapi.json", "https://checker.test/openapi.json"],
    origins: ["https://provider.test", "https://checker.test"], have: { text: "text" }, want: "text", intent: "uppercase", risks: ["read"],
    witnesses: [{ capability: "openapi:checker:uppercase", args: { text: { input: "text" } }, verify: [{ op: "exists", path: "result" }], agree: { path: "result" } }] };
  const good: FallbackAgent = { propose: async () => ({ proposal: { capability: "openapi:writer:uppercase", inputBindings: { payload: "text" } }, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } }) };
  return { rc, store, contract, good, create, drift, calls: () => calls };
}

test("fallback maps an optional input, verifies, persists, and a fresh runtime needs no agent", async () => {
  const f = await fixture();
  const result = await new RecoveringWorkflow(f.rc, f.contract, f.good).execute({ text: "orchid" });
  assert.equal(result.status, "verified", JSON.stringify(result));
  assert.equal(result.route, "fallback");
  assert.equal(result.output, "ORCHID");
  assert.equal(result.durable, true);
  assert.equal(f.store.state!.published![0].recovery!.source, "fallback");
  assert.ok(f.store.state!.published![0].recovery!.proposalHash);
  const fresh = await f.create();
  const reused = await new RecoveringWorkflow(fresh, f.contract).execute({ text: "iris" });
  assert.equal(reused.status, "verified", JSON.stringify(reused));
  assert.equal(reused.route, "retained");
  assert.equal(reused.output, "IRIS");
  assert.equal(reused.measurements.fallbackCalls, 0);
});

test("ordinary deterministic execution does not invoke the fallback", async () => {
  const f = await fixture(false);
  const agent: FallbackAgent = { propose: async () => { throw new Error("must not invoke"); } };
  const result = await new RecoveringWorkflow(f.rc, f.contract, agent).execute({ text: "rose" });
  assert.equal(result.status, "verified", JSON.stringify(result));
  assert.equal(result.measurements.fallbackCalls, 0);
});

for (const proposal of [68, 95.37, 62.14, { output: 20 }, { code: "return 20" },
  { capability: "openapi:writer:uppercase", inputBindings: { payload: "text" }, witnesses: [] },
  { capability: "openapi:unapproved:write", inputBindings: {} },
  { capability: "openapi:writer:uppercase", inputBindings: { payload: "secret" } }]) {
  test(`untrusted proposal cannot supply an answer, acceptance oracle or authority: ${JSON.stringify(proposal)}`, async () => {
    const f = await fixture();
    const agent: FallbackAgent = { propose: async () => ({ proposal, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } }) };
    const result = await new RecoveringWorkflow(f.rc, f.contract, agent).execute({ text: "secret-private-input" });
    assert.notEqual(result.status, "verified");
    assert.equal(f.calls(), 0);
    assert.equal(f.rc.published.size, 0);
  });
}

test("a wrong outcome fails unchanged independent verification and is never promoted", async () => {
  const f = await fixture(true, true);
  const result = await new RecoveringWorkflow(f.rc, f.contract, f.good).execute({ text: "rose" });
  assert.notEqual(result.status, "verified");
  assert.equal(f.rc.published.size, 0);
  assert.equal(f.calls(), 1);
});

test("missing usage, timeout, and persistence failure cannot claim publication", async () => {
  for (const kind of ["usage", "timeout", "store"]) {
    const f = await fixture();
    if (kind === "store") f.store.save = async () => { throw new Error("storage unavailable"); };
    const agent: FallbackAgent = { propose: async (context, limits, signal) => {
      assert.ok(!JSON.stringify(context).includes("secret-private-input"));
      assert.ok(signal instanceof AbortSignal);
      if (kind === "timeout") return new Promise(() => {});
      const r = await f.good.propose(context, limits, signal);
      return { ...r, usage: kind === "usage" ? null : r.usage };
    } };
    const result = await new RecoveringWorkflow(f.rc, f.contract, agent, { maxInputBytes: 8000, maxOutputTokens: 300, timeoutMs: 10 }).execute({ text: "secret-private-input" });
    assert.notEqual(result.status, "verified");
    assert.equal(result.durable, false);
    assert.equal(f.rc.published.size, 0);
  }
});


test("a changed provider cannot silently repin the original independent verifier", async () => {
  const f = await fixture(false);
  assert.equal((await new RecoveringWorkflow(f.rc, f.contract).execute({ text: "rose" })).status, "verified");
  const before = f.calls();
  f.drift.provider = true;
  f.drift.checker = true;
  const fresh = await f.create();
  const r = await new RecoveringWorkflow(fresh, f.contract, f.good).execute({ text: "iris" });
  assert.notEqual(r.status, "verified");
  assert.equal(f.calls(), before, "changed verifier blocks dispatch before another effect");
});

test("publication failure after execution preserves the effect without claiming a durable repair", async () => {
  const f = await fixture(false);
  const save = f.store.save.bind(f.store);
  f.store.save = async state => { if (state.published?.length) throw new Error("publication write failed"); await save(state); };
  const r = await new RecoveringWorkflow(f.rc, f.contract).execute({ text: "rose" });
  assert.notEqual(r.status, "verified");
  assert.equal(r.durable, false);
  assert.equal(f.calls(), 1);
  assert.equal(f.store.state?.published?.length ?? 0, 0);
});
