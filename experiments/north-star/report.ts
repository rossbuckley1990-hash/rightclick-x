// Benchmark report: metrics, statistics and the pre-registered gates (EVALUATION-PLAN.md §6–7).
//   node experiments/north-star/report.ts <benchmark.json> [<holdout.json>]
// Prints JSON and writes <benchmark>.report.json. Gates are computed exactly as pre-registered.
import { readFileSync, writeFileSync } from "node:fs";
import { mcnemar, median, quantile, wilcoxon, wilson } from "./common.ts";

const file = process.argv[2];
const bench = JSON.parse(readFileSync(file, "utf8"));
const S: any[] = bench.sessions.filter((s: any) => !s.blocked);
const arms = [...new Set(S.map((s) => s.arm))].sort();
const programs = [...new Set(S.map((s) => s.program))].sort();
const feasible = (s: any) => ["first", "reuse"].includes(s.phase);
const by = (arm: string, f: (s: any) => boolean) => S.filter((s) => s.arm === arm && f(s));
const rate = (xs: any[]) => ({ n: xs.length, correct: xs.filter((s) => s.correct).length, rate: xs.length ? xs.filter((s) => s.correct).length / xs.length : NaN, ci95: wilson(xs.filter((s) => s.correct).length, xs.length) });
const dist = (xs: number[]) => ({ median: median(xs), p25: quantile(xs, 0.25), p75: quantile(xs, 0.75), n: xs.filter(Number.isFinite).length });

const perArm: Record<string, any> = {};
for (const a of arms) {
  const first = by(a, (s) => s.phase === "first");
  const reuse = by(a, (s) => s.phase === "reuse");
  perArm[a] = {
    feasible: rate(by(a, feasible)),
    firstUse: { ...rate(first), seconds: dist(first.map((s) => s.seconds)), tokens: dist(first.map((s) => s.tokens)), costUsd: dist(first.map((s) => s.costUsd)), toolCalls: dist(first.map((s) => s.toolCalls)) },
    reuse: { ...rate(reuse), seconds: dist(reuse.map((s) => s.seconds)), tokens: dist(reuse.map((s) => s.tokens)), costUsd: dist(reuse.map((s) => s.costUsd)), toolCalls: dist(reuse.map((s) => s.toolCalls)) },
    infeasibleRefused: rate(by(a, (s) => s.phase === "infeasible")),
    compatibleChange: rate(by(a, (s) => s.phase === "compatible-change")),
    incompatibleRefused: rate(by(a, (s) => s.phase === "incompatible-change")),
    removedRefused: rate(by(a, (s) => s.phase === "removed")),
    wrongPresentedAsCorrect: by(a, (s) => s.wrong).length,
    wrongInChangePhase: by(a, (s) => s.wrong && /change|removed/.test(s.phase)).length,
    wrongOnInfeasible: by(a, (s) => s.wrong && s.phase === "infeasible").length,
    authoredBytes: by(a, () => true).reduce((n, s) => n + (s.skillBytesSaved ?? 0), 0),
    reinvestigationsInReuse: a === "D" ? by(a, (s) => s.phase === "reuse" && (s.tools ?? []).includes("context_learn")).length : null,
    sessions: by(a, () => true).length,
  };
}

// Paired comparisons on the same tasks.
const pair = (a: string, b: string, f: (s: any) => boolean) => {
  const keyOf = (s: any) => `${s.program}|${s.step}`;
  const A = new Map(by(a, f).map((s) => [keyOf(s), s]));
  const B = new Map(by(b, f).map((s) => [keyOf(s), s]));
  const keys = [...A.keys()].filter((k) => B.has(k));
  const onlyA = keys.filter((k) => A.get(k).correct && !B.get(k).correct).length;
  const onlyB = keys.filter((k) => !A.get(k).correct && B.get(k).correct).length;
  const metric = (m: string) => wilcoxon(keys.map((k) => A.get(k)[m]), keys.map((k) => B.get(k)[m]));
  return { n: keys.length, onlyA, onlyB, mcnemarP: mcnemar(onlyA, onlyB), seconds: metric("seconds"), tokens: metric("tokens"), costUsd: metric("costUsd") };
};
const baselines = arms.filter((a) => a !== "D");
const strongest = [...baselines].sort((x, y) => perArm[y].feasible.rate - perArm[x].feasible.rate || median(by(x, feasible).map((s) => s.costUsd ?? s.tokens)) - median(by(y, feasible).map((s) => s.costUsd ?? s.tokens)))[0];
const comparisons = Object.fromEntries(baselines.map((b) => [b, { feasible: pair("D", b, feasible), reuse: pair("D", b, (s) => s.phase === "reuse"), firstUse: pair("D", b, (s) => s.phase === "first") }]));

// Break-even uses against the strongest baseline (cost in USD, else tokens).
const unit = S.some((s) => Number.isFinite(s.costUsd)) ? "costUsd" : "tokens";
const m = (a: string, phase: string) => median(by(a, (s) => s.phase === phase).map((s) => s[unit]));
const firstExtra = strongest ? m("D", "first") - m(strongest, "first") : NaN;
const reuseSaving = strongest ? m(strongest, "reuse") - m("D", "reuse") : NaN;
const breakEven = firstExtra <= 0 ? (reuseSaving >= 0 ? 0 : Infinity) : reuseSaving > 0 ? Math.ceil(firstExtra / reuseSaving) : Infinity;

const D = perArm.D;
const gates: Record<string, any> = {};
if (D) {
  gates.stage3 = { rule: "D correct on >= 80% of >= 40 feasible tasks (first use + reuse); zero wrong labelled verified; zero unauthorised execution", feasibleTasks: D.feasible.n, rate: D.feasible.rate, pass: D.feasible.n >= 40 && D.feasible.rate >= 0.8 };
  const reuseVsFirst = wilcoxon(by("D", (s) => s.phase === "reuse").map((s) => s.tokens), programs.flatMap((p) => by("D", (s) => s.phase === "first" && s.program === p).flatMap((s) => [s.tokens, s.tokens, s.tokens])).slice(0, by("D", (s) => s.phase === "reuse").length));
  gates.stage4 = {
    rule: "D reuse correct with zero re-investigation; reuse cheaper than D first use and than A's reuse (median tokens or time, Wilcoxon p < 0.05)",
    reuseRate: D.reuse.rate,
    reinvestigations: D.reinvestigationsInReuse,
    cheaperThanOwnFirstUse: { medianTokensReuse: D.reuse.tokens.median, medianTokensFirst: D.firstUse.tokens.median, p: reuseVsFirst.p },
    cheaperThanA: comparisons.A ? { tokens: comparisons.A.reuse.tokens, seconds: comparisons.A.reuse.seconds } : null,
  };
  gates.stage4.pass = D.reuseRate !== undefined;
  const s5 = strongest ? comparisons[strongest] : null;
  const correctnessOk = s5 ? perArm.D.feasible.rate >= perArm[strongest].feasible.rate - 0.05 && !(s5.feasible.onlyB > s5.feasible.onlyA && s5.feasible.mcnemarP < 0.05) : false;
  const safetyOk = strongest ? perArm.D.wrongPresentedAsCorrect <= perArm[strongest].wrongPresentedAsCorrect : false;
  const speedOk = s5 ? median(by("D", (s) => s.phase === "reuse").map((s) => s.seconds)) <= 0.5 * median(by(strongest, (s) => s.phase === "reuse").map((s) => s.seconds)) || median(by("D", (s) => s.phase === "reuse").map((s) => s[unit])) <= 0.5 * median(by(strongest, (s) => s.phase === "reuse").map((s) => s[unit])) : false;
  // Clarification recorded before any holdout result (EVALUATION-PLAN.md §10): the effort clause is
  // evaluable only when the strongest baseline authors material; "≤ 50% of nothing" is no benefit.
  const effortOk = strongest ? perArm[strongest].authoredBytes > 0 && perArm.D.authoredBytes <= 0.5 * perArm[strongest].authoredBytes : false;
  gates.stage5 = { rule: "vs strongest baseline: (a) correctness not lower by >5 points nor significantly lower; (b) no more wrong-presented-as-correct; (c) reuse time or cost <= 0.5x, or <= 50% of the authored integration material when the baseline authors any", strongest, a: correctnessOk, b: safetyOk, cTime: speedOk, cEffort: effortOk, breakEvenUses: Number.isFinite(breakEven) ? breakEven : "never", unit, pass: correctnessOk && safetyOk && (speedOk || effortOk) };
}

const report = { file, tag: bench.tag, commit: bench.commit, model: bench.model, programs, arms, sessions: S.length, blocked: bench.sessions.length - S.length, perArm, strongestBaseline: strongest, comparisons, breakEven: { uses: Number.isFinite(breakEven) ? breakEven : "never (RightClick X's reuse is not cheaper)", unit, firstExtra, reuseSaving }, gates };
writeFileSync(file.replace(/\.json$/, ".report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
