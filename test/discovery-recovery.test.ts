import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { discover } from "../src/reflectors/discover.ts";
import { Authority, DISCOVERY_BODY_LIMIT, readBody, request, type Net } from "../src/reflectors/net.ts";
import { McpClient } from "../src/reflectors/mcp.ts";
import { SERVICES } from "../demo/services.ts";

const URL = "https://protocol.test/capabilities";
const encoder = new TextEncoder();
const tool = { name: "read_record", inputSchema: { type: "object", properties: { id: { type: "string" } } }, annotations: { readOnlyHint: true } };
const netFor = (fetch: Net["fetch"], timeoutMs = 80): Net => ({ fetch, timeoutMs, auth: new Authority() });
const rpc = (body: any, result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
function pending(cancel = () => {}) {
  return new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } });
}
function mcp(body: any) {
  if (body.method === "initialize") return rpc(body, { serverInfo: { name: "protocol-test" }, capabilities: { tools: {} }, protocolVersion: "2025-06-18" });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "tools/list") return rpc(body, { tools: [tool] });
  if (body.method === "tools/call") return rpc(body, { content: [{ type: "text", text: "record-17" }] });
  return new Response(null, { status: 405 });
}

for (const failure of ["http", "rpc-error", "wrong-id", "missing-tools", "stalled"] as const) {
  test(`SSE GET: ${failure} MCP probe cannot suppress GraphQL or execute a tool`, { timeout: 2000 }, async () => {
    let cancelled = 0;
    const methods: string[] = [];
    const fetch: Net["fetch"] = async (_input, init = {}) => {
      if (!init.method) return pending(() => { cancelled++; });
      const body = JSON.parse(String(init.body));
      methods.push(body.method ?? "graphql");
      if (body.query) return SERVICES.atlas(new Request("https://atlas.test/graphql", init));
      if (failure === "http") return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 405 });
      if (failure === "rpc-error") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unsupported" } });
      if (failure === "wrong-id") return Response.json({ jsonrpc: "2.0", id: 999, result: {} });
      if (failure === "missing-tools") return body.method === "tools/list" ? rpc(body, {}) : mcp(body);
      return pending(() => { cancelled++; });
    };
    const rc = await RightClick.create({ fetch, timeoutMs: 80, directories: [] });
    await rc.learn({ source: URL });
    const cap = rc.graph.list().find(c => c.source === "graphql" && c.id.endsWith("query:geocode"));
    assert.ok(cap, "a failed MCP probe must leave GraphQL eligible");
    assert.equal(methods.filter(m => m === "initialize").length, 1, "do not repeat a failed MCP probe");
    assert.ok(!methods.includes("tools/call"));
    assert.ok(cancelled >= 1);
    const run = await rc.run(cap.id, { place: "Tokyo" });
    assert.equal(run.status, "completed");
    assert.equal((run.output as any).countryCode, "JP");
  });
}

test("stalled GraphQL body cannot suppress a valid MCP capability", { timeout: 2000 }, async () => {
  let cancelled = 0;
  const net = netFor(async (_input, init = {}) => {
    if (!init.method) return new Response(null, { status: 405 });
    const body = JSON.parse(String(init.body));
    if (body.query) return pending(() => { cancelled++; });
    return mcp(body);
  });
  const d = await discover(net, URL);
  assert.deepEqual(d.reflections.flatMap(r => r.capabilities.map(c => c.title)), ["read_record"]);
  assert.equal(cancelled, 1);
});

test("web form capabilities survive failed protocol probes", { timeout: 2000 }, async () => {
  let cancelled = 0;
  const rc = await RightClick.create({ directories: [], timeoutMs: 80, fetch: async (input, init = {}) => {
    if (String(input).includes("/search")) return new Response("found record-17");
    if (!init.method) return new Response('<html><form action="/search" method="get"><input name="q" required></form></html>');
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 405 });
  } });
  await rc.learn({ source: URL });
  const cap = rc.graph.list().find(c => c.source === "web");
  assert.ok(cap);
  const run = await rc.run(cap.id, { q: "17" });
  assert.equal(run.status, "completed");
  assert.equal(run.output, "found record-17");
  assert.equal(cancelled, 2, "both failed POST bodies are disposed");
});

test("OpenAPI remains definitive and sends no unrelated POST probes", async () => {
  const methods: string[] = [];
  const net = netFor(async (input, init = {}) => {
    methods.push(init.method ?? "GET");
    return SERVICES.polyglot(new Request(String(input), init));
  });
  const d = await discover(net, "https://polyglot.test/openapi.json");
  assert.ok(d.reflections.flatMap(r => r.capabilities).some(c => c.id.endsWith(":translatetext")));
  assert.deepEqual(methods, ["GET"]);
});

for (const ending of ["\n", "\r\n", "\r"]) {
  test(`MCP streams: fragmented UTF-8, multiline data, ${JSON.stringify(ending)} framing, no EOF`, { timeout: 2000 }, async () => {
    let cancelled = 0;
    let calls = 0;
    const net = netFor(async (_input, init = {}) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = body.method === "initialize" ? { serverInfo: { name: "météo" } }
        : body.method === "tools/list" ? { tools: [tool] }
        : { content: [{ type: "text", text: "café 東京" }] };
      if (body.method === "tools/call") calls++;
      const event = `: heartbeat${ending}${ending}data: {"jsonrpc":"2.0","id":999,"result":{}}${ending}${ending}data: {"jsonrpc":"2.0",${ending}data: "id":${body.id},"result":${JSON.stringify(result)}}${ending}${ending}`;
      const bytes = encoder.encode(event);
      return new Response(new ReadableStream({
        start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); },
        cancel() { cancelled++; return new Promise<void>(() => {}); },
      }), { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } });
    }, 300);
    const client = new McpClient(URL, net);
    assert.deepEqual((await client.listTools()).map(t => t.name), ["read_record"]);
    assert.equal(client.serverInfo.name, "météo");
    assert.equal(await client.call("read_record", { id: "17" }), "café 東京");
    assert.equal(calls, 1);
    assert.equal(cancelled, 3);
  });
}

test("body deadline is absolute across chunks, aborts transport and releases the reader", { timeout: 2000 }, async () => {
  let cancelled = false;
  let signal: AbortSignal | undefined;
  let interval: ReturnType<typeof setInterval>;
  const net = netFor(async (_input, init = {}) => {
    signal = init.signal!;
    return new Response(new ReadableStream({
      start(c) { interval = setInterval(() => c.enqueue(encoder.encode("heartbeat")), 5); },
      cancel() { cancelled = true; clearInterval(interval); return new Promise<void>(() => {}); },
    }));
  }, 40);
  const res = await request(net, URL);
  try { await assert.rejects(readBody(res), /timeout after 40ms/); }
  finally { clearInterval(interval!); }
  assert.equal(cancelled, true);
  assert.equal(signal!.aborted, true);
  assert.equal(res.body!.locked, false);
});

test("caller abort remains active during a body read", { timeout: 2000 }, async () => {
  let cancelled = false;
  const caller = new AbortController();
  const net = netFor(async () => pending(() => { cancelled = true; }), 1000);
  const res = await request(net, URL, { signal: caller.signal });
  const reading = readBody(res);
  caller.abort(new Error("operator cancelled"));
  await assert.rejects(reading, /operator cancelled/);
  assert.equal(cancelled, true);
  assert.equal(res.body!.locked, false);
});

test("typed discovery rejects oversized contracts and disposes the body", { timeout: 2000 }, async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const net = netFor(async () => new Response(new ReadableStream({
    pull(c) { c.enqueue(chunk); },
    cancel() { cancelled = true; },
  })), 1000);
  const d = await discover(net, URL, { kind: "openapi" });
  assert.equal(d.reflections.length, 0);
  assert.match(d.probes[0].detail!, new RegExp(`exceeds ${DISCOVERY_BODY_LIMIT} bytes`));
  assert.equal(cancelled, true);
});

test("ordinary finite HTTP output is not subject to the discovery byte limit", { timeout: 2000 }, async () => {
  const data = "x".repeat(DISCOVERY_BODY_LIMIT + 1);
  const net = netFor(async () => new Response(data), 1000);
  assert.equal((await readBody(await request(net, URL)) as string).length, data.length);
});

for (const kind of ["openapi", "web", "peer"] as const) {
  test(`typed ${kind} error response is disposed without waiting for cancellation`, { timeout: 1000 }, async () => {
    let cancelled = false;
    const net = netFor(async () => new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise<void>(() => {}); } }), { status: 404 }));
    assert.equal((await discover(net, URL, { kind })).reflections.length, 0);
    assert.equal(cancelled, true);
  });
}

test("redirect and negotiation retry dispose unused bodies without aborting the next request", async () => {
  let cancelled = 0;
  const visited: string[] = [];
  const net = netFor(async (input, init = {}) => {
    visited.push(String(input));
    assert.equal(init.signal!.aborted, false);
    if (visited.length === 1) return new Response(new ReadableStream({ cancel() { cancelled++; return new Promise<void>(() => {}); } }), { status: 302, headers: { location: "/next" } });
    if (visited.length === 2) return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 406 });
    return Response.json({ ok: true });
  });
  const res = await request(net, URL, { headers: { accept: "application/json, text/html" } });
  assert.deepEqual(await readBody(res), { ok: true });
  assert.equal(cancelled, 2);
  assert.equal(visited.length, 3);
});

test("blocked redirect disposes its body and never reaches the disallowed origin", async () => {
  let cancelled = false;
  const visited: string[] = [];
  const net = netFor(async input => {
    visited.push(String(input));
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: "https://denied.test/" } });
  });
  net.policy = { blockPrivate: false, origins: ["https://protocol.test"] };
  await assert.rejects(request(net, URL), /blocked by egress policy/);
  assert.deepEqual(visited, [URL]);
  assert.equal(cancelled, true);
});

test("stream discovery does not grant execution permission to unannotated tools", async () => {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], fetch: async (_input, init = {}) => {
    if (!init.method) return pending();
    const body = JSON.parse(String(init.body));
    if (body.method === "tools/list") return rpc(body, { tools: [{ ...tool, annotations: undefined }] });
    if (body.method === "tools/call") calls++;
    return mcp(body);
  } });
  await rc.learn({ source: URL });
  const cap = rc.graph.list().find(c => c.source === "mcp")!;
  assert.ok(cap);
  assert.equal(cap.risk, "destructive");
  const result = await rc.run(cap.id, { id: "17" }).catch(e => ({ status: "failed", error: String(e) }));
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
});
