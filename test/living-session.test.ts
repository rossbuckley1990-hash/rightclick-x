import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { RpcPeer, holdPresentation, type Wire } from "../experiments/living/challenge-session.ts";

const origin = "https://document.test";
const contract = { openapi: "3.1.0", info: { title: "Documents" }, servers: [{ url: origin }], paths: {
  "/render": { post: { operationId: "render", summary: "Render document",
    requestBody: { required: true, content: { "application/json": { schema: { type: "object",
      required: ["text"], properties: { text: { type: "string" } } } } } },
    responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } } } } },
} };
const wireReply = (body: unknown, json = true) => ({ response: { status: 200,
  headers: { "content-type": json ? "application/json" : "text/plain" },
  body: Buffer.from(json ? JSON.stringify(body) : String(body)).toString("base64") } });
async function host(t: TestContext) {
  const output = mkdtempSync(join(tmpdir(), "rcx-session-test-"));
  t.diagnostic("session transcript: " + join(output, "session.jsonl"));
  const requests: Wire[] = [], tools: any[] = [];
  let allowed = false;
  const child = spawn(process.execPath, [new URL("../experiments/living/challenge-host.ts", import.meta.url).pathname],
    { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", data => { stderr += data; });
  const peer = new RpcPeer(child, join(output, "session.jsonl"), async wire => {
    requests.push(wire);
    if (wire.url === origin + "/catalog") return wireReply({ linkset: [{ "service-desc": [{ href: origin + "/spec", type: "application/vnd.oai.openapi+json" }] }] });
    if (wire.url === origin + "/spec") return wireReply(contract);
    if (!allowed) return { refused: true, reason: "operator has not authorized this action" };
    assert.equal(wire.url, origin + "/render");
    return wireReply(JSON.parse(Buffer.from(wire.body, "base64").toString()).text.toUpperCase(), false);
  }, row => tools.push(row));
  t.after(async () => {
    try { await peer.call("close"); child.stdin.end(); } finally { child.kill("SIGTERM"); await peer.exited; }
    assert.equal(stderr, "");
  });
  await peer.call("configure", { config: { origins: [origin], environment: { catalogs: [origin + "/catalog"] } } });
  return { peer, requests, tools, allow: () => { allowed = true; } };
}
async function tool(peer: RpcPeer, name: string, args: object = {}) {
  const envelope: any = await (await peer.http("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
  assert.equal(envelope.error, undefined);
  return JSON.parse(envelope.result.content[0].text);
}

test("one persistent handler shares discovery, denied execution, retained reuse and dashboard state", async t => {
  const { peer, requests, tools, allow } = await host(t);
  const baseline = await peer.call("snapshot");
  const list: any = await (await peer.http("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  assert.equal(list.result.tools.length, 13);
  await tool(peer, "context_research");
  const after = await peer.call("snapshot");
  assert.ok(after.graph.capabilities.length > baseline.graph.capabilities.length);
  assert.equal(after.state.published.length, 0, "discovery established no executable goal");
  const denied = await tool(peer, "context_run", { id: "openapi:documents:render", args: { text: "one" } });
  assert.equal(denied.status, "failed");
  assert.ok(denied.refusal);
  allow();
  const composed = await tool(peer, "context_compose", { have: { text: "one" }, want: "text", intent: "render document",
    through: ["openapi:documents:render"], run: true, publish: "Rendered document", verify: [{ op: "matches", pattern: "^[A-Z]+$" }] });
  assert.equal(composed.executed.status, "completed");
  assert.equal(composed.executed.output, "ONE");
  const before = requests.length;
  const reused: any = await (await peer.http("/x/rendered-document", { text: "two" })).json();
  assert.equal(reused.ok, true);
  assert.equal(reused.result, "TWO");
  assert.equal(requests.length - before, 1);
  const final = await peer.call("snapshot");
  assert.ok(final.state.published.some((g: any) => g.slug === "rendered-document"));
  assert.ok(tools.length >= 3);
  const dashboard: any = await (await peer.http("/api/viz")).json();
  assert.ok(JSON.stringify(dashboard).includes("Rendered document"));
});

test("live graph events remain responsive while ordinary tool requests execute", async t => {
  const { peer } = await host(t);
  const chunks: string[] = [];
  const cancel = new AbortController();
  const response = await peer.call("http", { request: { method: "GET", url: "http://session.local/events?since=0", headers: {}, body: "" } },
    chunk => { if (chunk.body) chunks.push(Buffer.from(chunk.body, "base64").toString()); }, cancel.signal);
  assert.equal(response.stream, true);
  await tool(peer, "context_research");
  const snapshot = await peer.call("snapshot");
  assert.ok(snapshot.graph.capabilities.some((c: any) => c.id === "openapi:documents:render"));
  assert.match(chunks.join(""), /provider|capability/);
  cancel.abort();
  assert.ok((await peer.call("snapshot")).state);
});

test("presentation finishes on closed pipes and bounded expiry without leaking signal handlers", async () => {
  const before = process.listenerCount("SIGTERM");
  const input = new PassThrough();
  const hold = holdPresentation(input, 500);
  input.end();
  await hold;
  assert.equal(process.listenerCount("SIGTERM"), before);
  await holdPresentation(input);
  await holdPresentation(new PassThrough(), 5);
  assert.equal(process.listenerCount("SIGTERM"), before);
});

test("a missing session executable rejects readiness and calls instead of hanging", async () => {
  const output = mkdtempSync(join(tmpdir(), "rcx-session-missing-"));
  const child = spawn(join(output, "absent"), [], { stdio: ["pipe", "pipe", "pipe"] });
  const peer = new RpcPeer(child, join(output, "session.jsonl"));
  await assert.rejects(peer.ready, /ENOENT/);
  assert.equal(await peer.exited, null);
  await assert.rejects(peer.call("configure"), /ENOENT/);
});
