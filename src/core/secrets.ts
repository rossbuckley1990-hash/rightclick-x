// Secret hygiene for logs, run records, persisted state and exports. A value is treated as a
// credential when the name it travels under says so (headers, parameters, inputs). Redaction
// happens where data leaves the request that needed it: audit logs, stored records, exports.

import { isArtefactValue, summariseArtefactValue } from "./artefact-shape.ts";

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie)$|api[-_]?key|apikey|access[-_]?key|secret|token|passw(or)?d|passphrase|credential|session[-_]?(id|key|token)?$|private[-_]?key|bearer|signature/i;

export const REDACTED = "[redacted]";

/** Redaction inspects no deeper than this. Past the cap every value is redacted, never passed through. */
export const MAX_REDACTION_DEPTH = 12;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE.test(name.trim());
}

/** A subtree redaction refuses to inspect: the shape is kept, every value is replaced. */
function redactUninspected(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(() => REDACTED);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) out[k] = REDACTED;
    return out;
  }
  return value;
}

/** A deep copy with the values of credential-named keys replaced. Fails closed: a credential
 *  named key keeps its redaction however it is wrapped, and anything too deep to inspect is
 *  redacted wholesale rather than returned unread. */
export function redact<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return redactUninspected(value) as T;
  // Artefact payloads never leave the request in logs, records or exports: identity and size only.
  if (isArtefactValue(value)) return summariseArtefactValue(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveName(k)) out[k] = v != null && typeof v !== "object" ? REDACTED : redactUninspected(v);
    else out[k] = redact(v, depth + 1);
  }
  return out as T;
}

/** Credential-named query parameters and bearer tokens removed from free text (errors, URLs). */
export function redactText(text: string): string {
  return text
    .replace(/([?&;]([\w.-]+)=)([^&\s"'#]+)/g, (m, pre: string, name: string) => (isSensitiveName(name) ? `${pre}${REDACTED}` : m))
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, `$1 ${REDACTED}`);
}

/** Values that must not appear anywhere: those passed under credential names. */
export function sensitiveValues(args: Record<string, unknown> | undefined): string[] {
  return Object.entries(args ?? {})
    .filter(([k, v]) => isSensitiveName(k) && typeof v === "string" && v.length >= 4)
    .map(([, v]) => v as string);
}

/** Free text with the given secret values replaced (for errors that echo what was sent). */
export function scrub(text: string, secrets: string[]): string {
  let t = text;
  for (const s of secrets) t = t.split(s).join(REDACTED);
  return redactText(t);
}
