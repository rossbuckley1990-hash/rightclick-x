// FAN-OUT CHECK — why the planner probes in links.ts do or do not show fan-out plans.
// Offline: loads the after-replay state links.ts left for RCX_FREEZE into the frozen build, with
// a fetch that refuses every request, and plans only (no run). Not pre-registered.
//   RCX_FREEZE=lifesci-fanout-2 node experiments/life-science/fanout-check.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { frozenBuild, HERE, TAG, WORK } from "./harness.ts";

const build = frozenBuild();
const { RightClick } = await import(`${build.dir}/src/runtime.ts`);
const { plan } = await import(`${build.dir}/src/core/planner.ts`);
const statePath = `${WORK}/${TAG}/links-replay/state.json`;
if (!existsSync(statePath)) throw new Error(`run links.ts on ${TAG} first`);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const store = { async load() { return structuredClone(state); }, async save() {} };
const rc = await RightClick.create({ name: "fanout-check", fetch: (async () => { throw new Error("offline"); }) as any, directories: [], store });
const g = rc.graph;

const fans = (p: any) => p.steps.some((s: any) => s.bindings.some((b: any) => b.each));
const brief = (p: any) => p && { summary: p.summary, result: p.result, resultType: p.resultType, intentScore: p.intentScore, fit: p.fit, steps: p.steps.map((s: any) => ({ capability: s.capability, bindings: s.bindings })) };
const RECORD = "openapi:proteins-rest-api:getbyaccession-2";
const ENTRY = "graphql:data-rcsb-org-graphql:query:entry";
const POLYMER = "graphql:data-rcsb-org-graphql:query:polymer_entity";
const accessionSchemes = g.identities.schemesFor(g.capabilities.values(), "accession", "P41159");

// Q03: accession → structure. Every fan-out plan the search finds, unanchored, and the route
// through the RCSB entry lookup with it anchored.
const q03 = { have: { accession: "text" }, want: "json", intent: "protein structure entries resolution", maxSteps: 3, schemes: { accession: accessionSchemes } };
const q03All = plan(g, rc.ledger, { ...q03, limit: 100000 });
const q03Anchored = plan(g, rc.ledger, { ...q03, maxSteps: 2, limit: 50, through: [ENTRY] });
const solo = q03All.find((p: any) => p.steps.length === 1 && p.steps[0].capability === RECORD);
// Q04/Q05 as lists: entry → polymer entity per entity id. What fills entity_id, and what feeds the step before it.
const q04 = { have: { entry_id: "id.entry" }, want: "list:text", intent: "gene name", maxSteps: 3 };
const q04Anchored = plan(g, rc.ledger, { ...q04, limit: 5, through: [POLYMER] });
const entityProducers = g.list().flatMap((c: any) => c.outputs.filter((o: any) => /^(list:)?id\.entity$/.test(o.type)).map((o: any) => `${c.id}.${o.name} (${o.type})`));

const out = {
  check: "fan-out reachability on the after-replay graph (plan only, offline)",
  build: { tag: TAG, commit: build.commit },
  at: new Date().toISOString(),
  q03: {
    goal: q03,
    unanchored: { plans: q03All.length, fanOutPlans: q03All.filter(fans).length },
    anchoredThroughEntry: q03Anchored.filter(fans).map(brief),
    oneStepRecordPlan: brief(solo),
    note: "links.ts keeps a plan only if it covers more intent terms than a kept plan it extends; compare intentScore of the one-step record plan with the fan-out plan",
  },
  q04List: {
    goal: q04,
    anchoredThroughPolymerEntity: q04Anchored.map(brief),
    producersOfEntityIds: entityProducers,
  },
};
writeFileSync(`${HERE}/evidence/fanout-check-${TAG}.json`, JSON.stringify(out, null, 2));
console.log(`Q03 unanchored: ${out.q03.unanchored.plans} plans, ${out.q03.unanchored.fanOutPlans} fan out; anchored through entry: ${out.q03.anchoredThroughEntry.map((p: any) => p.summary).join(" | ") || "none"}`);
console.log(`Q03 one-step record plan intent ${solo?.intentScore}; fan-out plan intent ${out.q03.anchoredThroughEntry.map((p: any) => p.intentScore).join(",")}`);
console.log(`Q04 list anchored through polymer_entity: ${q04Anchored.map((p: any) => p.summary).join(" | ") || "none"}`);
console.log(`evidence: experiments/life-science/evidence/fanout-check-${TAG}.json`);
