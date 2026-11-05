import type { CliInvoke } from "./types.ts";

/**
 * How a command-line run ended, separated into the questions a caller has to answer before using
 * its result. Each is recorded on every run, failed or not:
 *
 *   process        did the program run to completion (no timeout, sandbox limit or truncation)?
 *   classification what the exit code means for this operation: "success" (exit 0),
 *                  "semantic-nonzero" (a nonzero code with a demonstrated meaning, such as a
 *                  comparison that found differences) or "reported-error" (anything else)
 *   basis          the evidence for that classification
 *
 * Whether a result is established follows from these (`CliValidity.outcome`). Whether the outcome
 * the caller asked for is independently checked is a separate question, answered by the run's
 * verification status, never by the exit code.
 */
export interface CliExitStatus {
  process: "completed" | "timed-out" | "limit" | "truncated";
  code: number | null;
  classification: "success" | "semantic-nonzero" | "reported-error";
  basis: string;
}

export interface CliValidity {
  coverage: "partial";
  environment: "unchanged" | "changed" | "unrecorded";
  expected?: string;
  observed: string;
  processExit?: number | null;
  application: "not-assessed" | "reported-error" | "not-established";
  conformance?: { status: "matched" | "refused"; contract: string; samples: string; checks: number; sha256: string };
  /** Exit-code evidence for this run (see `CliExitStatus`). */
  exitStatus?: CliExitStatus;
  /**
   * "result-established": the run's result was returned. "not-established": it was not, and
   * `failure` holds the evidence of what the program did instead.
   */
  outcome?: "result-established" | "not-established";
  /**
   * Evidence retained from a run whose result was not established: digests and sizes only. Its
   * stdout and any files it wrote are never stored as artefacts or returned as results, so a
   * partial or failed output cannot be read back as if it were one.
   */
  failure?: {
    reason: string;
    stderrPreview: string;
    stdout: { sha256: string; bytes: number };
    unacceptedOutputs: Array<{ name: string; sha256: string; bytes: number }>;
  };
  /** Empty standard output admitted as a result on the program's own success code, not as a failure. */
  emptyResult?: boolean;
  /** The run's own sandbox directory appeared in the output and was replaced by a fixed placeholder. */
  sandboxPathNormalised?: boolean;
  /** SHA-256 of the raw standard output, before normalisation, so the evidence survives it. */
  rawOutputSha256?: string;
  /** Bounded base64 of raw stdout bytes that were not valid UTF-8, retained instead of being decoded lossily. */
  rawOutputBase64?: string;
  /** Exact standard output length in bytes. */
  stdoutBytes?: number;
  /**
   * Provenance of this run at the capability/result interface: the program and the build that was
   * checked, every input consumed and every output produced, by SHA-256. A result that claims this
   * capability's execution without a matching record here is not one this runtime produced.
   */
  artefacts?: {
    program: { bin: string; sha256: string };
    inputs: Array<{ name: string; role: "file" | "stdin"; sha256: string; bytes: number; ref?: string }>;
    outputs: Array<{ name: string; ref: string; sha256: string; bytes: number }>;
    stdout?: { sha256: string; bytes: number; ref?: string };
  };
  /**
   * The exact invocation (R8), for runs whose argument vector RightClick built from an established
   * contract: each item with its role, and the digest of the contract it came from.
   */
  invocation?: {
    v: 1;
    contract: string;
    argv: Array<{ kind: "flag"; text: string } | { kind: "file"; role: "read" | "write"; name: string; sha256?: string; bytes?: number }>;
    stdin?: { sha256: string; bytes: number };
  };
  /** The independent structural check of a binary output: its format, the facts read from it, and the facts it kept from the input. */
  outputCheck?: { mediaType: string; facts: Record<string, number | string | boolean>; kept: string[]; unchecked?: string[]; validator: string };
  limitation: string;
}

export class CliValidityError extends Error {
  readonly validity?: CliValidity;
  readonly capability?: string;
  readonly runs: string[];
  constructor(message: string, validity?: CliValidity, capability?: string, runs: string[] = []) {
    super(message);
    this.validity = validity;
    this.capability = capability;
    this.runs = runs;
  }
}

export function reportsApplicationError(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.isError === true || v.ok === false || v.success === false) return true;
  const error = v.error;
  if (!(typeof error === "string" && error.trim() || error && typeof error === "object" && Object.keys(error).length)) return false;
  return Object.keys(v).every(k => ["error", "message", "code", "status", "details"].includes(k));
}

/** Nonzero exit codes this operation has a demonstrated meaning for (see `CliInvoke.exitSemantics`). */
export function semanticExitCodes(inv: Pick<CliInvoke, "okExit" | "exitSemantics">): number[] {
  return inv.okExit.filter((c) => c !== 0 && !!inv.exitSemantics?.[String(c)]);
}

/** The exit codes after which a result can be established: 0 (when the contract has it) and semantic codes. */
export function successExitCodes(inv: Pick<CliInvoke, "okExit" | "exitSemantics">): number[] {
  return [...(inv.okExit.includes(0) ? [0] : []), ...semanticExitCodes(inv)];
}

/**
 * Classify a finished run's exit code against the operation's contract. The observable part of a
 * semantic code's basis is re-checked here, on this run: a semantic nonzero exit that wrote to
 * standard error, or produced nothing, is the program reporting an error, not a result.
 */
export function classifyExit(
  inv: Pick<CliInvoke, "okExit" | "exitSemantics">,
  run: { code: number | null; stderr: string; producedOutput: boolean },
): Omit<CliExitStatus, "process"> {
  const code = run.code;
  if (code === null) return { code, classification: "reported-error", basis: "the program ended without an exit code (signalled)" };
  if (code === 0) return inv.okExit.includes(0)
    ? { code, classification: "success", basis: "exit 0 (success by convention)" }
    : { code, classification: "reported-error", basis: "exit 0 is not a success code of this operation" };
  const semantic = inv.okExit.includes(code) ? inv.exitSemantics?.[String(code)] : undefined;
  if (!semantic) {
    return {
      code,
      classification: "reported-error",
      basis: inv.okExit.includes(code)
        ? `exit ${code} has no demonstrated meaning for this operation: it was never observed as a valid outcome (a declared interface, or state learned before exit semantics were recorded; learn the program again to establish one)`
        : `exit ${code} is not a success code of this operation (success: ${successExitCodes(inv).join("/") || "none"})`,
    };
  }
  if (run.stderr.trim()) return { code, classification: "reported-error", basis: `exit ${code} means "${semantic.meaning}" only without a diagnostic, and this run wrote to standard error` };
  if (!run.producedOutput) return { code, classification: "reported-error", basis: `exit ${code} means "${semantic.meaning}" only with output, and this run produced none` };
  return { code, classification: "semantic-nonzero", basis: `${semantic.meaning} (${semantic.evidence})` };
}
