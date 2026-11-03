import test from "node:test";
import assert from "node:assert/strict";
import { CodexResponsesFallback } from "../src/codex-fallback.ts";
import type { RepairContext } from "../src/recovery.ts";
const context: RepairContext = { schema: "rightclick-x/repair-context@1", contractHash: "hash", missing: "semantically-compatible-plan", inputs: { text: "text" }, want: "text", intent: "uppercase", capabilities: [], constraints: [] };
const limits = { maxInputBytes: 1000, maxOutputTokens: 100, timeoutMs: 1000 };
function completion() { return { status: "completed", model: "operator-selected-codex", usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 10, total_tokens: 110 },
  output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"capability":"cap","inputBindings":{"payload":"text"}}' }] }] }; }
function adapter(fetcher: typeof fetch) { return new CodexResponsesFallback({ model: "operator-selected-codex", apiKey: "synthetic-test-key", fetch: fetcher, reservationUsd: 1,
  prices: { inputPerMillion: 2, cachedInputPerMillion: 1, outputPerMillion: 4, source: "synthetic arithmetic fixture, not current prices" } }); }
test("bounded model proposal accounts complete usage without retaining prompt, credential or reasoning", async () => {
  let calls = 0;
  const a = adapter(async (_url, init) => { calls++; const r = JSON.parse(String(init!.body)); assert.equal(r.store, false); assert.deepEqual(r.tools, []); assert.equal(r.max_output_tokens, 100); return Response.json(completion()); });
  const r = await a.propose(context, limits, new AbortController().signal);
  assert.equal(r.usage.cachedInputTokens, 20);
  assert.equal(a.accounting()!.state, "settled");
  assert.equal(a.accounting()!.settledUsd, 0.00022);
  assert.ok(!JSON.stringify(a.accounting()).includes("synthetic-test-key"));
  await assert.rejects(a.propose(context, limits, new AbortController().signal), /budget/);
  assert.equal(calls, 1);
});
for (const mutation of ["truncated", "cached", "total", "status", "model", "oversize", "network"]) test(`unvalidated ${mutation} retains reservation and never retries`, async () => {
  const a = adapter(async () => {
    const r = completion();
    if (mutation === "truncated") return new Response('{"status":');
    if (mutation === "cached") r.usage.input_tokens_details.cached_tokens = 101;
    if (mutation === "total") r.usage.total_tokens = 99;
    if (mutation === "status") r.status = "incomplete";
    if (mutation === "model") r.model = "different-model";
    if (mutation === "oversize") return new Response("x".repeat(128001));
    if (mutation === "network") throw new Error("sensitive body or credential should not be recorded");
    return Response.json(r);
  });
  await assert.rejects(a.propose(context, limits, new AbortController().signal));
  assert.equal(a.accounting()!.state, "ambiguous");
  assert.equal(a.accounting()!.reservedUsd, 1);
  assert.equal(a.accounting()!.settledUsd, null);
  assert.ok(!JSON.stringify(a.accounting()).includes("sensitive"));
});
