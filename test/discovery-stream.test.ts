import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { Authority } from "../src/reflectors/net.ts";
import { handle } from "../src/interface/mcp-server.ts";

// Regression fixture for an observed live-provider failure, not a customer incident.
// A discovery GET can open an SSE subscription which deliberately never ends.
function endpoint(opts: { unauthorized?: boolean; notMcp?: boolean } = {}) {
  let cancelled = false;
  let calls = 0;
  const seen: Array<{ method: string; rpc?: string; auth: string | null; session: string | null }> = [];
  const tool = { name: "read_record", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: true } };
  const fetch = async (_url: any, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const msg = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method: init.method ?? "GET", rpc: msg?.method, auth: headers.get("authorization"), session: headers.get("mcp-session-id") });
    if (opts.unauthorized || headers.get("authorization") !== "Bearer fixture-only") return new Response("Unauthorized", { status: 401 });
    if (!init.method || init.method === "GET") return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } });
    if (opts.notMcp) return new Response("Not an MCP endpoint", { status: 405 });
    if (msg.method === "initialize") return Response.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "generic-stream", version: "1" } } }, { headers: { "mcp-session-id": "fixture-session" } });
    assert.equal(headers.get("mcp-session-id"), "fixture-session");
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: msg.id, result: { tools: [tool] } });
    if (msg.method === "tools/call") {
      calls++;
      const valid = typeof msg.params.arguments.id === "string";
      return Response.json({ jsonrpc: "2.0", id: msg.id, result: { isError: !valid, content: [{ type: "text", text: valid ? "record-17" : "original provider rejected invalid id" }] } });
    }
    return new Response("Unknown request", { status: 400 });
  };
  const auth = new Authority(); auth.set("https://stream.test", { Authorization: "Bearer fixture-only" });
  return { fetch, auth, seen, get cancelled() { return cancelled; }, get calls() { return calls; } };
}

test("context_learn cancels a discovery SSE subscription and performs authenticated MCP initialization", { timeout: 1000 }, async () => {
  const source = endpoint();
  const rc = await RightClick.create({ fetch: source.fetch, auth: source.auth, timeoutMs: 50, directories: [] });
  const response = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_learn", arguments: { source: "https://stream.test/capabilities" } } });
  assert.equal((response?.result as any).isError, false);
  assert.equal(source.cancelled, true);
  assert.equal(source.calls, 0, "discovery must not execute a tool");
  assert.deepEqual(source.seen.map(x => x.rpc ?? x.method), ["GET", "initialize", "notifications/initialized", "tools/list"]);
  assert.ok(source.seen.every(x => x.auth === "Bearer fixture-only"));
  const cap = rc.graph.list().find(x => x.source === "mcp")!;
  assert.equal(cap.risk, "read");
  const run = await handle(rc, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "context_run", arguments: { id: cap.id, args: { id: "17" } } } });
  assert.equal((run?.result as any).structuredContent.output, "record-17");
  assert.equal(source.calls, 1);
  const invalid = await rc.run(cap.id, { id: 42 });
  assert.equal(invalid.status, "failed", "the original provider's rejection must remain an error");
});

test("an SSE content type is not proof of an MCP capability", { timeout: 1000 }, async () => {
  const source = endpoint({ notMcp: true });
  const rc = await RightClick.create({ fetch: source.fetch, auth: source.auth, directories: [] });
  await rc.learn({ source: "https://stream.test/capabilities" });
  assert.equal(source.cancelled, true);
  assert.equal(rc.graph.list().filter(c => c.source === "mcp").length, 0);
  assert.equal(source.calls, 0);
});

test("SSE discovery does not bypass provider authentication", async () => {
  const source = endpoint({ unauthorized: true });
  const rc = await RightClick.create({ fetch: source.fetch, auth: source.auth, directories: [] });
  await rc.learn({ source: "https://stream.test/capabilities" });
  assert.equal(rc.graph.list().filter(c => c.source === "mcp").length, 0);
  assert.equal(source.calls, 0);
});
