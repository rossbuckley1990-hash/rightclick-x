// The composer: from "what I have" to "what I want" across any providers.
//
// State = the set of typed values available so far (goal inputs plus every
// output produced by earlier steps). A capability is applicable when all of
// its required inputs can be bound to available values; applying it adds its
// outputs. Best-first search over these states, priced by the experience
// ledger, yields ranked multi-provider pipelines. Nobody wrote the glue: the
// types did.

import { distance, strongly } from "./semantics.ts";
import { tokenize, type CapabilityGraph } from "./graph.ts";
import type { Ledger } from "./ledger.ts";
import type { Binding, Capability, PlanStep, SemType } from "./types.ts";

export interface Goal {
  /** Named inputs the caller can supply, with semantic types. */
  have: Record<string, SemType>;
  /** Desired output type. */
  want: SemType;
  /** Free-text intent ("weather", "translate", "summary") used to rank and filter. */
  intent?: string;
  maxSteps?: number;
  limit?: number;
  /** Capability ids to route around (e.g. ones that just failed). */
  exclude?: Set<string>;
}

export interface Plan {
  steps: PlanStep[];
  result: string;
  resultType: SemType;
  cost: number;
  intentScore: number;
  providers: string[];
  summary: string;
}

interface Value {
  ref: string;
  type: SemType;
  /** Step index that produced it, -1 for goal inputs. */
  step: number;
}

interface Node {
  values: Value[];
  steps: PlanStep[];
  used: Set<string>;
  cost: number;
}

const MAX_EXPANSIONS = 6000;

export function plan(graph: CapabilityGraph, ledger: Ledger, goal: Goal): Plan[] {
  const maxSteps = Math.min(goal.maxSteps ?? 4, 6);
  const limit = goal.limit ?? 5;
  const intent = new Set(tokenize(goal.intent ?? ""));
  const excluded = goal.exclude ?? new Set<string>();
  const caps = graph.list().filter(
    (c) => !excluded.has(c.id) && !(c.invoke.kind === "composite" && c.invoke.steps.some((s) => excluded.has(s.capability))),
  );
  const start: Node = {
    values: Object.entries(goal.have).map(([name, type]) => ({ ref: `$in.${name}`, type, step: -1 })),
    steps: [],
    used: new Set(),
    cost: 0,
  };

  const results: Plan[] = [];
  const seen = new Set<string>();
  let frontier: Node[] = [start];
  let expansions = 0;

  for (let depth = 0; depth < maxSteps && frontier.length && expansions < MAX_EXPANSIONS; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const cap of caps) {
        if (node.used.has(cap.id)) continue;
        if (++expansions > MAX_EXPANSIONS) break;
        const bindings = bind(cap, node.values);
        if (!bindings) continue;
        // A step must consume something produced or supplied, not only constants.
        if (cap.inputs.length && !bindings.length) continue;
        const stepIndex = node.steps.length;
        const produced: Value[] = cap.outputs.map((o) => ({
          ref: `${stepIndex}.${o.name}`,
          type: o.type,
          step: stepIndex,
        }));
        // Prune steps that add no new type to the state, unless they finish the goal.
        const finishes = produced.some((v) => distance(goal.want, v.type) >= 0 && distance(goal.want, v.type) <= 1);
        const novel = produced.some((v) => !node.values.some((h) => h.type === v.type));
        if (!novel && !finishes) continue;
        const child: Node = {
          values: [...node.values, ...produced],
          steps: [...node.steps, { capability: cap.id, bindings }],
          used: new Set([...node.used, cap.id]),
          cost: node.cost + ledger.cost(cap.id),
        };
        const key = child.steps.map((s) => `${s.capability}(${s.bindings.map((b) => b.from).join(",")})`).join(">");
        if (seen.has(key)) continue;
        seen.add(key);

        const hit = produced
          .map((v) => ({ v, d: distance(goal.want, v.type) }))
          .filter((x) => x.d >= 0 && x.d <= 1)
          .sort((a, b) => a.d - b.d)[0];
        if (hit) {
          const p = finalize(graph, child, hit.v, hit.d, intent);
          if (p) results.push(p);
        }
        next.push(child);
      }
    }
    // Beam: keep the cheapest, most on-intent partial plans.
    frontier = next
      .map((n) => ({ n, score: n.cost - intentOf(graph, n, intent) * 0.5 }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.n)
      .slice(0, 150);
  }

  const ranked = dedupe(results)
    .filter((p) => !intent.size || p.intentScore > 0)
    .sort((a, b) => b.intentScore - a.intentScore || a.cost - b.cost || a.steps.length - b.steps.length);
  // Drop plans that merely extend a kept plan without covering more of the intent.
  const kept: Plan[] = [];
  for (const p of ranked) {
    const ids = p.steps.map((s) => s.capability).join(">");
    const redundant = kept.some((k) => k.intentScore >= p.intentScore && ids.startsWith(k.steps.map((s) => s.capability).join(">") + ">"));
    if (!redundant) kept.push(p);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Bind every required input of `cap` to the best available value, or null. */
function bind(cap: Capability, values: Value[]): Binding[] | null {
  const bindings: Binding[] = [];
  for (const port of cap.inputs) {
    let best: Value | undefined;
    let bestScore = Infinity;
    for (const v of values) {
      if (!strongly(port.type, v.type)) continue;
      // Optional ports are only filled when the caller supplied them by name.
      if (!port.required && v.ref !== `$in.${port.name}`) continue;
      // Prefer exact types, recent values, and name matches with goal inputs.
      const d = distance(port.type, v.type);
      const nameBonus = v.ref === `$in.${port.name}` ? -2 : 0;
      const score = d * 10 - v.step + nameBonus;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (best) bindings.push({ port: port.name, from: best.ref });
    else if (port.required) return null;
  }
  return bindings;
}

/** How many distinct intent terms the plan covers. Junk steps add nothing. */
function intentOf(graph: CapabilityGraph, node: Node, intent: Set<string>): number {
  if (!intent.size) return 0;
  const covered = new Set<string>();
  for (const s of node.steps) {
    const c = graph.get(s.capability)!;
    const toks = new Set(tokenize(`${c.title} ${c.description} ${c.tags.join(" ")} ${c.outputs.map((o) => o.name).join(" ")}`));
    for (const t of intent) if (toks.has(t)) covered.add(t);
  }
  return covered.size;
}

function finalize(graph: CapabilityGraph, node: Node, v: Value, d: number, intent: Set<string>): Plan | null {
  // Drop trailing steps that don't contribute to the result.
  const needed = new Set<number>([v.step]);
  for (let i = node.steps.length - 1; i >= 0; i--) {
    if (!needed.has(i)) continue;
    for (const b of node.steps[i].bindings) {
      const m = /^(\d+)\./.exec(b.from);
      if (m) needed.add(Number(m[1]));
    }
  }
  if (needed.size !== node.steps.length) return null; // a shorter plan covers this
  const providers = [...new Set(node.steps.map((s) => graph.get(s.capability)!.provider))];
  const titles = node.steps.map((s) => graph.get(s.capability)!.title);
  const intentScore = intentOf(graph, node, intent);
  return {
    steps: node.steps,
    result: v.ref,
    resultType: v.type,
    cost: node.cost + d * 0.5,
    intentScore,
    providers,
    summary: titles.join(" → "),
  };
}

function dedupe(plans: Plan[]): Plan[] {
  const seen = new Set<string>();
  return plans.filter((p) => {
    const k = p.steps.map((s) => s.capability).join(">") + "#" + p.result;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
