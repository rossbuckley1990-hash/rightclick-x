// Replacement evaluation boundary. Historical runner/scorer and reports remain unchanged.
// The arm receives only public inputs. The observer runs AFTER the arm and owns the oracle.
// A shared host is not a sealed evaluation boundary: independent evaluation requires
// evaluator-controlled hosts/credentials and cases never visible to the engineer.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export type Verdict = "functional_recovery" | "correct_refusal" | "false_success" | "unresolved" | "harness_failure";
export interface Claim { status: "completed" | "refused" | "unresolved" | "ambiguous"; output?: unknown }
export interface Observation {
  outcome: "correct" | "incorrect" | "unknown";
  refusalRequired: boolean;
  effect: "confirmed" | "absent" | "uncertain";
  duplicates: number | null;
  evidenceHash: string;
}
export function score(claim: Claim | undefined, observation: Observation | undefined, harnessError = false): Verdict {
  if (harnessError || !claim || !observation || !/^[a-f0-9]{64}$/.test(observation.evidenceHash) ||
    !["correct", "incorrect", "unknown"].includes(observation.outcome) || !["confirmed", "absent", "uncertain"].includes(observation.effect) ||
    typeof observation.refusalRequired !== "boolean" || (observation.duplicates !== null && (!Number.isSafeInteger(observation.duplicates) || observation.duplicates < 0))) return "harness_failure";
  if (!["completed", "refused", "unresolved", "ambiguous"].includes(claim.status)) return "unresolved";
  if (claim.status === "completed") {
    if (observation.outcome === "incorrect" || observation.refusalRequired || (observation.duplicates ?? 0) > 0) return "false_success";
    return observation.outcome === "correct" && observation.effect === "confirmed" && observation.duplicates === 0 ? "functional_recovery" : "unresolved";
  }
  if (claim.status === "refused" && observation.refusalRequired && observation.effect === "absent" && observation.duplicates === 0) return "correct_refusal";
  return "unresolved";
}
export interface Usage { input: number; cached: number; output: number }
export function aggregateUsage(turns: Usage[] | null): Usage | null {
  if (turns === null || !turns.length) return null;
  const sum = { input: 0, cached: 0, output: 0 };
  for (const t of turns) {
    if (![t.input, t.cached, t.output].every(n => Number.isSafeInteger(n) && n >= 0) || t.cached > t.input) return null;
    sum.input += t.input; sum.cached += t.cached; sum.output += t.output;
  }
  return Object.values(sum).every(Number.isSafeInteger) ? sum : null;
}
interface Command { argv: string[]; timeoutMs: number }
interface Manifest {
  classification: "development" | "independently-sealed";
  sourceCommit: string;
  evaluator: string;
  arms: Record<"A" | "B" | "C" | "D" | "E", Command>;
  cases: Array<{ id: string; publicInput: unknown; reset: Command; observe: Command }>;
}
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
async function execute(command: Command, input: unknown) {
  if (!command.argv?.length || !Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 300_000) throw new Error("invalid evaluator command budget");
  const started = performance.now(), request = JSON.stringify(input);
  // Commands are evaluator/operator code, never model proposals. No ambient credentials.
  const p = spawn(command.argv[0], command.argv.slice(1), { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
  p.stdin.on("error", () => {}); p.stdin.end(request);
  let output = "", errorBytes = 0, expired = false, oversized = false;
  const timer = setTimeout(() => { expired = true; p.kill("SIGKILL"); }, command.timeoutMs);
  p.stdout.on("data", b => { output += b; if (Buffer.byteLength(output) > 1_000_000) { oversized = true; output = ""; p.kill("SIGKILL"); } });
  p.stderr.on("data", b => { errorBytes += b.length; });
  const code = await new Promise<number | null>((resolve, reject) => { p.on("close", resolve); p.on("error", reject); }).finally(() => clearTimeout(timer));
  let value: any; try { value = JSON.parse(output); } catch { /* never guess a number from prose */ }
  return { value, evidence: { code, expired, oversized, elapsedMs: performance.now() - started, requestBytes: Buffer.byteLength(request), outputBytes: Buffer.byteLength(output), errorBytes,
    inputHash: hash(request), outputHash: hash(output) }, failed: code !== 0 || expired || oversized || value === undefined };
}
export async function evaluate(manifest: Manifest) {
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !manifest.evaluator || Object.keys(manifest.arms).sort().join("") !== "ABCDE") throw new Error("frozen source, evaluator and all five arms required");
  if (manifest.classification !== "development") throw new Error("independently sealed execution requires evaluator-controlled infrastructure; this local runner cannot attest sealing");
  const rows = [];
  for (const c of manifest.cases) for (const [arm, command] of Object.entries(manifest.arms)) {
    const reset = await execute(c.reset, { case: c.id });
    if (reset.failed || reset.value.ready !== true) { rows.push({ case: c.id, arm, status: "harness_failure", reset: reset.evidence }); continue; }
    const started = performance.now();
    // No oracle/expected output or other arms' output enters the arm process.
    const attempt = await execute(command, c.publicInput);
    const observed = await execute(c.observe, { case: c.id, claim: attempt.value?.claim });
    const status = score(attempt.value?.claim, observed.value, attempt.failed || observed.failed);
    const meter = attempt.value?.metrics;
    rows.push({ case: c.id, arm, status, elapsedMs: performance.now() - started, armExecution: attempt.evidence, observation: observed.evidence,
      usage: aggregateUsage(meter?.usage ?? null), modelCostUsd: null,
      // Agent-supplied telemetry is reported as such, never independently measured.
      reportedMetrics: meter ?? null, metricProvenance: meter ? "adapter-reported; requires transport audit" : "not-established",
      observerEvidence: observed.value ?? null });
  }
  return { schema: "rightclick-x/evaluation@2", classification: "development", sourceCommit: manifest.sourceCommit, evaluator: manifest.evaluator,
    manifestHash: hash(JSON.stringify(manifest)), rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
  const result = await evaluate(manifest);
  await writeFile(process.argv[3], JSON.stringify(result, null, 2), { flag: "wx" }); // never overwrite failed evidence
}
