// Q09 follow-up (post hoc, not pre-registered): on the build with output views,
// can a client get the EBI Proteins isoform count for P04637 from RightClick X
// without receiving the multi-megabyte payload? The harness calls the MCP tools
// directly (no AI) and compares with truth computed straight from the databases.
//   RCX_FREEZE=lifesci-views-1 node experiments/life-science/views-check.ts [--state <file>]

import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { frozenBuild, HERE, Mcp, serverFiles, TAG, WORK } from "./harness.ts";
import { QUESTIONS } from "./questions.ts";

const argv = process.argv.slice(2);
const state = argv.includes("--state") ? argv[argv.indexOf("--state") + 1] : `${WORK}/lifesci-freeze-3/phase-a-state.json`;
const build = frozenBuild();
const dir = `${WORK}/${TAG}/views-check`;
rmSync(dir, { recursive: true, force: true });
const f = serverFiles(dir);
copyFileSync(state, f.state);
const mcp = new Mcp(build.rcx, f);
await mcp.init();
const id = "openapi:proteins-rest-api:getentriesforisoforms";
const args = { accession: "P04637" };
// Response size as the client receives it (the server pretty-prints the text content).
const call = async (name: string, a: Record<string, unknown>) => {
  const r = await mcp.tool(name, a);
  return { ok: r.ok, ms: r.ms, responseChars: JSON.stringify(r.value, null, 2).length, value: r.value };
};
const plain = await call("context_run", { id, args });
const runId = plain.value.runId;
const counted = await call("context_run_status", { runId, view: { count: true } });
const projected = await call("context_run_status", { runId, view: { select: "accession" } });
const fresh = await call("context_run", { id, args, view: { count: true } });
const full = await call("context_run_status", { runId, view: { full: true } });
await mcp.close();
const truth = await QUESTIONS.find((q) => q.id === "Q09")!.truth();
const out = {
  at: new Date().toISOString(),
  build: { tag: TAG, commit: build.commit },
  startState: state,
  posthoc: true,
  capability: id,
  args,
  truth: truth.parts,
  truthIsoformAccessions: truth.facts.isoformAccessions,
  withoutView: { ok: plain.ok, status: plain.value.status, responseChars: plain.responseChars, outputPresent: plain.value.output !== undefined, outputView: plain.value.outputView, outputDigest: plain.value.receipt?.outputDigest },
  countOfRecordedRun: { ok: counted.ok, responseChars: counted.responseChars, output: counted.value.output },
  accessionsOfRecordedRun: { ok: projected.ok, responseChars: projected.responseChars, output: projected.value.output },
  countOnFreshRun: { ok: fresh.ok, status: fresh.value.status, responseChars: fresh.responseChars, output: fresh.value.output, outputDigest: fresh.value.receipt?.outputDigest },
  fullOnRequest: { ok: full.ok, responseChars: full.responseChars, length: Array.isArray(full.value.output) ? full.value.output.length : null, outputDigest: full.value.receipt?.outputDigest },
};
const n = truth.parts[1];
const verdict = {
  summaryCountMatchesTruth: plain.value.outputView?.total === n,
  countMatchesTruth: counted.value.output === n && fresh.value.output === n,
  accessionsMatchTruth: JSON.stringify(projected.value.output) === JSON.stringify(truth.facts.isoformAccessions),
  fullOutputStillAvailable: full.value.output?.length === n,
  digestOfRecordedRunUnchangedByViews: full.value.receipt?.outputDigest === plain.value.receipt?.outputDigest,
};
writeFileSync(`${HERE}/evidence/views-check-${TAG}.json`, JSON.stringify({ ...out, verdict }, null, 2));
console.log(JSON.stringify({ truth: truth.parts, withoutView: { responseChars: plain.responseChars, outputView: { ...plain.value.outputView, shape: "…" } }, verdict }, null, 1));
