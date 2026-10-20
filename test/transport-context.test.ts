import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { request, TransportRefused } from "../src/reflectors/net.ts";
import { reflectMcpTools } from "../src/reflectors/mcp.ts";
import type { TransportContext } from "../src/core/types.ts";

const spec = { openapi: "3.1.0", info: { title: "Unrelated counters", version: "1" },
  servers: [{ url: "https://counter.test" }], paths: {
    "/values/{key}": { get: { operationId: "value", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Counter", content: { "application/json": { schema: { type: "integer" } } } } } } },
  } };

test("concurrent runs receive distinct immutable transport context, never HTTP context headers", async () => {
  const seen: any[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (input, init, context?: any) => {
    seen.push({ input: String(input), headers: Object.fromEntries(new Headers(init?.headers)), context });
    await new Promise(resolve => setTimeout(resolve, String(input).endsWith("slow") ? 10 : 0));
    return Response.json(7);
  } });
  rc.graph.add(reflectOpenAPI(spec, "https://counter.test/openapi.json"));
  const runs = await Promise.all(["slow", "fast"].map(key => rc.run("openapi:unrelated-counters:value", { key })));
  assert.ok(seen.every(r => r.context), "execution fetch lacks runtime context");
  for (const [i, run] of runs.entries()) {
    assert.equal(run.status, "completed");
    const c = seen[i].context;
    assert.deepEqual(Object.keys(c).sort(), ["capabilityId", "requestId", "runId", "runtimeId"]);
    assert.equal(c.runId, run.runId);
    assert.equal(c.capabilityId, "openapi:unrelated-counters:value");
    assert.equal(c.runtimeId, rc.activity.epoch);
    assert.ok(Object.isFrozen(c));
    assert.doesNotMatch(JSON.stringify(seen[i].headers), /run_|runtimeId|requestId/);
  }
  assert.equal(new Set(seen.map(r => r.context.requestId)).size, 2);
});

test("MCP preserves its session and separates concurrent call context from discovery", async () => {
  const seen: { method: string; context?: TransportContext }[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (_input, init, context) => {
    const body = JSON.parse(String(init?.body)); seen.push({ method: body.method, context });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize" ?
      { serverInfo: { name: "Counters" }, capabilities: {} } : { content: [{ type: "text", text: "7" }] } },
    { headers: { "mcp-session-id": "same-session" } });
  } });
  rc.graph.add(reflectMcpTools([{ name: "count", annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} } }], "https://mcp.test", "Counters"));
  const cap = rc.graph.list().find(c => c.invoke.kind === "mcp")!;
  const first = await rc.run(cap.id);
  const next = await Promise.all([rc.run(cap.id), rc.run(cap.id)]);
  assert.ok([first, ...next].every(r => r.status === "completed"));
  assert.equal(seen.filter(r => r.method === "initialize").length, 1);
  assert.deepEqual(seen.filter(r => r.method === "tools/call").map(r => r.context?.runId), [first, ...next].map(r => r.runId));
  assert.equal(new Set(seen.map(r => r.context?.requestId)).size, 5);
});

test("repair contract reads stay discovery while the repaired attempt retains its owner", async () => {
  const seen: { url: string; context?: TransportContext }[] = [];
  let attempts = 0;
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (input, _init, context) => {
    const url = String(input); seen.push({ url, context });
    if (url.endsWith("openapi.json")) return Response.json(spec);
    return ++attempts === 1 ? new Response("temporarily broken", { status: 500 }) : Response.json(7);
  } });
  await rc.learn({ source: "https://counter.test/openapi.json" });
  const run = await rc.run("openapi:unrelated-counters:value", { key: "repair" });
  assert.equal(run.status, "completed");
  assert.equal(attempts, 2);
  assert.ok(seen.filter(r => r.url.endsWith("openapi.json")).every(r => r.context === undefined));
  const executions = seen.filter(r => !r.url.endsWith("openapi.json"));
  assert.ok(executions.every(r => r.context?.runId === run.runId));
  assert.notEqual(executions[0].context?.requestId, executions[1].context?.requestId);
});

test("GraphQL owns its distinct wire request without claiming HTTP operation identity", async () => {
  let context: TransportContext | undefined;
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (_input, _init, c) => {
    context = c; return Response.json({ data: { count: 7 } });
  } });
  rc.graph.add({ provider: { id: "gql:unrelated", title: "Counters", source: "graphql", origin: "https://gql.test",
    learnedAt: new Date().toISOString(), capabilityIds: ["gql:unrelated:count"] },
    capabilities: [{ id: "gql:unrelated:count", provider: "gql:unrelated", title: "Count", description: "", source: "graphql",
      inputs: [], outputs: [{ name: "", type: "integer", required: true }], risk: "read", tags: [],
      invoke: { kind: "graphql", endpoint: "https://gql.test", operation: "query", field: "count", args: {}, selection: "" } }] });
  const run = await rc.run("gql:unrelated:count");
  assert.equal(run.status, "completed");
  assert.equal(context?.runId, run.runId);
  assert.equal(context?.capabilityId, run.capability);
});

test("discovery and refused-before-dispatch work do not get an execution context", async () => {
  const seen: any[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [],
    authority: { execution: { allowedRisks: [] } },
    fetch: async (_input, _init, context?: any) => { seen.push(context); return Response.json(spec); } });
  await rc.learn({ source: "https://counter.test/openapi.json" });
  assert.ok(seen.length);
  assert.ok(seen.every(c => c === undefined));
  const n = seen.length;
  assert.equal((await rc.run("openapi:unrelated-counters:value", { key: "denied" })).status, "failed");
  assert.equal(seen.length, n);
});

test("each redirect gets a distinct request ID while a transport refusal remains a refusal", async () => {
  const seen: any[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (input, _init, context?: any) => {
    seen.push(context);
    if (String(input).includes("/values/")) return new Response(null, { status: 302, headers: { location: "/redirected" } });
    throw new TransportRefused("revoked");
  } });
  rc.graph.add(reflectOpenAPI(spec, "https://counter.test/openapi.json"));
  const run = await rc.run("openapi:unrelated-counters:value", { key: "redirect" });
  assert.equal(run.status, "failed");
  assert.ok(run.refusal);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(c => c?.runId === run.runId));
  assert.notEqual(seen[0].requestId, seen[1].requestId);
  await assert.rejects(request(rc.net, "https://counter.test/direct"), /revoked/);
  assert.equal(seen.at(-1), undefined);
});
