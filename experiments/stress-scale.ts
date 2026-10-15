// X1: how big can the graph get? Learn N synthetic providers in batches and
// measure learning throughput, memory, graph size, planning and search.
//   node experiments/stress-scale.ts [providers=2000]

import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { universeHandler } from "./universe.ts";

const N = Number(process.argv[2] ?? 2000);
const BATCH = 100;
const ORIGIN = "https://universe.test";
const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: universeHandler() }), directories: [] });
const mb = () => Math.round(process.memoryUsage().rss / 1e6);
const rows = [];
const t0 = performance.now();
for (let i = 0; i < N; i += BATCH) {
  const t = performance.now();
  await rc.learn({ sources: Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => `${ORIGIN}/p/${i + k}/openapi.json`) });
  const learnMs = Math.round(performance.now() - t);
  const tp = performance.now();
  const p = rc.graph.powers();
  const powersMs = Math.round(performance.now() - tp);
  const row = { providers: i + BATCH, capabilities: p.capabilities, edges: p.edges, powers: p.total, learnMs, powersMs, rssMB: mb() };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tq = performance.now();
const plans = await rc.compose({ have: { city: "Lisbon" }, want: "language", maxSteps: 4, limit: 5 });
const planMs = Math.round(performance.now() - tq);
const tr = performance.now();
const run = await rc.compose({ have: { city: "Lisbon" }, want: "language", maxSteps: 4, run: true });
const runMs = Math.round(performance.now() - tr);
const ts = performance.now();
const search = rc.graph.search("translate summary into language", 5);
const searchMs = Math.round(performance.now() - ts);
console.log(JSON.stringify({ totalMs: Math.round(performance.now() - t0), planMs, plans: plans.plans.length, example: plans.plans[0]?.titles, runMs, runStatus: run.executed?.status, steps: run.executed?.titles.length, searchMs, top: search[0]?.capability.title, rssMB: mb() }));
