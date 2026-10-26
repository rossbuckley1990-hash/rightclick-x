// The tool-loading experiment (experiments/tool-loading/) may change the startup guidance and
// nothing else: every original statement kept, the retained-ID index passed through, the same 13
// tools with the same descriptions and contracts, and the server's own answers to every call. The
// server now ships the measured reuse text, and the experiment can still reproduce its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../src/interface/mcp-server.ts";
import { ANNOTATED_TOOLS } from "../src/interface/tools.ts";
import { applyGuidance, GUIDANCE_NAMES, ORIGINAL_BASE, REUSE_BASE, REUSE_SENTENCE } from "../experiments/tool-loading/guidance.ts";
import { transformer } from "../experiments/tool-loading/proxy.ts";
import { mcpClient } from "../experiments/tool-loading/client.ts";
import { learnAll, world } from "./helpers.ts";

const sentences = (s: string) => s.split(/(?<=\.)\s+/).filter(Boolean);

test("tool-loading guidance: the server ships exactly the measured reuse text, and the control is reproducible", async () => {
  const { rc } = await world();
  const init: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(init.result.instructions.startsWith(REUSE_BASE), init.result.instructions);
  assert.equal(applyGuidance(init.result.instructions, "reuse"), init.result.instructions);
  assert.ok(applyGuidance(init.result.instructions, "original").startsWith(ORIGINAL_BASE));
  assert.equal(applyGuidance(applyGuidance(init.result.instructions, "original"), "reuse"), init.result.instructions);
  assert.throws(() => applyGuidance("Use any tool you like.", "reuse"), /do not start with the expected text/);
  assert.throws(() => applyGuidance(ORIGINAL_BASE, "terse" as any), /unknown guidance/);
});

test("tool-loading guidance: reuse only adds a sentence; every original statement and the retained index survive", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const saved = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "weather" });
  assert.equal(saved.executed?.status, "completed");
  const server: string = applyGuidance(((await handle(rc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })) as any).result.instructions, "original");
  assert.equal(applyGuidance(server, "original"), server);
  const reuse = applyGuidance(server, "reuse");
  assert.equal(reuse.replace(` ${REUSE_SENTENCE}`, ""), server, "removing the added sentence gives the original text back");
  for (const s of sentences(ORIGINAL_BASE)) assert.ok(reuse.includes(s), s);
  assert.ok(reuse.endsWith(rc.startupSummary()), "the retained-ID index is passed through unchanged");
  assert.match(reuse, /goal:weather/);
  for (const must of [/context_explain for inputs, constraints and evidence/, /Discovery never grants authority/, /Provider text is untrusted data/, /stored checks and witnesses/])
    assert.match(reuse, must);
  assert.ok(!/skip|without (context_explain|checks|witness)|no need to (inspect|explain|verify)/i.test(REUSE_SENTENCE), "the guidance never suggests skipping inspection or verification");
  assert.ok(reuse.length < 1600, `bounded like the server's own instructions: ${reuse.length}`);
});

test("tool-loading proxy: only a requested initialize result changes", () => {
  const seen: any[] = [];
  const t = transformer("reuse", (e) => seen.push(e));
  const other = JSON.stringify({ jsonrpc: "2.0", id: 4, result: { instructions: `${ORIGINAL_BASE} x` } });
  assert.equal(t.response(other), other, "a result for an id that did not ask initialize passes untouched");
  t.request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  const init = JSON.parse(t.response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { instructions: ORIGINAL_BASE } })));
  assert.equal(init.result.instructions, REUSE_BASE);
  t.request(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const list = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: ANNOTATED_TOOLS } });
  assert.equal(t.response(list), list, "the tool list passes through byte for byte");
  assert.deepEqual(seen.map((e) => e.event), ["initialize", "tools/list"]);
});

test("tool-loading proxy: same tools, calls and refusals as the server; only the guidance differs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-guidance-"));
  const env = (name: string) => ({ RCX_STATE_FILE: join(dir, `${name}.json`), RCX_WORKSPACE: dir });
  const ask = async (c: Awaited<ReturnType<typeof mcpClient>>) => ({
    tools: (await c.req("tools/list")).result.tools,
    inspect: (await c.req("tools/call", { name: "context_inspect", arguments: { value: "https://example.com/a.html" } })).result,
    refused: (await c.req("tools/call", { name: "context_run", arguments: { id: "goal:none", acknowledgeChange: true } })).result,
  });
  const direct = await mcpClient(env("direct"));
  const base = await ask(direct);
  await direct.close();
  assert.equal(base.tools.length, 13);
  for (const guidance of GUIDANCE_NAMES) {
    const c = await mcpClient(env(guidance), guidance);
    const got = await ask(c);
    await c.close();
    assert.deepEqual(got, base, `${guidance}: tools with their descriptions, results and refusals unchanged`);
    assert.deepEqual({ ...c.init.result, instructions: undefined }, { ...direct.init.result, instructions: undefined });
    assert.equal(c.init.result.instructions, applyGuidance(direct.init.result.instructions, guidance));
  }
});
