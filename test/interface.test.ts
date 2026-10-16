import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHandler } from "../src/interface/http.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { TOOLS } from "../src/interface/tools.ts";
import edge from "../src/entry/edge.ts";
import { learnAll, world } from "./helpers.ts";

test("MCP: thirteen context_* tools, stable no matter how the graph grows", async () => {
  const { rc } = await world();
  const init: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  const list = async () => ((await handle(rc, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as any).result.tools.map((t: any) => t.name);
  const before = await list();
  assert.equal(before.length, 13);
  const annotated: any = await handle(rc, { jsonrpc: "2.0", id: 9, method: "tools/list" });
  const ann = Object.fromEntries(annotated.result.tools.map((t: any) => [t.name, t.annotations]));
  assert.equal(ann.context_inspect.readOnlyHint, true);
  assert.equal(ann.context_learn.readOnlyHint, false);
  assert.equal(ann.context_run.destructiveHint, true);
  assert.ok(annotated.result.tools.every((t: any) => t.annotations && t.title), "every tool declares annotations and a title");
  assert.ok(before.every((n: string) => n.startsWith("context_")));
  await learnAll(rc);
  assert.deepEqual(await list(), before);
  const call: any = await handle(rc, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "context_compose", arguments: { have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true } },
  });
  assert.equal(call.result.isError, false);
  assert.match(call.result.structuredContent.executed.output, /°C/);
  const bad: any = await handle(rc, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "context_run", arguments: { id: "nope" } } });
  assert.equal(bad.result.isError, true);
  assert.equal(await handle(rc, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("HTTP: public manifest, token lock, API and MCP routes", async () => {
  const { rc } = await world();
  const locked = createHandler(rc, {});
  assert.equal((await locked(new Request("https://h.test/.well-known/rightclick.json"))).status, 200);
  assert.equal((await locked(new Request("https://h.test/api/runtime", { method: "POST" }))).status, 401, "no token configured => API locked");

  const h = createHandler(rc, { token: "s3cret" });
  assert.equal((await h(new Request("https://h.test/api/runtime", { method: "POST", headers: { authorization: "Bearer nope" } }))).status, 401);
  const auth = { authorization: "Bearer s3cret", "content-type": "application/json" };
  const rt: any = await (await h(new Request("https://h.test/api/runtime", { method: "POST", headers: auth, body: "{}" }))).json();
  assert.equal(rt.product, "RightClick X");
  const insp: any = await (await h(new Request("https://h.test/api/inspect", { method: "POST", headers: auth, body: JSON.stringify({ value: "https://a.test" }) }))).json();
  assert.equal(insp.type, "url");
  const mcp: any = await (await h(new Request("https://h.test/mcp", { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))).json();
  assert.equal(mcp.result.tools.length, TOOLS.length);
  const dash = await h(new Request("https://h.test/"));
  assert.match(await dash.text(), /RightClick <span>X<\/span>/);
});

test("HTTP: /events streams graph changes as server-sent events", async () => {
  const { rc } = await world();
  const h = createHandler(rc, { open: true });
  const res = await h(new Request("https://h.test/events"));
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.getReader();
  void rc.learn({ source: "https://polyglot.test/openapi.json" });
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /^data: .*"provider\.learned"/);
  await reader.cancel();
});

test("edge entry: default export fetch handler with env bindings and token", async () => {
  const kv = new Map<string, string>();
  const KV = { get: async (k: string, t?: string) => (t === "json" ? JSON.parse(kv.get(k) ?? "null") : (kv.get(k) ?? null)), put: async (k: string, v: string) => void kv.set(k, v), list: async () => ({ keys: [] }) };
  const env = { RCX_TOKEN: "edge-token", RCX_NAME: "edge-test", CACHE: KV, RCX_STATE: KV };
  const waits: Promise<unknown>[] = [];
  const req = new Request("https://edge.test/api/runtime", { method: "POST", headers: { authorization: "Bearer edge-token" } });
  (req as any).cf = { colo: "LIS", country: "PT" };
  const res = await edge.fetch(req, env, { waitUntil: (p) => waits.push(p) });
  const body: any = await res.json();
  assert.equal(body.name, "edge-test");
  assert.equal(body.runtime.region, "LIS");
  const tools: any = await (await edge.fetch(new Request("https://edge.test/api/providers", { method: "POST", headers: { authorization: "Bearer edge-token" } }), env)).json();
  assert.ok(tools.some((p: any) => p.id.startsWith("platform:") && p.capabilities >= 2), "KV binding became capabilities");
  await Promise.all(waits);
  assert.ok(kv.has("rcx-state"), "graph state persisted to the KV binding");
  assert.equal((await edge.fetch(new Request("https://edge.test/api/runtime", { method: "POST" }), env)).status, 401);
});

test("stdio MCP: the CLI speaks newline-delimited JSON-RPC", async () => {
  const dir = await mkdtemp(`${tmpdir()}/rcx-stdio-`);
  const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], { env: { ...process.env, RCX_STATE_FILE: `${dir}/state.json` }, stdio: ["pipe", "pipe", "inherit"] });
  const lines: any[] = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "context_inspect", arguments: { value: "ada@example.com" } } });
  const deadline = Date.now() + 15000;
  while (lines.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  assert.equal(lines[0].result.serverInfo.name, "rightclick-x");
  assert.equal(lines[1].result.tools.length, 13);
  assert.equal(lines[2].result.structuredContent.type, "email");
});
