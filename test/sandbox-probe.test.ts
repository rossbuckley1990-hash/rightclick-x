// How the availability probe decides, checked with stand-in candidates so it runs on every host.
// A transient failure (a lost observation, the wall clock, a failed spawn, a signal) is retried a
// bounded number of times. A refusal is not retried. Only a run that passes the unchanged check is
// ever accepted. The same paths through the real sandbox and observer are in sandbox-observer.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFINED_POLICY, PROBE_ATTEMPTS, probeOutcome, probeSandboxes, type Sandbox, type SandboxRun } from "../src/core/sandbox.ts";

const PROBE = { bin: "/bin/echo", args: ["rcx-sandbox-probe"] };
const run = (over: Partial<SandboxRun> = {}): SandboxRun => ({
  code: 0, stdout: "rcx-sandbox-probe\n", stderr: "", timedOut: false, truncated: false, durationMs: 1, created: [], workDir: "/rcx-sandbox", ...over,
});
const lostObservation = () => run({ code: -1, stdout: "", limit: "supervision" });
const refusedByKernel = () => run({ code: 1, stdout: "", stderr: "bwrap: setting up uid map: Permission denied" });

/** A candidate that answers its runs in order, repeating the last answer, and records what it was asked to run. */
function candidate(kind: Sandbox["kind"], answers: (SandboxRun | Error)[]) {
  const calls: { bin: string; args: string[] }[] = [];
  const sandbox: Sandbox = {
    kind, policy: CONFINED_POLICY, enforces: [],
    async run(bin, args) {
      calls.push({ bin, args });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { sandbox, calls };
}

test("only a confined run that printed the marker and exited 0 shows a working sandbox", () => {
  assert.equal(probeOutcome(run()), "ok");
  for (const r of [null, lostObservation(), run({ code: null, stdout: "", timedOut: true, limit: "time" }), run({ code: -1, stdout: "" }), run({ code: null, stdout: "" })]) {
    assert.equal(probeOutcome(r), "transient", JSON.stringify(r));
  }
  for (const r of [refusedByKernel(), run({ stdout: "something else\n" }), run({ stdout: "" }), run({ code: 2 })]) {
    assert.equal(probeOutcome(r), "refused", JSON.stringify(r));
  }
});

test("a transient failure is retried with the same probe, and a later attempt that passes is accepted", async () => {
  const c = candidate("macos-sandbox-exec", [lostObservation(), run()]);
  const r = await probeSandboxes([c.sandbox]);
  assert.equal(r.sandbox, c.sandbox);
  assert.equal(r.transient, false);
  assert.deepEqual(r.attempts.map((a) => [a.attempt, a.outcome, a.limit ?? null]), [[1, "transient", "supervision"], [2, "ok", null]]);
  assert.deepEqual(c.calls, [PROBE, PROBE], "nothing but the probe was run");
});

test("a candidate that only ever fails transiently is given up after PROBE_ATTEMPTS runs, and no sandbox is returned", async () => {
  const c = candidate("linux-bwrap", [lostObservation(), new Error("spawn EAGAIN"), run({ code: null, stdout: "", timedOut: true, limit: "time" })]);
  const r = await probeSandboxes([c.sandbox]);
  assert.equal(r.sandbox, null);
  assert.equal(r.transient, true, "the absence may not last, so it must not be remembered");
  assert.equal(c.calls.length, PROBE_ATTEMPTS);
  assert.ok(c.calls.every((call) => JSON.stringify(call) === JSON.stringify(PROBE)));
  assert.ok(r.attempts.every((a) => a.outcome === "transient"));
  assert.match(String(r.attempts[1]?.error), /EAGAIN/);
});

test("a refusal is not retried, is not transient, and the next candidate is probed", async () => {
  const refused = candidate("linux-bwrap", [refusedByKernel(), run()]);
  const working = candidate("linux-bwrap", [run()]);
  const r = await probeSandboxes([refused.sandbox, working.sandbox]);
  assert.equal(r.sandbox, working.sandbox);
  assert.equal(refused.calls.length, 1, "a refusing sandbox is not asked again");
  assert.deepEqual(r.attempts.map((a) => a.outcome), ["refused", "ok"]);

  const none = await probeSandboxes([candidate("linux-bwrap", [refusedByKernel(), run()]).sandbox]);
  assert.equal(none.sandbox, null);
  assert.equal(none.transient, false, "a refusal is definitive");
});

test("a candidate whose probe prints something else is refused, and is never retried into acceptance", async () => {
  const c = candidate("macos-sandbox-exec", [run({ stdout: "not the marker\n" }), run()]);
  const r = await probeSandboxes([c.sandbox]);
  assert.equal(r.sandbox, null);
  assert.equal(c.calls.length, 1);
});

test("an absence is transient when any candidate ran out of attempts, and definitive only when all refused", async () => {
  const mixed = await probeSandboxes([candidate("linux-bwrap", [lostObservation()]).sandbox, candidate("linux-bwrap", [refusedByKernel()]).sandbox]);
  assert.equal(mixed.sandbox, null);
  assert.equal(mixed.transient, true);
  assert.equal(mixed.attempts.length, PROBE_ATTEMPTS + 1);

  const empty = await probeSandboxes([]);
  assert.deepEqual(empty, { sandbox: null, transient: false, attempts: [] });
});
