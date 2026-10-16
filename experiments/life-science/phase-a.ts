// PHASE A — onboarding by context_learn only (pre-registered, PREREGISTRATION.md §5).
// The harness starts the frozen RightClick X (stdio MCP, fresh state) and uses
// only its MCP tools: one context_learn per contract URL, then providers /
// graph / explain to describe the result, then one pre-registered smoke run per
// source. No per-database code or configuration exists anywhere.
//   RCX_FREEZE=lifesci-freeze-1 node experiments/life-science/phase-a.ts

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { frozenBuild, HERE, Mcp, readJsonl, serverFiles, sha256, TAG, WORK } from "./harness.ts";

const SOURCES = [
  { key: "S1", name: "UniProtKB REST", url: "https://rest.uniprot.org/uniprotkb/api/docs" },
  { key: "S2", name: "EBI Proteins API", url: "https://www.ebi.ac.uk/proteins/api/openapi.json" },
  { key: "S3", name: "RCSB PDB Data API (GraphQL)", url: "https://data.rcsb.org/graphql" },
  { key: "S4", name: "RCSB PDB Search API", url: "https://search.rcsb.org/openapi.json" },
  { key: "S5", name: "EMBL-EBI OLS4", url: "https://www.ebi.ac.uk/ols4/v3/api-docs" },
  { key: "S6", name: "PDBe via third-party MCP wrapper (exploratory)", url: "https://gateway.pipeworx.io/pdbe/mcp", exploratory: true },
];

// Pre-registered smoke calls. The capability is located by what it invokes, not by a name we chose.
const SMOKE: Record<string, { find: (c: any) => boolean; args: Record<string, unknown>; expect: string[]; needed?: string[] }> = {
  S1: { find: (c) => c.invoke?.kind === "http" && /\/uniprotkb\/\{accession\}$/.test(c.invoke.url), args: { accession: "P04637" }, expect: ["P04637"] },
  S2: { find: (c) => c.invoke?.kind === "http" && /\/proteins\/\{accession\}$/.test(c.invoke.url), args: { accession: "P04637" }, expect: ["P04637"] },
  S3: { find: (c) => c.invoke?.kind === "graphql" && c.invoke.field === "entry", args: { entry_id: "4HHB" }, expect: ["4HHB"], needed: ["X-RAY DIFFRACTION", "1.74"] },
  S4: {
    find: (c) => c.invoke?.kind === "http" && c.invoke.method === "GET" && /\/rcsbsearch\/v2\/query$/.test(c.invoke.url),
    args: { json: JSON.stringify({ query: { type: "terminal", service: "text", parameters: { attribute: "rcsb_id", operator: "exact_match", value: "4HHB" } }, return_type: "entry" }) },
    expect: ["4HHB"],
  },
  S5: { find: (c) => c.invoke?.kind === "http" && /\/ols4\/api\/search$/.test(c.invoke.url), args: { q: "apoptosis" }, expect: ["apoptosis"], needed: ["GO:0006915"] },
};

const build = frozenBuild();
const runDir = `${WORK}/${TAG}/phase-a`;
rmSync(runDir, { recursive: true, force: true });
const files = serverFiles(runDir);
const log = (...a: unknown[]) => console.log(...a);
log(`Phase A · build ${TAG} (${build.commit.slice(0, 7)}) · work ${runDir}`);

const mcp = new Mcp(build.rcx, files);
const init = await mcp.init();
const tools = (await mcp.request("tools/list")).result.tools.map((t: any) => t.name);
log(`server ${init.serverInfo?.name} ${init.serverInfo?.version} · ${tools.length} tools`);

const learned: any[] = [];
for (const s of SOURCES) {
  const before = readJsonl(files.netlog).length;
  const r = await mcp.tool("context_learn", { source: s.url });
  const reqs = readJsonl(files.netlog).slice(before);
  const res = r.value?.results?.[0];
  const caps = (res?.learned ?? []).reduce((n: number, l: any) => n + (l.capabilitiesAdded ?? 0), 0);
  learned.push({ ...s, ok: r.ok && !res?.error && caps > 0, ms: r.ms, requests: reqs.length, requestsDetail: reqs.map((q) => `${q.method} ${q.status ?? q.error} ${q.url}`), probes: res?.probes, learned: res?.learned, error: r.ok ? res?.error : r.value });
  log(`${s.key} ${s.name}: ${r.ok && caps ? "learned" : "FAILED"} · ${caps} capabilities · ${r.ms} ms · ${reqs.length} requests${res?.error ? ` · ${res.error}` : ""}${r.ok ? "" : ` · ${String(r.value).slice(0, 200)}`}`);
}

const providers = (await mcp.tool("context_providers")).value;
const stats = (await mcp.tool("context_graph", { op: "stats" })).value;
const exported = (await mcp.tool("context_graph", { op: "export" })).value;
const edges: Array<[string, string]> = (await mcp.tool("context_graph", { op: "edges", limit: 200000 })).value;
const caps: any[] = exported.capabilities;
const byId = new Map(caps.map((c) => [c.id, c]));
const sourceOf = (c: any) => learned.find((l) => (l.learned ?? []).some((x: any) => x.provider === c.provider))?.key;

// Per-source description: capabilities, risk, semantic types of ports.
const perSource = learned.map((l) => {
  const mine = caps.filter((c) => sourceOf(c) === l.key);
  const inTypes: Record<string, number> = {};
  const outTypes: Record<string, number> = {};
  for (const c of mine) {
    for (const p of c.inputs) inTypes[p.type] = (inTypes[p.type] ?? 0) + 1;
    for (const p of c.outputs) outTypes[p.type] = (outTypes[p.type] ?? 0) + 1;
  }
  const idPorts = mine.flatMap((c) => c.inputs.filter((p: any) => /accession|entry_id|uniprot_id|comp_id|entity_id|obo_id|iri|^class$|^q$|query|gene/i.test(p.name)).map((p: any) => `${c.id.split(":").pop()}.${p.name}: ${p.type}`));
  return { key: l.key, providers: (l.learned ?? []).map((x: any) => x.provider), capabilities: mine.length, readOnly: mine.filter((c) => c.risk === "read").length, inputTypes: inTypes, outputTypes: outTypes, identifierInputs: [...new Set(idPorts)].slice(0, 60) };
});

// Cross-provider typed links among the learned sources (what the planner can chain automatically).
const cross: Record<string, number> = {};
const crossSamples: string[] = [];
for (const [a, b] of edges) {
  const ca = byId.get(a);
  const cb = byId.get(b);
  if (!ca || !cb) continue;
  const sa = sourceOf(ca);
  const sb = sourceOf(cb);
  if (!sa || !sb || sa === sb) continue;
  const k = `${sa}→${sb}`;
  cross[k] = (cross[k] ?? 0) + 1;
  if (crossSamples.length < 40) crossSamples.push(`${a} → ${b}`);
}

// Pre-registered smoke runs.
const smoke: any[] = [];
for (const s of SOURCES.filter((x) => SMOKE[x.key])) {
  const spec = SMOKE[s.key];
  const cap = caps.find((c) => sourceOf(c) === s.key && spec.find(c));
  if (!cap) {
    smoke.push({ key: s.key, ok: false, reason: "no capability invoking the pre-registered operation" });
    log(`smoke ${s.key}: no matching capability`);
    continue;
  }
  const r = await mcp.tool("context_run", { id: cap.id, args: spec.args });
  const text = JSON.stringify(r.value ?? "");
  const status = r.value?.status;
  const has = spec.expect.every((e) => text.includes(e));
  const needed = (spec.needed ?? []).map((e) => ({ fact: e, present: text.includes(e) }));
  const ok = r.ok && status === "completed" && has;
  smoke.push({ key: s.key, capability: cap.id, args: spec.args, ok, status, ms: r.ms, expectPresent: has, neededFacts: needed, error: r.ok ? r.value?.error : r.value, outputBytes: text.length, outputHead: text.slice(0, 600) });
  log(`smoke ${s.key} ${cap.id}: ${ok ? "OK" : "FAILED"} · status ${status ?? "-"} · ${r.ms} ms${needed.length ? ` · needed facts: ${needed.map((n) => `${n.fact}=${n.present ? "yes" : "NO"}`).join(", ")}` : ""}${ok ? "" : ` · ${String(r.value?.error ?? r.value).slice(0, 240)}`}`);
}

await mcp.close();
const statePath = `${runDir}/state.json`;
const state = readFileSync(statePath, "utf8");
mkdirSync(`${WORK}/${TAG}`, { recursive: true });
copyFileSync(statePath, `${WORK}/${TAG}/phase-a-state.json`);
const net = readJsonl(files.netlog);
const perHost: Record<string, number> = {};
for (const q of net) perHost[new URL(q.url).host] = (perHost[new URL(q.url).host] ?? 0) + 1;

const evidence = {
  phase: "A",
  build: { tag: TAG, commit: build.commit },
  at: new Date().toISOString(),
  perDatabaseAuthoring: { linesOfCode: 0, linesOfConfig: 0, note: "each source was given to context_learn as its URL only; nothing else exists" },
  tools,
  sources: learned,
  perSource,
  providers,
  stats,
  crossProviderTypedLinks: { counts: cross, samples: crossSamples },
  smoke,
  network: { requests: net.length, perHost, refused: net.filter((q) => q.refused).length },
  stateSha256: sha256(state),
  stateFile: `${WORK}/${TAG}/phase-a-state.json`,
};
mkdirSync(`${HERE}/evidence`, { recursive: true });
writeFileSync(`${HERE}/evidence/phase-a-${TAG}.json`, JSON.stringify(evidence, null, 2));
log(`\ncross-provider typed links: ${JSON.stringify(cross)}`);
log(`network: ${net.length} requests ${JSON.stringify(perHost)}`);
log(`evidence: experiments/life-science/evidence/phase-a-${TAG}.json`);
