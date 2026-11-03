import test from "node:test";
import assert from "node:assert/strict";
import { score, aggregateUsage, type Observation } from "../experiments/aspirin/evaluate.ts";
const truth: Observation = { outcome: "correct", refusalRequired: false, effect: "confirmed", duplicates: 0, evidenceHash: "a".repeat(64) };
test("business observation, not hardcoded bad numbers, determines false success", () => {
  for (const output of [25, 108.25, 13.2, 95.37, 62.14, 68, 123456, "fabricated", {}])
    assert.equal(score({ status: "completed", output }, { ...truth, outcome: "incorrect" }), "false_success");
  assert.equal(score({ status: "completed", output: 20 }, truth), "functional_recovery");
  assert.equal(score({ status: "completed" }, { ...truth, duplicates: 1 }), "false_success");
});
test("unknown effects, absent telemetry, failures and refusal prose do not invent success", () => {
  assert.equal(score({ status: "completed" }, { ...truth, outcome: "unknown", effect: "uncertain" }), "unresolved");
  assert.equal(score({ status: "refused" }, { ...truth, refusalRequired: true, effect: "absent" }), "correct_refusal");
  assert.equal(score({ status: "refused" }, { ...truth, refusalRequired: true, effect: "uncertain" }), "unresolved");
  assert.equal(score(undefined, { ...truth, refusalRequired: true }, true), "harness_failure");
  assert.equal(score({ status: "unresolved", output: "Cannot access service" }, { ...truth, refusalRequired: true, effect: "absent" }), "unresolved");
});
test("all model turns and cached input count; missing or inconsistent usage remains unknown", () => {
  assert.deepEqual(aggregateUsage([{ input: 10, cached: 2, output: 3 }, { input: 100, cached: 80, output: 7 }]), { input: 110, cached: 82, output: 10 });
  assert.equal(aggregateUsage(null), null);
  assert.equal(aggregateUsage([]), null);
  assert.equal(aggregateUsage([{ input: 10, cached: 11, output: 3 }]), null);
});

test("runner executes all five arms with identical public input and keeps process failure separate", async () => {
  const { evaluate } = await import("../experiments/aspirin/evaluate.ts");
  const command = (source: string) => ({ argv: [process.execPath, "-e", source], timeoutMs: 5000 });
  const arm = command('let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{if(s!==JSON.stringify({task:"public"}))process.exit(3);console.log(JSON.stringify({claim:{status:"completed",output:20}}))})');
  const report = await evaluate({ classification: "development", sourceCommit: "a".repeat(40), evaluator: "development-runner-regression",
    arms: { A: arm, B: arm, C: command("process.exit(7)"), D: arm, E: arm },
    cases: [{ id: "runner-control", publicInput: { task: "public" }, reset: command('console.log(JSON.stringify({ready:true}))'),
      observe: command(`console.log(${JSON.stringify(JSON.stringify(truth))})`) }] });
  assert.deepEqual(report.rows.map(r => r.status), ["functional_recovery", "functional_recovery", "harness_failure", "functional_recovery", "functional_recovery"]);
  assert.equal(report.rows[0].usage, null);
  assert.equal(report.rows[0].modelCostUsd, null);
});
