// North Star acquisition probe. The SAME script runs against the unmodified baseline and against
// the fixed build; only the product changes. Every attempt is recorded, including failures.
//
//   node experiments/north-star-acquisition/probe.ts --label baseline --state /tmp/ns-base.json
//
// Predictions are in PREDICTIONS.md, committed before this file was first run.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { connect } from "./mcp-client.ts";

const HERE = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;
const LYCHEE = "/opt/homebrew/bin/lychee";
const ICONV = "/usr/bin/iconv";

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LABEL = arg("label", "unlabelled");
const STATE = arg("state", `/tmp/rcx-ns-${LABEL}.json`);
const OUT = arg("out", `${HERE}evidence/probe-${LABEL}.json`);

const fixtures = Object.fromEntries(
  readdirSync(`${HERE}fixtures/`).filter((f) => f.endsWith(".md")).sort()
    .map((f) => [f, readFileSync(`${HERE}fixtures/${f}`, "utf8")]),
);
const oracle = JSON.parse(readFileSync(`${HERE}evidence/oracle-expected.json`, "utf8")).fixtures;

const c = await connect({ repo: REPO, state: STATE, investigate: `${LYCHEE},${ICONV}`, execute: `${LYCHEE},${ICONV}` });
const call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);
const startedAt = new Date().toISOString();
const rec: any = { label: LABEL, startedAt, repo: REPO, state: STATE, predictions: "see PREDICTIONS.md (committed first)", checks: {} };

// A crashed harness must still preserve what it observed: partial evidence beats a lost run.
const flush = () => { mkdirSync(`${HERE}evidence`, { recursive: true }); writeFileSync(OUT, JSON.stringify(rec, null, 2)); };
process.on("uncaughtException", (e: any) => { rec.crashed = String(e?.stack ?? e).slice(0, 2000); rec.finishedAt = new Date().toISOString(); flush(); console.error(`[${LABEL}] crashed, partial evidence written: ${String(rec.crashed).split("\n")[0]}`); process.exit(1); });

// A capability whose output representation was established as a line list returns an array, so the
// harness must not flatten it through String(): that would join elements with commas and report one
// "line" for a correct three-element result.
const elements = (s: unknown): string[] => Array.isArray(s) ? s.map((x) => String(x)) : String(s ?? "").trim() === "" ? [] : String(s).trim().split("\n").map((x) => x.trim()).filter(Boolean);
const text = (s: unknown) => (Array.isArray(s) ? JSON.stringify(s) : String(s ?? ""));
const lines = elements;
const refusalOf = (r: any) => r?.refusal ?? r?.error ?? r?.threw ?? r?.raw ?? null;
// The per-run sandbox directory is created fresh by the sandbox for every run. Only that component
// is logically volatile; every other path difference is a real output change and must survive.
const SBX = /\/(?:private\/)?var\/folders\/[^/\s]+\/[^/\s]+\/[^/\s]*\/?T\/rcx-sbx-[^/\s]+/g;
const withoutSandboxPath = (s: string) => s.replace(SBX, "<sandbox>");

// ---------------------------------------------------------------- 0. acquire
console.error(`[${LABEL}] learning ${LYCHEE} ...`);
const learnLychee = await call("context_learn", { source: `cli:${LYCHEE}` });
rec.checks.acquire = {
  learnLychee: { error: refusalOf(learnLychee), keys: Object.keys(learnLychee ?? {}) },
  learnDetail: learnLychee?.results?.[0]?.probes?.[0]?.detail ?? null,
  totalNewCapabilities: learnLychee?.totalNewCapabilities ?? null,
};

// Capability ids come from the graph, never from a hardcoded list, so the harness cannot smuggle
// an answer. context_graph requires an op; "search" finds what the program's own provider holds.
const ID_RE = /"((?:cli|goal|builtin):[A-Za-z0-9._-]+:[A-Za-z0-9._-]+|builtin:[A-Za-z0-9._-]+)"/g;
const idsFrom = (v: unknown) => [...new Set(JSON.stringify(v ?? {}).match(ID_RE)?.map((s) => s.slice(1, -1)) ?? [])];
const searchIds = async (query: string) => {
  const s = await call("context_graph", { op: "search", query, limit: 100 });
  return { ids: idsFrom(s), error: refusalOf(s), shape: Object.keys(s ?? {}) };
};
const graphExport = await call("context_graph", { op: "export" });
const graphStats = await call("context_graph", { op: "stats" });
const ids = idsFrom(graphExport);
const lycheeSearch = await searchIds("lychee");
rec.checks.acquire.graphExportIds = ids;
rec.checks.acquire.graphStats = graphStats?.raw ? String(graphStats.raw).slice(0, 200) : graphStats;
rec.checks.acquire.lycheeSearch = lycheeSearch;
rec.checks.acquire.lycheeIds = [...new Set([...lycheeSearch.ids, ...ids.filter((i) => i.startsWith("cli:lychee:"))])];
console.error(`[${LABEL}] ${rec.checks.acquire.lycheeIds.length} lychee capabilities: ${rec.checks.acquire.lycheeIds.join(", ")}`);

// Identify the capability under test by its recorded invocation, not by guessing from its name.
const explains: Record<string, any> = {};
for (const id of rec.checks.acquire.lycheeIds) explains[id] = await call("context_explain", { id, detail: "run" });
const flagsOf = (e: any) => JSON.stringify(e?.executionPlan ?? e?.contract ?? e ?? {});
const dumpId = rec.checks.acquire.lycheeIds.find((id) => /--dump|"dump"/.test(flagsOf(explains[id])));
rec.checks.acquire.dumpCapability = dumpId ?? null;
rec.checks.acquire.identification = dumpId
  ? `selected because its recorded execution plan passes --dump; harness choice, not product behaviour`
  : "no learned lychee capability records --dump in its execution plan";
if (dumpId) {
  rec.checks.acquire.explainKeys = Object.keys(explains[dumpId] ?? {});
  rec.checks.acquire.explainSample = JSON.stringify(explains[dumpId] ?? {}).slice(0, 1400);
}
rec.checks.acquire.outputPortTypes = Object.fromEntries(
  rec.checks.acquire.lycheeIds.map((id) => {
    const e = explains[id];
    const cap = e?.capability ?? e;
    return [id, {
      inputs: cap?.inputs ?? null,
      outputs: cap?.outputs ?? null,
      tags: (cap?.tags ?? []).filter((t: string) => /^(unsupported|direct-only|nondeterministic|input-independent-in-samples|declared-only|exact-stdout)$/.test(t)),
      okExit: cap?.invoke?.okExit ?? null,
      outputRepresentation: cap?.invoke?.output ?? null,
      lineType: cap?.invoke?.lineType ?? null,
      emptyResult: cap?.invoke?.emptyResult ?? null,
    }];
  }),
);
console.error(`[${LABEL}] capability under test: ${dumpId ?? "(none)"}`);

// ---------------------------------------------------------------- B1/A1 empty result
if (dumpId) {
  rec.checks.A1_emptyResult = { perFixture: {} };
  for (const [name, md] of Object.entries(fixtures)) {
    const r = await call("context_run", { id: dumpId, args: { file1: md }, view: { full: true } });
    const got = lines(r?.output);
    rec.checks.A1_emptyResult.perFixture[name] = {
      status: r?.status ?? null,
      refusal: refusalOf(r),
      outputIsArray: Array.isArray(r?.output),
      lineCount: got.length,
      lines: got.slice(0, 20),
      oracleAbsoluteHttp: oracle[name].absoluteHttp,
      oracleRelative: oracle[name].relative,
      oracleMailto: oracle[name].mailto,
      absoluteHttpMatchesOracle: JSON.stringify(got.filter((l) => /^https?:/.test(l)).sort()) === JSON.stringify(oracle[name].absoluteHttp),
      replacementChars: (String(r?.output ?? "").match(/\uFFFD/g) ?? []).length,
    };
  }
  const nl = rec.checks.A1_emptyResult.perFixture["no-links.md"];
  rec.checks.A1_emptyResult.verdict = {
    emptyFixtureStatus: nl?.status,
    emptyFixtureRefusal: nl?.refusal,
    emptyResultAdmitted: nl?.status === "completed" && nl?.lineCount === 0,
    emptyResultRefused: !!nl?.refusal && /without output/i.test(String(nl.refusal)),
  };
}

// ---------------------------------------------------------------- B3/A3 repeatability
if (dumpId) {
  const rel = fixtures["rel-links.md"];
  const run1 = await call("context_run", { id: dumpId, args: { file1: rel }, view: { full: true } });
  const run2 = await call("context_run", { id: dumpId, args: { file1: rel }, view: { full: true } });
  const o1 = text(run1?.output), o2 = text(run2?.output);
  rec.checks.A3_repeatability = {
    run1Status: run1?.status ?? null,
    run2Status: run2?.status ?? null,
    run1Refusal: refusalOf(run1),
    identicalBytes: o1 === o2,
    identicalAfterSandboxPathNormalisation: withoutSandboxPath(o1) === withoutSandboxPath(o2),
    sandboxPathPresentInReturnedOutput: SBX.test(o1) || new RegExp(SBX.source).test(o1),
    run1: elements(run1?.output).slice(0, 8),
    run2: elements(run2?.output).slice(0, 8),
    note: "identicalBytes=false with identicalAfterSandboxPathNormalisation=true isolates the volatile sandbox directory as the only difference",
  };
  SBX.lastIndex = 0;
}

// ---------------------------------------------------------------- B2/A2 typed composition
if (dumpId) {
  const abs = fixtures["abs-links.md"];
  const planOnly = await call("context_compose", {
    have: { document: { type: "markdown", value: abs } },
    want: "list:url",
    intent: "enumerate the links in a markdown document",
    run: false,
  });
  const plans = planOnly?.plans ?? planOnly?.routes ?? [];
  // A second, independent reading of the same question: does the graph itself hold a path?
  const paths = await call("context_graph", { op: "paths", from: "markdown", to: "list:url", limit: 10 });
  rec.checks.A2_typedComposition = {
    dumpOutputPortType: rec.checks.acquire.outputPortTypes[dumpId]?.outputs ?? null,
    graphPathsMarkdownToListUrl: paths?.raw ? String(paths.raw).slice(0, 400) : paths,
    plansFound: Array.isArray(plans) ? plans.length : null,
    planningRefusal: planOnly?.planningRefusal ?? null,
    error: refusalOf(planOnly),
    planTitles: Array.isArray(plans) ? plans.slice(0, 4).map((p: any) => p?.titles ?? p?.steps ?? p) : null,
    usesAcquiredCapability: Array.isArray(plans) && JSON.stringify(plans).includes(dumpId),
  };
}

// ---------------------------------------------------------------- B4/A4 non-UTF-8 output
const learnIconv = await call("context_learn", { source: `cli:${ICONV}` });
const iconvSearch = await searchIds("iconv");
rec.checks.A4_encoding = {
  learnedIconv: refusalOf(learnIconv),
  learnDetail: learnIconv?.results?.[0]?.probes?.[0]?.detail ?? null,
  iconvSearch,
  iconvIds: [...new Set([...iconvSearch.ids, ...idsFrom(await call("context_graph", { op: "export" })).filter((i) => i.startsWith("cli:iconv:"))])],
};
const iconvInvoke = rec.checks.A4_encoding.iconvIds.find((i: string) => i.endsWith(":invoke")) ?? rec.checks.A4_encoding.iconvIds[0];
if (iconvInvoke) {
  const r = await call("context_run", {
    id: iconvInvoke,
    args: { input: "caf\u00e9 na\u00efve\n", options: ["-f", "UTF-8", "-t", "ISO-8859-1"] },
    view: { full: true },
  });
  const out = String(r?.output ?? "");
  rec.checks.A4_encoding.run = {
    capability: iconvInvoke,
    status: r?.status ?? null,
    refusal: refusalOf(r),
    outputCodePoints: [...out].map((ch) => ch.codePointAt(0)),
    replacementChars: (out.match(/\uFFFD/g) ?? []).length,
    // 0xE9 is the ISO-8859-1 byte for e-acute; as UTF-8 text it cannot survive, so a faithful
    // channel must either refuse or hand back the exact bytes, never U+FFFD.
    silentlyCorrupted: (out.match(/\uFFFD/g) ?? []).length > 0 && (r?.status === "completed"),
    explicitlyUnsupported: /utf-8|encoding|byte/i.test(String(refusalOf(r) ?? "")),
  };
} else {
  rec.checks.A4_encoding.run = { capability: null, note: "no iconv capability was learned, so the encoding boundary could not be probed through the product" };
}

// ---------------------------------------------------------------- B5/A5 assurance ceiling
if (dumpId) {
  const abs = fixtures["abs-links.md"];
  const published = await call("context_compose", {
    have: { document: { type: "markdown", value: abs } },
    want: "list:url",
    intent: "enumerate the links in a markdown document",
    run: true,
    publish: "ns-link-audit",
    verify: [{ op: "length_gt", value: 0 }],
  });
  rec.checks.A5_assurance = {
    status: published?.executed?.status ?? null,
    verification: published?.executed?.verification ?? null,
    trust: published?.executed?.verification?.status ?? null,
    published: !!published?.published || !!published?.goal,
    publishRefused: published?.publishRefused ?? null,
    pipeline: published?.executed?.titles ?? null,
    error: refusalOf(published),
    claimsVerifiedWithoutWitness: (published?.executed?.verification?.status === "verified") && !(published?.executed?.witnesses?.length),
  };
}

// ---------------------------------------------------------------- accounting
rec.finishedAt = new Date().toISOString();
rec.interaction = {
  toolCalls: c.transcript.filter((t) => t.method === "tools/call").length,
  totalSentChars: c.transcript.reduce((a, t) => a + t.sentChars, 0),
  totalReceivedChars: c.transcript.reduce((a, t) => a + t.receivedChars, 0),
  totalMs: c.transcript.reduce((a, t) => a + t.ms, 0),
  perCall: c.transcript.map((t) => ({ method: t.method, sent: t.sentChars, received: t.receivedChars, ms: t.ms })),
};
mkdirSync(`${HERE}evidence`, { recursive: true });
writeFileSync(OUT, JSON.stringify(rec, null, 2));
c.close();
console.error(`[${LABEL}] wrote ${OUT}`);
console.log(JSON.stringify({ label: LABEL, out: OUT, dumpCapability: dumpId ?? null, A1: rec.checks.A1_emptyResult?.verdict ?? null, A3: rec.checks.A3_repeatability ?? null, A2: rec.checks.A2_typedComposition ?? null, A4: rec.checks.A4_encoding?.run ?? null, A5: rec.checks.A5_assurance ?? null }, null, 2));
