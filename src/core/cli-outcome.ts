import { ClientFacingError } from "../interface/client-error.ts";

export interface CliValidity {
  coverage: "partial";
  environment: "unchanged" | "changed" | "unrecorded";
  expected?: string;
  observed: string;
  processExit?: number | null;
  application: "not-assessed" | "reported-error" | "not-established";
  conformance?: { status: "matched" | "refused"; contract: string; samples: string; checks: number; sha256: string };
  limitation: string;
}

export class CliValidityError extends ClientFacingError {
  readonly validity?: CliValidity;
  readonly capability?: string;
  readonly runs: string[];
  /** `message` is the reviewed client text; `detail` may carry the wrapped diagnostic
   *  (a run-record error string) that must stay in the audit channel. */
  constructor(message: string, validity?: CliValidity, capability?: string, runs: string[] = [], detail?: string) {
    super("cli_validity", message, detail);
    this.name = "CliValidityError";
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
