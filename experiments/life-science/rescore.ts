// Re-score Phase B sessions affected by HARNESS defects, keeping the strict
// (as-run) verdicts untouched next to the re-scored ones, with reasons.
//
//  1. A truth query failed at scoring time (e.g. a transient HTTP 404 from OLS):
//     truth is recomputed now, directly against the databases.
//  2. Grounding tested a composite number string ("646-668"). The pre-registered
//     rule excludes pure numbers from grounding; a range of two numbers is
//     numbers. Re-scored with ranges excluded, and each of its numbers required
//     to appear as a JSON value in a fetched body (stricter than skipping).
//
//   node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/rescore.ts phase-b-lifesci-freeze-3

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { bodies, HERE, WORK } from "./harness.ts";
import { QUESTIONS } from "./questions.ts";

const label = process.argv[2] ?? "phase-b-lifesci-freeze-3";
const dir = `${HERE}/evidence/${label}`;
const tag = label.replace(/^.*?(lifesci-freeze-\d+)$/, "$1");
const run = label.replace(`-${tag}`, "");
const out: any[] = [];
for (const f of readdirSync(dir).filter((x) => /^(claude|codex)-Q\d+\.json$/.test(x)).sort()) {
  const s = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const q = QUESTIONS.find((x) => x.id === s.question)!;
  const reasons: string[] = [];
  let truth = s.truth ? { parts: s.truth, facts: s.truthFacts } : null;
  if (!truth) {
    truth = await q.truth();
    reasons.push(`truth recomputed (as-run truth query failed: ${s.truthError})`);
  }
  const perPart = q.score(s.parts, truth as any);
  const correct = perPart.every(Boolean);
  let grounded = s.grounded;
  let checks = s.groundingChecks;
  if (s.groundingChecks?.some((c: any) => !c.found && /^\d+(\.\d+)?-\d+(\.\d+)?$/.test(c.value)) || reasons.length) {
    const fetched = bodies(`${WORK}/${tag}/${run}/${s.client}-${s.question}/bodies`);
    const vals: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === "string" && v) vals.push(v);
      else if (Array.isArray(v)) v.forEach(add);
      else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (add(k), add(x)));
    };
    truth!.parts.forEach(add);
    checks = [...new Set(vals)].flatMap((v) => {
      if (/^\d+(\.\d+)?$/.test(v)) return [];
      const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(v);
      if (range) return range.slice(1).map((n) => ({ value: n, found: new RegExp(`[:\\[,]\\s*"?${n}"?\\s*[,}\\]]`).test(fetched) }));
      return [{ value: v, found: fetched.toLowerCase().includes(v.toLowerCase()) || fetched.toLowerCase().replace(/\s+/g, "").includes(v.toLowerCase().replace(/\s+/g, "")) }];
    });
    if (s.question === "Q13") checks = s.groundingChecks;
    const g = checks.every((c: any) => c.found);
    if (g !== s.grounded) reasons.push("grounding re-checked: number ranges treated as numbers, each number required as a JSON value in a fetched body");
    grounded = g;
  }
  out.push({ client: s.client, question: s.question, answer: s.answer, strict: { correct: s.correct, grounded: s.grounded, correctAndGrounded: s.correctAndGrounded }, rescored: { correct, grounded, correctAndGrounded: correct && grounded, perPart, checks }, changed: correct !== s.correct || grounded !== s.grounded, reasons });
}
const summary = ["claude", "codex"].map((c) => {
  const s = out.filter((x) => x.client === c);
  const n = (k: "strict" | "rescored") => s.filter((x) => x[k].correctAndGrounded).length;
  const v = (k: number) => (k >= 11 ? "PASS" : k >= 7 ? "PARTIAL" : "FAIL");
  return { client: c, strict: n("strict"), strictVerdict: v(n("strict")), rescored: n("rescored"), rescoredVerdict: v(n("rescored")) };
});
writeFileSync(`${dir}/rescored.json`, JSON.stringify({ at: new Date().toISOString(), note: "strict = as run (primary, pre-registered); rescored = after correcting harness defects listed per session", summary, sessions: out }, null, 2));
for (const x of out.filter((x) => x.changed)) console.log(`${x.client} ${x.question}: strict ${JSON.stringify(x.strict)} → rescored correct=${x.rescored.correct} grounded=${x.rescored.grounded} · ${x.reasons.join("; ")}`);
console.log(JSON.stringify(summary, null, 1));
