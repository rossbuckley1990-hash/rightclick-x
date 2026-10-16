// IDENTIFIER LINKS — how many meaningful cross-provider identifier links the typed
// graph has, and where they come from (not pre-registered; follow-up to P3).
//
//  1. Baseline: the Phase A graph of lifesci-freeze-3 (types only).
//  2. The Phase A graph of RCX_FREEZE (learn + the pre-registered smoke calls only).
//  3. The same state after replaying, in order, every context_run call the Phase B
//     agents made (both clients, 28 sessions, args as logged, `verify` dropped), in one
//     RightClick X process. Read-only and rate-limited by polite-fetch like every run.
//
// A link is "meaningful" when an output port of a capability of one source fills a
// required input port of a capability of another source either through a learned
// identifier scheme, or through a specific identifier type (id.*). Generic text,
// number and json plumbing is not counted.
//   RCX_FREEZE=lifesci-links-1 node experiments/life-science/links.ts

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { frozenBuild, HERE, Mcp, readJsonl, serverFiles, TAG, WORK } from "./harness.ts";

const build = frozenBuild();
const { accepts } = await import(`${build.dir}/src/core/semantics.ts`);
const log = (...a: unknown[]) => console.log(...a);

const SOURCES: Record<string, RegExp> = {
  S1: /^openapi:openapi-definition$/,
  S2: /^openapi:proteins-rest-api$/,
  S3: /^graphql:data-rcsb-org-graphql$/,
  S4: /^openapi:rcsb-search-api$/,
  S5: /^openapi:ols-service$/,
  S6: /^mcp:pipeworx-gateway$/,
};
const sourceOf = (provider: string) => Object.entries(SOURCES).find(([, re]) => re.test(provider))?.[0];
const isList = (t: string) => t.startsWith("list:");

/** Classify every cross-source capability pair by how an output reaches a required input. */
function measure(caps: any[]) {
  const mine = caps.filter((c) => sourceOf(c.provider));
  const scheme: Record<string, number> = {};
  const idType: Record<string, number> = {};
  const schemePairs = new Set<string>();
  const idPairs = new Set<string>();
  const samples: string[] = [];
  for (const a of mine) {
    for (const b of mine) {
      const sa = sourceOf(a.provider)!;
      const sb = sourceOf(b.provider)!;
      if (sa === sb) continue;
      let bySchemeHere = false;
      let byIdHere = false;
      let example = "";
      for (const o of a.outputs) {
        for (const i of b.inputs) {
          if (!i.required) continue;
          if (o.schemes?.length && i.schemes?.length && isList(o.type) === isList(i.type) && o.schemes.some((s: string) => i.schemes.includes(s))) {
            bySchemeHere = true;
            example ||= `${a.id}.${o.name} (${o.type}) → ${b.id}.${i.name} (${i.type}) [${i.schemes.join(",")}]`;
          }
          if (/^(list:)?id\./.test(i.type) && accepts(i.name, i.type, o.type)) byIdHere = true;
        }
      }
      const k = `${sa}→${sb}`;
      if (bySchemeHere) {
        scheme[k] = (scheme[k] ?? 0) + 1;
        schemePairs.add(`${a.id}>${b.id}`);
        if (samples.length < 60) samples.push(example);
      }
      if (byIdHere) {
        idType[k] = (idType[k] ?? 0) + 1;
        idPairs.add(`${a.id}>${b.id}`);
      }
    }
  }
  const newBySchemeOnly = [...schemePairs].filter((p) => !idPairs.has(p)).length;
  return { capabilities: mine.length, schemeLinks: { pairs: schemePairs.size, bySourcePair: scheme, samples }, idTypeLinks: { pairs: idPairs.size, bySourcePair: idType }, newBySchemeOnly };
}

function schemesOf(state: any, caps: any[]) {
  // Readable scheme membership: which ports of which source carry which scheme.
  const out: Record<string, { inputs: string[]; feeds: string[] }> = {};
  for (const c of caps) {
    const src = sourceOf(c.provider);
    if (!src) continue;
    for (const p of c.inputs) for (const s of p.schemes ?? []) (out[s] ??= { inputs: [], feeds: [] }).inputs.push(`${src} ${c.id.split(":").pop()}.${p.name} (${p.type})`);
    for (const p of c.outputs) for (const s of p.schemes ?? []) (out[s] ??= { inputs: [], feeds: [] }).feeds.push(`${src} ${c.id.split(":").pop()}.${p.name} (${p.type}${p.observed ? ", observed" : ""})`);
  }
  return { schemes: out, evidence: (state.identities?.links ?? []).map((l: any) => ({ kind: l.kind, from: l.from.replaceAll("\u0001", " "), to: l.to.replaceAll("\u0001", " "), value: l.value })) };
}

const capsOf = (state: any) => state.reflections.flatMap((r: any) => r.capabilities);

// 1. Baseline and 2. Phase A on this build.
const baselineState = JSON.parse(readFileSync(`${WORK}/lifesci-freeze-3/phase-a-state.json`, "utf8"));
const phaseAPath = `${WORK}/${TAG}/phase-a-state.json`;
if (!existsSync(phaseAPath)) throw new Error(`run phase-a.ts on ${TAG} first`);
const phaseAState = JSON.parse(readFileSync(phaseAPath, "utf8"));
const baseline = measure(capsOf(baselineState));
const phaseA = { ...measure(capsOf(phaseAState)), ...schemesOf(phaseAState, capsOf(phaseAState)) };
log(`baseline freeze-3: id-type links ${baseline.idTypeLinks.pairs} cap pairs · scheme links ${baseline.schemeLinks.pairs}`);
log(`phase A ${TAG}: id-type links ${phaseA.idTypeLinks.pairs} · scheme links ${phaseA.schemeLinks.pairs} (${phaseA.newBySchemeOnly} not already id-typed) · schemes ${Object.keys(phaseA.schemes).length}`);

// Plan-only probes for hops the Phase B questions needed (no run, no network).
const PROBES = [
  { hop: "accession → structure (Q03, Q11)", have: { accession: "P41159" }, want: "json", intent: "protein structure entries resolution" },
  { hop: "accession → genomic coordinates (Q08)", have: { accession: "P38398" }, want: "json", intent: "genomic coordinates" },
  { hop: "accession → GO term → ontology parents (Q07)", have: { accession: "P68871" }, want: "json", intent: "ontology term parents" },
  { hop: "PDB entry → accession → gene (Q04)", have: { entry_id: "4HHB" }, want: "text", intent: "gene name" },
  { hop: "PDB entry → accession → organism (Q05)", have: { entry_id: "6M0J" }, want: "text", intent: "organism scientific name" },
];
// Each binding that carries a value from one source into another is classified: through a
// learned scheme, through a specific id type, or as generic text/number plumbing.
async function probe(mcp: Mcp) {
  const caps = new Map<string, any>(((await mcp.tool("context_graph", { op: "export" })).value.capabilities as any[]).map((c) => [c.id, c]));
  const out = [];
  for (const p of PROBES) {
    const r = await mcp.tool("context_compose", { have: p.have, want: p.want, intent: p.intent, run: false, limit: 5, maxSteps: 3 });
    const plans = (r.value?.plans ?? []).map((x: any) => {
      const crossings: string[] = [];
      for (const s of x.steps) {
        const b = caps.get(s.capability);
        for (const bind of s.bindings) {
          const m = /^(\d+)\.(.*)$/.exec(bind.from);
          if (!m) continue;
          const a = caps.get(x.steps[Number(m[1])].capability);
          if (sourceOf(a.provider) === sourceOf(b.provider)) continue;
          const o = a.outputs.find((q: any) => q.name === m[2]) ?? { type: "json" };
          const port = b.inputs.find((q: any) => q.name === bind.port);
          const kind = o.schemes?.some((sc: string) => port.schemes?.includes(sc)) ? "scheme" : /^(list:)?id\./.test(port.type) && accepts(port.name, port.type, o.type) ? "id-type" : "generic";
          crossings.push(`${kind}: ${sourceOf(a.provider)} ${m[2] || "(whole)"} (${o.type}) → ${sourceOf(b.provider)} ${bind.port} (${port.type})`);
        }
      }
      return { summary: x.summary, providers: x.providers.map(sourceOf), crossings, meaningful: crossings.length > 0 && crossings.every((c) => !c.startsWith("generic")) };
    });
    out.push({ ...p, haveTypes: r.value?.goal?.have, plans, meaningfulCrossSourcePlans: plans.filter((x: any) => x.meaningful).length, genericCrossSourcePlans: plans.filter((x: any) => x.crossings.some((c: string) => c.startsWith("generic"))).length });
  }
  return out;
}

// 3. Replay the agents' calls from the Phase A state.
const runDir = `${WORK}/${TAG}/links-replay`;
rmSync(runDir, { recursive: true, force: true });
const files = serverFiles(runDir);
copyFileSync(phaseAPath, files.state);
const mcp = new Mcp(build.rcx, files);
await mcp.init();
const probesBefore = await probe(mcp);

const evDir = `${HERE}/evidence/phase-b-lifesci-freeze-3`;
const sessions = readdirSync(evDir).filter((f) => /^(claude|codex)-Q\d+\.json$/.test(f)).sort((a, b) => (a.startsWith("claude") === b.startsWith("claude") ? (a < b ? -1 : 1) : a.startsWith("claude") ? -1 : 1));
const replay: any[] = [];
for (const f of sessions) {
  const s = JSON.parse(readFileSync(`${evDir}/${f}`, "utf8"));
  for (const call of s.mcpCallLog.filter((c: any) => c.tool === "context_run")) {
    const { verify: _verify, ...args } = call.args;
    const r = await mcp.tool("context_run", args);
    replay.push({ session: f.replace(".json", ""), capability: args.id, agentOk: call.ok, ok: r.ok && r.value?.status === "completed", status: r.value?.status, error: r.ok ? r.value?.error : String(r.value).slice(0, 200), ms: r.ms });
    log(`${f.replace(".json", "")} ${args.id}: ${r.value?.status ?? "error"} · ${r.ms} ms`);
  }
}
const probesAfter = await probe(mcp);
await mcp.close();
const afterState = JSON.parse(readFileSync(files.state, "utf8"));
const after = { ...measure(capsOf(afterState)), ...schemesOf(afterState, capsOf(afterState)) };
log(`after replay: id-type links ${after.idTypeLinks.pairs} · scheme links ${after.schemeLinks.pairs} (${after.newBySchemeOnly} not already id-typed) · schemes ${Object.keys(after.schemes).length}`);
const net = readJsonl(files.netlog);
const perHost: Record<string, number> = {};
for (const q of net) perHost[new URL(q.url).host] = (perHost[new URL(q.url).host] ?? 0) + 1;

const evidence = {
  measurement: "cross-provider identifier links",
  build: { tag: TAG, commit: build.commit },
  at: new Date().toISOString(),
  definition: "cap pair (A in source X, B in source Y≠X) where an output port of A fills a required input port of B via a shared learned scheme with equal cardinality (schemeLinks), or where B's input has a specific id.* type that accepts A's output type (idTypeLinks)",
  baseline: { tag: "lifesci-freeze-3", ...baseline },
  phaseA,
  replay: { note: "context_run calls of all 28 Phase B sessions, in order, in one process starting from the Phase A state; `verify` dropped", calls: replay.length, completed: replay.filter((r) => r.ok).length, calls_: replay },
  afterReplay: after,
  probes: { before: probesBefore, after: probesAfter },
  network: { requests: net.length, perHost, refused: net.filter((q) => q.refused).length },
};
mkdirSync(`${HERE}/evidence`, { recursive: true });
writeFileSync(`${HERE}/evidence/links-${TAG}.json`, JSON.stringify(evidence, null, 2));
log(`probes, plans crossing sources only by scheme/id-type (meaningful) vs with generic crossings, before/after replay: ${probesBefore.map((p) => `${p.meaningfulCrossSourcePlans}|${p.genericCrossSourcePlans}`).join(" ")} / ${probesAfter.map((p) => `${p.meaningfulCrossSourcePlans}|${p.genericCrossSourcePlans}`).join(" ")}`);
log(`network: ${net.length} requests ${JSON.stringify(perHost)}`);
log(`evidence: experiments/life-science/evidence/links-${TAG}.json`);
