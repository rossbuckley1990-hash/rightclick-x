// The composer: from "what I have" to "what I want" across any providers.
//
// State = the set of typed values available so far (goal inputs plus every
// output produced by earlier steps). A capability is applicable when all of
// its required inputs can be bound to available values; applying it adds its
// outputs. Best-first search over these states, priced by the experience
// ledger, yields ranked multi-provider pipelines. Nobody wrote the glue: the
// types did.

import { accepts, distance, isNominal } from "./semantics.ts";
import { tokenize, type CapabilityGraph } from "./graph.ts";
import type { Ledger } from "./ledger.ts";
import type { Binding, Capability, PlanStep, Risk, SemType } from "./types.ts";

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
  /** Caller-chosen constraint: only plan with capabilities of these risk labels (e.g. ["read"]). */
  risks?: Risk[];
  /** Anchors: capability ids every returned plan must pass through. The planner wires the rest. */
  through?: string[];
}

export interface Plan {
  steps: PlanStep[];
  result: string;
  resultType: SemType;
  cost: number;
  intentScore: number;
  /** How well the plan uses the caller's inputs. */
  fit: number;
  /** How content-like the result is (an `extract` beats a `title`). */
  resultScore: number;
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

/** Expansion budget per search depth, so wide graphs (GitHub: 1,200+ ops) still get searched deep. */
const DEPTH_BUDGET = 8000;

export function plan(graph: CapabilityGraph, ledger: Ledger, goal: Goal): Plan[] {
  const maxSteps = Math.min(goal.maxSteps ?? 4, 6);
  const limit = goal.limit ?? 5;
  const intent = new Set(tokenize(goal.intent ?? ""));
  const excluded = goal.exclude ?? new Set<string>();
  const anchors = new Set(goal.through ?? []);
  const risks = goal.risks?.length ? new Set(goal.risks) : null;
  const caps = graph.list().filter(
    (c) =>
      !excluded.has(c.id) &&
      !(c.invoke.kind === "composite" && c.invoke.steps.some((s) => excluded.has(s.capability))) &&
      (!risks || risks.has(c.risk)),
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
  for (let depth = 0; depth < maxSteps && frontier.length; depth++) {
    const next: Node[] = [];
    let expansions = 0;
    for (const node of frontier) {
      if (expansions > DEPTH_BUDGET) break;
      for (const cap of caps) {
        if (node.used.has(cap.id)) continue;
        const bindings = bind(cap, node.values, intent);
        if (!bindings) continue;
        if (++expansions > DEPTH_BUDGET) break;
        // A step must consume something produced or supplied, not only constants,
        // and every step after the first must build on an earlier step's output.
        if (cap.inputs.length && !bindings.length) continue;
        if (node.steps.length && !bindings.some((b) => !b.from.startsWith("$in."))) continue;
        const stepIndex = node.steps.length;
        const produced: Value[] = cap.outputs.map((o) => ({
          ref: `${stepIndex}.${o.name}`,
          type: o.type,
          step: stepIndex,
        }));
        // Prune steps that add no new type to the state, unless they finish the goal.
        const finishes = produced.some((v) => satisfies(goal.want, v.type));
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
          .map((v) => ({ v, d: distance(goal.want, v.type), s: outputScore(v.ref, intent) }))
          .filter((x) => satisfies(goal.want, x.v.type))
          .sort((a, b) => a.d - b.d || b.s - a.s)[0];
        if (hit) {
          const p = finalize(graph, child, hit.v, hit.d, intent);
          if (p) results.push(p);
        }
        next.push(child);
      }
    }
    // Beam: keep the cheapest, most on-intent partial plans.
    frontier = next
      .map((n) => ({ n, score: n.cost - intentOf(graph, n, intent) * 0.5 - anchorsIn(n, anchors) * 3 }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.n)
      .slice(0, 150);
  }

  const ranked = dedupe(results)
    .filter((p) => !intent.size || p.intentScore > 0 || anchors.size)
    .filter((p) => [...anchors].every((a) => p.steps.some((s) => s.capability === a)))
    .sort(
      (a, b) =>
        Math.floor(b.fit) - Math.floor(a.fit) || b.intentScore - a.intentScore || b.fit - a.fit || b.resultScore - a.resultScore || a.cost - b.cost || a.steps.length - b.steps.length,
    );
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

/** Does a produced type answer the goal? Markup is not the "text" a caller asked for. */
function satisfies(want: SemType, got: SemType): boolean {
  const d = distance(want, got);
  if (d < 0 || d > 1) return false;
  return !(want === "text" && (got === "html" || got === "markdown"));
}

const CONTENT = /(^|\.)(extract|summary|description|content|text|body|answer|result|translated\w*|message|output|response)$/i;

/** Prefer content-bearing outputs (extract, summary) and ones named like the intent. */
function outputScore(ref: string, intent: Set<string>): number {
  const path = ref.replace(/^\d+\./, "");
  let s = CONTENT.test(path) ? 2 : 0;
  for (const t of tokenize(path)) if (intent.has(t)) s += 1;
  if (path === "") s += 0.5;
  return s - path.split(".").length * 0.1;
}

/** Bind every required input of `cap` to the best available value, or null. */
function bind(cap: Capability, values: Value[], intent: Set<string>): Binding[] | null {
  const bindings: Binding[] = [];
  for (const port of cap.inputs) {
    let best: Value | undefined;
    let bestScore = Infinity;
    for (const v of values) {
      if (!accepts(port.name, port.type, v.type)) continue;
      // Optional ports are only filled when the caller supplied them by name.
      if (!port.required && v.ref !== `$in.${port.name}`) continue;
      const leafName = v.ref.replace(/^(\$in|\d+)\./, "").split(".").pop() ?? "";
      // Name-like ports (title, name, q) take names, not prose fields like body/description.
      if (isNominal(port.name, port.type) && CONTENT.test(leafName)) continue;
      // Prefer exact types, recent values, the caller's names, and values named like the intent.
      const d = distance(port.type, v.type);
      const nameBonus = v.ref === `$in.${port.name}` ? 5 : 0;
      const leaf = v.ref.replace(/^(\$in|\d+)\./, "").split(".").pop() ?? "";
      const leafToks = tokenize(leaf);
      // Intent words often name the caller's own inputs ("question"); only produced values earn this.
      const intentBonus = v.step >= 0 && leafToks.length ? (5 * leafToks.filter((t) => intent.has(t)).length) / leafToks.length : 0;
      const contentBonus = port.type === "text" && CONTENT.test(leaf) ? 2 : 0;
      // The caller's own value of the exact type beats one derived through a detour.
      // (Identities only: free text is meant to be transformed, so the latest version wins.)
      const callerBonus = v.step === -1 && d === 0 && port.type !== "text" ? 3 : 0;
      const score = d * 3 - 2 * v.step - nameBonus - intentBonus - contentBonus - callerBonus;
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
function anchorsIn(node: Node, anchors: Set<string>): number {
  let n = 0;
  for (const s of node.steps) if (anchors.has(s.capability)) n++;
  return n;
}

/** Plans should use what the caller supplied: +1 per distinct input used, +0.25 per input that lands in a same-named port. */
function fitOf(graph: CapabilityGraph, node: Node): number {
  const used = new Set<string>();
  const named = new Set<string>();
  for (const s of node.steps)
    for (const b of s.bindings)
      if (b.from.startsWith("$in.")) {
        used.add(b.from);
        if (b.from.slice(4).toLowerCase() === b.port.toLowerCase()) named.add(b.from);
      }
  void graph;
  return used.size + named.size * 0.25;
}

const TOKENS = new WeakMap<Capability, Set<string>>();

function tokensOf(c: Capability): Set<string> {
  let t = TOKENS.get(c);
  if (!t) TOKENS.set(c, (t = new Set(tokenize(`${c.title} ${c.description} ${c.tags.join(" ")}`))));
  return t;
}

/**
 * How many distinct intent terms the plan covers, from what its steps are
 * (title, description, tags) and the values it actually uses. Output fields a
 * plan merely could produce don't count, so junk steps add nothing.
 */
function intentOf(graph: CapabilityGraph, node: Node, intent: Set<string>, resultRef?: string): number {
  if (!intent.size) return 0;
  const covered = new Set<string>();
  const used = [...node.steps.flatMap((s) => s.bindings.map((b) => b.from)), ...(resultRef ? [resultRef] : [])];
  const leafTokens = new Set(used.flatMap((r) => tokenize(r.replace(/^(\$in|\d+)\./, ""))));
  for (const s of node.steps) {
    const toks = tokensOf(graph.get(s.capability)!);
    for (const t of intent) if (toks.has(t) || leafTokens.has(t)) covered.add(t);
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
  const intentScore = intentOf(graph, node, intent, v.ref);
  const last = graph.get(node.steps[v.step].capability)!;
  // A crystallized pipeline is judged by the result it was proven on.
  let resultScore = last.invoke.kind === "composite" ? outputScore(last.invoke.result, intent) : outputScore(v.ref, intent);
  // The whole result of a step that *is* the intent (Summarize for "summary") is content.
  if (/^\d+\.$/.test(v.ref) && [...tokensOf(last)].some((t) => intent.has(t))) resultScore += 2;
  return {
    steps: node.steps,
    result: v.ref,
    resultType: v.type,
    cost: node.cost + d * 0.5,
    intentScore,
    fit: fitOf(graph, node),
    resultScore,
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
