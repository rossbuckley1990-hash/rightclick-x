// Existing A1–A4 redirect security checks from verified source 6b22a59.
// Test bodies and fixtures are unchanged; unrelated host-sandbox tests are not imported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
const DUMMY = "dummy-credential-7f3a9c";
const urlOf = (input: string | URL | Request) => (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

const itemsSpec = {
  openapi: "3.0.0",
  info: { title: "Items", version: "1" },
  servers: [{ url: "https://api.a.test" }],
  paths: {
    "/items/{id}": {
      get: {
        operationId: "getItem",
        summary: "Get an item",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "X-Api-Key", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } } },
      },
    },
  },
};

test("A1 redirect: a caller-supplied credential header (OpenAPI header parameter) never reaches another origin", async () => {
  const seen: Array<{ origin: string; key: string | null }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    const h = new Headers(init?.headers);
    if (url.endsWith("/openapi.json")) return Response.json(itemsSpec);
    seen.push({ origin: new URL(url).origin, key: h.get("x-api-key") });
    if (url.startsWith("https://api.a.test/items/")) return new Response(null, { status: 302, headers: { location: "https://collector.evil.test/c" } });
    return Response.json({ name: "widget" });
  }) as typeof fetch;
  const rc = await RightClick.create({ fetch: f, directories: [] });
  await rc.learn({ source: "https://api.a.test/openapi.json" });
  const cap = rc.graph.list().find((c) => c.invoke.kind === "http" && /getitem/i.test(c.id));
  assert.ok(cap, "the operation was learned");
  await rc.run(cap!.id, { id: "7", "X-Api-Key": DUMMY });
  assert.ok(seen.some((s) => s.origin === "https://api.a.test" && s.key === DUMMY), "the credential reached its own origin");
  const leaked = seen.filter((s) => s.origin !== "https://api.a.test" && s.key);
  assert.deepEqual(leaked, [], "no caller credential at any other origin");
});

test("A2 redirect: Proxy-Authorization, Cookie and custom headers stay on the original origin, including A -> B -> A", async () => {
  const { Authority, request } = await import("../src/reflectors/net.ts");
  const seen: Array<{ origin: string; path: string; h: Record<string, string> }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    seen.push({ origin: url.origin, path: url.pathname, h: Object.fromEntries(new Headers(init?.headers)) });
    if (url.origin === "https://a.test" && url.pathname === "/start") return new Response(null, { status: 302, headers: { location: "https://b.test/hop" } });
    if (url.origin === "https://b.test") return new Response(null, { status: 302, headers: { location: "https://a.test/attacker-chosen" } });
    return new Response("ok");
  }) as typeof fetch;
  const headers = { "Proxy-Authorization": `Basic ${DUMMY}`, Cookie: `s=${DUMMY}`, "X-Session-Token": DUMMY, "X-Custom-Auth": DUMMY, Accept: "text/plain" };
  const res = await request({ fetch: f, auth: new Authority(), timeoutMs: 5000 }, "https://a.test/start", { headers });
  assert.equal(await res.text(), "ok");
  const first = seen[0];
  assert.equal(first.h["x-session-token"], DUMMY, "the original request carries the caller's headers");
  for (const s of seen.slice(1)) {
    const carried = Object.entries(s.h).filter(([, v]) => v.includes(DUMMY)).map(([k]) => k);
    assert.deepEqual(carried, [], `${s.origin}${s.path} received caller credentials: ${carried.join(", ")}`);
  }
  assert.equal(seen[1].h.accept, "text/plain", "non-sensitive negotiation headers still travel");
});

test("A3 redirect: a request body is never re-sent to another origin (307/308)", async () => {
  const { Authority, request } = await import("../src/reflectors/net.ts");
  const bodies: Array<{ origin: string; body: string }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    bodies.push({ origin: url.origin, body: String(init?.body ?? "") });
    if (url.origin === "https://a.test") return new Response(null, { status: 307, headers: { location: "https://b.test/sink" } });
    return new Response("ok");
  }) as typeof fetch;
  const res = await request({ fetch: f, auth: new Authority(), timeoutMs: 5000 }, "https://a.test/orders", { method: "POST", body: JSON.stringify({ card: DUMMY }), headers: { "content-type": "application/json" } });
  assert.ok(res.status === 307 || res.status >= 400, `not followed (status ${res.status})`);
  assert.deepEqual(bodies.filter((b) => b.origin !== "https://a.test"), [], "the body did not reach another origin");
});

test("A4 redirect: same-origin redirects keep the caller's headers; pinned credentials still apply per origin", async () => {
  const { Authority, request } = await import("../src/reflectors/net.ts");
  const seen: Array<{ url: string; key: string | null; pinned: string | null }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    const h = new Headers(init?.headers);
    seen.push({ url, key: h.get("x-api-key"), pinned: h.get("authorization") });
    if (url === "https://a.test/v1/x") return new Response(null, { status: 301, headers: { location: "/v2/x" } });
    if (url === "https://a.test/v2/x") return new Response(null, { status: 302, headers: { location: "https://b.test/y" } });
    return new Response("ok");
  }) as typeof fetch;
  const auth = new Authority();
  auth.set("https://b.test", { Authorization: "Bearer pinned-b" });
  await request({ fetch: f, auth, timeoutMs: 5000 }, "https://a.test/v1/x", { headers: { "X-Api-Key": DUMMY } });
  assert.equal(seen[1].key, DUMMY, "same-origin hop keeps the caller's header");
  assert.equal(seen[2].key, null, "cross-origin hop drops it");
  assert.equal(seen[2].pinned, "Bearer pinned-b", "the operator's credential for b.test still applies at b.test");
});

for (const destructiveHint of [true, "true"]) {
  test(`MCP contradictory annotations cannot weaken main's destructive gate (${typeof destructiveHint})`, async () => {
    let calls = 0;
    const rc = await RightClick.create({ directories: [], fetch: async (_input, init = {}) => {
      if (!init.method) return new Response(null, { status: 405 });
      const body = JSON.parse(String(init.body));
      if (body.query) return new Response(null, { status: 405 });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call") calls++;
      const result = body.method === "initialize" ? { serverInfo: { name: "risk-fixture" } }
        : body.method === "tools/list" ? { tools: [{ name: "conflicting_tool", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint } }] }
        : { content: [{ type: "text", text: "must not execute" }] };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    } });
    await rc.learn({ source: "https://risk.test/mcp" });
    const cap = rc.graph.list().find(c => c.source === "mcp");
    assert.ok(cap, "the tool must be discovered before its execution gate is tested");
    assert.equal(cap.risk, "destructive");
    const result = await rc.run(cap.id, {}).catch(e => ({ status: "failed", error: String(e) }));
    assert.equal(result.status, "failed");
    assert.equal(calls, 0, "contradictory or malformed annotations must not authorize execution");
  });
}
