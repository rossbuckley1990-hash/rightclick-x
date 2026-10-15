// Live-internet experiments. Every provider here is a real public service on
// the internet; RightClick X has no code specific to any of them. Calls are
// read-only (specs, introspection, GET/query operations, read-only MCP tools).
//
//   node experiments/cloud.ts            run all, write experiments/results/latest.json
//   node experiments/cloud.ts E3 E5      run selected experiments

import { createHandler } from "../src/interface/http.ts";
import { serve } from "../src/entry/node-host.ts";
import { RightClick } from "../src/runtime.ts";
import { APIS_GURU, MCP_REGISTRY } from "../src/reflectors/directories.ts";
import { Authority, type Net } from "../src/reflectors/net.ts";

const proc = (globalThis as any).process;
const only = new Set<string>(proc.argv.slice(2));
const results: Record<string, unknown> = { startedAt: new Date().toISOString(), runtime: `node ${proc.versions.node}`, experiments: {} };
const record = (id: string, data: unknown) => ((results.experiments as any)[id] = data);
const log = (...a: unknown[]) => console.log(...a);
const ms = (t0: number) => Math.round(performance.now() - t0);
const h = (id: string, title: string) => log(`\n━━ ${id} ━━ ${title}`);
const want = (id: string) => !only.size || only.has(id);

const WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/?spec";
const COUNTRIES = "https://countries.trevorblades.com/";
const DEEPWIKI = "https://mcp.deepwiki.com/mcp";

// ---------------------------------------------------------------- E1
async function e1() {
  h("E1", "World research: what could this agent acquire, right now?");
  const rc = await RightClick.create({ name: "e1" });
  const topics = ["weather", "translation", "geocoding", "currency exchange", "news", "maps", "email", "payments"];
  const t0 = performance.now();
  const rows = [];
  for (const topic of topics) {
    const t = performance.now();
    const r = await rc.research({ topic, limit: 5 });
    const row = {
      topic,
      ms: ms(t),
      directories: r.directories.map((d) => ({ id: d.id, reachable: d.reachable, error: d.error, candidates: d.candidates.map((c) => c.title) })),
    };
    rows.push(row);
    log(`  ${topic.padEnd(18)} ${row.directories.map((d) => `${d.id}: ${d.reachable ? d.candidates.length : "✗"}`).join("  ")}  ${row.ms}ms   e.g. ${row.directories.flatMap((d) => d.candidates).slice(0, 3).join(" · ")}`);
  }
  record("E1", { totalMs: ms(t0), rows });
}

// ---------------------------------------------------------------- E2
async function e2() {
  h("E2", "Mass reflection: absorb a slice of the public API universe");
  const rc = await RightClick.create({ name: "e2", timeoutMs: 30_000 });
  const net: Net = rc.net;
  await APIS_GURU.search(net, "api", 1); // warm the directory cache
  const res = await fetch(APIS_GURU.url);
  const dir = (await res.json()) as Record<string, any>;
  const names = Object.keys(dir).sort();
  const N = Number(proc.env.E2_N ?? 120);
  const step = Math.floor(names.length / N);
  const sample = names
    .filter((_, i) => i % step === 0)
    .slice(0, N)
    .map((n) => dir[n].versions[dir[n].preferred]?.swaggerUrl)
    .filter(Boolean);
  log(`  directory: ${names.length} APIs; sampling every ${step}th → ${sample.length} specs`);
  const t0 = performance.now();
  const curve: Array<{ providers: number; capabilities: number; edges: number; powers: number; ms: number }> = [];
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < sample.length; i += 12) {
    const r = await rc.learn({ sources: sample.slice(i, i + 12) });
    for (const x of r.results) {
      if (x.learned.some((l) => l.capabilitiesAdded > 0)) ok++;
      else {
        failed++;
        errors.push(`${x.source.split("/specs/")[1] ?? x.source}: ${x.error ?? x.probes.map((p) => p.detail).join("; ")}`.slice(0, 160));
      }
    }
    const p = rc.graph.powers();
    curve.push({ providers: rc.graph.providers.size, capabilities: p.capabilities, edges: p.edges, powers: p.total, ms: ms(t0) });
    log(`  ${String(Math.min(i + 12, sample.length)).padStart(4)} specs  ${String(p.capabilities).padStart(6)} capabilities  ${String(p.edges).padStart(8)} typed links  ${p.total.toLocaleString().padStart(12)} powers  ${ms(t0)}ms`);
  }
  const census = rc.graph.census().slice(0, 12);
  const tp = performance.now();
  const plans = await rc.compose({ have: { email: "someone@example.com" }, want: "json", intent: "validate email", limit: 3 });
  const planMs = ms(tp);
  const ts = performance.now();
  const search = rc.graph.search("weather forecast", 5).map((s) => `${s.capability.title} (${s.capability.provider})`);
  const searchMs = ms(ts);
  log(`  reflected ${ok}/${sample.length} specs (${failed} failed: mostly specs without reachable JSON or empty paths)`);
  log(`  semantic types most produced/consumed: ${census.map((c) => c.type).join(", ")}`);
  log(`  planner over ${rc.graph.capabilities.size} capabilities: ${planMs}ms → ${plans.plans.length} plans, e.g. ${plans.plans[0]?.titles.join(" → ") ?? "-"}`);
  log(`  search "weather forecast" in ${searchMs}ms → ${search.slice(0, 3).join(" · ")}`);
  record("E2", { directorySize: names.length, sampled: sample.length, ok, failed, errors: errors.slice(0, 20), curve, census, planMs, plans: plans.plans.map((p) => p.titles), searchMs, search });
}

// ---------------------------------------------------------------- E3
async function e3() {
  h("E3", "Cross-protocol composition on the live internet (GraphQL → REST)");
  const rc = await RightClick.create({ name: "e3" });
  const t0 = performance.now();
  const learned = await rc.learn({ sources: [COUNTRIES, WIKIPEDIA] });
  for (const r of learned.results) log(`  learned ${r.source}  ${r.probes.filter((p) => p.ok).map((p) => `${p.kind}: ${p.detail}`).join(", ")}${r.error ? " ✗ " + r.error : ""}`);
  log(`  graph: ${rc.graph.capabilities.size} capabilities, ${rc.graph.powers().total.toLocaleString()} powers (${ms(t0)}ms)`);
  const runs = [];
  for (const code of ["PT", "JP", "KE", "PE", "NZ"]) {
    const r = await rc.compose({
      have: { country: code },
      want: "text",
      intent: "country capital summary",
      run: true,
      verify: [{ op: "length_gt", value: 40 }],
    });
    const out = String(r.executed?.output ?? "").replace(/\s+/g, " ");
    runs.push({ code, chain: r.executed?.titles, ms: r.executed?.durationMs, verification: r.executed?.verification.status, output: out.slice(0, 220), crystallized: r.crystallized?.title, attempts: r.executed?.attempts });
    log(`  ${code}  ${r.executed?.status === "completed" ? "✓" : "✗"} ${r.executed?.titles.join(" → ")}  ${r.executed?.durationMs}ms  ${r.executed?.verification.status}`);
    log(`      ${out.slice(0, 150)}${out.length > 150 ? "…" : ""}`);
  }
  record("E3", { runs, graph: rc.graph.powers() });
}

// ---------------------------------------------------------------- E4
async function e4() {
  h("E4", "Absorb a remote MCP server and use it through the same 13 tools");
  const rc = await RightClick.create({ name: "e4", timeoutMs: 60_000 });
  const t0 = performance.now();
  const l = await rc.learn({ source: DEEPWIKI });
  const tools = rc.graph.list().filter((c) => c.source === "mcp");
  log(`  ${DEEPWIKI}: ${tools.length} tools absorbed in ${ms(t0)}ms → ${tools.map((t) => `${t.title}(${t.inputs.filter((p) => p.required).map((p) => `${p.name}:${p.type}`).join(", ")})`).join("; ")}`);
  const ask = tools.find((t) => /ask/i.test(t.id));
  let answer: unknown = null;
  let composed: unknown = null;
  if (ask) {
    const r = await rc.run(ask.id, { repoName: "modelcontextprotocol/modelcontextprotocol", question: "In one paragraph, what is the Streamable HTTP transport?" }, { verify: [{ op: "length_gt", path: "result", value: 100 }] });
    answer = { status: r.status, ms: r.durationMs, verification: r.verification.status, preview: String((r.output as any)?.result ?? r.error).slice(0, 400) };
    log(`  context_run ${ask.id}: ${r.status} in ${r.durationMs}ms, ${r.verification.status}`);
    log(`      ${String((r.output as any)?.result ?? r.error).replace(/\s+/g, " ").slice(0, 200)}…`);
    const c = await rc.compose({
      have: { repoName: "nodejs/node", question: "What does the module loader do? Answer briefly." },
      want: "language",
      intent: "ask question detect language",
      run: true,
    });
    composed = { chain: c.executed?.titles, output: c.executed?.output, ms: c.executed?.durationMs, attempts: c.executed?.attempts };
    for (const a of c.executed?.attempts ?? []) log(`  ✗ attempt ${a.summary} failed at ${a.failed}: ${a.error.slice(0, 120)}`);
    log(`  compose remote-MCP answer → builtin: ${c.executed?.titles.join(" → ")} = ${JSON.stringify(c.executed?.output)} (${c.executed?.durationMs}ms)`);
  }
  record("E4", { learned: l.totalNewCapabilities, tools: tools.map((t) => ({ id: t.id, inputs: t.inputs })), answer, composed });
}

// ---------------------------------------------------------------- E5 + E6
async function e5() {
  h("E5", "A federated mesh: three instances, three providers, one graph");
  log("  (instances run on this machine, standing in for regions; their providers are real internet services)");
  const regions: Array<[string, string]> = [
    ["eu-west", WIKIPEDIA],
    ["us-east", COUNTRIES],
    ["ap-south", DEEPWIKI],
  ];
  const nodes = [];
  for (const [region, source] of regions) {
    const rc = await RightClick.create({ name: `rcx-${region}`, region, timeoutMs: 60_000 });
    await rc.learn({ source });
    const s = await serve(createHandler(rc, { open: true }), 0);
    nodes.push({ region, rc, s });
    log(`  ${region.padEnd(9)} ${s.url}  learned ${new URL(source).host}: ${rc.graph.capabilities.size - 14} capabilities`);
  }
  // Fault injection for E6: the hub's own route to Wikipedia goes down.
  let wikipediaDown = false;
  const hubFetch: typeof fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (wikipediaDown && new URL(url).host === "en.wikipedia.org") throw new Error("injected outage: en.wikipedia.org unreachable from hub");
    return fetch(input, init);
  }) as typeof fetch;
  const hub = await RightClick.create({ name: "rcx-hub", region: "hub", fetch: hubFetch, auth: new Authority() });
  const t0 = performance.now();
  const fed = await hub.learn({ sources: nodes.map((n) => n.s.url) });
  log(`  hub federated ${fed.totalNewCapabilities} capabilities from 3 peers in ${ms(t0)}ms → ${hub.graph.powers().total.toLocaleString()} powers`);
  const c = await hub.compose({ have: { country: "BR" }, want: "text", intent: "country capital summary", run: true });
  const via = (c.executed?.runs ?? []).map((id) => hub.runs.get(id)?.provider);
  log(`  BR: ${c.executed?.titles.join(" → ")}  via ${via.join(" → ")}  ${c.executed?.durationMs}ms`);
  log(`      ${String(c.executed?.output).replace(/\s+/g, " ").slice(0, 160)}…`);
  record("E5", { peers: regions.map((r) => r[0]), federated: fed.totalNewCapabilities, powers: hub.graph.powers(), chain: c.executed?.titles, via, output: String(c.executed?.output).slice(0, 300) });

  h("E6", "Self-healing across the mesh under an injected outage");
  // A second hub that first proves (and crystallizes) its own direct route to Wikipedia,
  // then federates the mesh, then loses Wikipedia.
  const hub2 = await RightClick.create({ name: "rcx-hub2", region: "hub2", fetch: hubFetch });
  await hub2.learn({ sources: [COUNTRIES, WIKIPEDIA] });
  const direct = await hub2.compose({ have: { country: "IN" }, want: "text", intent: "country capital summary", run: true });
  const viaDirect = (direct.executed?.runs ?? []).map((id) => hub2.runs.get(id)?.provider);
  log(`  before outage  IN: ${direct.executed?.titles.join(" → ")}  via ${viaDirect.join(" → ")}  ${direct.executed?.durationMs}ms`);
  await hub2.learn({ sources: nodes.map((n) => n.s.url) });
  wikipediaDown = true;
  const healed = await hub2.compose({ have: { country: "EG" }, want: "text", intent: "country capital summary", run: true });
  const viaHealed = (healed.executed?.runs ?? []).map((id) => hub2.runs.get(id)?.provider);
  for (const a of healed.executed?.attempts ?? []) log(`  ✗ ${a.summary.slice(0, 90)}  failed at ${a.failed}`);
  log(`  after outage   EG: ${healed.executed?.status} via ${viaHealed.join(" → ")}  ${healed.executed?.durationMs}ms`);
  log(`      ${String(healed.executed?.output).replace(/\s+/g, " ").slice(0, 160)}…`);
  const chain = await hub2.verifyReceipts();
  log(`  hub receipts: ${chain.count}, chain intact: ${chain.intact}`);
  record("E6", { before: { via: viaDirect, ms: direct.executed?.durationMs }, after: { status: healed.executed?.status, attempts: healed.executed?.attempts, via: viaHealed, ms: healed.executed?.durationMs, output: String(healed.executed?.output).slice(0, 300) }, receipts: chain });
  for (const n of nodes) await n.s.close();
}


// ---------------------------------------------------------------- E7
const GITHUB_SPEC = "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json";
async function e7() {
  h("E7", "GitHub: the entire REST API from its own spec, then pipelines nobody wrote");
  const rc = await RightClick.create({ name: "e7", timeoutMs: 120_000 });
  const before = rc.graph.powers();
  const t0 = performance.now();
  const l = await rc.learn({ sources: [GITHUB_SPEC, WIKIPEDIA, DEEPWIKI] });
  const learnMs = ms(t0);
  const gh = rc.graph.list().filter((c) => c.provider.startsWith("openapi:github"));
  const byRisk = gh.reduce((m: Record<string, number>, c) => ((m[c.risk] = (m[c.risk] ?? 0) + 1), m), {});
  const after = rc.graph.powers();
  log(`  learned GitHub REST (${gh.length} operations), Wikipedia REST, DeepWiki MCP in ${learnMs}ms; GitHub-specific code: 0 lines`);
  log(`  GitHub operations by risk: ${JSON.stringify(byRisk)}`);
  log(`  graph: ${before.capabilities} → ${after.capabilities} capabilities · ${after.edges.toLocaleString()} typed links · ${after.total.toLocaleString()} composite powers`);
  const searches = [];
  for (const q of ["list pull requests", "merge a branch", "create a gist", "get latest release"]) {
    const t = performance.now();
    const hit = rc.graph.search(q, 1)[0]?.capability;
    searches.push({ q, ms: ms(t), hit: hit?.title, risk: hit?.risk });
    log(`  search "${q}" → ${hit?.title} [${hit?.risk}] (${ms(t)}ms)`);
  }
  const goals: Array<{ label: string; goal: any }> = [
    { label: "Summarize the latest Node.js release", goal: { have: { owner: "nodejs", repo: "node" }, want: "text", intent: "latest release summary" } },
    { label: "GitHub user → real name → Wikipedia", goal: { have: { username: "gvanrossum" }, want: "text", intent: "user name summary", through: ["openapi:github-v3-rest-api:users-get-by-username", "openapi:wikimedia-rest-api:get-page-summary-title"] } },
    { label: "Repository → homepage → read the live site", goal: { have: { owner: "denoland", repo: "deno" }, want: "text", intent: "repository homepage summary", through: ["openapi:github-v3-rest-api:repos-get", "builtin:web.fetch"] } },
  ];
  const runs = [];
  for (const { label, goal } of goals) {
    const t = performance.now();
    const r = await rc.compose({ ...goal, run: true, risks: ["read", "external"], verify: [{ op: "length_gt", value: 30 }] });
    const via = (r.executed?.runs ?? []).map((id) => rc.runs.get(id)?.provider);
    const out = String(r.executed?.output ?? "").replace(/\s+/g, " ");
    runs.push({ label, chain: r.executed?.titles, via, ms: ms(t), status: r.executed?.status, verification: r.executed?.verification.status, output: out.slice(0, 400), attempts: r.executed?.attempts, crystallized: r.crystallized?.id });
    log(`  ${r.executed?.status === "completed" ? "✓" : "✗"} ${label}  (${ms(t)}ms, ${r.executed?.verification.status})`);
    log(`      ${r.executed?.titles.join(" → ")}`);
    log(`      ${out.slice(0, 180)}${out.length > 180 ? "…" : ""}`);
    for (const a of r.executed?.attempts ?? []) log(`      ✗ attempt failed at ${a.failed}: ${a.error.slice(0, 120)}`);
  }
  // The crystallized GitHub→Wikipedia pipeline is now one capability.
  const again = await rc.compose({ have: { username: "torvalds" }, want: "text", intent: "user name summary", run: true, risks: ["read", "external"] });
  log(`  reuse crystallized pipeline for torvalds: ${again.executed?.titles.join(" → ")}`);
  log(`      ${String(again.executed?.output).replace(/\s+/g, " ").slice(0, 160)}…`);
  const ask = await rc.compose({ have: { repoName: "nodejs/node", question: "In two sentences, what does lib/internal/modules do?" }, want: "text", intent: "ask question", run: true });
  log(`  DeepWiki (remote MCP) on nodejs/node: ${String(ask.executed?.output).replace(/\s+/g, " ").slice(0, 200)}…`);
  const chain = await rc.verifyReceipts();
  log(`  receipts: ${chain.count}, intact: ${chain.intact}; GitHub API calls made: ${[...rc.runs.values()].filter((r) => r.provider.startsWith("openapi:github")).length} (all read-only, unauthenticated)`);
  record("E7", { learnMs, operations: gh.length, byRisk, before, after, searches, runs, reuse: { chain: again.executed?.titles, output: String(again.executed?.output).slice(0, 300) }, deepwiki: String(ask.executed?.output).slice(0, 600), receipts: chain });
}

const ALL: Array<[string, () => Promise<void>]> = [
  ["E1", e1],
  ["E2", e2],
  ["E3", e3],
  ["E4", e4],
  ["E5", e5],
  ["E7", e7],
];

for (const [id, fn] of ALL) {
  if (!want(id) && !(id === "E5" && want("E6"))) continue;
  try {
    await fn();
  } catch (e) {
    log(`  ✗ ${id} crashed: ${(e as Error)?.stack ?? e}`);
    record(id, { crashed: String((e as Error)?.message ?? e) });
  }
}
results.finishedAt = new Date().toISOString();
const fs = await import("node:fs/promises");
await fs.mkdir("experiments/results", { recursive: true });
const file = `experiments/results/${only.size ? [...only].join("-") : "latest"}.json`;
await fs.writeFile(file, JSON.stringify(results, null, 2));
log(`\nresults → ${file}`);
