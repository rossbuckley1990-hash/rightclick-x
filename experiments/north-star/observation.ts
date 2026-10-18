// Opt-in benchmark measurement, NOT an authority boundary or OS execution attestation.
// The trusted harness owns this file; agent tool calls cannot select its path or write it.
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Sandbox, SandboxRun } from "../../src/core/sandbox.ts";
import { matches, type Task } from "./common.ts";

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function identity(program: string) {
  try { return { real: realpathSync(program), sha256: sha256(readFileSync(program)) }; } catch { return null; }
}
export function recordSandbox(file: string, sessionId: string, target: string, base: Sandbox | null, mode: "candidate" | "baseline") {
  // Exclusive creation prevents accidental append to a different attempt.
  writeFileSync(file, "", { flag: "wx" });
  let sequence = 0, invocation = 0, closed = false;
  const emit = (event: object) => {
    if (closed) throw new Error("observation already closed");
    appendFileSync(file, JSON.stringify({ schema: 1, sessionId, target, sequence: sequence++, ...event }) + "\n");
  };
  emit({ type: "ready", mode, sandbox: base?.kind ?? null });
  const sandbox: Sandbox | null = base ? {
    kind: base.kind, enforces: [...base.enforces],
    async run(program, args, opts = {}) {
      const id = ++invocation;
      emit({ type: "started", id, program, args, stdin: opts.stdin ?? "", files: opts.files ?? {}, purpose: opts.purpose ?? "unclassified", identity: identity(program) });
      try {
        const result = await base.run(program, args, opts);
        emit({ type: "finished", id, result, identity: identity(program) });
        return result;
      } catch (error) {
        emit({ type: "error", id, error: String(error) });
        throw error;
      }
    },
  } : null;
  return {
    sandbox,
    onInvestigationStart: (program: string) => emit({ type: "investigation", program }),
    close: () => { if (!closed) { emit({ type: "closed" }); closed = true; } },
  };
}

export interface Observation {
  complete: boolean;
  problem?: string;
  sha256: string | null;
  investigationsStarted: number | null;
  invocations: Record<string, number> | null;
  targetExecuted: boolean | null;
  taskExecutionObserved: boolean | null;
}
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: unknown) => object(x) && Object.values(x).every(v => typeof v === "string");
const validIdentity = (x: any) => x === null || object(x) && typeof x.real === "string" && /^[a-f0-9]{64}$/.test(x.sha256);
function validResult(r: any): r is SandboxRun {
  return object(r) && (r.code === null || Number.isInteger(r.code)) && typeof r.stdout === "string" && typeof r.stderr === "string" && typeof r.timedOut === "boolean" && typeof r.truncated === "boolean" && Number.isFinite(r.durationMs) && r.durationMs >= 0 && typeof r.workDir === "string" && Array.isArray(r.created) && r.created.every((s: unknown) => typeof s === "string") && (r.limit === undefined || ["time", "cpu", "memory", "processes", "output", "file-size", "supervision"].includes(r.limit));
}
// Input may be transported as stdin, files or a literal argv value, but every requested byte
// must occur in one submitted input. Equal content supplied twice requires two occurrences.
function inputPresent(task: Task, run: any) {
  const available = [run.stdin, ...Object.values(run.files), ...run.args];
  for (const required of [task.input.stdin, ...Object.values(task.input.files ?? {})].filter((s): s is string => s !== undefined && s !== "")) {
    const index = available.indexOf(required);
    if (index < 0) return false;
    available.splice(index, 1);
  }
  return true;
}
export function assessObservation(file: string, sessionId: string, target: string, task: Task): Observation {
  let digest: string | null = null;
  const unknown = (problem: string): Observation => ({ complete: false, problem, sha256: digest, investigationsStarted: null, invocations: null, targetExecuted: null, taskExecutionObserved: null });
  try {
    const raw = readFileSync(file, "utf8");
    digest = sha256(raw);
    if (!raw.endsWith("\n")) return unknown("missing or truncated observation");
    const rows = raw.trimEnd().split("\n").map(line => JSON.parse(line));
    if (rows.length < 2 || rows.some((e, i) => !object(e) || e.schema !== 1 || e.sessionId !== sessionId || e.target !== target || e.sequence !== i)) return unknown("invalid provenance or sequence");
    const ready = rows[0];
    if (ready.type !== "ready" || !["candidate", "baseline"].includes(ready.mode) || ![null, "macos-sandbox-exec", "linux-bwrap"].includes(ready.sandbox) || rows.at(-1).type !== "closed") return unknown("missing lifecycle markers");
    let investigations = 0, targetExecuted = false, taskExecutionObserved = false;
    const pending = new Map<number, any>(), used = new Set<number>();
    const invocations: Record<string, number> = { execution: 0, investigation: 0, revalidation: 0, "agent-run": 0, unclassified: 0 };
    for (const row of rows.slice(1, -1)) {
      if (row.type === "investigation") {
        if (ready.mode !== "candidate" || row.program !== target) return unknown("unexpected investigation");
        investigations++;
      } else if (row.type === "started") {
        if (ready.sandbox === null || !Number.isInteger(row.id) || row.id <= 0 || used.has(row.id) || typeof row.program !== "string" || !Object.hasOwn(invocations, row.purpose) || !Array.isArray(row.args) || !row.args.every((v: unknown) => typeof v === "string") || typeof row.stdin !== "string" || !strings(row.files) || !validIdentity(row.identity)) return unknown("invalid sandbox start");
        pending.set(row.id, row); used.add(row.id); invocations[row.purpose]++;
      } else if (row.type === "finished" || row.type === "error") {
        const start = pending.get(row.id);
        if (!start) return unknown("unmatched sandbox completion");
        pending.delete(row.id);
        if (row.type === "error") {
          if (typeof row.error !== "string") return unknown("invalid sandbox error");
          continue;
        }
        if (!validResult(row.result) || !validIdentity(row.identity)) return unknown("invalid sandbox result");
        const r = row.result;
        const usable = start.program === target && ["execution", "agent-run"].includes(start.purpose) && start.identity && row.identity && start.identity.real === row.identity.real && start.identity.sha256 === row.identity.sha256 && r.code !== null && r.code >= 0 && ![126, 127].includes(r.code) && !r.timedOut && !r.truncated && !r.limit;
        if (!usable) continue;
        targetExecuted = true;
        const out = r.workDir ? r.stdout.split(r.workDir).join("").split(r.workDir.replace(/^\/private/, "")).join("") : r.stdout;
        if (task.kind === "feasible" && task.valid === true && task.expected !== undefined && inputPresent(task, start) && matches(task, out)) taskExecutionObserved = true;
      } else return unknown("unexpected observation event");
    }
    if (pending.size) return unknown("incomplete sandbox invocation");
    // Baseline tool use has no RCX investigation lifecycle; it is not measured as zero.
    return { complete: true, sha256: digest, investigationsStarted: ready.mode === "candidate" ? investigations : null, invocations, targetExecuted, taskExecutionObserved };
  } catch (error) { return unknown(`unreadable observation: ${String(error)}`); }
}
