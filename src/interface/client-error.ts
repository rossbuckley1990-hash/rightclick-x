// The client error boundary (H2, issue #38). Clients — MCP peers and HTTP callers —
// are untrusted. Raw exception text never crosses this boundary: a thrown message can
// echo a provider response body, a filesystem path, an environment value or an
// implementation detail, and scrubbing only catches the patterns we know.
//
// The contract is an allowlist, not a scrubber:
//
//   1. `ClientFacingError` — the ONLY way text reaches a client. Subclasses and throw
//      sites exist where the message is a reviewed template whose interpolations are
//      the caller's own input, public graph metadata (ids, ports, slugs, titles,
//      status codes), or literal server text. Provider response bodies, filesystem
//      paths and environment values go in `detail`, which is the protected diagnostic.
//   2. Anything else — the client receives a stable `internal` code, a safe sentence
//      and an opaque reference id. The full exception goes to the audit channel under
//      the same reference id.
//
// This module deliberately imports nothing from the product: every product error
// class carries its own code by extending ClientFacingError.

import { sensitiveValues, scrub } from "../core/secrets.ts";

export type ClientErrorCode =
  | "unknown_tool"
  | "unknown_capability"
  | "unknown_run"
  | "unknown_provider"
  | "invalid_argument"
  | "confirmation_required"
  | "execution_denied"
  | "transport_refused"
  | "state_conflict"
  | "state_commit_unknown"
  | "cli_validity"
  | "graphql_error"
  | "changed_meaning"
  | "unavailable"
  | "provider_error"
  | "program_failed"
  | "planning_refused"
  | "outcome_pending"
  | "missing_data"
  | "malformed_response"
  | "heal_failed"
  | "goal_state"
  | "internal";

/** An error whose message is safe for clients by construction. Only reviewed templates
 *  may construct one; the code is part of the public, stable error contract. `detail`
 *  is the fuller diagnostic for the audit channel — it never reaches the client. */
export class ClientFacingError extends Error {
  readonly code: ClientErrorCode;
  readonly detail?: string;
  constructor(code: ClientErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ClientFacingError";
    this.code = code;
    this.detail = detail;
  }
}

let refCounter = 0;
/** A short opaque reference so an operator can correlate a client report with the
 *  server-side diagnostic. Contains nothing about the failure itself. */
function nextRef(): string {
  refCounter = (refCounter + 1) % 0xffffffff;
  return Date.now().toString(36) + "-" + refCounter.toString(36);
}

export interface ClientErrorView {
  code: ClientErrorCode;
  /** Safe to show to an untrusted caller. */
  message: string;
  /** Present for `internal`: correlates the client view with the audit entry. */
  ref?: string;
  /** The protected diagnostic; for the audit sink, never the client. */
  detail: string;
}

/** Scrub the caller's own credential-named arguments out of a reviewed message before
 *  it crosses — defense in depth on an already-reviewed channel, not the boundary. */
function reviewed(code: ClientErrorCode, message: string, args?: Record<string, unknown>, detail?: string): ClientErrorView {
  return { code, message: scrub(message, sensitiveValues(args)), detail: scrub(detail ?? message, sensitiveValues(args)) };
}

/** Map a thrown value to the client-safe view. Reviewed templates keep their useful
 *  text; everything else fails closed to a generic internal error with a reference. */
export function toClientError(e: unknown, args?: Record<string, unknown>): ClientErrorView {
  if (e instanceof ClientFacingError) return reviewed(e.code, e.message, args, e.detail);
  const ref = nextRef();
  const raw = String((e as Error)?.message ?? e);
  return {
    code: "internal",
    message: `internal error (ref ${ref}); the detail is recorded server-side`,
    ref,
    detail: raw,
  };
}

/** The exact text an MCP client receives: stable code prefix, safe message. */
export function clientErrorText(view: ClientErrorView): string {
  return `[rcx:${view.code}] ${view.message}`;
}

/** Safe text for a failure being captured into a client-visible record (run records,
 *  composition attempts, witness evidence, healing notes, learn results). Reviewed
 *  messages pass through; anything else is reduced to its class and a reference id,
 *  with the raw text emitted to the server log — the protected diagnostic channel. */
export function capturedErrorText(e: unknown): string {
  if (e instanceof ClientFacingError) {
    if (e.detail) console.error(`[rcx-diagnostic] ${e.detail.slice(0, 500)}`);
    return e.message;
  }
  const name = e instanceof Error ? e.name : typeof e === "string" ? "failure" : "non-error";
  const view = toClientError(e);
  console.error(`[rcx-diagnostic ${view.ref}] ${String(view.detail).slice(0, 500)}`);
  return `${name} failure (ref ${view.ref}); the detail is recorded server-side`;
}
