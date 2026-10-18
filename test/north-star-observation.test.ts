import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSandbox, assessObservation } from "../experiments/north-star/observation.ts";
import type { Sandbox, SandboxRun } from "../src/core/sandbox.ts";
import type { Task } from "../experiments/north-star/common.ts";

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "rcx-measure-")));
const target = "/bin/cat", session = "unit-test";
const task: Task = { id: "echo", program: "cat", kind: "feasible", request: "echo input", input: { stdin: "unique input\n" }, expected: "unique input\n", valid: true };
const result: SandboxRun = { code: 0, stdout: task.expected!, stderr: "", timedOut: false, truncated: false, durationMs: 1, created: [], workDir: "/tmp/example" };
async function fixture(opts: { program?: string; input?: string; purpose?: "execution" | "investigation" | "revalidation"; result?: Partial<SandboxRun>; error?: boolean; mode?: "candidate" | "baseline" } = {}) {
  const path = join(dir(), "events.jsonl");
  const base: Sandbox = { kind: "macos-sandbox-exec", enforces: [], run: async () => { if (opts.error) throw new Error("launch failed"); return { ...result, ...opts.result }; } };
  const recorder = recordSandbox(path, session, target, base, opts.mode ?? "candidate");
  await recorder.sandbox!.run(opts.program ?? target, [], { stdin: opts.input ?? task.input.stdin, purpose: opts.purpose ?? "execution" }).catch(() => {});
  recorder.close();
  return path;
}
const assess = (path: string) => assessObservation(path, session, target, task);
function mutate(path: string, change: (rows: any[]) => any[]) {
  const rows = JSON.parse(`[${readFileSync(path, "utf8").trim().split("\n").join(",")}]`);
  writeFileSync(path, change(rows).map(x => JSON.stringify(x)).join("\n") + "\n");
}

test("measurement requires completed target invocation, exact supplied input and oracle output", async () => {
  const good = assess(await fixture());
  assert.equal(good.taskExecutionObserved, true);
  assert.equal(good.investigationsStarted, 0);
  assert.equal(good.invocations!.execution, 1);
  for (const opts of [{ program: "/bin/echo" }, { input: "different\n" }, { result: { stdout: "wrong output" } }, { purpose: "investigation" as const }, { purpose: "revalidation" as const }]) assert.equal(assess(await fixture(opts)).taskExecutionObserved, false);
});

test("launch failure, timeout, output limit and unstable identity cannot establish usable execution", async () => {
  for (const opts of [{ error: true }, ...[null, -1, 126, 127].map(code => ({ result: { code } })), { result: { timedOut: true } }, { result: { truncated: true } }, { result: { limit: "memory" as const } }]) assert.equal(assess(await fixture(opts)).targetExecuted, false);
  const path = await fixture();
  mutate(path, rows => { rows[2].identity.sha256 = "a".repeat(64); return rows; });
  assert.equal(assess(path).targetExecuted, false);
});

test("builtin-only sessions cannot become target execution even when MCP reported success", () => {
  const path = join(dir(), "events.jsonl");
  const recorder = recordSandbox(path, session, target, null, "candidate");
  recorder.close();
  assert.equal(assess(path).taskExecutionObserved, false);
});

test("missing, truncated, mismatched and interrupted observations are unknown, never zero", async () => {
  assert.equal(assess(join(dir(), "missing")).investigationsStarted, null);
  for (const change of [
    (rows: any[]) => rows.slice(0, -1),
    (rows: any[]) => rows.filter(r => r.type !== "finished").map((r, i) => ({ ...r, sequence: i })),
    (rows: any[]) => { rows[0].sessionId = "another-attempt"; return rows; },
    (rows: any[]) => { rows[1].target = "/bin/echo"; return rows; },
    (rows: any[]) => { rows[2].result.stdout = null; return rows; },
    (rows: any[]) => { rows[2].id = 99; return rows; },
    (rows: any[]) => { rows[1].purpose = "toString"; return rows; },
    (rows: any[]) => [...rows.slice(0, -1), { ...rows[1] }, rows.at(-1)].map((r, i) => ({ ...r, sequence: i })),
  ]) {
    const path = await fixture(); mutate(path, change);
    const observed = assess(path);
    assert.equal(observed.complete, false, JSON.stringify(change));
    assert.equal(observed.investigationsStarted, null);
    assert.equal(observed.targetExecuted, null);
  }
});

test("baseline investigation count stays unknown; unrelated lifecycle events are rejected", async () => {
  const path = await fixture({ mode: "baseline" });
  assert.equal(assess(path).investigationsStarted, null);
  mutate(path, rows => [...rows.slice(0, -1), { ...rows[0], type: "investigation", program: target }, rows.at(-1)].map((r, i) => ({ ...r, sequence: i })));
  assert.equal(assess(path).complete, false);
});

test("input multiplicity and missing oracle eligibility cannot be bypassed", async () => {
  const path = await fixture();
  assert.equal(assessObservation(path, session, target, { ...task, input: { stdin: task.input.stdin, files: { duplicate: task.input.stdin! } } }).taskExecutionObserved, false);
  assert.equal(assessObservation(path, session, target, { ...task, valid: undefined }).taskExecutionObserved, false);
  assert.equal(assessObservation(path, session, target, { ...task, expected: undefined }).taskExecutionObserved, false);
});

test("observation attempts are exclusive and closed recorders reject later events", () => {
  const path = join(dir(), "events.jsonl"), recorder = recordSandbox(path, session, target, null, "candidate");
  assert.throws(() => recordSandbox(path, session, target, null, "candidate"), /EEXIST/);
  recorder.close(); recorder.close();
  assert.throws(() => recorder.onInvestigationStart(target), /closed/);
});

test("model telemetry preserves missing usage and does not inherit paid-provider environment", async () => {
  const { measuredTokens, subscriptionEnvironment } = await import("../experiments/north-star/common.ts");
  assert.equal(measuredTokens(undefined), undefined);
  assert.equal(measuredTokens({}), undefined);
  assert.equal(measuredTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: -1 }), undefined);
  assert.equal(measuredTokens({ input_tokens: 1, output_tokens: 2 }), 3);
  assert.equal(measuredTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }), 15);
  assert.deepEqual(subscriptionEnvironment({ HOME: "/example", PATH: "/bin", ANTHROPIC_API_KEY: "secret", ANTHROPIC_BASE_URL: "https://untrusted.invalid", CLAUDE_CODE_USE_BEDROCK: "1", AWS_SECRET_ACCESS_KEY: "secret", RCX_AUTH: "secret" }), { PATH: "/bin", HOME: "/example" });
});
