// Goal-satisfaction evaluation, exactly as pre-registered (PREREGISTRATION.md, 1e191f8).
//   node experiments/goal-satisfaction/run.ts lifesci-fanout-2 lifesci-satisfy-1
// Dev tasks run on each build's links-replay state (built by phase-a.ts then links.ts); the
// holdout runs on a fresh state. RightClick X is reached only through its MCP tools; truth is
// queried directly by the harness (questions.ts), rate-limited by polite-fetch.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Mcp, WORK, frozenBuild, readJsonl, serverFiles } from "../life-science/harness.ts";
import { QUESTIONS } from "../life-science/questions.ts";

const [BASE, CAND] = process.argv.slice(2);
const OUT = "experiments/goal-satisfaction/evidence";
mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.log(...a);
const UA = { "user-agent": "rightclick-x-goal-satisfaction-truth/0.1 (read-only; 1 req/s per host)" };

const TASKS = [
  { id: "Q03", have: { accession: "P41159" }, intent: "protein structure entries resolution", require: ["resolution"] },
  { id: "Q04", have: { entry_id: "4HHB" }, intent: "gene name", require: ["gene name"] },
  { id: "Q05", have: { entry_id: "6M0J" }, intent: "organism scientific name", require: ["organism scientific name"] },
  { id: "Q07", have: { accession: "P68871" }, intent: "ontology term parents", require: ["label"] },
  { id: "Q08", have: { accession: "P38398" }, intent: "genomic coordinates", require: ["chromosome", "ensembl gene"] },
  { id: "Q08g", have: { gene: "BRCA1", taxid: "9606" }, intent: "genomic coordinates", require: ["chromosome", "ensembl gene"] },
];
const NEG_DEV = [
  { id: "N2", have: { accession: "P41159" }, intent: "protein melting point", require: ["melting point"] },
  { id: "N3", have: { comp_id: "MK1" }, intent: "gene name", require: ["gene name"] },
];
const HA = "https://advisories.ecosyste.ms/docs/api/v1/openapi.yaml";
const HB = "https://raw.githubusercontent.com/google/osv.dev/master/docs/osv_service_v1.swagger.json";
const H1 = { id: "H1", have: { purl: "pkg:npm/lodash@4.17.20" }, intent: "vulnerability summary", require: ["summary"] };

const strings = (v: unknown, out: string[] = [], depth = 0): string[] => {
  if (depth > 10) return out;
  if (typeof v === "string" || typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, depth + 1));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out, depth + 1));
  return out;
};
const objects = (v: unknown, out: any[] = [], depth = 0): any[] => {
  if (depth > 10) return out;
  if (Array.isArray(v)) v.forEach((x) => objects(x, out, depth + 1));
  else if (v && typeof v === "object") {
    out.push(v);
    Object.values(v).forEach((x) => objects(x, out, depth + 1));
  }
  return out;
};
const numbersUnderResolution = (o: any): number[] => {
  const out: number[] = [];
  const walk = (v: any, key: string, d: number) => {
    if (d > 6) return;
    if (typeof v === "number" && /resolution/i.test(key)) out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key, d + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, /resolution/i.test(k) ? k : key, d + 1);
  };
  walk(o, "", 0);
  return out;
};
const has = (vals: string[], s: string) => vals.some((v) => v.toLowerCase() === String(s).toLowerCase());

// ---------------------------------------------------------------- pre-registered scorers
async function score(id: string, output: unknown): Promise<{ pass: boolean; detail: string; truth: unknown }> {
  const q = QUESTIONS.find((x) => x.id === (id === "Q08g" ? "Q08" : id))!;
  const t = await q.truth();
  const vals = strings(output);
  if (id === "Q03") {
    const entries = (t.facts as any).entries as Array<{ id: string; res: number }>;
    const xrefs = Object.keys((t.facts as any).uniprotResolutions ?? {});
    const objs = objects(output).filter((o) => typeof o.rcsb_id === "string");
    const found = entries.map((e) => objs.some((o) => o.rcsb_id === e.id && numbersUnderResolution(o).some((n) => Math.abs(n - e.res) <= 0.01)));
    const unrelated = objs.filter((o) => !xrefs.includes(o.rcsb_id)).map((o) => o.rcsb_id);
    const lowest = Math.min(...objs.flatMap((o) => numbersUnderResolution(o)));
    const lowestOk = (t.parts[0] as string[]).some((w) => objs.some((o) => o.rcsb_id === w && numbersUnderResolution(o).some((n) => Math.abs(n - lowest) <= 1e-9)));
    return { pass: found.every(Boolean) && !unrelated.length && lowestOk, detail: `entries found ${found.filter(Boolean).length}/${entries.length}; unrelated ${unrelated.length}; lowest belongs to a winner ${lowestOk}`, truth: t.facts };
  }
  if (id === "Q04") {
    const ok = (t.parts[2] as string[]).every((a) => has(vals, a)) && (t.parts[3] as string[]).every((g) => has(vals, g));
    return { pass: ok, detail: `accessions ${JSON.stringify(t.parts[2])}, genes ${JSON.stringify(t.parts[3])}`, truth: t.parts };
  }
  if (id === "Q05") {
    const orgs = (t.facts as any).organisms as Record<string, string>;
    const ok = Object.entries(orgs).every(([a, o]) => has(vals, a) && has(vals, o));
    return { pass: ok, detail: JSON.stringify(orgs), truth: orgs };
  }
  if (id === "Q07") {
    const ok = has(vals, String(t.parts[0])) && (t.parts[1] as string[]).every((l) => has(vals, l));
    return { pass: ok, detail: `${t.parts[0]} parents ${JSON.stringify(t.parts[1])}`, truth: t.parts };
  }
  // Q08 / Q08g
  const ok = (t.parts[1] as string[]).some((c) => has(vals, c)) && (t.parts[2] as string[]).some((g) => has(vals, g));
  return { pass: ok, detail: `chromosome ${JSON.stringify(t.parts[1])}, gene ${JSON.stringify(t.parts[2])}`, truth: t.parts };
}

async function h1Truth() {
  const j = async (u: string, init?: RequestInit) => {
    const r = await fetch(u, { ...init, headers: { ...UA, ...(init?.headers ?? {}), ...(init?.body ? { "content-type": "application/json" } : {}) } });
    await new Promise((x) => setTimeout(x, 1100));
    return r.ok ? r.json() : { __status: r.status };
  };
  const adv: any[] = await j(`https://advisories.ecosyste.ms/api/v1/advisories/lookup?purl=${encodeURIComponent(H1.have.purl)}`);
  const advisories = (Array.isArray(adv) ? adv : []).map((a: any) => ({ uuid: a.uuid, identifiers: (a.identifiers ?? []) as string[] }));
  const osv: Record<string, any> = {};
  for (const a of advisories) for (const id of a.identifiers) if (!(id in osv)) osv[id] = await j(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
  const witness: any = await j("https://api.osv.dev/v1/query", { method: "POST", body: JSON.stringify({ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" }) });
  return { advisories, osv, witnessIds: (witness?.vulns ?? []).map((v: any) => v.id) };
}

function scoreH1(output: unknown, t: Awaited<ReturnType<typeof h1Truth>>) {
  const recs = objects(output).filter((o) => typeof o.id === "string" && ("summary" in o || "aliases" in o));
  const idsOf = (o: any) => [o.id, ...(o.aliases ?? [])];
  const resolvable = t.advisories.filter((a) => a.identifiers.some((i) => t.osv[i] && !t.osv[i].__status));
  const coverage = resolvable.every((a) => recs.some((o) => idsOf(o).some((i) => a.identifiers.includes(i))));
  const exact = recs.every((o) => t.osv[o.id] && !t.osv[o.id].__status ? o.summary === t.osv[o.id].summary : false);
  const related = recs.every((o) => t.advisories.some((a) => idsOf(o).some((i) => a.identifiers.includes(i))));
  return { pass: recs.length > 0 && coverage && exact && related, coverage, exact, related, records: recs.length, resolvableAdvisories: resolvable.length };
}

// ---------------------------------------------------------------- one build
async function runBuild(tag: string) {
  const b = frozenBuild(tag);
  const ev: any = { build: tag, commit: b.commit, tasks: [], negatives: [], holdout: {} };
  const replay = `${WORK}/${tag}/links-replay/state.json`;
  if (!existsSync(replay)) throw new Error(`missing dev state for ${tag}: run phase-a.ts and links.ts first (${replay})`);
  const dir = `${WORK}/${tag}/goal-satisfaction`;
  mkdirSync(dir, { recursive: true });
  const runCompose = async (mcp: Mcp, task: any) => {
    // view.full: the tool response otherwise withholds outputs over its size budget (the run record
    // keeps them); lifesci-satisfy-1's first run scored a withheld output as empty (Q08).
    const args = { have: task.have, want: "json", intent: task.intent, require: task.require, run: true, limit: 25, maxSteps: 3, view: { full: true } };
    const r = await mcp.tool("context_compose", args);
    const v = r.ok ? r.value : { error: r.value };
    return { args, ms: r.ms, ranking: (v.plans ?? []).map((p: any) => ({ summary: p.summary, satisfaction: p.satisfaction ?? null })), outcome: v.outcome ?? null, executed: v.executed ? { status: v.executed.status, titles: v.executed.titles, runs: v.executed.runs, attempts: v.executed.attempts, fanOuts: v.executed.fanOuts } : null, output: v.executed?.output ?? null, error: r.ok ? undefined : r.value };
  };

  // Dev tasks and dev negatives: a copy of the replay state per build.
  const devFiles = serverFiles(`${dir}/dev`);
  copyFileSync(replay, devFiles.state);
  const dev = new Mcp(b.rcx, devFiles);
  await dev.init();
  for (const task of [...TASKS, ...NEG_DEV]) {
    const t0 = Date.now();
    const r: any = await runCompose(dev, task);
    r.id = task.id;
    r.seconds = (Date.now() - t0) / 1000;
    if (task.id.startsWith("N")) {
      r.pass = !r.ranking.some((p: any) => p.satisfaction?.status === "established") && !(r.executed && r.executed.status === "completed");
      ev.negatives.push(r);
    } else {
      r.score = r.executed?.status === "completed" ? await score(task.id, r.output) : { pass: false, detail: r.outcome ? `outcome ${r.outcome.status}: ${r.outcome.reason ?? ""}` : "nothing executed", truth: null };
      ev.tasks.push(r);
    }
    log(`  ${tag} ${task.id}: ${r.outcome?.status ?? "(no outcome)"} · executed ${r.executed?.status ?? "-"} · ${task.id.startsWith("N") ? (r.pass ? "control PASS" : "control FAIL") : r.score.pass ? "score PASS" : `score FAIL (${r.score.detail})`}`);
    writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(ev, null, 2));
  }
  await dev.close();

  // Holdout: fresh state. N1 (learn only), seeding HS1/HS2, then H1.
  const hoFiles = serverFiles(`${dir}/holdout-${Date.now()}`);
  const ho = new Mcp(b.rcx, hoFiles);
  await ho.init();
  const learned = await ho.tool("context_learn", { sources: [HA, HB] });
  ev.holdout.learn = learned.ok ? learned.value.results.map((x: any) => ({ source: x.source, error: x.error, learned: x.learned?.length })) : learned.value;
  const n1: any = await runCompose(ho, { ...H1 });
  n1.id = "N1";
  n1.pass = !n1.ranking.some((p: any) => p.satisfaction?.status === "established") && !(n1.executed && n1.executed.status === "completed");
  ev.negatives.push(n1);
  log(`  ${tag} N1: ${n1.outcome?.status ?? "(no outcome)"} · executed ${n1.executed?.status ?? "-"} · ${n1.pass ? "control PASS" : "control FAIL"}`);
  // Seeding: capabilities located by invoked path.
  const graph = await ho.tool("context_graph", { op: "export" });
  const caps: any[] = graph.ok ? graph.value.capabilities ?? graph.value.nodes ?? [] : [];
  const byPath = (re: RegExp, method: string) => caps.find((c: any) => c.invoke?.kind === "http" && c.invoke.method === method && re.test(c.invoke.url));
  const lookup = byPath(/\/advisories\/lookup$/, "GET");
  const vuln = byPath(/\/v1\/vulns\/\{[^}]+\}$/, "GET");
  ev.holdout.seeding = { lookup: lookup?.id ?? null, vuln: vuln?.id ?? null, runs: [] };
  if (lookup) {
    const hs1 = await ho.tool("context_run", { id: lookup.id, args: { purl: "pkg:npm/minimist@1.2.5" } });
    ev.holdout.seeding.runs.push({ hs: "HS1", ok: hs1.ok, status: hs1.value?.status });
    const ids: string[] = (hs1.value?.output ?? []).flatMap((a: any) => a.identifiers ?? []);
    if (vuln) {
      const port = (vuln.inputs ?? []).find((p: any) => p.required)?.name ?? "id";
      for (const id of ids.slice(0, 3)) {
        const hs2 = await ho.tool("context_run", { id: vuln.id, args: { [port]: id } });
        ev.holdout.seeding.runs.push({ hs: "HS2", id, ok: hs2.ok, status: hs2.value?.status });
        if (hs2.value?.status === "completed") break;
      }
    }
  }
  const h1: any = await runCompose(ho, H1);
  h1.id = "H1";
  const truth = await h1Truth();
  h1.score = h1.executed?.status === "completed" ? scoreH1(h1.output, truth) : { pass: false, detail: h1.outcome ? `outcome ${h1.outcome.status}: ${h1.outcome.reason ?? ""}` : "nothing executed" };
  h1.truth = { advisories: truth.advisories, witnessIds: truth.witnessIds };
  ev.holdout.h1 = h1;
  log(`  ${tag} H1: ${h1.outcome?.status ?? "(no outcome)"} · executed ${h1.executed?.status ?? "-"} · ${h1.score.pass ? "score PASS" : `score FAIL (${JSON.stringify(h1.score).slice(0, 160)})`}`);
  await ho.close();
  ev.network = { dev: readJsonl(devFiles.netlog).length, holdout: readJsonl(hoFiles.netlog).length };
  // Executed items (ran), as pre-registered; lifesci-satisfy-3 was first scored on listed items.
  ev.fanOutLimitsHeld = [...ev.tasks, h1].every((t: any) => (t.executed?.fanOuts ?? []).every((f: any) => (f.ran ?? 0) <= (f.max ?? Infinity)));
  writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(ev, null, 2));
  return ev;
}

const results: Record<string, any> = {};
for (const tag of [BASE, CAND]) {
  log(`build ${tag}`);
  results[tag] = await runBuild(tag);
}
const c = results[CAND];
const established = (t: any) => t.outcome?.status === "established" && t.executed?.status === "completed";
const multi = (t: any) => new Set((t.executed?.titles ?? []).length ? t.executed.titles : []).size >= 2;
const criteria = {
  A: c.tasks.filter((t: any) => ["Q03", "Q04", "Q05", "Q07"].includes(t.id)).some((t: any) => t.ranking[0]?.satisfaction?.status === "established" && multi(t)),
  B: c.tasks.filter((t: any) => ["Q03", "Q04", "Q05", "Q07"].includes(t.id)).some((t: any) => established(t) && multi(t) && t.score.pass),
  C: established(c.holdout.h1) && c.holdout.h1.score.pass,
  D: c.tasks.filter((t: any) => t.id.startsWith("Q08")).every((t: any) => established(t) && t.score.pass && !(t.outcome?.joins ?? []).some((j: any) => j.kind === "generic")),
  E: c.negatives.every((n: any) => n.pass) && [...c.tasks, ...c.negatives, c.holdout.h1].every((t: any) => !t.ranking.some((p: any) => p.satisfaction?.status === "established" && p.satisfaction.joins.some((j: any) => j.kind === "generic"))),
  F: c.fanOutLimitsHeld,
};
writeFileSync(`${OUT}/criteria-${CAND}.json`, JSON.stringify({ baseline: BASE, candidate: CAND, criteria, note: "G (suite) and H (tsc) are recorded from the build's own test run" }, null, 2));
log(`criteria (${CAND}): ${JSON.stringify(criteria)}`);
