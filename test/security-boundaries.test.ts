// Adversarial tests for security boundaries. Each one reproduces a named risk class. Run against
// unmodified main (c27289e) first, where all five fail, then kept as regressions.
// Record: experiments/security-boundaries/RECORD.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { createHandler } from "../src/interface/http.ts";

// run() refuses an unauthorised destructive call by throwing; either form counts as refused.
const attempt = (p: Promise<any>) => p.catch((e: Error) => ({ status: "failed", error: e.message }));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

test("workspace: a symlink inside the workspace cannot read or write outside it", async () => {
  const outside = mkdtempSync(join(tmpdir(), "rcx-outside-"));
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
  const ws = mkdtempSync(join(tmpdir(), "rcx-ws-"));
  symlinkSync(outside, join(ws, "escape"));
  symlinkSync(join(outside, "secret.txt"), join(ws, "secret-link.txt"));
  const rc = await RightClick.create({ name: "ws", workspace: ws, directories: [], fetch: (async () => json({})) as typeof fetch });
  const id = (fn: string) => rc.graph.list().find((c) => c.id.endsWith(`:${fn}`))!.id;
  for (const p of ["escape/secret.txt", "secret-link.txt"]) {
    const r = await rc.run(id("fs.read"), { path: p });
    assert.equal(r.status, "failed", `read through ${p} must fail`);
    assert.ok(!JSON.stringify(r.output ?? "").includes("TOP SECRET"));
  }
  const w = await rc.run(id("fs.write"), { path: "escape/planted.txt", content: "x" });
  assert.equal(w.status, "failed", "write through a symlinked directory must fail");
  assert.equal(existsSync(join(outside, "planted.txt")), false);
  const w2 = await rc.run(id("fs.write"), { path: "secret-link.txt", content: "overwritten" });
  assert.equal(w2.status, "failed", "write to a symlinked file must fail");
  assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "TOP SECRET");
  // Ordinary use still works.
  mkdirSync(join(ws, "notes"));
  assert.equal((await rc.run(id("fs.write"), { path: "notes/a.txt", content: "hello" })).status, "completed");
  assert.equal((await rc.run(id("fs.read"), { path: "notes/a.txt" })).output, "hello");
});

function shop() {
  const state = { posts: 0, gets: 0, version: 1 };
  const spec = (): any => ({
    openapi: "3.0.0", servers: [{ url: "https://shop.test" }],
    paths: {
      "/orders": { post: { operationId: "createOrder", summary: "Create an order for a product", requestBody: { content: { "application/json": { schema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] } } } },
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { order_id: { type: "string" } } } } } } } } },
      "/orders/{order_id}/receipt": { get: { operationId: "getReceipt", summary: "Get the receipt for an order", parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { receipt_url: { type: "string", format: "uri" } } } } } } } } },
      // A second way to order exists: healing could "route around" the failed one.
      "/checkout": { post: { operationId: "checkout", summary: "Checkout a product as an order", requestBody: { content: { "application/json": { schema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] } } } },
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { order_id: { type: "string" } } } } } } } } },
    },
    // The contract changes after the first failure (drift), which triggers run-level repair.
    info: { title: "Shop", version: String(state.version) },
  });
  const f = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.pathname === "/openapi.json") return json(spec());
    if ((u.pathname === "/orders" || u.pathname === "/checkout") && method === "POST") {
      state.posts++;
      state.version++;
      // The order IS created, then the server fails before answering (a timeout in real life).
      return json({ error: "gateway timeout" }, 504);
    }
    if (u.pathname.endsWith("/receipt")) {
      state.gets++;
      return json({ receipt_url: "https://shop.test/r/1" });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { state, f };
}

test("no automatic retry of a non-idempotent step: a failed POST is not sent again by healing", async () => {
  const { state, f } = shop();
  const rc = await RightClick.create({ name: "shop", fetch: f, directories: [] });
  await rc.learn({ source: "https://shop.test/openapi.json" });
  const r = await rc.compose({ have: { product_id: "P-1" }, want: "url", intent: "order receipt", run: true });
  assert.notEqual(r.executed?.status, "completed");
  assert.equal(state.posts, 1, `the POST was sent ${state.posts} times`);
  // A plain run of the write must not be re-sent by run-level repair either.
  const id = rc.graph.list().find((c) => c.title.startsWith("Create an order"))!.id;
  const before = state.posts;
  await rc.run(id, { product_id: "P-2" });
  assert.equal(state.posts - before, 1, "context_run must not resend a write");
});

test("published goals: GET never executes a goal that can write; POST is required", async () => {
  const state = { posts: 0 };
  const spec = {
    openapi: "3.0.0", info: { title: "Notes" }, servers: [{ url: "https://notes.test" }],
    paths: { "/notes": { post: { operationId: "addNote", summary: "Add a note", requestBody: { content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } } },
      responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } } } } },
  };
  const f = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return json(spec);
    if (u.pathname === "/notes" && (init?.method ?? "GET").toUpperCase() === "POST") {
      state.posts++;
      return json({ id: `n${state.posts}` });
    }
    return json({ error: "nf" }, 404);
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "notes", fetch: f, directories: [] });
  await rc.learn({ source: "https://notes.test/openapi.json" });
  const pub = await rc.compose({ have: { text: "hello" }, want: "json", intent: "add note", run: true, publish: "Add note" });
  assert.equal(pub.executed?.status, "completed");
  const handler = createHandler(rc, { open: true });
  const before = state.posts;
  const get = await handler(new Request("http://local.test/x/add-note?text=from-a-link"));
  assert.equal(get.status, 405, "GET on a writing goal is refused");
  assert.equal(state.posts, before, "nothing was written by the GET");
  const post = await handler(new Request("http://local.test/x/add-note", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "deliberate" }) }));
  assert.equal(post.status, 200);
  assert.equal(state.posts, before + 1);
});

function mcpServer(tools: any[], calls: string[]) {
  return (async (input: any, init?: any) => {
    const body = JSON.parse(init?.body ?? "{}");
    const reply = (result: unknown) => json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "t" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ tools });
    if (body.method === "tools/call") {
      calls.push(body.params.name);
      return reply({ content: [{ type: "text", text: "done" }] });
    }
    return json({ error: "nf" }, 404);
  }) as typeof fetch;
}

test("ambiguous side effects: an MCP tool without annotations is not executable as if it were safe", async () => {
  const calls: string[] = [];
  const f = mcpServer([
    { name: "purge_cache", description: "Purge the cache", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
    { name: "lookup", description: "Look up a key", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  ], calls);
  const rc = await RightClick.create({ name: "mcp", fetch: f, directories: [] });
  await rc.learn({ source: "https://tools.test/mcp" });
  const purge = rc.graph.list().find((c) => c.id.endsWith(":purge-cache") || c.id.endsWith(":purge_cache"))!;
  const lookup = rc.graph.list().find((c) => c.id.endsWith(":lookup"))!;
  assert.equal(lookup.risk, "read");
  // MCP: destructiveHint defaults to true when readOnlyHint is not true. Unknown is unsafe.
  assert.equal(purge.risk, "destructive");
  const r = await attempt(rc.run(purge.id, { key: "k" }));
  assert.equal(r.status, "failed");
  assert.deepEqual(calls, [], "nothing was called");
});

test("authority: an agent's confirm: true is not operator approval for a destructive operation", async () => {
  const calls: string[] = [];
  const f = mcpServer([{ name: "drop_table", description: "Drop a table", annotations: { destructiveHint: true }, inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] } }], calls);
  // Default authority: destructive operations need an operator approval made outside the agent.
  const rc = await RightClick.create({ name: "auth", fetch: f, directories: [] });
  await rc.learn({ source: "https://db.test/mcp" });
  const drop = rc.graph.list().find((c) => /drop/.test(c.id))!;
  const agent = await attempt(rc.run(drop.id, { table: "users" }, { confirm: true }));
  assert.equal(agent.status, "failed", "agent-supplied confirmation alone is refused");
  assert.match(String(agent.error), /operator/i);
  assert.deepEqual(calls, []);
  // An operator approval (configuration, not a tool argument) authorises that capability only.
  const approved = await RightClick.create({ name: "auth2", fetch: f, directories: [], authority: { approve: [drop.id] } });
  await approved.learn({ source: "https://db.test/mcp" });
  assert.equal((await attempt(approved.run(drop.id, { table: "users" }))).status, "failed", "approved, but the agent has still not asked: needs confirm");
  assert.equal((await approved.run(drop.id, { table: "users" }, { confirm: true })).status, "completed");
  assert.deepEqual(calls, ["drop_table"]);
  // The tool interface cannot grant authority.
  const viaTool = await RightClick.create({ name: "auth3", fetch: f, directories: [] });
  await viaTool.learn({ source: "https://db.test/mcp" });
  const r = await attempt(viaTool.run(drop.id, { table: "users", approve: [drop.id] } as any, { confirm: true }));
  assert.equal(r.status, "failed");
});
