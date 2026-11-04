import type { Capability, GraphQLFailureEvidence, TransportRefusal } from "./types.ts";
import type { CliValidity } from "./cli-outcome.ts";
// Outcome verification: "the provider answered" is not "the job got done".
// Callers attach predicates to a run; the result is verified, refuted, or
// honestly unverified when no predicate was given.

export type Predicate =
  | { op: "exists"; path?: string }
  | { op: "equals"; path?: string; value: unknown; confirmFixedInvariant?: boolean }
  | { op: "contains"; path?: string; value: string; confirmFixedInvariant?: boolean }
  | { op: "matches"; path?: string; pattern: string; confirmFixedInvariant?: boolean }
  | { op: "type"; path?: string; value: "string" | "number" | "boolean" | "object" | "array" }
  | { op: "gt" | "lt"; path?: string; value: number }
  | { op: "length_gt"; path?: string; value: number };

export interface PredicateWarning {
  index: number;
  predicate: Predicate;
  code:
    | "input-derived-literal"
    | "acquisition-sample-literal"
    | "sample-domain-or-url"
    | "sample-filename"
    | "vacuous-regex";
  literal?: string;
  matchedSource?: string;
  message: string;
  remediation: {
    confirmFixedInvariant: string;
    parameteriseOrStructure: string;
  };
}

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
  /** Agreement: the witness recomputes the outcome from the invocation's inputs alone, and its
   *  result must agree with the candidate. Such a witness is never given the candidate. */
  agree?: WitnessAgreement;
}

/** How an independently recomputed result must agree with the candidate. */
export interface WitnessAgreement {
  /** Path into the witness's own result; absent or empty: all of it. */
  path?: string;
  /** Path into the candidate result; absent or empty: all of it. */
  candidate?: string;
  /** exact (default): the same value; trimmed: the same text once surrounding whitespace is
   *  removed; number: numbers no further apart than tolerance. */
  mode?: "exact" | "trimmed" | "number";
  tolerance?: number;
}

export interface AgreementResult {
  mode: "exact" | "trimmed" | "number";
  ok: boolean;
  witness: unknown;
  candidate: unknown;
}

export interface WitnessResult {
  capability: string;
  runId: string;
  status: "completed" | "failed" | "pending";
  verification: { status: "verified" | "checked" | "refuted" | "unverified"; results: PredicateResult[] };
  output?: unknown;
  error?: string;
  refusal?: TransportRefusal;
  graphqlFailure?: GraphQLFailureEvidence;
  cliValidity?: CliValidity;
  agreement?: AgreementResult;
}

/** The agreement shape is checked before anything runs, so a malformed one never passes later. */
export function assertAgreement(a: unknown): asserts a is WitnessAgreement {
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("witness agreement must be an object");
  const { path, candidate, mode, tolerance, ...rest } = a as Record<string, unknown>;
  if (Object.keys(rest).length) throw new Error(`unknown witness agreement field: ${Object.keys(rest)[0]}`);
  if (path !== undefined && typeof path !== "string" || candidate !== undefined && typeof candidate !== "string") throw new Error("witness agreement paths must be strings");
  if (mode !== undefined && !["exact", "trimmed", "number"].includes(mode as string)) throw new Error("witness agreement mode must be exact, trimmed or number");
  if (tolerance !== undefined && (mode !== "number" || typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0)) throw new Error("witness agreement tolerance must be a finite non-negative number, with mode number");
}

/** Whether an independently recomputed result agrees with the candidate. */
export function agreement(a: WitnessAgreement, witnessOutput: unknown, candidateOutput: unknown): AgreementResult {
  const mode = a.mode ?? "exact";
  const witness = pick(witnessOutput, a.path), candidate = pick(candidateOutput, a.candidate);
  let ok = false;
  if (witness !== undefined && candidate !== undefined) {
    if (mode === "number") {
      const [w, c] = [witness, candidate].map((x) => typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
      ok = Number.isFinite(w) && Number.isFinite(c) && Math.abs(w - c) <= (a.tolerance ?? 0);
    } else if (mode === "trimmed") ok = typeof witness === "string" && typeof candidate === "string" ? witness.trim() === candidate.trim() : stable(witness) === stable(candidate);
    else ok = stable(witness) === stable(candidate);
  }
  return { mode, ok, witness: summarize(witness), candidate: summarize(candidate) };
}

/** JSON with object keys sorted: equal values give equal text whatever their key order. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
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

const BUILTIN_PROBE_TOKENS = new Set([
  "example.org",
  "iana.org",
  "alpha-node.org",
  "bravo-host.dev",
  "münchen.de",
  "xn--mnchen-3ya.de",
  "zürich.ch",
  "xn--zrich-kva.ch",
  "ada lovelace",
  "alan turing",
  "grace hopper",
]);

const VACUOUS_REGEX_PATTERNS = new Set([
  "",
  ".*",
  ".+",
  "^.*$",
  "^.+$",
  "^.*",
  ".*$",
  "^.+" ,
  ".+$",
  "[\\s\\S]*",
  "[\\s\\S]+",
  "^[\\s\\S]*$",
  "^[\\s\\S]+$",
  "^",
  "$",
]);

function collectStringValues(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStringValues(v, out, depth + 1);
  }
  return out;
}

const TOKEN_STOPWORDS = new Set([
  "http",
  "https",
  "true",
  "false",
  "null",
  "json",
  "text",
  "html",
  "utf8",
  "utf-8",
  "check",
  "with",
  "from",
  "into",
  "that",
  "this",
]);

function extractTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const m of lower.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) tokens.add(m[0]);
  for (const m of lower.matchAll(/\b(?:[a-z0-9\u00a0-\uffff](?:[a-z0-9\u00a0-\uffff-]{0,61}[a-z0-9\u00a0-\uffff])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9]+)\b/gi)) tokens.add(m[0].toLowerCase());
  for (const m of lower.matchAll(/\b[a-z0-9_.-]+\.(?:md|txt|json|html|xml|csv|yaml|yml|svg|toml|ini|log|sh|py|ts|js)\b/gi)) tokens.add(m[0].toLowerCase());
  const withoutSchemes = lower.replace(/https?:\/\//g, " ");
  for (const m of withoutSchemes.matchAll(/[a-z0-9\u00a0-\uffff][a-z0-9\u00a0-\uffff._-]{3,}/gi)) {
    const tok = m[0].toLowerCase();
    if (!TOKEN_STOPWORDS.has(tok)) tokens.add(tok);
  }
  return [...tokens];
}

/**
 * Conservative publication-time linter for stored predicates on a reusable goal.
 * Detects predicates that appear tied to an unpinned caller input, an acquisition probe sample,
 * a sample domain/URL/filename, or a vacuous regular expression. Never rewrites predicates or
 * upgrades assurance. Callers may explicitly confirm intentional fixed invariants via
 * `confirmFixedInvariant: true` on the predicate or `confirmFixedInvariants` on `compose`.
 */
export function lintPublicationPredicates(
  predicates: Predicate[] | undefined,
  context: {
    inputs?: Record<string, unknown>;
    fixedInputs?: Record<string, unknown>;
    capabilities?: Capability[];
    confirmFixedInvariants?: boolean | string[];
  } = {},
): PredicateWarning[] {
  if (!predicates?.length) return [];
  const fixedKeys = new Set(Object.keys(context.fixedInputs ?? {}));
  const fixedStrings = collectStringValues(context.fixedInputs ?? {}).map((s) => s.toLowerCase());
  const isPinnedInFixed = (litLower: string) =>
    fixedStrings.some((f) => f === litLower || f.includes(litLower) || (litLower.length >= 4 && litLower.includes(f)));

  const unpinnedInputs: Array<{ name: string; raw: string; lower: string; tokens: string[] }> = [];
  for (const [name, val] of Object.entries(context.inputs ?? {})) {
    if (fixedKeys.has(name)) continue;
    for (const raw of collectStringValues(val)) {
      unpinnedInputs.push({ name, raw, lower: raw.toLowerCase(), tokens: extractTokens(raw) });
    }
  }

  const sampleSources: Array<{ source: string; lower: string; tokens: string[] }> = [];
  for (const cap of context.capabilities ?? []) {
    if (cap.invoke.kind !== "cli") continue;
    for (const ex of cap.invoke.examples ?? []) {
      const texts = [
        ...(ex.stdin ? [ex.stdin] : []),
        ...(ex.literals ?? []),
        ex.outputPreview,
        ...Object.keys(ex.files ?? {}),
        ...Object.values(ex.files ?? {}),
      ];
      for (const t of texts) {
        if (t && t.trim().length >= 3) {
          sampleSources.push({ source: `${cap.id}:example`, lower: t.toLowerCase(), tokens: extractTokens(t) });
        }
      }
    }
  }

  const isConfirmed = (p: Predicate, literal: string): boolean => {
    if ("confirmFixedInvariant" in p && p.confirmFixedInvariant === true) return true;
    if (context.confirmFixedInvariants === true) return true;
    if (Array.isArray(context.confirmFixedInvariants)) {
      return context.confirmFixedInvariants.some((c) => c === literal || c.toLowerCase() === literal.toLowerCase());
    }
    return false;
  };

  const warnings: PredicateWarning[] = [];

  predicates.forEach((p, index) => {
    if (p.op === "matches") {
      const pat = p.pattern.trim();
      if (VACUOUS_REGEX_PATTERNS.has(pat)) {
        warnings.push({
          index,
          predicate: p,
          code: "vacuous-regex",
          literal: p.pattern,
          message: `Predicate #${index} uses a loose/vacuous regular expression (${JSON.stringify(p.pattern)}) that matches arbitrary text and does not establish structural or semantic correctness.`,
          remediation: {
            confirmFixedInvariant: "Loose regular expressions cannot establish semantic invariants; use `exists` or `type` if only presence is required.",
            parameteriseOrStructure: "Replace with a specific structural pattern (e.g. `^https://`, `^xn--[a-z0-9-]+\\.`) or attach an independent `OutcomeWitness`.",
          },
        });
      }
      return;
    }

    if (p.op !== "contains" && p.op !== "equals") return;
    if (typeof p.value !== "string") return;
    const literal = p.value.trim();
    if (literal.length < 3) return;
    if (isConfirmed(p, literal) || isConfirmed(p, p.value)) return;

    const litLower = literal.toLowerCase();
    if (isPinnedInFixed(litLower)) return;

    const remediation = {
      confirmFixedInvariant: `If ${JSON.stringify(p.value)} is an intentional fixed invariant required of every future run, set \`confirmFixedInvariant: true\` on the predicate or pass \`confirmFixedInvariants: [${JSON.stringify(p.value)}]\` when publishing.`,
      parameteriseOrStructure: `To allow unseen future inputs to succeed, replace this literal assertion with a structural check (\`type\`, \`length_gt\`, or a structural \`matches\` regex) or an input-relative \`OutcomeWitness\`.`,
    };

    // 1. Check if literal derives from an unpinned caller input supplied during publication.
    for (const inp of unpinnedInputs) {
      const tokenMatch = inp.tokens.find((tok) => tok.length >= 4 && (litLower === tok || litLower.includes(tok)));
      if (inp.lower.includes(litLower) || tokenMatch) {
        warnings.push({
          index,
          predicate: p,
          code: "input-derived-literal",
          literal: p.value,
          matchedSource: `input:${inp.name}`,
          message: `Predicate #${index} (${p.op}: ${JSON.stringify(p.value)}) appears tied to the acquisition caller input "${inp.name}" rather than an invariant of all future inputs. Unseen inputs that do not contain ${JSON.stringify(p.value)} will be refuted.`,
          remediation,
        });
        return;
      }
    }

    // 2. Check if literal matches a capability's stored acquisition probe samples or built-in probe vocabulary.
    if (BUILTIN_PROBE_TOKENS.has(litLower) || [...BUILTIN_PROBE_TOKENS].some((tok) => tok.length >= 5 && litLower.includes(tok))) {
      warnings.push({
        index,
        predicate: p,
        code: "acquisition-sample-literal",
        literal: p.value,
        matchedSource: "builtin-probe-vocabulary",
        message: `Predicate #${index} (${p.op}: ${JSON.stringify(p.value)}) contains a built-in acquisition probe sample identifier. Future runs on unseen inputs will fail unless they produce this sample literal.`,
        remediation,
      });
      return;
    }

    for (const samp of sampleSources) {
      const tokenMatch = samp.tokens.find((tok) => tok.length >= 4 && (litLower === tok || litLower.includes(tok)));
      if (samp.lower.includes(litLower) || tokenMatch) {
        warnings.push({
          index,
          predicate: p,
          code: "acquisition-sample-literal",
          literal: p.value,
          matchedSource: samp.source,
          message: `Predicate #${index} (${p.op}: ${JSON.stringify(p.value)}) matches an empirical acquisition sample from ${samp.source} rather than a general output invariant.`,
          remediation,
        });
        return;
      }
    }

    // 3. Check if literal contains a sample filename or sandbox path (before domain check so *.md/*.txt/*.json are classified as filenames).
    const filenameMatch =
      /(?:^|\/)in\d+-[a-z0-9_]+\.[a-z0-9]+/i.exec(literal)?.[0] ??
      (!/^https?:\/\//i.test(literal) ? /\b[a-z0-9_.-]+\.(?:md|txt|json|html|xml|csv|yaml|yml|svg|toml|ini|log)\b/i.exec(literal)?.[0] : undefined);
    if (filenameMatch) {
      warnings.push({
        index,
        predicate: p,
        code: "sample-filename",
        literal: p.value,
        matchedSource: filenameMatch,
        message: `Predicate #${index} (${p.op}: ${JSON.stringify(p.value)}) asserts a specific filename (${JSON.stringify(filenameMatch)}) that may vary across invocations.`,
        remediation,
      });
      return;
    }

    // 4. Check if literal contains a concrete URL or domain name not pinned in fixed inputs.
    const urlOrDomain =
      /https?:\/\/[^\s"'<>)\]]+/i.exec(literal)?.[0] ??
      /\b(?:[a-z0-9\u00a0-\uffff](?:[a-z0-9\u00a0-\uffff-]{0,61}[a-z0-9\u00a0-\uffff])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9]+)\b/i.exec(literal)?.[0];
    if (urlOrDomain) {
      warnings.push({
        index,
        predicate: p,
        code: "sample-domain-or-url",
        literal: p.value,
        matchedSource: urlOrDomain,
        message: `Predicate #${index} (${p.op}: ${JSON.stringify(p.value)}) asserts a specific domain or URL (${JSON.stringify(urlOrDomain)}) that is not pinned in fixed inputs.`,
        remediation,
      });
      return;
    }
  });

  return warnings;
}
