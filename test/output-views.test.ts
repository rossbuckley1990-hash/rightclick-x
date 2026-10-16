// Large outputs over the tool interface. Reproduces the life-science Q09 miss
// with a synthetic service: an isoforms endpoint whose answer is a few entries
// but several megabytes, so a client cannot read it whole and needs the count,
// a projection or a slice from the server. The run record and receipt keep the
// full output whatever the client asked to see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch } from "../demo/services.ts";
import { OUTPUT_BUDGET, shape } from "../src/core/view.ts";
import { sha256, stableStringify } from "../src/core/ledger.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { RightClick } from "../src/runtime.ts";

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });

const ISOFORMS = 9;
const isoforms = (accession: string) =>
  Array.from({ length: ISOFORMS }, (_, i) => ({
    accession: i === 0 ? accession : `${accession}-${i + 1}`,
    sequence: { length: 393 - i * 10, value: "M".repeat(400_000) },
    features: Array.from({ length: 50 }, (_, f) => ({ type: "REGION", begin: String(f), end: String(f + 5) })),
    ...(i % 2 ? { comments: [{ type: "ALTERNATIVE PRODUCTS" }] } : {}),
  }));

async function lab() {
  const calls: string[] = [];
  const spec = {
    openapi: "3.0.1",
    info: { title: "Isoforms", version: "1" },
    servers: [{ url: "https://iso.test" }],
    paths: {
      "/isoforms/{accession}": { get: { operationId: "getIsoforms", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } } } },
      "/entry/{accession}": { get: { operationId: "getEntry", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } },
    },
  };
  const iso = async (r: Request) => {
    const p = new URL(r.url).pathname;
    if (p === "/openapi.json") return json(spec);
    calls.push(p);
    if (p.startsWith("/isoforms/")) return json(isoforms(p.split("/").pop()!));
    if (p.startsWith("/entry/")) return json({ accession: p.split("/").pop(), length: 393 });
    return new Response("not found", { status: 404 });
  };
  const rc = await RightClick.create({ fetch: routerFetch({ "https://iso.test": iso }), directories: [] });
  await rc.learn({ source: "https://iso.test/openapi.json" });
  let id = 0;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res: any = await handle(rc, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
    return { ...res.result, out: res.result.structuredContent, chars: res.result.content[0].text.length };
  };
  return { rc, calls, tool };
}

const ISO = "openapi:isoforms:getisoforms";

test("an oversized output is withheld whole and summarised by size, count and shape; the record keeps all of it", async () => {
  const { rc, tool } = await lab();
  const full = isoforms("P04637");
  const r = await tool("context_run", { id: ISO, args: { accession: "P04637" } });
  assert.equal(r.isError, false);
  assert.ok(JSON.stringify(full).length > 3_000_000, "the synthetic answer is multi-megabyte");
  assert.ok(r.chars < OUTPUT_BUDGET * 2, `the tool response is small enough to read (${r.chars} chars)`);
  assert.equal(r.out.status, "completed");
  assert.equal(r.out.output, undefined, "never a cut-down copy that looks complete");
  const v = r.out.outputView;
  assert.equal(v.omitted, true);
  assert.equal(v.total, ISOFORMS, "the count is in the summary");
  assert.equal(v.chars, JSON.stringify(full).length);
  assert.match(v.reason, /withheld whole/);
  assert.match(v.hint, /context_run_status/);
  assert.equal(v.shape.array, ISOFORMS);
  assert.deepEqual(Object.keys(v.shape.of).sort(), ["accession", "comments", "features", "sequence"], "optional keys of later elements are in the shape");
  // Stored run and receipt are about the whole output.
  assert.deepEqual(rc.runs.get(r.out.runId)!.output, full);
  assert.equal(r.out.receipt.outputDigest, await sha256(stableStringify(full)));
});

test("count, projection and slice come back from the server; context_run_status views a recorded run without calling upstream again", async () => {
  const { tool, calls } = await lab();
  const counted = await tool("context_run", { id: ISO, args: { accession: "P04637" }, view: { count: true } });
  assert.equal(counted.out.output, ISOFORMS);
  assert.equal(counted.out.outputView.total, ISOFORMS);
  assert.equal(calls.length, 1);
  const runId = counted.out.runId;

  const projected = await tool("context_run_status", { runId, view: { fields: ["accession", "sequence.length"] } });
  assert.equal(projected.out.output.length, ISOFORMS);
  assert.deepEqual(projected.out.output[0], { accession: "P04637", "sequence.length": 393 });
  assert.deepEqual(projected.out.output.at(-1), { accession: "P04637-9", "sequence.length": 313 });

  const mapped = await tool("context_run_status", { runId, view: { select: "accession" } });
  assert.deepEqual(mapped.out.output, ["P04637", ...Array.from({ length: 8 }, (_, i) => `P04637-${i + 2}`)], "select maps over arrays like verify paths");

  const sliced = await tool("context_run_status", { runId, view: { offset: 2, limit: 3, fields: ["accession"] } });
  assert.deepEqual(sliced.out.output, [{ accession: "P04637-3" }, { accession: "P04637-4" }, { accession: "P04637-5" }]);
  assert.equal(sliced.out.outputView.total, ISOFORMS, "the total is reported next to a slice");

  const nested = await tool("context_run_status", { runId, view: { select: "0.features", count: true } });
  assert.equal(nested.out.output, 50);

  const text = await tool("context_run_status", { runId, view: { select: "0.sequence.value", offset: 0, limit: 5 } });
  assert.equal(text.out.output, "MMMMM");
  assert.equal(text.out.outputView.total, 400_000);

  assert.equal(calls.length, 1, "views of a recorded run never call the upstream API again");
});

test("full:true returns the whole output on request, with the same digest as the summarised run", async () => {
  const { tool } = await lab();
  const summarised = await tool("context_run", { id: ISO, args: { accession: "P04637" } });
  const whole = await tool("context_run_status", { runId: summarised.out.runId, view: { full: true } });
  assert.deepEqual(whole.out.output, isoforms("P04637"));
  assert.equal(whole.out.receipt.outputDigest, summarised.out.receipt.outputDigest);
  const fresh = await tool("context_run", { id: ISO, args: { accession: "P04637" }, view: { full: true } });
  assert.equal(fresh.out.output.length, ISOFORMS);
  assert.equal(fresh.out.receipt.outputDigest, summarised.out.receipt.outputDigest, "the view never changes what is hashed");
  // A view that still exceeds the budget is withheld too, unless full is asked for.
  const big = await tool("context_run_status", { runId: summarised.out.runId, view: { select: "sequence.value" } });
  assert.equal(big.out.outputView.omitted, true);
  assert.equal(big.out.output, undefined);
  assert.equal(big.out.outputView.shape.array, ISOFORMS);
});

test("small outputs are returned as before; a missing select path is reported, not mistaken for an empty answer", async () => {
  const { tool } = await lab();
  const small = await tool("context_run", { id: "openapi:isoforms:getentry", args: { accession: "P04637" } });
  assert.deepEqual(small.out.output, { accession: "P04637", length: 393 });
  assert.equal(small.out.outputView, undefined, "no view, small output: response unchanged");
  const missing = await tool("context_run", { id: "openapi:isoforms:getentry", args: { accession: "P04637" }, view: { select: "isoforms" } });
  assert.equal(missing.out.status, "completed");
  assert.equal(missing.out.output, null);
  assert.equal(missing.out.outputView.found, false);
  assert.deepEqual(missing.out.outputView.shape, { accession: "string", length: "number" });
  const notCountable = await tool("context_run", { id: "openapi:isoforms:getentry", args: { accession: "P04637" }, view: { select: "length", count: true } });
  assert.equal(notCountable.out.output, null);
  assert.match(notCountable.out.outputView.hint, /count applies/);
});

test("a malformed view is rejected before the capability runs", async () => {
  const { tool, calls, rc } = await lab();
  for (const view of [{ selct: "x" }, { limit: -1 }, { fields: "accession" }, { count: "yes" }, ["count"]]) {
    const r = await tool("context_run", { id: ISO, args: { accession: "P04637" }, view });
    assert.equal(r.isError, true, JSON.stringify(view));
  }
  assert.equal(calls.length, 0, "no upstream call for a rejected view");
  assert.equal(rc.chain.receipts.length, 0, "and no receipt");
});

test("path-less checks on a large output report its size instead of echoing it once per predicate", async () => {
  const { tool } = await lab();
  const verify = [8, 9, 10].map((n) => ({ op: "length_gt", value: n }));
  const r = await tool("context_run", { id: ISO, args: { accession: "P04637" }, verify, view: { count: true } });
  assert.ok(r.chars < 10_000, `${r.chars} chars`);
  assert.equal(r.out.status, "failed", "length_gt 9 and 10 are refuted for 9 entries");
  assert.deepEqual(r.out.verification.results.map((x: any) => x.ok), [true, false, false]);
  assert.deepEqual(r.out.verification.results[0].actual, { omitted: "array", length: ISOFORMS, chars: JSON.stringify(isoforms("P04637")).length });
  assert.match(r.out.error, /verification refuted/);
  assert.equal(r.out.output, ISOFORMS, "a refuted run still shows the viewed output");
});

test("context_compose applies the same guard and views to its executed output", async () => {
  const { tool } = await lab();
  const goal = { have: { accession: "P04637" }, want: "list:json", run: true, through: [ISO] };
  const plain = await tool("context_compose", goal);
  assert.equal(plain.out.executed.status, "completed");
  assert.equal(plain.out.executed.output, undefined);
  assert.equal(plain.out.executed.outputView.omitted, true);
  assert.equal(plain.out.executed.outputView.total, ISOFORMS);
  assert.ok(plain.chars < OUTPUT_BUDGET * 2, `${plain.chars} chars`);
  const counted = await tool("context_compose", { ...goal, view: { count: true } });
  assert.equal(counted.out.executed.output, ISOFORMS);
  const step = await tool("context_run_status", { runId: counted.out.executed.runs.at(-1), view: { select: "accession", offset: 8 } });
  assert.deepEqual(step.out.output, ["P04637-9"], "the step's recorded output is reachable without re-running");
});

test("shape outlines types without values", () => {
  assert.deepEqual(shape({ a: [1, 2], b: { c: "x".repeat(100) }, d: null, e: [] }), { a: { array: 2, of: ["number"] }, b: { c: "string(100)" }, d: "null", e: { array: 0 } });
});
