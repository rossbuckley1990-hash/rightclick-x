// Reclassify infrastructure interruptions without mutating original scoring or raw evidence.
// node experiments/north-star/correct-quota.ts <raw.json> <new-corrected.json>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { quotaBlock } from "./quota.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output)) throw new Error("provide distinct input and new output files");
const raw = readFileSync(input);
const original = JSON.parse(raw.toString());
const corrections: object[] = [];
const sessions = original.sessions.map((s: any) => {
  const reason = quotaBlock(String(s.reply ?? ""));
  if (!reason || s.blocked) return s;
  corrections.push({ key: s.key, reason, tokens: s.tokens, toolCalls: s.toolCalls, executed: s.executed,
    classification: s.tokens === 0 && s.toolCalls === 0 && s.executed === false ? "blocked-before-execution" : "interrupted-session" });
  return { ...s, blocked: reason };
});
const counts = Object.fromEntries(["A", "B", "C", "D"].map((arm) => {
  const all = sessions.filter((s: any) => s.arm === arm);
  const feasible = all.filter((s: any) => !s.blocked && ["first", "reuse"].includes(s.phase));
  return [arm, { recorded: all.length, blocked: all.filter((s: any) => s.blocked).length,
    feasibleObserved: feasible.length, correct: feasible.filter((s: any) => s.correct).length,
    wrongPresentedAsCorrect: all.filter((s: any) => !s.blocked && s.wrong).length }];
}));
const correction = { originalSha256: createHash("sha256").update(raw).digest("hex"), originalSource: input,
  rule: "Explicit provider quota response is BLOCKED; all original task scores remain unchanged. Blocked sessions are excluded from observed rates and remain missing acceptance evidence.",
  correctedSessions: corrections, counts, verdict: "PARTIAL: incomplete and unequal samples; no competitive or generalisation gate can be claimed" };
writeFileSync(output, JSON.stringify({ ...original, sessions, correction }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(correction, null, 2));
