import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { definitionRetentionError } from "../src/core/retention-policy.ts";
import { Ledger } from "../src/core/ledger.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { MemoryStore } from "./helpers.ts";

const CANARY = "opaque-fixture-value-873649";

test("fixed values and witness literals are refused without echoing a canary", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, authority: { shareEvidence: true } });
  await assert.rejects(rc.compose({ have: { text: { type: "text", value: CANARY, fixed: true } }, want: "hash",
    through: ["builtin:text.sha256"], run: true, publish: "safe title" }), error => {
    assert.match(String(error), /fixed execution values cannot be persisted/);
    assert.ok(!String(error).includes(CANARY)); return true;
  });
  assert.ok(definitionRetentionError({}, [{ op: "equals", value: CANARY }]));
  assert.ok(definitionRetentionError({}, [], [{ capability: "fixture", args: { item: { value: CANARY } }, verify: [] }]));
  assert.equal(definitionRetentionError({}, [], [{ capability: "fixture", args: { item: { input: "item" } }, verify: [{ op: "equals", value: true }] }]), undefined);
  await rc.flush();
  assert.ok(!JSON.stringify(store.state).includes(CANARY));
  assert.ok(!JSON.stringify(rc.exportKnowledge()).includes(CANARY));
});

test("automatic durable recovery refuses a state-changing HTTP request before dispatch", async () => {
  let calls = 0;
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, fetch: async () => { calls++; return new Response(null, { status: 202 }); } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: "Safe fixture" }, servers: [{ url: "https://example.test" }],
    paths: { "/action": { post: { operationId: "action", responses: { "202": { description: "pending" } } } } } }, "https://example.test/spec"));
  const cap = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST")!;
  await assert.rejects(rc.run(cap.id, { data: CANARY }), /requires secure continuation storage/);
  assert.equal(calls, 0);
  await rc.flush();
  assert.ok(!JSON.stringify(store.state).includes(CANARY));
});

test("recovery refuses a composite before executing any underlying step", async () => {
  let calls = 0;
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, workflowRecovery: true,
    fetch: async () => { calls++; return Response.json({ value: "ok" }); } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: "Read fixture" }, servers: [{ url: "https://example.test" }],
    paths: { "/item": { get: { operationId: "getItem", responses: { "200": { description: "ok" } } } } } }, "https://example.test/spec"));
  const leaf = rc.graph.list().find(c => c.invoke.kind === "http")!;
  rc.graph.addCapability({ id: "composite:retention", provider: "fixture", source: "composite", title: "Read fixture", description: "", tags: [], risk: "read",
    inputs: [{ name: "query", type: "text", required: true }], outputs: [{ name: "", type: "json", required: true }],
    invoke: { kind: "composite", steps: [{ capability: leaf.id, bindings: [] }], result: "0" } },
    { id: "fixture", title: "Fixture", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  const result = await rc.run("composite:retention", { query: CANARY });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /external value vault/);
  assert.equal(calls, 0);
  await rc.flush();
  assert.ok(!JSON.stringify(store.state).includes(CANARY));
});

test("read-only HTTP continuation with an opaque cursor is not checkpointed or followed", async () => {
  const calls: string[] = [];
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store,
    fetch: async input => { calls.push(String(input)); return new Response(null, { status: 202, headers: { location: `/tasks/${CANARY}` } }); } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: "Read fixture" }, servers: [{ url: "https://example.test" }],
    paths: { "/start": { get: { operationId: "start", responses: { "202": { description: "pending" } } } },
      "/tasks/{key}": { get: { operationId: "task", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } } }, "https://example.test/spec"));
  const cap = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.url.endsWith("/start"))!;
  const result = await rc.run(cap.id);
  assert.notEqual(result.status, "completed");
  assert.equal(calls.length, 1);
  await rc.flush();
  assert.ok(!JSON.stringify(store.state).includes(CANARY));
});

test("opaque values and thrown errors are excluded from MCP audit and exception replies", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store });
  const audit: unknown[] = [];
  rc.toolCallSink = entry => audit.push(entry);
  // Trigger a thrown error where the unknown capability itself is the canary.
  const reply = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_run", arguments: { id: CANARY } } });
  assert.ok(!JSON.stringify(reply).includes(CANARY));
  assert.ok(!JSON.stringify(audit).includes(CANARY));
  const ledger = new Ledger(); ledger.record("fixture", false, 1, CANARY);
  assert.ok(!JSON.stringify(ledger.toJSON()).includes(CANARY));
});

test("observed identifier values stay in memory, not persisted state", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, fetch: async () => Response.json({ id: CANARY }) });
  rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: "Lookup" }, servers: [{ url: "https://example.test" }],
    paths: { "/item/{id}": { get: { operationId: "item", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } } } } } }, "https://example.test/spec"));
  const capability = rc.graph.list().find(c => c.invoke.kind === "http")!;
  assert.equal((await rc.run(capability.id, { id: CANARY })).status, "completed");
  assert.ok(rc.graph.identities.evidence().length > 0, "fixture exercised value-bearing identity observation");
  await rc.flush();
  assert.ok(!JSON.stringify(store.state).includes(CANARY));
});

test("agreement evidence and provider errors are omitted from MCP response details", async () => {
  const fake = { run: async () => ({ runId: "fixture", status: "failed", output: "safe result", error: CANARY,
    verification: { status: "refuted", results: [{ ok: false, actual: CANARY }] },
    witnesses: [{ status: "failed", output: CANARY, error: CANARY, agreement: { mode: "exact", ok: false, witness: CANARY, candidate: CANARY } }] }) } as unknown as RightClick;
  const reply = await handle(fake, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "context_run", arguments: { id: "fixture", view: { full: true } } } });
  assert.ok(!JSON.stringify(reply).includes(CANARY));
  assert.ok(JSON.stringify(reply).includes("safe result"));
});
