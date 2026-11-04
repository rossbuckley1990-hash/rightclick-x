// Cost-accounting audit of evidence/competitive-proof.json.
//   node experiments/north-star-acquisition/cost-audit.ts > experiments/north-star-acquisition/evidence/competitive-proof.cost-audit.json
//
// Reads the original evidence and never rewrites it. Every derived figure is recomputed from the
// recorded token counts and timestamps, with each measurement kept in its own category:
//   recorded agent tokens  — counts as transcribed from the agent platform's per-session telemetry
//   cached context         — the cache-read share of those counts
//   modelled API cost      — counts × the pricing assumption the evidence names; not a bill
//   actual bill            — never recorded; always null here
//   runtime-only latency   — the benchmark script's in-process timing of each reuse call
//   agent-session time     — the wall clock from a session's start to its completion
// Original values, recomputed values and the discrepancies between them are all reported.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url).pathname;
const SOURCE = "experiments/north-star-acquisition/evidence/competitive-proof.json";
const bytes = readFileSync(`${HERE}evidence/competitive-proof.json`);
const proof = JSON.parse(bytes.toString("utf8"));

// The pricing assumption stated in proof.breakEvenAnalysis.pricingReference. No model name, cache-write
// premium or provider invoice is recorded with it, so it is a model, not a price list.
const RATE = { uncachedInput: 1.25 / 1e6, cacheRead: 0.3125 / 1e6, output: 10 / 1e6 };

type Session = {
  conversationId: string; tasksCompleted: number; startedAt: string; completedAt: string;
  wallSeconds: number; uncachedInputTokens: number; cacheReadTokens: number; outputTokens: number;
  totalTokens: number; totalTokensPerTask: number; estimatedCostUsd: number; estimatedCostUsdPerTask: number;
};
const sessions: Record<string, Session> = proof.subagentTelemetry;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r1 = (n: number) => Math.round(n * 10) / 10;

const perSession = Object.fromEntries(
  Object.entries(sessions).map(([name, s]) => {
    const tokens = s.uncachedInputTokens + s.cacheReadTokens + s.outputTokens;
    const wall = (Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 1000;
    const cost = s.uncachedInputTokens * RATE.uncachedInput + s.cacheReadTokens * RATE.cacheRead + s.outputTokens * RATE.output;
    const n = s.tasksCompleted;
    return [name, {
      conversationId: s.conversationId,
      tasksCompleted: n,
      recordedAgentTokens: {
        uncachedInput: s.uncachedInputTokens,
        cacheRead: s.cacheReadTokens,
        output: s.outputTokens,
        total: tokens,
        totalMatchesOriginal: tokens === s.totalTokens,
        perTask: { uncachedInput: s.uncachedInputTokens / n, cacheRead: s.cacheReadTokens / n, output: s.outputTokens / n, total: tokens / n },
        cacheWriteTokens: null,
      },
      cachedContext: { cacheReadShareOfTotal: r4(s.cacheReadTokens / tokens), cacheReadShareOfInput: r4(s.cacheReadTokens / (s.cacheReadTokens + s.uncachedInputTokens)) },
      modelledApiCostUsd: {
        total: r4(cost),
        perTask: r4(cost / n),
        perTaskUnrounded: cost / n,
        original: { total: s.estimatedCostUsd, perTask: s.estimatedCostUsdPerTask },
        perTaskMatchesOriginal: s.estimatedCostUsdPerTask === r4(cost / n),
      },
      actualBilledUsd: null,
      agentSessionSeconds: { total: wall, perTask: wall / n, matchesOriginal: wall === s.wallSeconds },
    }];
  }),
);

const A = perSession.ArmA_RightClick_Acquisition, AR = perSession.ArmA_RightClick_Reuse_4Tasks;
const B = perSession.ArmB_SavedScript_Acquisition, BR = perSession.ArmB_SavedScript_Reuse_4Tasks;
const D = perSession.Baseline_DirectShell_FromScratch;

// Break-even: the smallest number of reuses n after acquisition for which acquisition + n·reuse is no
// more than (n + 1) uses of the alternative (the acquisition session also completes the task once).
// The convention reproduces the original's figures; it is stated so it can be disputed.
const breakEven = (acq: number, reuse: number, alt: number): number | null => (alt <= reuse ? null : Math.max(0, Math.ceil((acq - alt) / (alt - reuse))));
const metric = (f: (s: typeof A) => number) => breakEven(f(A), f(AR), f(D));
const vsDirect = {
  agentSessionSeconds: metric((s) => s.agentSessionSeconds.perTask),
  allRecordedTokensIncludingCacheReads: metric((s) => s.recordedAgentTokens.perTask.total),
  uncachedInputPlusOutputTokens: metric((s) => s.recordedAgentTokens.perTask.uncachedInput + s.recordedAgentTokens.perTask.output),
  modelledApiCostUsd: metric((s) => s.modelledApiCostUsd.perTaskUnrounded),
  original: proof.breakEvenAnalysis.vsDirectShellWithoutSavedScript,
};
// Against the saved script, which has an acquisition of its own: the smallest n with
// acquisition + n·reuse ≤ savedAcquisition + n·savedReuse. 0 = cheaper from the first use;
// null = never (no lower per-reuse figure to recover a higher acquisition with).
const breakEvenVs = (acq: number, reuse: number, altAcq: number, altReuse: number): number | null =>
  acq <= altAcq ? 0 : reuse >= altReuse ? null : Math.ceil((acq - altAcq) / (altReuse - reuse));
const vsSavedMetric = (f: (s: typeof A) => number) => breakEvenVs(f(A), f(AR), f(B), f(BR));
const vsSaved = {
  agentSessionSeconds: vsSavedMetric((s) => s.agentSessionSeconds.perTask),
  allRecordedTokensIncludingCacheReads: vsSavedMetric((s) => s.recordedAgentTokens.perTask.total),
  uncachedInputPlusOutputTokens: vsSavedMetric((s) => s.recordedAgentTokens.perTask.uncachedInput + s.recordedAgentTokens.perTask.output),
  modelledApiCostUsd: vsSavedMetric((s) => s.modelledApiCostUsd.perTaskUnrounded),
  note: "null = never: RightClick's acquisition and per-reuse figures are both higher than the saved script's, so no number of reuses recovers the difference on this happy path.",
};

const reason: string = proof.breakEvenAnalysis.vsSavedScriptCompetitor.reason;
const statedCost = (label: RegExp) => Number(reason.match(label)?.[1]);
const corrections = [
  {
    id: "C1",
    field: "breakEvenAnalysis.vsSavedScriptCompetitor.reason (RightClick per-reuse modelled cost)",
    original: statedCost(/RightClick [\d.]+s \/ [\d,]+ tokens \/ \$([\d.]+) per task/),
    corrected: AR.modelledApiCostUsd.perTask,
    explanation: "Recorded telemetry gives 29,394 uncached + 74,176 cache-read + 3,079 output tokens over 4 tasks = $0.0907 / 4 = $0.0227 per task at the stated rates. $0.0252 is not reproducible from any recorded RightClick field at those rates; it overstated RightClick's reuse cost by about 11%. The conclusion (no break-even against the saved script) is unchanged.",
  },
  {
    id: "C2",
    field: "subagentTelemetry.ArmA_RightClick_Acquisition.estimatedCostUsdPerTask",
    original: sessions.ArmA_RightClick_Acquisition.estimatedCostUsdPerTask,
    corrected: A.modelledApiCostUsd.perTask,
    explanation: "Unrounded: $0.322337 / 2 = $0.161169 → $0.1612. The recorded $0.1611 equals the already-rounded total ($0.3223) divided by 2 and rounded again. The reason text's $0.1612 was correct.",
  },
  {
    id: "C3",
    field: "subagentTelemetry.ArmB_SavedScript_Reuse_4Tasks.estimatedCostUsdPerTask",
    original: sessions.ArmB_SavedScript_Reuse_4Tasks.estimatedCostUsdPerTask,
    corrected: BR.modelledApiCostUsd.perTask,
    explanation: "Unrounded: $0.047425 / 4 = $0.011856 → $0.0119. The recorded $0.0118 equals the already-rounded total ($0.0474) divided by 4 and rounded half-to-even. The reason text's $0.0119 was correct.",
  },
  {
    id: "C4",
    field: "breakEvenAnalysis.vsDirectShellWithoutSavedScript.totalTokensReuses",
    original: proof.breakEvenAnalysis.vsDirectShellWithoutSavedScript.totalTokensReuses,
    corrected: { allRecordedTokensIncludingCacheReads: vsDirect.allRecordedTokensIncludingCacheReads, uncachedInputPlusOutputTokens: vsDirect.uncachedInputPlusOutputTokens },
    explanation: "The original adds cache-read tokens (priced at a quarter of uncached input) to uncached and output tokens as if they were one unit. Both views are now reported; cache reads are 61-86% of every session's tokens.",
  },
  {
    id: "C5",
    field: "label: estimatedCostUsd",
    original: "estimatedCostUsd (unqualified)",
    corrected: "modelledApiCostUsd; actualBilledUsd = null",
    explanation: "Every dollar figure is recorded tokens × an unnamed 'frontier LLM API' rate. No invoice, model identifier or cache-write count was recorded, so no actual charge is known.",
  },
];

const provenance = {
  scriptGenerated: ["armA_rightclick", "armB_savedScript", "armC_manualWrapper", "adversarialControls (except kernelNetworkAndFilesystemSandbox)", "generatedAt", "tasksCount"],
  scriptLiteralNotMeasured: ["adversarialControls.kernelNetworkAndFilesystemSandbox (true/false/false are literals in competitive-proof.ts)", "armC_manualWrapper.developerAuthoredLinesOfCode (literal 28)"],
  addedAfterTheScriptRan: ["subagentTelemetry", "breakEvenAnalysis"],
  evidence: `generatedAt ${proof.generatedAt} precedes the reuse sessions (${sessions.ArmA_RightClick_Reuse_4Tasks.startedAt} to ${sessions.ArmA_RightClick_Reuse_4Tasks.completedAt}) and competitive-proof.ts emits neither block.`,
  verifiableFromRepository: "Token counts and timestamps are transcriptions: the conversation transcripts named by conversationId are not in the repository, so they cannot be re-derived here. Only their internal consistency is checked.",
};

const runtimeOnlyLatencyMs = {
  note: "In-process time of one reuse call, measured by competitive-proof.ts. Excludes agent reasoning, tool round trips and acquisition. Not comparable with agent-session seconds.",
  rightclick: { acquisition: proof.armA_rightclick.acquisitionMs, meanReuse: proof.armA_rightclick.meanReuseMs },
  savedScript: { acquisition: proof.armB_savedScript.acquisitionMs, meanReuse: proof.armB_savedScript.meanReuseMs },
  manualWrapper: { acquisition: null, meanReuse: proof.armC_manualWrapper.meanReuseMs },
  rightclickReuseOverSavedScript: r1(proof.armA_rightclick.meanReuseMs / proof.armB_savedScript.meanReuseMs),
};

const limits = [
  "One session per arm and phase; no repetitions, so no variance or confidence interval exists for any figure.",
  "Per-task figures average heterogeneous tasks (2 acquisitions, 4 reuses, 1 baseline task) and the baseline task's kind is not recorded.",
  "The saved-script (B) and manual-wrapper (C) arms were deliberately built without hash pinning, sandboxing or output verification. Their failure on the drift controls shows what those safeguards catch, not that RightClick outperforms a competitor who implements them.",
  "Human engineering effort, setup and future maintenance were not measured for any arm.",
];

const out = {
  audits: SOURCE,
  auditsSha256: createHash("sha256").update(bytes).digest("hex"),
  pricingAssumption: { ...proof.breakEvenAnalysis.pricingReference && { statedAs: proof.breakEvenAnalysis.pricingReference }, usdPerToken: RATE, cacheWritePremiumModelled: false, modelRecorded: false },
  provenance,
  perSession,
  runtimeOnlyLatencyMs,
  breakEven: {
    convention: {
      vsDirectShell: "smallest n with acquisition + n·reuse ≤ (n + 1)·directShell: the direct shell saves nothing, so every use is a from-scratch session",
      vsSavedScript: "smallest n with acquisition + n·reuse ≤ savedAcquisition + n·savedReuse",
      units: "per-task figures from one session per arm and phase",
    },
    vsDirectShell: vsDirect,
    vsSavedScript: vsSaved,
  },
  corrections,
  limits,
};
console.log(JSON.stringify(out, null, 2));
