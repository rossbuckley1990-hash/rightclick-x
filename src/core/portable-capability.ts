// Portable goals are deliberately separate from a runtime snapshot or provider
// reflection. A host must explicitly declassify every exported definition and
// each fixed input. The runtime cannot infer whether arbitrary bytes are secret.
import type { PublishedGoal } from "../runtime.ts";

export const PORTABLE_GOAL_FORMAT = "rightclick-x/portable-goal@1" as const;
export interface ProtectedValueRef {
  kind: "protected-value-ref";
  version: 1;
  slot: string;
  purpose: string;
  requiredScope: string;
}
export type PortableGoalDefinition = Pick<PublishedGoal, "slug" | "revision" | "title" | "have" | "want" | "intent" | "verify" | "require" | "witnesses" | "fixed" | "inputBindings" | "origins" | "risks" | "through" | "anchors" | "maxSteps">;
export interface PortableGoal {
  format: typeof PORTABLE_GOAL_FORMAT;
  goal: PortableGoalDefinition;
  protectedInputs: Record<string, ProtectedValueRef>;
}
export interface PortableGoalApproval {
  /** Host has reviewed the entire proposed definition, including metadata and literal checks. */
  approveDefinition: true;
  /** Fixed inputs individually classified by the host as portable. */
  portableFixedInputs: string[];
}

function fail(): never { throw new Error("invalid or unapproved portable capability definition"); }
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail();
  return v as Record<string, any>;
}
function keys(v: unknown, allowed: string[], required: string[] = []): Record<string, any> {
  const o = object(v);
  if (Object.keys(o).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(o, k))) fail();
  return o;
}
function str(v: unknown, max = 1024, empty = false): asserts v is string {
  if (typeof v !== "string" || v.length > max || (!empty && !v.length) || /[\u0000-\u001f\u007f]/.test(v)) fail();
}
function list(v: unknown, max = 64): asserts v is unknown[] { if (!Array.isArray(v) || v.length > max) fail(); }
function names(v: unknown): string[] {
  list(v); const seen = new Set<string>();
  for (const x of v) { str(x, 512); if (seen.has(x)) fail(); seen.add(x); }
  return v as string[];
}
function strings(v: unknown): void { list(v); for (const x of v) str(x, 512); }
function scalar(v: unknown): void {
  if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return;
  str(v, 4096, true);
}
function safeKey(k: string): void { str(k, 512); if (["__proto__", "prototype", "constructor"].includes(k)) fail(); }

/** Descriptors are not bearer credentials and are never resolved on parse/import. */
export function parseProtectedValueRef(value: unknown): ProtectedValueRef {
  const o = keys(value, ["kind", "version", "slot", "purpose", "requiredScope"], ["kind", "version", "slot", "purpose", "requiredScope"]);
  if (o.kind !== "protected-value-ref" || o.version !== 1) fail();
  for (const field of ["slot", "purpose", "requiredScope"]) if (typeof o[field] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(o[field])) fail();
  return { kind: "protected-value-ref", version: 1, slot: o.slot, purpose: o.purpose, requiredScope: o.requiredScope };
}

function predicate(value: unknown): void {
  const p = keys(value, ["op", "path", "value", "pattern"], ["op"]);
  if (p.path !== undefined) str(p.path, 512, true);
  switch (p.op) {
    case "exists": if ("value" in p || "pattern" in p) fail(); break;
    case "equals": if (!("value" in p) || "pattern" in p) fail(); scalar(p.value); break;
    case "contains": if (!("value" in p) || "pattern" in p) fail(); str(p.value, 4096, true); break;
    case "matches": if (!("pattern" in p) || "value" in p) fail(); str(p.pattern, 512, true); try { new RegExp(p.pattern); } catch { fail(); } break;
    case "type": if (!("value" in p) || !["string", "number", "boolean", "object", "array"].includes(p.value) || "pattern" in p) fail(); break;
    case "gt": case "lt": case "length_gt": if (!("value" in p) || typeof p.value !== "number" || !Number.isFinite(p.value) || "pattern" in p) fail(); break;
    default: fail();
  }
}
function predicates(value: unknown): void { list(value, 32); value.forEach(predicate); }
function witness(value: unknown): void {
  const w = keys(value, ["capability", "contract", "args", "verify", "agree"], ["capability", "contract", "args", "verify"]);
  str(w.capability, 512); if (typeof w.contract !== "string" || !/^sha256:[a-f0-9]{64}$/.test(w.contract)) fail();
  const args = object(w.args); if (Object.keys(args).length > 32) fail();
  for (const [name, binding] of Object.entries(args)) {
    safeKey(name); const b = keys(binding, ["input", "output", "value"]);
    if (Object.keys(b).length !== 1) fail();
    if ("input" in b) str(b.input, 512); else if ("output" in b) str(b.output, 512, true); else scalar(b.value);
  }
  predicates(w.verify);
  if (!w.verify.length && !w.agree) fail();
  if (w.agree !== undefined) {
    const a = keys(w.agree, ["path", "candidate", "mode", "tolerance"]);
    if (a.path !== undefined) str(a.path, 512, true); if (a.candidate !== undefined) str(a.candidate, 512, true);
    if (a.mode !== undefined && !["exact", "trimmed", "number"].includes(a.mode)) fail();
    if (a.tolerance !== undefined && (a.mode !== "number" || typeof a.tolerance !== "number" || !Number.isFinite(a.tolerance) || a.tolerance < 0)) fail();
    if (Object.values(args).some((b: any) => "output" in b)) fail();
  }
}
const DEFINITION_FIELDS = ["slug", "revision", "title", "have", "want", "intent", "verify", "require", "witnesses", "fixed", "inputBindings", "origins", "risks", "through", "anchors", "maxSteps"];
const OBSERVATIONS = ["publishedAt", "calls", "lastPipeline", "providers", "lastResult", "trust", "protectedInputs"];

/** Parse only the classified portable schema; unknown nested fields fail closed. */
export function parsePortableGoal(value: unknown): PortableGoal {
  let size: number; try { size = JSON.stringify(value).length; } catch { return fail(); } if (size > 65_536) fail();
  const root = keys(value, ["format", "goal", "protectedInputs"], ["format", "goal", "protectedInputs"]);
  if (root.format !== PORTABLE_GOAL_FORMAT) fail();
  const g = keys(root.goal, DEFINITION_FIELDS, ["slug", "revision", "title", "have", "want"]);
  str(g.slug, 128); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g.slug)) fail();
  str(g.revision, 128); str(g.title, 512); str(g.want, 256); if (g.intent !== undefined) str(g.intent, 1000, true);
  const have = object(g.have); if (!Object.keys(have).length || Object.keys(have).length > 64) fail();
  for (const [k, type] of Object.entries(have)) { safeKey(k); str(type, 256); }
  if (g.verify !== undefined) predicates(g.verify);
  if (g.require !== undefined) names(g.require);
  if (g.through !== undefined) names(g.through);
  if (g.risks !== undefined && names(g.risks).some(r => !["read", "write", "external", "destructive"].includes(r))) fail();
  if (g.origins !== undefined) for (const origin of names(g.origins)) { try { const u = new URL(origin); if (!["http:", "https:"].includes(u.protocol) || u.origin !== origin || u.username || u.password) fail(); } catch { fail(); } }
  if (g.maxSteps !== undefined && (!Number.isSafeInteger(g.maxSteps) || g.maxSteps < 1 || g.maxSteps > 64)) fail();
  if (g.witnesses !== undefined) { list(g.witnesses, 16); g.witnesses.forEach(witness); }
  if (g.fixed !== undefined) { const f = object(g.fixed); for (const [k, v] of Object.entries(f)) { safeKey(k); if (!Object.hasOwn(have, k)) fail(); scalar(v); } }
  if (g.inputBindings !== undefined) { const m = object(g.inputBindings); if (Object.keys(m).length > 64) fail(); for (const [id, ports] of Object.entries(m)) { safeKey(id); const p = object(ports); if (Object.keys(p).length > 64) fail(); for (const [name, input] of Object.entries(p)) { safeKey(name); str(input, 512); if (!Object.hasOwn(have, input)) fail(); } } }
  if (g.anchors !== undefined) { list(g.anchors, 64); for (const item of g.anchors) { const a = keys(item, ["id", "source", "title", "risk", "inputTypes", "outputTypes", "operation"], ["id", "title", "risk", "inputTypes", "outputTypes"]); str(a.id, 512); str(a.title, 512); if (a.source !== undefined) str(a.source, 1024); if (a.operation !== undefined) str(a.operation, 1024); if (!["read", "write", "external", "destructive"].includes(a.risk)) fail(); strings(a.inputTypes); strings(a.outputTypes); } }
  // Match the persisted state decoder's limit so every accepted artifact can
  // be safely reopened even when a custom Store does not validate on save.
  const slots = object(root.protectedInputs); if (Object.keys(slots).length > 16) fail();
  for (const [input, ref] of Object.entries(slots)) { safeKey(input); if (!Object.hasOwn(have, input) || g.fixed && Object.hasOwn(g.fixed, input)) fail(); parseProtectedValueRef(ref); }
  // A JSON clone strips object aliases and prototypes, and only accepted keys cross the boundary.
  return JSON.parse(JSON.stringify(root)) as PortableGoal;
}

/** Host-only projection: do not copy provider reflections, observations, output, receipts or unknown fields. */
export function makePortableGoal(goal: PublishedGoal, protectedInputs: Record<string, ProtectedValueRef>, approval: PortableGoalApproval): PortableGoal {
  const decision = keys(approval, ["approveDefinition", "portableFixedInputs"], ["approveDefinition", "portableFixedInputs"]);
  if (decision.approveDefinition !== true) fail();
  const approvedFixed = names(decision.portableFixedInputs);
  const g = object(goal);
  if (Object.keys(g).some(k => !DEFINITION_FIELDS.includes(k) && !OBSERVATIONS.includes(k))) fail();
  if (g.protectedInputs !== undefined) {
    const before = object(g.protectedInputs), after = object(protectedInputs);
    if (Object.keys(before).length !== Object.keys(after).length) fail();
    for (const name of Object.keys(before)) {
      if (!Object.hasOwn(after, name)) fail();
      const a = parseProtectedValueRef(before[name]), b = parseProtectedValueRef(after[name]);
      if (a.slot !== b.slot || a.purpose !== b.purpose || a.requiredScope !== b.requiredScope) fail();
    }
  }
  const fixed = g.fixed ? Object.keys(object(g.fixed)) : [];
  if (fixed.length !== approvedFixed.length || fixed.some(k => !approvedFixed.includes(k))) fail();
  const out: Record<string, unknown> = {};
  for (const k of DEFINITION_FIELDS) if (g[k] !== undefined) out[k] = g[k];
  return parsePortableGoal({ format: PORTABLE_GOAL_FORMAT, goal: out, protectedInputs });
}
