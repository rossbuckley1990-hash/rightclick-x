// Operator controls are exercised through the same paths available to agents.
// Dummy providers count effects independently of runtime success/receipt labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { dispatch } from "../src/interface/tools.ts";
import { createHandler } from "../src/interface/http.ts";
import { MemoryStore } from "./helpers.ts";
import { authorityFromEnv } from "../src/core/authority.ts";
import type { Capability } from "../src/core/types.ts";

const attempt = (p: Promise<any>) => p.catch((e: Error) => ({ status: "failed", error: e.message }));
const origin = "https://policy.test";
const response = { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } };

async function fixture(execution?: Record<string, unknown>, store?: MemoryStore) {
  const calls: string[] = [];
  const spec = { openapi: "3.0.0", info: { title: "Policy fixture", version: "1" }, servers: [{ url: origin }], paths: {
    "/read": { get: { operationId: "read", summary: "Read text", responses: response } },
    "/write": { post: { operationId: "write", summary: "Write text", responses: response } },
  } };
  const rc = await RightClick.create({ directories: [], store, authority: { execution } as any, fetch: (async (input: any, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return Response.json(spec);
    calls.push(`${init?.method ?? "GET"} ${u.origin}${u.pathname}`);
    return new Response("result", { headers: { "content-type": "text/plain" } });
  }) as typeof fetch });
  await rc.learn({ source: `${origin}/openapi.json` });
  const read = rc.graph.list().find((c) => c.invoke.kind === "http" && c.invoke.method === "GET")!;
  const write = rc.graph.list().find((c) => c.invoke.kind === "http" && c.invoke.method === "POST")!;
  assert.ok(read && write, "fixture exposes both operations");
  return { rc, calls, read, write };
}

test("operator read-only policy applies to direct, MCP and HTTP calls despite caller confirmation", async () => {
  const { rc, calls, read, write } = await fixture({ allowedRisks: ["read"] });
  assert.equal((await rc.run(read.id)).status, "completed");
  calls.length = 0;
  const direct = await attempt(rc.run(write.id, {}, { confirm: true }));
  const mcp: any = await attempt(dispatch(rc, "context_run", { id: write.id, confirm: true, execution: { allowedRisks: ["write"] } }));
  const http = createHandler(rc, { open: true });
  await http(new Request("http://localhost/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: write.id, confirm: true }) }));
  assert.deepEqual(calls, [], "no denied provider operation was dispatched");
  assert.equal(direct.status, "failed");
  assert.equal(mcp.status, "failed");
  assert.match(direct.error, /execution policy/);
});

test("denied ids survive persistence and agent calls cannot relax operator policy", async () => {
  const store = new MemoryStore();
  const first = await fixture(undefined, store);
  await first.rc.flush();
  const { rc, calls, read } = await fixture({ deniedCapabilities: [first.read.id] }, store);
  await attempt(rc.run(read.id, {}, { confirm: true, acknowledgeChange: true }));
  assert.deepEqual(calls, []);
});

test("a stale read label on a POST cannot bypass read-only policy", async () => {
  const { rc, calls, write } = await fixture({ allowedRisks: ["read"] });
  write.risk = "read";
  await attempt(rc.run(write.id));
  assert.deepEqual(calls, [], "transport consequences override a misleading lower risk declaration");
});

test("composite preflight refuses all steps before an allowed effect preceding a denied step", async () => {
  const initial = await fixture();
  const { rc, calls, read, write } = await fixture({ deniedCapabilities: [initial.read.id] });
  const composite: Capability = { id: "test:composite", provider: "test", source: "composite", title: "Two steps", description: "", inputs: [], outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [], invoke: { kind: "composite", steps: [{ capability: write.id, bindings: [] }, { capability: read.id, bindings: [] }], result: "1." } };
  rc.graph.addCapability(composite, { id: "test", title: "Test", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  await attempt(rc.run(composite.id));
  assert.deepEqual(calls, [], "nothing happens before preflight finishes");
});

test("caller origin constraints cannot widen operator network restrictions", async () => {
  const { rc, calls, read } = await fixture();
  rc.net.policy = { blockPrivate: false, origins: ["https://other.test"] };
  await rc.compose({ have: {}, want: "text", through: [read.id], origins: [origin], run: true });
  assert.deepEqual(calls, [], "caller scope intersects the operator's scope");
});

test("invalid execution policy is rejected instead of silently permitting operations", async () => {
  for (const execution of [{ allowedRisk: ["read"] }, { allowedRisks: ["reed"] }, { deniedCapabilities: "*" }, { allowedOrigins: ["https://policy.test/path"] }]) {
    await assert.rejects(RightClick.create({ authority: { execution } as any }), /execution policy/);
  }
});

test("a denied saved goal cannot bypass authority through generated REST or GraphQL", async () => {
  const store = new MemoryStore();
  const original = await fixture(undefined, store);
  const saved = await original.rc.compose({ have: {}, want: "text", through: [original.read.id], run: true, publish: "Kept read" });
  assert.equal(saved.executed?.status, "completed");
  assert.ok(original.rc.graph.get("goal:kept-read"));
  await original.rc.flush();
  const { rc, calls } = await fixture({ deniedCapabilities: ["goal:kept-read"] }, store);
  const handler = createHandler(rc, { open: true });
  const direct = await attempt(rc.run("goal:kept-read"));
  assert.equal(direct.status, "failed");
  await handler(new Request("http://localhost/x/kept-read"));
  await handler(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ keptRead { result ok } }" }) }));
  assert.deepEqual(calls, [], "generated APIs cannot skip goal-level denial");
});

test("repair checks a newly discovered successor against the operator denylist", async () => {
  let version = 1;
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], authority: { execution: { deniedCapabilities: ["openapi:moving:forbidden"] } }, fetch: (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return Response.json({ openapi: "3.0.0", info: { title: "Moving", version: String(version) }, servers: [{ url: `${origin}/v${version}` }], paths: { "/text": { get: { operationId: version === 1 ? "original" : "forbidden", responses: response } } } });
    calls.push(u.pathname);
    return u.pathname.startsWith(`/v${version}/`) ? new Response("ok") : new Response("gone", { status: 404 });
  }) as typeof fetch });
  await rc.learn({ source: `${origin}/openapi.json` });
  const cap = rc.graph.list().find((c) => c.invoke.kind === "http")!;
  assert.equal(cap.id, "openapi:moving:original", "deny rule uses the reflected provider identity");
  version = 2;
  const result = await rc.run(cap.id);
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, ["/v1/text"], "no dispatch to the forbidden successor");
});

test("allowlists intersect, deny takes precedence, and audit is read-only", async () => {
  const initial = await fixture();
  const { rc, calls, read, write } = await fixture({ allowedCapabilities: ["*"], deniedCapabilities: [initial.write.id + "*"] });
  const audit: any = await dispatch(rc, "context_graph", { op: "authority", execution: {} });
  assert.deepEqual(calls, []);
  assert.equal(audit.capabilities.find((c: any) => c.capability === read.id).allowed, true);
  assert.equal(audit.capabilities.find((c: any) => c.capability === write.id).allowed, false);
  audit.policy.deniedCapabilities.length = 0;
  await attempt(rc.run(write.id));
  assert.deepEqual(calls, [], "mutating an audit result cannot change policy");
  assert.ok(audit.limitations.some((s: string) => /outside this boundary/.test(s)));
  const empty = await fixture({ allowedCapabilities: [] });
  await empty.rc.run(empty.read.id);
  assert.deepEqual(empty.calls, []);
});

test("operator environment policy is parsed and invalid settings fail closed", () => {
  assert.deepEqual(authorityFromEnv({ RCX_EXECUTION_POLICY: '{"allowedRisks":["read"]}' }).execution, { allowedRisks: ["read"] });
  assert.throws(() => authorityFromEnv({ RCX_EXECUTION_POLICY: '{"allowedRisk":["read"]}' }), /execution policy/);
  assert.throws(() => authorityFromEnv({ RCX_EXECUTION_POLICY: "not-json" }));
  const samples = [{ args: { input: "b\na\n" }, output: "a\nb\n" }, { args: { input: "d\nc\n" }, output: "c\nd\n" }];
  assert.deepEqual({ ...authorityFromEnv({ RCX_CLI_CONFORMANCE: JSON.stringify({ "cli:sort:run": { samples } }) }).cliConformance }, { "cli:sort:run": { samples } });
  assert.equal(authorityFromEnv({}).cliConformance, undefined);
  assert.throws(() => authorityFromEnv({ RCX_CLI_CONFORMANCE: JSON.stringify({ "cli:sort:run": { samples: samples.slice(0, 1) } }) }), /2–8 operator-authorized samples/);
  assert.throws(() => authorityFromEnv({ RCX_CLI_CONFORMANCE: "not-json" }));
});

test("deep composite dependencies exceed the analysis bound without executing a leaf", async () => {
  const { rc, calls, read } = await fixture({ allowedRisks: ["read"] });
  let previous = read.id;
  for (let i = 0; i < 40; i++) {
    const id = `depth:${i}`;
    rc.graph.addCapability({ ...read, id, provider: "depth", source: "composite", invoke: { kind: "composite", steps: [{ capability: previous, bindings: [] }], result: "0." } }, { id: "depth", title: "Depth fixture", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
    previous = id;
  }
  const result = await rc.run(previous);
  assert.equal(result.status, "failed");
  assert.match(result.error!, /analysis bound/);
  assert.deepEqual(calls, []);
});

test("opaque platform bindings cannot masquerade as local-only under an origin policy", async () => {
  let effects = 0;
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedOrigins: [] } }, bindings: {
    remote: { get: async () => { effects++; return "private record"; }, put: async () => {}, list: async () => [] },
  } });
  const cap = rc.graph.list().find((c) => c.invoke.kind === "platform" && c.invoke.fn === "kv.remote.get")!;
  assert.ok(cap);
  const result = await rc.run(cap.id, { key: "record" });
  assert.equal(effects, 0, "a binding bypassing the HTTP layer has unknown destinations");
  assert.equal(result.status, "failed");
});
