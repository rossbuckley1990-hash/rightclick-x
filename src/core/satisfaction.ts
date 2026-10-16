// Goal satisfaction (experiments/goal-satisfaction/PREREGISTRATION.md).
//
// Type compatibility is not satisfaction: with `want: json`, every lookup "answers". A plan is
// judged on what its RESULT carries for each piece of required information (`require`), and on
// how each of its joins is supported:
//   caller   - the caller's own value;
//   evidence - a learned identifier scheme (values observed to link the two ports);
//   declared - a specific declared type on both sides (not text/json/number plumbing);
//   generic  - text/json/number/id plumbing that any value would satisfy.
// Statuses: established (all required information in the result's declared fields, no generic
// join), unverified (information present, but a join is generic), incomplete (missing).
// Plan length and fan-out earn nothing by themselves.
import type { CapabilityGraph } from "./graph.ts";
import { tokenize } from "./graph.ts";
import type { Capability, DeclaredField, PlanStep } from "./types.ts";

export type JoinKind = "caller" | "evidence" | "declared" | "generic";
export type SatisfactionStatus = "established" | "unverified" | "incomplete";

export interface Satisfaction {
  status: SatisfactionStatus;
  /** required term -> the declared result field that carries it */
  covered: Record<string, string>;
  missing: string[];
  joins: Array<{ step: number; port: string; from: string; kind: JoinKind }>;
  /** GraphQL steps whose required fields are declared but not in the default selection. */
  projection: Array<{ step: number; fields: string[] }>;
}

const GENERIC = new Set(["text", "json", "number", "id", "boolean", "list:text", "list:json", "list:number", "list:id"]);

/** The fields a step's result carries under a result path, from ports and contract-declared fields. */
export function resultFields(cap: Capability, path: string): DeclaredField[] {
  const prefix = path ? `${path}.` : "";
  const fromPorts = cap.outputs.filter((o) => o.name).map((o) => ({ path: o.name, selected: true }) as DeclaredField);
  const all = [...fromPorts, ...(cap.fields ?? [])];
  const seen = new Set<string>();
  const out: DeclaredField[] = [];
  for (const f of all) {
    const p = f.path.replace(/\[\]/g, "");
    if (prefix && !p.startsWith(prefix)) continue;
    const rel = prefix ? p.slice(prefix.length) : p;
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    out.push({ path: rel, selected: f.selected });
  }
  // A leaf result (e.g. "2.rate") carries its own name.
  if (path && !out.length) out.push({ path: path.split(".").pop()!, selected: true });
  return out;
}

/** Does a field path carry a required term? Every word of the term must appear in the path. */
export function carries(path: string, term: string): boolean {
  const want = tokenize(term);
  const have = new Set(tokenize(path.replace(/[._\[\]]+/g, " ")));
  return want.length > 0 && want.every((w) => have.has(w));
}

export function assess(graph: CapabilityGraph, steps: PlanStep[], result: string, require: string[]): Satisfaction {
  const covered: Record<string, string> = {};
  const projection: Satisfaction["projection"] = [];
  const last = steps.length - 1;
  const [stepIdx, ...rest] = result.split(".");
  const resultStep = Number(stepIdx);
  const cap = graph.get(steps[resultStep]?.capability ?? "");
  if (cap) {
    const fields = resultFields(cap, rest.join("."));
    const needProjection: string[] = [];
    for (const term of require) {
      const sel = fields.find((f) => f.selected !== false && carries(f.path, term));
      const any = sel ?? fields.find((f) => carries(f.path, term));
      if (!any) continue;
      covered[term] = any.path;
      if (!sel && cap.invoke.kind === "graphql" && (cap.invoke as any).selectPort) needProjection.push(any.path);
      else if (!sel) delete covered[term]; // declared but unreachable: the provider cannot be asked for it
    }
    if (needProjection.length) projection.push({ step: resultStep, fields: needProjection });
  }
  void last;
  const missing = require.filter((t) => !(t in covered));

  const joins: Satisfaction["joins"] = [];
  steps.forEach((st, i) => {
    const c = graph.get(st.capability);
    for (const b of st.bindings) {
      if (b.value !== undefined) continue;
      const port = c?.inputs.find((p) => p.name === b.port);
      let kind: JoinKind;
      if (b.from.startsWith("$in.")) kind = "caller";
      else {
        const [si, ...pp] = b.from.split(".");
        const src = graph.get(steps[Number(si)]?.capability ?? "");
        const out = src?.outputs.find((o) => o.name === pp.join("."));
        const outType = out?.type.replace(/^list:/, "") ?? "json";
        const portType = port?.type.replace(/^list:/, "") ?? "json";
        if (port?.schemes?.length && out?.schemes?.some((s) => port.schemes!.includes(s))) kind = "evidence";
        else if (port && !GENERIC.has(port.type) && !GENERIC.has(portType) && (outType === portType || (portType.startsWith("id.") && outType === portType))) kind = "declared";
        else kind = "generic";
      }
      joins.push({ step: i, port: b.port, from: b.from, kind });
    }
  });
  const status: SatisfactionStatus = missing.length ? "incomplete" : joins.some((j) => j.kind === "generic") ? "unverified" : "established";
  return { status, covered, missing, joins, projection };
}

export const STATUS_RANK: Record<SatisfactionStatus, number> = { established: 2, unverified: 1, incomplete: 0 };

/** After a run: does the actual output carry every required term (a key path with a value)? */
export function outputCarries(output: unknown, require: string[]): { present: string[]; absent: string[] } {
  const paths: string[] = [];
  const walk = (v: unknown, prefix: string, depth: number) => {
    if (depth > 8 || paths.length > 20000) return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 200)) walk(x, prefix, depth + 1);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (x !== null && x !== undefined && x !== "") paths.push(p);
        walk(x, p, depth + 1);
      }
    }
  };
  walk(output, "", 0);
  const present = require.filter((t) => paths.some((p) => carries(p, t)));
  return { present, absent: require.filter((t) => !present.includes(t)) };
}
