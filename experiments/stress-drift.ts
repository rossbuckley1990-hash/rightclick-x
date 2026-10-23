// X3: drift storm. 50 providers, each independently and randomly jumping
// between four breaking contracts (REST v1, REST v2, GraphQL, MCP) while a
// continuous stream of integration calls runs. Measures availability of
// verified results and how often the runtime had to re-learn the world.
//   node experiments/stress-drift.ts [calls=1500]

import { mkdirSync, writeFileSync } from "node:fs";
import { evolvingPolyglot, type Version } from "../demo/evolving.ts";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { rng } from "./universe.ts";

const CALLS = Number(process.argv[2] ?? 1500);
const N = 50;
const MUTATION_RATE = 0.08; // per call: chance that some provider ships a breaking release
const svcs = Array.from({ length: N }, () => evolvingPolyglot());
const routes = Object.fromEntries(svcs.map((s, i) => [`https://polyglot-${i}.test`, s.handler]));
const rc = await RightClick.create({ fetch: routerFetch(routes), directories: [] });
await rc.learn({ sources: Object.keys(routes).map((o) => `${o}/`) });
const r = rng(2026);

let verified = 0, mutations = 0, healedCalls = 0, driftEvents = 0;
const off = rc.graph.subscribe((e) => void (e.kind === "provider.drifted" && driftEvents++));
const latencies: number[] = [];
const t0 = performance.now();
for (let n = 1; n <= CALLS; n++) {
  if (r() < MUTATION_RATE * 4) {
    // Bias mutations toward the providers the runtime is actually using, which is the worst case.
    const used = [...rc.runs.values()].slice(-5).map((x) => Number(/polyglot-(\d+)/.exec(rc.graph.providers.get(x.provider)?.meta?.source as string ?? "")?.[1])).filter((x) => !isNaN(x));
    const i = used.length && r() < 0.7 ? used[Math.floor(r() * used.length)] : Math.floor(r() * N);
    const next = (1 + Math.floor(r() * 4)) as Version;
    if (svcs[i].version() !== next) {
      svcs[i].setVersion(next);
      mutations++;
    }
  }
  const t = performance.now();
  const c = await rc.compose({ have: { text: "Hello world", language: "es" }, want: "text", intent: "translate", run: true, verify: [{ op: "contains", value: "Hola mundo" }] });
  latencies.push(performance.now() - t);
  if (c.executed?.status === "completed" && ["checked", "verified"].includes(c.executed.verification.status)) verified++; // its predicate passed (checked)
  if (c.executed?.attempts.some((a) => a.healing)) healedCalls++;
}
off();
latencies.sort((a, b) => a - b);
const pct = (p: number) => Math.round(latencies[Math.floor((latencies.length - 1) * p)]);
const result = {
  providers: N,
  calls: CALLS,
  breakingReleases: mutations,
  driftEventsDetected: driftEvents,
  callsThatHealed: healedCalls,
  availability: +(verified / CALLS).toFixed(4),
  p50ms: pct(0.5),
  p99ms: pct(0.99),
  totalMs: Math.round(performance.now() - t0),
  receiptsIntact: (await rc.verifyReceipts()).intact,
};
console.log(JSON.stringify(result, null, 2));
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/X3-drift-storm.json", JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
