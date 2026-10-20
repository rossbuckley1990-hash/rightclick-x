// Outcome verification: "the provider answered" is not "the job got done".
// Callers attach predicates to a run; the result is verified, refuted, or
// honestly unverified when no predicate was given.

export type Predicate =
  | { op: "exists"; path?: string }
  | { op: "equals"; path?: string; value: unknown }
  | { op: "contains"; path?: string; value: string }
  | { op: "matches"; path?: string; pattern: string }
  | { op: "type"; path?: string; value: "string" | "number" | "boolean" | "object" | "array" }
  | { op: "gt" | "lt"; path?: string; value: number }
  | { op: "length_gt"; path?: string; value: number };

export interface PredicateResult {
  predicate: Predicate;
  ok: boolean;
  actual: unknown;
}

/** A read-only environmental capability that independently checks an outcome.
 * Bindings are relative to each invocation, never frozen to the first example.
 */
export interface OutcomeWitness {
  capability: string;
  /** Runtime-pinned checker contract. Changed checkers require a new explicit proof. */
  contract?: string;
  args: Record<string, { input: string } | { output: string } | { value: unknown }>;
  verify: Predicate[];
}

export interface WitnessResult {
  capability: string;
  runId: string;
  status: "completed" | "failed" | "pending";
  verification: { status: "verified" | "checked" | "refuted" | "unverified"; results: PredicateResult[] };
  output?: unknown;
  error?: string;
}

export function pick(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (Array.isArray(cur)) cur = cur.map((x) => (x as Record<string, unknown>)?.[seg]);
    else cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Stored predicates checked by RightClick X itself on the output. Passing them is a check
 * ("checked"), not independent verification: only a separate witness provider verifies.
 */
export function check(value: unknown, predicates: Predicate[]): { status: "checked" | "refuted" | "unverified"; results: PredicateResult[] } {
  if (!predicates?.length) return { status: "unverified", results: [] };
  const results = predicates.map((p) => {
    const actual = pick(value, p.path);
    let ok = false;
    switch (p.op) {
      case "exists":
        ok = actual !== undefined && actual !== null && actual !== "";
        break;
      case "equals":
        ok = JSON.stringify(actual) === JSON.stringify(p.value);
        break;
      case "contains":
        ok = (typeof actual === "string" ? actual : JSON.stringify(actual ?? "")).includes(p.value);
        break;
      case "matches":
        ok = new RegExp(p.pattern).test(typeof actual === "string" ? actual : JSON.stringify(actual ?? ""));
        break;
      case "type":
        ok = p.value === "array" ? Array.isArray(actual) : typeof actual === p.value && !Array.isArray(actual);
        break;
      case "gt":
        ok = Number(actual) > p.value;
        break;
      case "lt":
        ok = Number(actual) < p.value;
        break;
      case "length_gt":
        ok = ((actual as { length?: number })?.length ?? 0) > p.value;
        break;
    }
    return { predicate: p, ok, actual: summarize(actual) };
  });
  return { status: results.every((r) => r.ok) ? "checked" : "refuted", results };
}

function summarize(v: unknown): unknown {
  if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "…";
  // A path-less predicate must not echo a large output back once per check.
  if (v && typeof v === "object") {
    const chars = JSON.stringify(v).length;
    if (chars > 1000) return Array.isArray(v) ? { omitted: "array", length: v.length, chars } : { omitted: "object", keys: Object.keys(v).length, chars };
  }
  return v;
}
