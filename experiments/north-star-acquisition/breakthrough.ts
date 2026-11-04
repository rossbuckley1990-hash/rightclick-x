// Phase 3 — the breakthrough test.
//
// One call to context_compose per goal. The harness never invokes lychee itself and never wires two
// programs together by hand: it states what it has and what it wants, and runs whatever the planner
// chose. Expectations are predeclared in PREDICTIONS.md Part 5, committed before this first ran.
//
// Ordering matters: the candidate pipeline (C1-C3) and its unseen/fresh-process/fresh-session reuse
// (C5-C7) are executed BEFORE any builtin-only witness composite is crystallized into the graph,
// so the unanchored goal:host-summary is never shadowed by a 1-step crystallized builtin composite.
// Then C4 (independent witness verification) and C9 (two acquired CLI programs lychee -> jq
// composed together, independently verified by the builtin witness, and reused in a fresh OS process)
// are executed, followed by C8 (executable revalidation).
//
//   node experiments/north-star-acquisition/breakthrough.ts [--state /tmp/rcx-ns-bt.json]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, appendFileSync, rmSync } from "node:fs";
import { connect } from "./mcp-client.ts";

const HERE = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;
const LYCHEE = "/opt/homebrew/bin/lychee";
const JQ = "/opt/homebrew/bin/jq";
const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const STATE = arg("state", "/tmp/rcx-ns-breakthrough.json");
const OUT = `${HERE}evidence/breakthrough.json`;
// Scratch outside the repository: these are large binaries, not source.
const COPY_DIR = "/tmp/rcx-ns-revalidation";
const COPY = `${COPY_DIR}/lychee-under-test`;

const fixtures = Object.fromEntries(["abs-links.md", "mixed.md", "no-links.md", "rel-links.md"].map((f) => [f, readFileSync(`${HERE}fixtures/${f}`, "utf8")]));
const oracle = JSON.parse(readFileSync(`${HERE}evidence/oracle-expected.json`, "utf8")).fixtures;
// A held-out document the acquisition never saw: reuse must work on inputs it was not tuned on.
// Uses non-reserved TLDs (.dev, .io) because lychee's default link extractor excludes RFC 2606
// reserved domains (.example, .test).
const UNSEEN = `# Unseen document\n\nPoints at [one](https://kilo-unseen.dev/first) and\n[two](https://lima-unseen.io/second), then [three](https://kilo-unseen.dev/third).\n`;
const UNSEEN_EXPECTED = ["kilo-unseen.dev", "lima-unseen.io", "kilo-unseen.dev"];
const UNSEEN_EXPECTED_COUNTS = [
  { host: "kilo-unseen.dev", count: 2 },
  { host: "lima-unseen.io", count: 1 },
];
const hostsOf = (urls: string[]) => urls.map((u) => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean);
const expectedDomains = (fixture: string) => hostsOf(oracle[fixture].absoluteHttp);

const rec: any = { startedAt: new Date().toISOString(), state: STATE, predictions: "PREDICTIONS.md Part 5, committed before this run", phases: {} };
const flush = () => { mkdirSync(`${HERE}evidence`, { recursive: true }); writeFileSync(OUT, JSON.stringify(rec, null, 2)); };
process.on("uncaughtException", (e: any) => { rec.crashed = String(e?.stack ?? e).slice(0, 3000); rec.finishedAt = new Date().toISOString(); flush(); console.error(`crashed: ${String(rec.crashed).split("\n")[0]}`); process.exit(1); });

let session = 0;
const open = async (programs: string) => {
  session++;
  const c = await connect({ repo: REPO, state: STATE, investigate: programs, execute: programs });
  console.error(`[session ${session}] connected (fresh OS process, fresh MCP session)`);
  return c;
};
const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? "").trim() ? String(v).trim().split("\n").map((x) => x.trim()).filter(Boolean) : []);
const refusalOf = (r: any) => r?.refusal ?? r?.error ?? r?.threw ?? r?.raw ?? null;

// ================================================================ Phase A: acquire, compose, publish (C1, C2, C3, C7)
rmSync(STATE, { force: true });
let c = await open(`${LYCHEE},${JQ}`);
let call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);

console.error("[A] acquiring lychee ...");
const learn = await call("context_learn", { source: `cli:${LYCHEE}` });
rec.phases.A_acquire = {
  detail: learn?.results?.[0]?.probes?.[0]?.detail ?? null,
  newCapabilities: learn?.totalNewCapabilities ?? null,
  graphBeforeAnyGoal: learn?.graph ?? null,
  error: refusalOf(learn),
};

// C1/C2/C3: the candidate, composed on a graph that holds no saved goal. No anchors, no named
// capability, no published witness yet: whatever the planner picks is what runs and publishes.
console.error("[A] composing the candidate with no anchors and nothing published yet ...");
const candidate = await call("context_compose", {
  have: { document: { type: "markdown", value: fixtures["abs-links.md"] } },
  want: "list:domain",
  intent: "hosts linked from a markdown document",
  run: true,
  verify: [{ op: "length_gt", value: 0 }],
  publish: "host-summary",
});
const executedPipeline = candidate?.executed?.titles ?? null;
const candidateOutput = asArray(candidate?.executed?.output);
rec.phases.A_candidate = {
  plansOffered: (candidate?.plans ?? []).map((p: any) => ({ titles: p.titles, cost: p.cost, result: p.result })),
  planCount: (candidate?.plans ?? []).length,
  executedPipeline,
  executedSteps: Array.isArray(executedPipeline) ? executedPipeline.length : 0,
  multistep: Array.isArray(executedPipeline) && executedPipeline.length >= 2,
  usedAcquiredCapability: JSON.stringify(executedPipeline ?? []).includes("lychee"),
  output: candidate?.executed?.output ?? null,
  outputIsList: Array.isArray(candidate?.executed?.output),
  status: candidate?.executed?.status ?? null,
  trust: candidate?.executed?.verification?.status ?? null,
  published: candidate?.published ?? null,
  publishRefused: candidate?.publishRefused ?? null,
  attempts: candidate?.executed?.attempts ?? null,
  contract: candidate?.executed?.contract ?? null,
  error: refusalOf(candidate),
  oracleExpectedDomains: expectedDomains("abs-links.md"),
  matchesOracle: JSON.stringify(candidateOutput.slice().sort()) === JSON.stringify(expectedDomains("abs-links.md").slice().sort()),
  matchesOracleInOrder: JSON.stringify(candidateOutput) === JSON.stringify(expectedDomains("abs-links.md")),
};
console.error(`[A] executed: ${JSON.stringify(executedPipeline)} -> ${JSON.stringify(candidate?.executed?.output)}`);

// C7 (same session): a document the acquisition never saw.
console.error("[A] reuse in the same session on an unseen document ...");
const unseen = await call("context_run", { id: "goal:host-summary", args: { document: UNSEEN } });
rec.phases.A_unseenSameSession = {
  status: unseen?.status ?? null,
  output: unseen?.output ?? null,
  expected: UNSEEN_EXPECTED,
  matches: JSON.stringify(asArray(unseen?.output).slice().sort()) === JSON.stringify(UNSEEN_EXPECTED.slice().sort()),
  verification: unseen?.verification?.status ?? null,
  error: refusalOf(unseen),
};
rec.phases.A_interaction = { toolCalls: c.transcript.filter((t) => t.method === "tools/call").length, receivedChars: c.transcript.reduce((a, t) => a + t.receivedChars, 0) };
c.close();

// ================================================================ Phase B: fresh OS process (C5)
c = await open(`${LYCHEE},${JQ}`);
call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);
console.error("[B] fresh process: discovering the published goal without being told its id ...");
const found = await call("context_graph", { op: "search", query: "host summary", limit: 20 });
const foundIds = [...new Set(JSON.stringify(found ?? {}).match(/"goal:[a-z0-9-]+"/g)?.map((s) => s.slice(1, -1)) ?? [])];
const rerun = await call("context_run", { id: "goal:host-summary", args: { document: fixtures["abs-links.md"] } });
const runStatus = await call("context_run_status", { limit: 5 });
const runtime = await call("context_runtime", {});
rec.phases.B_freshProcess = {
  discoveredGoalIds: foundIds,
  status: rerun?.status ?? null,
  output: rerun?.output ?? null,
  matchesPhaseA: JSON.stringify(asArray(rerun?.output)) === JSON.stringify(candidateOutput),
  verification: rerun?.verification?.status ?? null,
  receipt: rerun?.receipt ?? null,
  chainIntact: runStatus?.chain?.valid ?? runStatus?.chain?.ok ?? runtime?.receipts?.intact ?? null,
  chainLength: runStatus?.chain?.count ?? runStatus?.chain?.length ?? null,
  runtimeKeys: Object.keys(runtime ?? {}),
  error: refusalOf(rerun),
};
console.error(`[B] goal:host-summary -> ${JSON.stringify(rerun?.output)} [${rerun?.status}] chainIntact=${rec.phases.B_freshProcess.chainIntact}`);
c.close();

// ================================================================ Phase C: fresh agent session (C6)
c = await open(`${LYCHEE},${JQ}`);
call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);
console.error("[C] fresh agent session on the unseen document ...");
const sessionRun = await call("context_run", { id: "goal:host-summary", args: { document: UNSEEN } });
const explained = await call("context_explain", { id: "goal:host-summary" });
rec.phases.C_freshSession = {
  status: sessionRun?.status ?? null,
  output: sessionRun?.output ?? null,
  expected: UNSEEN_EXPECTED,
  matches: JSON.stringify(asArray(sessionRun?.output).slice().sort()) === JSON.stringify(UNSEEN_EXPECTED.slice().sort()),
  verification: sessionRun?.verification?.status ?? null,
  publishedTrust: explained?.capability?.tags ?? null,
  reuseGuidance: explained?.details?.reuseGuidance ?? null,
  error: refusalOf(sessionRun),
};
console.error(`[C] unseen -> ${JSON.stringify(sessionRun?.output)} [${sessionRun?.status}]`);

// ================================================================ Phase E: independent witness & two-CLI composition (C4 & C9)
console.error("[E] crystallizing the builtin-only witness pipelines ...");
const witnessLinks = await call("context_compose", {
  have: { document: { type: "markdown", value: fixtures["abs-links.md"] } },
  want: "list:url",
  intent: "links extracted from a markdown document",
  run: true,
  through: ["builtin:markdown.html", "builtin:html.links"],
});
const witnessLinksId = witnessLinks?.crystallized?.id ?? null;

const witnessGoal = await call("context_compose", {
  have: { document: { type: "markdown", value: fixtures["abs-links.md"] } },
  want: "list:domain",
  intent: "hosts linked from a markdown document",
  run: true,
  through: ["builtin:markdown.html", "builtin:html.links", "builtin:url.domain"],
  publish: "hosts-independent-builtin",
});
const witnessDomainsId = witnessGoal?.crystallized?.id ?? null;
rec.phases.A_witnessGoal = {
  status: witnessGoal?.executed?.status ?? null,
  pipeline: witnessGoal?.executed?.titles ?? null,
  output: witnessGoal?.executed?.output ?? null,
  trust: witnessGoal?.executed?.verification?.status ?? null,
  crystallizedDomainsId: witnessDomainsId,
  crystallizedLinksId: witnessLinksId,
  published: witnessGoal?.published ?? null,
  publishRefused: witnessGoal?.publishRefused ?? null,
  error: refusalOf(witnessGoal),
};

console.error("[E] re-composing link extraction with the independent builtin witness attached (C4) ...");
for (const name of ["abs-links.md", "mixed.md"]) {
  const witnessed = await call("context_compose", {
    have: { document: { type: "markdown", value: fixtures[name] } },
    want: "list:url",
    intent: "enumerate the links in a markdown document",
    run: true,
    through: ["cli:lychee:dump"],
    witnesses: witnessLinksId ? [{ capability: witnessLinksId, args: { document: { input: "document" } }, agree: { mode: "exact" } }] : [],
    ...(name === "abs-links.md" ? { publish: "links-verified" } : {}),
  });
  rec.phases[`A_witness_${name}`] = {
    anchoredTo: "cli:lychee:dump — declared, because this step asks whether an independent witness (builtin:core) agrees with cli:lychee",
    witnessCapability: witnessLinksId,
    status: witnessed?.executed?.status ?? null,
    pipeline: witnessed?.executed?.titles ?? null,
    output: witnessed?.executed?.output ?? null,
    trust: witnessed?.executed?.verification?.status ?? null,
    assurance: witnessed?.executed?.contract?.assurance ?? null,
    witnesses: witnessed?.executed?.witnesses ?? null,
    published: witnessed?.published ?? null,
    publishRefused: witnessed?.publishRefused ?? null,
    oracleExpectedLinks: oracle[name].absoluteHttp,
    matchesOracle: JSON.stringify(asArray(witnessed?.executed?.output).slice().sort()) === JSON.stringify(oracle[name].absoluteHttp.slice().sort()),
    error: refusalOf(witnessed),
  };
  console.error(`[E] witness on ${name}: trust=${witnessed?.executed?.verification?.status ?? null}`);
}

console.error("[E] acquiring jq and composing two acquired CLI programs (lychee -> jq) (C9) ...");
const learnJq = await call("context_learn", { source: `cli:${JQ}` });
const jqDomainsWitnessed = await call("context_compose", {
  have: {
    document: { type: "markdown", value: fixtures["abs-links.md"] },
    jqOptions: { value: ["-f"], fixed: true },
    jqFiles: { value: { "filter.jq": 'map(split("/")[2])' }, fixed: true },
  },
  want: "json",
  intent: "extract hostnames from markdown links using lychee and jq",
  through: ["cli:lychee:dump", "cli:jq:invoke"],
  inputBindings: { "cli:jq:invoke": { options: "jqOptions", files: "jqFiles" } },
  maxSteps: 2,
  witnesses: witnessDomainsId ? [{ capability: witnessDomainsId, args: { document: { input: "document" } }, agree: { mode: "exact" } }] : [],
  run: true,
  publish: "host-list-verified",
});
const jqHostCounts = await call("context_compose", {
  have: {
    document: { type: "markdown", value: fixtures["abs-links.md"] },
    jqOptions: { value: ["-f"], fixed: true },
    jqFiles: { value: { "filter.jq": 'map(split("/")[2]) | group_by(.) | map({host: .[0], count: length})' }, fixed: true },
  },
  want: "json",
  intent: "aggregate link counts per host from markdown using lychee and jq",
  through: ["cli:lychee:dump", "cli:jq:invoke"],
  inputBindings: { "cli:jq:invoke": { options: "jqOptions", files: "jqFiles" } },
  maxSteps: 2,
  verify: [{ op: "length_gt", value: 0 }],
  run: true,
  publish: "host-counts-cli",
});
rec.phases.A_twoCliComposition = {
  learnJqDetail: learnJq?.results?.[0]?.probes?.[0]?.detail ?? null,
  domainListVerified: {
    status: jqDomainsWitnessed?.executed?.status ?? null,
    pipeline: jqDomainsWitnessed?.executed?.titles ?? null,
    output: jqDomainsWitnessed?.executed?.output ?? null,
    trust: jqDomainsWitnessed?.executed?.verification?.status ?? null,
    assurance: jqDomainsWitnessed?.executed?.contract?.assurance ?? null,
    witnesses: jqDomainsWitnessed?.executed?.witnesses ?? null,
    published: jqDomainsWitnessed?.published ?? null,
    error: refusalOf(jqDomainsWitnessed),
  },
  hostCountAggregation: {
    status: jqHostCounts?.executed?.status ?? null,
    pipeline: jqHostCounts?.executed?.titles ?? null,
    output: jqHostCounts?.executed?.output ?? null,
    trust: jqHostCounts?.executed?.verification?.status ?? null,
    published: jqHostCounts?.published ?? null,
    error: refusalOf(jqHostCounts),
  },
};
c.close();

// Verify fresh OS-process reuse of the two-CLI goals on unseen input
c = await open(`${LYCHEE},${JQ}`);
call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);
const rerunVerified = await call("context_run", { id: "goal:host-list-verified", args: { document: UNSEEN } });
const rerunHostCounts = await call("context_run", { id: "goal:host-counts-cli", args: { document: UNSEEN } });
rec.phases.E_freshProcessTwoCliReuse = {
  verifiedGoalOnUnseenInFreshProcess: {
    status: rerunVerified?.status ?? null,
    verification: rerunVerified?.verification?.status ?? null,
    output: rerunVerified?.output ?? null,
    matchesExpected: JSON.stringify(rerunVerified?.output) === JSON.stringify(UNSEEN_EXPECTED),
  },
  hostCountsOnUnseenInFreshProcess: {
    status: rerunHostCounts?.status ?? null,
    verification: rerunHostCounts?.verification?.status ?? null,
    output: rerunHostCounts?.output ?? null,
    matchesExpected: JSON.stringify(rerunHostCounts?.output) === JSON.stringify(UNSEEN_EXPECTED_COUNTS),
  },
};
console.error(`[E] fresh-process 2-CLI reuse: verified=${rerunVerified?.verification?.status} counts=${JSON.stringify(rerunHostCounts?.output)}`);
c.close();

// ================================================================ Phase D: executable revalidation (C8)
//
// The gate is behavioural, not byte-identity: a changed program is revalidated by replaying its
// stored conformance examples, so a byte change that leaves behaviour identical is accepted and a
// byte change that alters behaviour is refused. Both arms are measured.
mkdirSync(COPY_DIR, { recursive: true });
rmSync(COPY, { force: true });
copyFileSync(LYCHEE, COPY);
chmodSync(COPY, 0o755);
c = await open(`${LYCHEE},${COPY_DIR}/`);
call = (t: string, a: Record<string, unknown>) => c.callTool(t, a);
const { createHash } = await import("node:crypto");
const digestOf = () => createHash("sha256").update(readFileSync(COPY)).digest("hex");
const shaBefore = digestOf();
console.error("[D] learning a copy of the program ...");
const learnCopy = await call("context_learn", { source: `cli:${COPY}` });
const copyIds = [...new Set(JSON.stringify(await call("context_graph", { op: "search", query: "lychee-under-test", limit: 30 }) ?? {}).match(/"cli:lychee-under-test:[a-z0-9-]+"/g)?.map((s) => s.slice(1, -1)) ?? [])];
const dumpCopy = copyIds.find((i) => i.endsWith(":dump")) ?? copyIds[0] ?? null;
const runDump = async () => (dumpCopy ? await call("context_run", { id: dumpCopy, args: { file1: fixtures["abs-links.md"] } }) : null);

const before = await runDump();
// Arm 1: a byte change that leaves behaviour identical.
appendFileSync(COPY, Buffer.from([0x00]));
const shaAppended = digestOf();
const afterAppend = await runDump();
// Arm 2: a replacement whose behaviour differs.
rmSync(COPY, { force: true });
writeFileSync(COPY, "#!/bin/sh\ncat\n", { mode: 0o755 });
const shaReplaced = digestOf();
const afterReplace = await runDump();

rec.phases.D_revalidation = {
  copyCapabilityIds: copyIds,
  capabilityUnderTest: dumpCopy,
  learnedCopy: learnCopy?.results?.[0]?.probes?.[0]?.detail ?? null,
  sha256Investigated: shaBefore,
  baseline: { status: before?.status ?? null, output: before?.output ?? null, error: refusalOf(before) },
  arm1_byteChangeBehaviourIdentical: {
    sha256: shaAppended,
    bytesChanged: shaAppended !== shaBefore,
    status: afterAppend?.status ?? null,
    output: afterAppend?.output ?? null,
    error: refusalOf(afterAppend),
    accepted: (afterAppend?.status ?? null) === "completed",
    note: "accepted only if the stored conformance examples replay identically; that is the gate, and it is behavioural rather than byte-identity",
  },
  arm2_replacementBehaviourChanged: {
    sha256: shaReplaced,
    bytesChanged: shaReplaced !== shaBefore,
    status: afterReplace?.status ?? null,
    output: afterReplace?.output ?? null,
    error: refusalOf(afterReplace),
    refused: (afterReplace?.status ?? null) === "failed" || !!refusalOf(afterReplace),
    refusalNamesTheChangedProgram: /changed|sha256|409|re-investigate/i.test(String(refusalOf(afterReplace) ?? "")),
  },
};
console.error(`[D] baseline=${before?.status} arm1=${afterAppend?.status} arm2=${afterReplace?.status}`);
c.close();

rec.finishedAt = new Date().toISOString();
flush();
console.log(JSON.stringify({
  out: OUT,
  C1_pipeline: rec.phases.A_candidate?.executedPipeline,
  C1_multistep: rec.phases.A_candidate?.multistep,
  C1_usedAcquired: rec.phases.A_candidate?.usedAcquiredCapability,
  C2_matchesOracle: rec.phases.A_candidate?.matchesOracle,
  C3_trust: rec.phases.A_candidate?.trust,
  C4_witnessTrust: { abs: rec.phases["A_witness_abs-links.md"]?.trust, mixed: rec.phases["A_witness_mixed.md"]?.trust },
  C5_freshProcessMatches: rec.phases.B_freshProcess?.matchesPhaseA,
  C5_chainIntact: rec.phases.B_freshProcess?.chainIntact,
  C6_freshSessionMatches: rec.phases.C_freshSession?.matches,
  C7_unseenSameSession: rec.phases.A_unseenSameSession?.matches,
  C8_arm1_accepted: rec.phases.D_revalidation?.arm1_byteChangeBehaviourIdentical?.accepted,
  C8_arm2_refused: rec.phases.D_revalidation?.arm2_replacementBehaviourChanged?.refused,
  C9_twoCliVerifiedTrust: rec.phases.A_twoCliComposition?.domainListVerified?.trust,
  C9_twoCliHostCounts: rec.phases.A_twoCliComposition?.hostCountAggregation?.output,
  C9_freshProcessUnseenVerified: rec.phases.E_freshProcessTwoCliReuse?.verifiedGoalOnUnseenInFreshProcess,
  C9_freshProcessUnseenHostCounts: rec.phases.E_freshProcessTwoCliReuse?.hostCountsOnUnseenInFreshProcess,
}, null, 2));
process.exit(0);
