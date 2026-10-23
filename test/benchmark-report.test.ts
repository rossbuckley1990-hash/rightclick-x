import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { reportBenchmark } from "../experiments/north-star/report-core.ts";

// Synthetic gate tests only. These rows are never reported as product measurements.
function fixture() {
  const holdout: any = { commit: "synthetic", programs: [] };
  const bench: any = { commit: "synthetic", sessions: [] };
  for (let p = 0; p < 10; p++) {
    const name = `program${p}`;
    const tasks = Array.from({ length: 5 }, (_, t) => ({ id: `${name}#${t}`, kind: t === 4 ? "infeasible" : "feasible", valid: true, input: { stdin: `input${t}` } }));
    holdout.programs.push({ name, tasks });
    const phases = ["first", "reuse", "reuse", "reuse", "infeasible", "compatible-change", "incompatible-change", "removed"];
    const steps = ["t1", "t2", "t3", "t4", "infeasible", "compatible", "incompatible", "removed"];
    const ids = [0, 1, 2, 3, 4, 0, 1, 2];
    for (const arm of ["A", "B", "C", "D"]) for (let i = 0; i < 8; i++) {
      const reuse = phases[i] === "reuse";
      bench.sessions.push({ arm, program: name, step: steps[i], phase: phases[i], task: tasks[ids[i]].id, correct: true, wrong: false, tokens: arm === "D" ? reuse ? 10 : 1000 : 500, seconds: arm === "D" ? reuse ? 1 : 100 : 50, skillBytesSaved: 0, investigationsStarted: 0, tools: ["context_learn"] });
    }
  }
  const domain2: any = { commit: "synthetic", tasks: [], sessions: [] };
  for (let i = 0; i < 12; i++) {
    const id = `api${Math.floor(i / 4)}#${i}`;
    domain2.tasks.push({ id, api: `api${Math.floor(i / 4)}`, valid: true });
    for (const arm of ["A", "D"]) domain2.sessions.push({ arm, task: id, correct: true, wrong: false });
  }
  const safety = { commit: "synthetic", benchmarkSha256: "fixture-benchmark", domain2Sha256: "fixture-domain2", coveredSessions: [...bench.sessions.filter((s: any) => s.arm === "D").map((s: any) => `domain1|D|${s.program}|${s.step}`), ...domain2.sessions.filter((s: any) => s.arm === "D").map((s: any) => `domain2|D|${s.task}`)], wrongLabelledVerified: 0, unauthorisedExecutions: 0 };
  return { bench, opts: { holdout, domain2, safety, benchmarkSha256: "fixture-benchmark", domain2Sha256: "fixture-domain2" } };
}

test("report gates can pass only with complete qualifying evidence (synthetic control)", () => {
  const { bench, opts } = fixture();
  const r = reportBenchmark(bench, opts);
  for (const g of Object.values(r.gates)) assert.equal(g.status, "PASS");
  assert.equal(r.ownReuseComparison.programs, 10); // Not 30 pseudo-independent first-use observations.
  assert.equal(r.actualReinvestigations, 0); // context_learn may be an unchanged-provider no-op.
  assert.equal(r.breakEven.uses, 2);
});
test("missing second domain and observer coverage cannot pass generalisation", () => {
  const { bench, opts } = fixture();
  const r = reportBenchmark(bench, { holdout: opts.holdout });
  assert.equal(r.gates.stage3.status, "PARTIAL");
  assert.equal(r.safetyEvidence.unauthorisedExecutions, null);
  assert.equal(r.safetyEvidence.wrongLabelledVerified, null);
});
test("verified wrong output and unauthorised execution each fail independently", () => {
  for (const field of ["wrongLabelledVerified", "unauthorisedExecutions"] as const) {
    const { bench, opts } = fixture();
    opts.safety[field] = 1;
    assert.equal(reportBenchmark(bench, opts).gates.stage3.status, "FAIL");
  }
});
test("observer assertions with mismatched source, bytes or missing coverage remain unknown", () => {
  for (const change of [(s: any) => { s.commit = "other"; }, (s: any) => { s.benchmarkSha256 = "other"; }, (s: any) => { s.coveredSessions.pop(); }]) {
    const { bench, opts } = fixture(); change(opts.safety);
    assert.equal(reportBenchmark(bench, opts).gates.stage3.status, "PARTIAL");
  }
});
test("weekly quota and absent rows remain missing, even when all observed rows succeed", () => {
  const { bench, opts } = fixture();
  bench.sessions.find((s: any) => s.arm === "D" && s.step === "t4").reply = "You've hit your weekly limit";
  const r = reportBenchmark(bench, opts);
  assert.equal(r.blocked, 1);
  assert.equal(r.coverage.D.missing.length, 1);
  for (const g of Object.values(r.gates)) assert.equal(g.pass, false);
});
test("a successful partial first/reuse matrix cannot pass a lifecycle comparison", () => {
  const { bench, opts } = fixture();
  bench.sessions = bench.sessions.filter((s: any) => ["first", "reuse"].includes(s.phase));
  assert.equal(reportBenchmark(bench, opts).gates.stage5.status, "PARTIAL");
});
test("duplicate sessions are rejected rather than last-write-wins", () => {
  const { bench, opts } = fixture(); bench.sessions.push({ ...bench.sessions[0] });
  assert.throws(() => reportBenchmark(bench, opts), /duplicate session/);
});
test("reuse is rejected for wrong answers, repeated inputs, or actual investigation", () => {
  for (const mutate of [
    (f: any) => { f.bench.sessions.find((s: any) => s.arm === "D" && s.phase === "reuse").correct = false; },
    (f: any) => { f.opts.holdout.programs[0].tasks[1].input = f.opts.holdout.programs[0].tasks[0].input; },
    (f: any) => { f.bench.sessions.find((s: any) => s.arm === "D" && s.phase === "reuse").investigationsStarted = 1; },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(reportBenchmark(f.bench, f.opts).gates.stage4.status, "FAIL");
  }
});
test("absence of actual investigation telemetry does not mean zero investigation", () => {
  const { bench, opts } = fixture();
  for (const s of bench.sessions) delete s.investigationsStarted;
  const r = reportBenchmark(bench, opts);
  assert.equal(r.actualReinvestigations, null);
  assert.equal(r.gates.stage4.status, "PARTIAL");
});
test("strongest baseline and paired costs do not depend on session order", () => {
  const { bench, opts } = fixture();
  for (const s of bench.sessions) if (s.arm === "B") s.tokens = 400;
  const a = reportBenchmark(bench, opts);
  bench.sessions.reverse();
  const b = reportBenchmark(bench, opts);
  assert.equal(a.strongestBaseline, "B");
  assert.deepEqual(a.comparisons, b.comparisons);
  assert.deepEqual(a.breakEven, b.breakEven);
});
test("missing costs cannot create a competitive advantage through NaN or zero defaults", () => {
  const { bench, opts } = fixture();
  for (const s of bench.sessions) { delete s.tokens; delete s.seconds; }
  const r = reportBenchmark(bench, opts);
  assert.equal(r.strongestBaseline, null);
  assert.equal(r.breakEven.uses, null);
  assert.equal(r.gates.stage5.pass, false);
});
test("a huge unpaired cost cannot change matched cost metrics", () => {
  const { bench, opts } = fixture();
  bench.sessions = bench.sessions.filter((s: any) => !(s.arm === "D" && s.program === "program0" && s.step === "t2"));
  bench.sessions.find((s: any) => s.arm === "A" && s.program === "program0" && s.step === "t2").tokens = 1e9;
  const r = reportBenchmark(bench, opts);
  assert.equal(r.comparisons.A.reuse.tokens.medianB, 500);
  assert.deepEqual(r.comparisons.A.reuse.unpairedB, ["program0|t2"]);
  assert.equal(r.gates.stage5.pass, false);
});
test("report CLI never overwrites input or existing report bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-report-test-"));
  const input = join(dir, "input.json"), output = join(dir, "output.json");
  const raw = JSON.stringify(fixture().bench);
  writeFileSync(input, raw); writeFileSync(output, "preserved");
  for (const out of [input, output]) {
    const r = spawnSync(process.execPath, [resolve("experiments/north-star/report.ts"), input, "--out", out], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(input, "utf8"), raw);
    assert.equal(readFileSync(output, "utf8"), "preserved");
  }
});

test("measured benchmark gates reject missing execution, altered counts, provenance and unaccounted retries", () => {
  const measured = () => {
    const f = fixture();
    Object.assign(f.bench, { schema: 3, holdoutSha256: "manifest", previousAttempts: [] });
    for (const s of f.bench.sessions) {
      s.keyProvenance = { commit: "synthetic", holdoutSha256: "manifest" };
      s.observation = { complete: true, taskExecutionObserved: true, investigationsStarted: 0 };
    }
    return f;
  };
  const positive = measured();
  assert.equal(reportBenchmark(positive.bench, positive.opts).gates.stage4.status, "PASS");
  for (const change of [
    (b: any) => { b.sessions[0].observation.complete = false; },
    (b: any) => { b.sessions[0].observation.taskExecutionObserved = false; },
    (b: any) => { b.sessions[0].keyProvenance.commit = "different"; },
    (b: any) => { b.sessions.find((s: any) => s.arm === "D").investigationsStarted = 1; },
    (b: any) => { b.previousAttempts.push({ blocked: "quota", tokens: 100 }); },
    (b: any) => { delete b.previousAttempts; },
  ]) {
    const { bench, opts } = measured(); change(bench);
    const r = reportBenchmark(bench, opts);
    assert.ok(r.problems.length > 0);
    assert.notEqual(r.gates.stage4.status, "PASS");
  }
});
