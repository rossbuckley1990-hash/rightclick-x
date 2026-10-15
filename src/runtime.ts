// RightClick X runtime: one object that owns the live graph and implements
// the whole context_* family. Every interface (MCP, HTTP API, CLI, dashboard,
// federation) is a thin shell around this class.

import { CapabilityGraph, signature, tokenize, type GraphEvent, type LearnDelta } from "./core/graph.ts";
import { Ledger, ReceiptChain, sha256, type Receipt } from "./core/ledger.ts";
import { plan, type Plan } from "./core/planner.ts";
import { distance, inferType, inspectValue, type Inspection } from "./core/semantics.ts";
import type { Capability, FetchLike, PlanStep, Reflection, SemType } from "./core/types.ts";
import { check, pick, type Predicate, type PredicateResult } from "./core/verify.ts";
import { builtinReflection, type BuiltinFn } from "./reflectors/builtins.ts";
import { DEFAULT_DIRECTORIES, type Candidate, type Directory } from "./reflectors/directories.ts";
import { discover, type Discovery, type SourceKind } from "./reflectors/discover.ts";
import { buildDocument } from "./reflectors/graphql.ts";
import { McpClient } from "./reflectors/mcp.ts";
import { Authority, readBody, request, type Net, type NetworkPolicy } from "./reflectors/net.ts";
import { detectRuntime, platformReflection, type PlatformFn, type RuntimeInfo } from "./reflectors/platform.ts";

export const VERSION = "0.1.0";

export interface Store {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}

export interface PersistedState {
  version: 1;
  reflections: Reflection[];
  ledger: Record<string, any>;
  receipts: Receipt[];
  published?: PublishedGoal[];
}

/**
 * A goal published as an API endpoint. The contract (typed inputs, output
 * type, checks) is fixed; the implementation is whatever pipeline the graph
 * finds at call time, so it survives upstream changes.
 */
export interface PublishedGoal {
  slug: string;
  title: string;
  have: Record<string, SemType>;
  want: SemType;
  intent?: string;
  verify?: Predicate[];
  risks?: Capability["risk"][];
  through?: string[];
  publishedAt: string;
  calls: number;
  lastPipeline?: string[];
  providers?: string[];
}

export interface RuntimeOptions {
  name?: string;
  region?: string;
  fetch?: FetchLike;
  auth?: Authority;
  timeoutMs?: number;
  directories?: Directory[];
  bindings?: Record<string, unknown>;
  workspace?: string;
  store?: Store;
  /** Outbound network policy. Default: allow everything (local use); servers exposed beyond loopback block private addresses. */
  network?: NetworkPolicy;
}

export interface RunRecord {
  runId: string;
  capability: string;
  provider: string;
  title: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: string;
  startedAt: string;
  durationMs: number;
  verification: { status: "verified" | "refuted" | "unverified"; results: PredicateResult[] };
  receipt: Receipt;
  steps?: string[];
  /** For failed composite runs: the innermost capability that failed. */
  failedCapability?: string;
}

class StepError extends Error {
  capability: string;
  constructor(capability: string, message: string) {
    super(message);
    this.capability = capability;
  }
}

export interface ComposeResult {
  goal: { have: Record<string, SemType>; want: SemType; intent?: string; through?: string[] };
  plans: Array<Plan & { titles: string[] }>;
  executed?: {
    summary: string;
    titles: string[];
    output: unknown;
    status: "completed" | "failed";
    verification: RunRecord["verification"];
    runs: string[];
    /** Failed attempts the runtime routed around before succeeding. */
    attempts: Array<{ summary: string; failed: string; error: string; healing?: string }>;
    durationMs: number;
  };
  crystallized?: { id: string; title: string; newPowers: number };
  /** Present when the goal was published as an endpoint. */
  published?: { slug: string; path: string };
  /** Present when compose had to go and find new capabilities in the world. */
  acquisition?: { topic: string; considered: string[]; learned: Array<{ title: string; kind: string; source: string; capabilities: number; error?: string }> };
}

export interface SourceDrift {
  changed: boolean;
  providersBefore: string[];
  providersAfter: string[];
  added: string[];
  removed: string[];
  modified: string[];
  /** Crystallized pipelines retired because their proof no longer holds. */
  retired: string[];
}

const RUN_BUFFER = 500;

export class RightClick {
  readonly graph = new CapabilityGraph();
  readonly ledger = new Ledger();
  readonly chain = new ReceiptChain();
  readonly runs = new Map<string, RunRecord>();
  readonly net: Net;
  readonly info: RuntimeInfo;
  readonly name: string;
  readonly startedAt = new Date();
  readonly published = new Map<string, PublishedGoal>();
  private directories: Directory[];
  private builtins = new Map<string, BuiltinFn>();
  private platformFns = new Map<string, PlatformFn>();
  private mcpClients = new Map<string, McpClient>();
  private store?: Store;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private runCounter = 0;

  private constructor(opts: RuntimeOptions) {
    this.net = {
      fetch: opts.fetch ?? ((i, init) => fetch(i, init)),
      auth: opts.auth ?? new Authority(),
      timeoutMs: opts.timeoutMs ?? 20_000,
      policy: opts.network,
    };
    this.directories = opts.directories ?? DEFAULT_DIRECTORIES;
    this.info = { ...detectRuntime(), region: opts.region };
    this.name = opts.name ?? "rightclick-x";
    this.store = opts.store;
  }

  static async create(opts: RuntimeOptions = {}): Promise<RightClick> {
    const rc = new RightClick(opts);
    const b = builtinReflection();
    rc.builtins = b.fns;
    rc.graph.add(b.reflection);
    const p = await platformReflection(rc.info, { bindings: opts.bindings, workspace: opts.workspace });
    rc.platformFns = p.fns;
    if (p.reflection.capabilities.length) rc.graph.add(p.reflection);
    const saved = await opts.store?.load().catch(() => null);
    if (saved?.version === 1) {
      for (const r of saved.reflections) rc.graph.add(r);
      rc.ledger.load(saved.ledger);
      rc.chain.restore(saved.receipts ?? []);
      for (const g of saved.published ?? []) rc.published.set(g.slug, g);
    }
    return rc;
  }

  /** Tell the runtime where it is (e.g. Cloudflare's request.cf.colo). */
  observeLocation(region?: string, country?: string): void {
    if (region) this.info.region = region;
    if (country) this.info.country = country;
  }

  // ================================================================ context_runtime

  runtime() {
    const powers = this.graph.powers();
    return {
      product: "RightClick X",
      version: VERSION,
      name: this.name,
      runtime: this.info,
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      graph: { providers: this.graph.providers.size, ...powers },
      runs: this.runs.size,
      receipts: { count: this.chain.receipts.length, head: this.chain.headHash },
      eventCursor: this.graph.cursor,
    };
  }

  // ================================================================ context_research

  async research(opts: { topic?: string; limit?: number; learn?: number } = {}) {
    const census = this.graph.census();
    const produced = new Set(census.filter((c) => c.producers).map((c) => c.type));
    const unfed = census.filter((c) => c.consumers && !produced.has(c.type) && ![...produced].some((p) => distance(c.type, p) === 1));
    const directories: Array<{ id: string; title: string; reachable: boolean; error?: string; candidates: Candidate[] }> = [];
    if (opts.topic) {
      const settled = await Promise.allSettled(this.directories.map((d) => d.search(this.net, opts.topic!, opts.limit ?? 5)));
      settled.forEach((s, i) => {
        const d = this.directories[i];
        directories.push(
          s.status === "fulfilled"
            ? { id: d.id, title: d.title, reachable: true, candidates: s.value }
            : { id: d.id, title: d.title, reachable: false, error: String((s.reason as Error)?.message ?? s.reason), candidates: [] },
        );
      });
    } else {
      for (const d of this.directories) directories.push({ id: d.id, title: d.title, reachable: true, candidates: [] });
    }

    let learned: Awaited<ReturnType<RightClick["learn"]>> | undefined;
    if (opts.learn && opts.topic) {
      const ranked = directories.flatMap((d) => d.candidates).sort((a, b) => b.score - a.score).slice(0, opts.learn);
      if (ranked.length) learned = await this.learn({ sources: ranked.map((c) => c.source) });
    }

    const report = {
      environment: {
        runtime: this.info,
        credentialedOrigins: this.net.auth.origins(),
        platformProviders: [...this.graph.providers.values()].filter((p) => p.source === "platform").map((p) => ({ id: p.id, capabilities: p.capabilityIds.length, meta: p.meta })),
      },
      graph: { providers: this.graph.providers.size, ...this.graph.powers() },
      types: census.slice(0, 30),
      gaps: {
        unfedInputs: unfed.map((u) => u.type),
        hint: unfed.length ? `Learn a source that produces: ${unfed.map((u) => u.type).join(", ")}` : "Every consumed type has a producer.",
      },
      topic: opts.topic,
      directories,
      learned,
    };
    this.graph.emit("research", { topic: opts.topic, candidates: directories.reduce((n, d) => n + d.candidates.length, 0) });
    return report;
  }

  // ================================================================ context_learn

  async learn(opts: { source?: string; sources?: string[]; deep?: boolean; spec?: Reflection; kinds?: Record<string, SourceKind> }) {
    const sources = [...(opts.source ? [opts.source] : []), ...(opts.sources ?? [])];
    // Batch learning measures powers once for the whole batch, not per provider.
    const batchBefore = this.graph.powers().total;
    this.graph.measuring = sources.length <= 3;
    const results: Array<{ source: string; probes: Discovery["probes"]; learned: LearnDelta[]; drift?: SourceDrift; error?: string }> = [];
    if (opts.spec) results.push({ source: opts.spec.provider.origin, probes: [], learned: [this.graph.add(opts.spec)] });
    await Promise.all(
      sources.map(async (source) => {
        try {
          const d = await discover(this.net, source, { deep: opts.deep, mcp: (u) => this.mcp(u), kind: opts.kinds?.[source] });
          // Re-learning a source replaces everything it produced before, even when
          // the provider changed protocol (OpenAPI -> GraphQL -> MCP) and so its id.
          const previous = [...this.graph.providers.values()].filter((p) => p.meta?.source === source);
          const before = new Map(previous.flatMap((p) => p.capabilityIds.map((id) => [id, this.graph.get(id) ? signature(this.graph.get(id)!) : ""] as const)));
          if (!d.reflections.length && previous.length) throw new Error(`no supported contract found at ${source} any more`);
          const ids = new Set(d.reflections.map((r) => r.provider.id));
          const compositesBefore = this.graph.list().filter((c) => c.source === "composite").map((c) => c.id);
          for (const p of previous) if (!ids.has(p.id)) this.graph.forget(p.id);
          const learned = d.reflections.map((r) => this.graph.add({ ...r, provider: { ...r.provider, meta: { ...r.provider.meta, source } } }));
          let drift: SourceDrift | undefined;
          if (previous.length) {
            const after = new Map(learned.flatMap((l) => (this.graph.providers.get(l.provider)?.capabilityIds ?? []).map((id) => [id, signature(this.graph.get(id)!)] as const)));
            drift = {
              changed: false,
              providersBefore: previous.map((p) => p.id),
              providersAfter: [...ids],
              added: [...after.keys()].filter((id) => !before.has(id)),
              removed: [...before.keys()].filter((id) => !after.has(id)),
              modified: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
              retired: compositesBefore.filter((id) => !this.graph.get(id)),
            };
            drift.changed = !!(drift.added.length || drift.removed.length || drift.modified.length);
            if (drift.changed) this.graph.emit("provider.drifted", { source, ...drift });
          }
          results.push({ source, probes: d.probes, learned, drift });
        } catch (e) {
          results.push({ source, probes: [], learned: [], error: String((e as Error).message ?? e) });
        }
      }),
    );
    this.graph.measuring = true;
    this.persist();
    const powers = this.graph.powers();
    return {
      results,
      totalNewCapabilities: results.flatMap((r) => r.learned).reduce((s, l) => s + l.capabilitiesAdded, 0),
      totalNewPowers: powers.total - batchBefore,
      graph: { providers: this.graph.providers.size, ...powers },
    };
  }

  forget(providerId: string) {
    const ok = this.graph.forget(providerId);
    this.persist();
    return { forgotten: ok, graph: this.graph.powers() };
  }

  // ================================================================ context_inspect / actions / explain

  inspect(value: unknown): Inspection {
    return inspectValue(value);
  }

  actions(opts: { value?: unknown; type?: SemType; limit?: number }) {
    const type = opts.type ?? inspectValue(opts.value).type;
    const direct = this.graph
      .list()
      .map((c) => {
        const port = c.inputs.find((p) => p.required && distance(p.type, type) >= 0 && (p.type !== "json" || type === "json"));
        if (!port) return null;
        const otherRequired = c.inputs.filter((p) => p.required && p !== port).map((p) => `${p.name}:${p.type}`);
        return { c, port, d: distance(port.type, type), otherRequired };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.d - b.d || a.otherRequired.length - b.otherRequired.length || this.ledger.cost(a.c.id) - this.ledger.cost(b.c.id));

    // What this value can become through the graph, not just one hop away.
    const reach = new Map<SemType, number>();
    const frontier: Array<{ t: SemType; depth: number }> = [{ t: type, depth: 0 }];
    const seen = new Set([type]);
    while (frontier.length) {
      const { t, depth } = frontier.shift()!;
      if (depth >= 3) continue;
      for (const c of this.graph.consumersOf(t)) {
        for (const o of c.outputs) {
          reach.set(o.type, Math.min(reach.get(o.type) ?? 9, depth + 1));
          if (!seen.has(o.type)) {
            seen.add(o.type);
            frontier.push({ t: o.type, depth: depth + 1 });
          }
        }
      }
    }
    return {
      inspected: opts.value !== undefined ? inspectValue(opts.value) : { type },
      total: direct.length,
      actions: direct.slice(0, opts.limit ?? 25).map(({ c, port, otherRequired }) => ({
        id: c.id,
        title: c.title,
        provider: c.provider,
        source: c.source,
        risk: c.risk,
        bindsAs: port.name,
        needsAlso: otherRequired,
        produces: [...new Set(c.outputs.map((o) => o.type))],
        reliability: Number(this.ledger.reliability(c.id).toFixed(2)),
      })),
      reachableTypes: [...reach].sort((a, b) => a[1] - b[1]).map(([t, steps]) => ({ type: t, steps })),
    };
  }

  explain(id: string) {
    const c = this.graph.get(id) ?? this.graph.search(id, 1)[0]?.capability;
    if (!c) throw new Error(`unknown capability: ${id}`);
    const n = this.graph.neighbors(c.id);
    const example: Record<string, unknown> = {};
    for (const p of c.inputs) if (p.required) example[p.name] = EXAMPLES[p.type] ?? `<${p.type}>`;
    return {
      capability: c,
      provider: this.graph.providers.get(c.provider),
      graph: { feedsFrom: n.upstream.length, feedsInto: n.downstream.length, upstream: n.upstream.slice(0, 10), downstream: n.downstream.slice(0, 10) },
      experience: this.ledger.get(c.id) ?? null,
      reliability: this.ledger.reliability(c.id),
      exampleArgs: example,
    };
  }

  providers() {
    return [...this.graph.providers.values()].map((p) => ({
      id: p.id,
      title: p.title,
      source: p.source,
      origin: p.origin,
      learnedAt: p.learnedAt,
      capabilities: p.capabilityIds.length,
    }));
  }

  // ================================================================ context_run

  async run(id: string, args: Record<string, unknown> = {}, opts: { verify?: Predicate[] } = {}): Promise<RunRecord> {
    const cap = this.graph.get(id);
    if (!cap) throw new Error(`unknown capability: ${id}`);
    const runId = `run_${Date.now().toString(36)}_${(++this.runCounter).toString(36)}`;
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let output: unknown;
    let error: string | undefined;
    let steps: string[] | undefined;
    let failedCapability: string | undefined;
    try {
      const coerced = coerceArgs(cap, args);
      if (cap.invoke.kind === "composite") {
        const r = await this.runSteps(cap.invoke.steps, cap.invoke.result, coerced);
        output = r.output;
        steps = r.runs;
      } else {
        output = await this.execute(cap, coerced);
      }
    } catch (e) {
      error = String((e as Error)?.message ?? e);
      if (e instanceof StepError) failedCapability = e.capability;
    }
    const durationMs = Math.round((performance.now() - t0) * 10) / 10;
    const verification = error ? { status: "refuted" as const, results: [] } : check(output, opts.verify ?? []);
    const ok = !error && verification.status !== "refuted";
    this.ledger.record(cap.id, ok, durationMs, error);
    const receipt = await this.chain.append(
      { runId, capability: cap.id, provider: cap.provider, startedAt, durationMs, status: error ? "failed" : "completed", verification: verification.status },
      args,
      error ?? output,
    );
    const rec: RunRecord = {
      runId,
      capability: cap.id,
      provider: cap.provider,
      title: cap.title,
      status: error ? "failed" : "completed",
      output,
      error,
      startedAt,
      durationMs,
      verification,
      receipt,
      steps,
      failedCapability,
    };
    this.runs.set(runId, rec);
    if (this.runs.size > RUN_BUFFER) this.runs.delete(this.runs.keys().next().value!);
    this.graph.emit("run.completed", { runId, capability: cap.id, title: cap.title, provider: cap.provider, ok, durationMs, verification: verification.status });
    this.persist();
    return rec;
  }

  runStatus(opts: { runId?: string; limit?: number } = {}) {
    if (opts.runId) {
      const r = this.runs.get(opts.runId);
      if (!r) throw new Error(`unknown run: ${opts.runId}`);
      return r;
    }
    return { recent: [...this.runs.values()].slice(-(opts.limit ?? 20)).reverse().map(({ output, ...r }) => ({ ...r, output: preview(output) })) };
  }

  async verifyReceipts() {
    const broken = await ReceiptChain.verify(this.chain.receipts);
    return { count: this.chain.receipts.length, intact: broken === null, brokenAt: broken, head: this.chain.headHash };
  }

  // ================================================================ context_compose

  async compose(opts: {
    have: Record<string, unknown>;
    want: SemType;
    intent?: string;
    run?: boolean;
    verify?: Predicate[];
    maxSteps?: number;
    limit?: number;
    crystallize?: boolean;
    risks?: Capability["risk"][];
    /** Capability ids or search phrases the pipeline must pass through. */
    through?: string[];
    /** If the graph can't do it, research public directories, learn candidates and re-plan. */
    acquire?: boolean;
    /** After a verified run, publish this goal as an API endpoint under this name. */
    publish?: string;
  }): Promise<ComposeResult> {
    const values: Record<string, unknown> = {};
    const types: Record<string, SemType> = {};
    for (const [k, v] of Object.entries(opts.have)) {
      if (v && typeof v === "object" && !Array.isArray(v) && "type" in (v as any) && "value" in (v as any)) {
        types[k] = (v as any).type;
        values[k] = (v as any).value;
        continue;
      }
      const byName = inferType(k, typeof v === "number" ? { type: "number" } : { type: "string" });
      types[k] = byName !== "text" && byName !== "id" ? byName : inspectValue(v).type;
      values[k] = v;
    }
    const through = (opts.through ?? []).map((t) => (this.graph.get(t) ? t : this.graph.search(t, 1)[0]?.capability.id)).filter((x): x is string => !!x);
    const goal = { have: types, want: opts.want, intent: opts.intent, maxSteps: opts.maxSteps, limit: opts.limit ?? 5, risks: opts.risks, through };
    let plans = plan(this.graph, this.ledger, goal);
    const titles = (p: Plan) => p.steps.map((s) => this.graph.get(s.capability)!.title);
    const result: ComposeResult = {
      goal: { have: types, want: opts.want, intent: opts.intent, through },
      plans: plans.map((p) => ({ ...p, titles: titles(p) })),
    };

    // Acquisition on demand: nothing in the graph can do this yet, so go and
    // find something in the world that can, learn it, and plan again.
    let candidates: Candidate[] | null = null;
    const acquireMore = async (): Promise<boolean> => {
      if (!opts.acquire) return false;
      if (!candidates) {
        const topic = [opts.intent ?? "", opts.want].join(" ").trim();
        const r = await this.research({ topic, limit: 6 });
        // Interleave directories so one noisy source can't crowd out the other.
        const lists = r.directories.map((d) => d.candidates);
        candidates = [];
        for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) candidates.push(l[i]);
        result.acquisition = { topic, considered: candidates.map((c) => `${c.title} (${c.kind})`), learned: [] };
      }
      const batch = candidates.splice(0, 3);
      if (!batch.length) return false;
      const l = await this.learn({ sources: batch.map((c) => c.source), kinds: Object.fromEntries(batch.map((c) => [c.source, c.kind])) });
      for (const c of batch) {
        const res = l.results.find((x) => x.source === c.source);
        result.acquisition!.learned.push({ title: c.title, kind: c.kind, source: c.source, capabilities: res?.learned.reduce((n, d) => n + d.capabilitiesAdded, 0) ?? 0, error: res?.error });
      }
      plans = plan(this.graph, this.ledger, goal);
      result.plans = plans.map((p) => ({ ...p, titles: titles(p) }));
      return true;
    };
    // Acquire when nothing can do it, or when the best plan covers too little of the intent
    // (a builtin that merely echoes text is not "a Wikipedia summary").
    const intentTerms = new Set(tokenize(opts.intent ?? "")).size;
    const covered = () => plans[0]?.intentScore ?? 0;
    const enough = () => plans.length > 0 && (!intentTerms || covered() >= Math.ceil(intentTerms * 0.75));
    for (let round = 0; !enough() && round < 3; round++) if (!(await acquireMore())) break;
    if (!opts.run || !plans.length) return result;

    // Self-healing execution: when a step fails, route around that capability
    // (and every crystallized pipeline containing it) and re-plan.
    const attempts: Array<{ summary: string; failed: string; error: string; healing?: string }> = [];
    const exclude = new Set<string>();
    const refreshed = new Set<string>();
    const t0 = performance.now();
    for (let attempt = 0; attempt < 6 && plans.length; attempt++) {
      const p = plans[0];
      try {
        const r = await this.runSteps(p.steps, p.result, values);
        const verification = check(r.output, opts.verify ?? []);
        if (verification.status === "refuted") throw new StepError(p.steps[p.steps.length - 1].capability, `verification refuted: ${JSON.stringify(verification.results.filter((x) => !x.ok))}`);
        result.executed = {
          summary: p.summary,
          titles: titles(p),
          output: r.output,
          status: "completed",
          verification,
          runs: r.runs,
          attempts,
          durationMs: Math.round(performance.now() - t0),
        };
        if (opts.crystallize !== false && p.steps.length > 1) result.crystallized = await this.crystallize(p, types, opts.intent);
        if (opts.publish) {
          const slug = slugify(opts.publish);
          this.published.set(slug, {
            slug,
            title: opts.publish,
            have: types,
            want: opts.want,
            intent: opts.intent,
            verify: opts.verify,
            risks: opts.risks,
            through: opts.through,
            publishedAt: new Date().toISOString(),
            calls: 0,
            lastPipeline: titles(p),
            providers: [...new Set(p.steps.map((st) => this.graph.get(st.capability)!.provider))],
          });
          result.published = { slug, path: `/x/${slug}` };
          this.graph.emit("goal.published", { slug, title: opts.publish, pipeline: titles(p) });
          this.persist();
        }
        return result;
      } catch (e) {
        const failed = e instanceof StepError ? e.capability : p.steps[0].capability;
        const attempt: { summary: string; failed: string; error: string; healing?: string } = { summary: p.summary, failed, error: String((e as Error)?.message ?? e) };
        attempts.push(attempt);
        // Self-maintenance: the provider may have changed its API. Re-reflect its
        // source once; if the contract drifted, the graph now describes the new
        // API and stale crystallized pipelines are retired, so just re-plan.
        const source = this.graph.providers.get(this.graph.get(failed)?.provider ?? "")?.meta?.source as string | undefined;
        let drifted = false;
        if (source && !refreshed.has(source) && !(e instanceof StepError && /verification refuted/.test(attempt.error))) {
          refreshed.add(source);
          const r = await this.learn({ source, deep: true });
          const d = r.results[0]?.drift;
          drifted = !!d?.changed;
          attempt.healing = r.results[0]?.error
            ? `re-reflected ${source}: ${r.results[0].error}`
            : drifted
              ? `API drift at ${source}: ${d!.providersBefore.join(",")} → ${d!.providersAfter.join(",")}; +${d!.added.length} −${d!.removed.length} ~${d!.modified.length} capabilities; ${d!.retired.length} pipeline(s) retired`
              : `re-reflected ${source}: no contract change`;
        }
        if (!drifted) {
          exclude.add(failed);
          // A crystallized pipeline in a failed plan is suspect as a whole.
          for (const s of p.steps) if (this.graph.get(s.capability)?.invoke.kind === "composite") exclude.add(s.capability);
        }
        plans = plan(this.graph, this.ledger, { ...goal, exclude });
        if (!plans.length && (await acquireMore())) plans = plan(this.graph, this.ledger, { ...goal, exclude });
      }
    }
    result.executed = {
      summary: "no working pipeline",
      titles: [],
      output: null,
      status: "failed",
      verification: { status: "refuted", results: [] },
      runs: [],
      attempts,
      durationMs: Math.round(performance.now() - t0),
    };
    return result;
  }

  /** Serve a published goal: fixed contract, implementation re-derived from the live graph. */
  async callPublished(slug: string, args: Record<string, unknown>) {
    const g = this.published.get(slug);
    if (!g) throw new Error(`no published goal: ${slug}`);
    const missing = Object.keys(g.have).filter((k) => args[k] === undefined || args[k] === "");
    if (missing.length) throw new Error(`missing parameter(s): ${missing.join(", ")}`);
    const have: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(g.have)) {
      const raw = args[k];
      const value = (t === "number" || t.startsWith("geo.")) && typeof raw === "string" ? Number(raw) : raw;
      have[k] = { type: t, value };
    }
    const r = await this.compose({ have, want: g.want, intent: g.intent, verify: g.verify, risks: g.risks, through: g.through, run: true });
    g.calls++;
    if (r.executed?.status === "completed") {
      g.lastPipeline = r.executed.titles;
      g.providers = [...new Set(r.executed.runs.map((id) => this.runs.get(id)?.provider).filter((x): x is string => !!x))];
    }
    this.persist();
    return {
      ok: r.executed?.status === "completed",
      result: r.executed?.output ?? null,
      pipeline: r.executed?.titles ?? [],
      verification: r.executed?.verification.status ?? "refuted",
      healed: r.executed?.attempts.length ?? 0,
      receipt: this.chain.headHash,
      error: r.executed?.status === "completed" ? undefined : (r.executed?.attempts.map((a) => a.error).join("; ") || "no pipeline found"),
    };
  }

  /** The API this instance has synthesized: one OpenAPI operation per published goal. */
  openApi(baseUrl: string) {
    const paths: Record<string, unknown> = {};
    for (const g of this.published.values()) {
      paths[`/x/${g.slug}`] = {
        get: {
          operationId: camel(g.slug),
          summary: g.title,
          description: `Synthesized by RightClick X from a goal (${g.intent ?? g.want}), not from code. Current pipeline: ${(g.lastPipeline ?? []).join(" → ")}. Providers: ${(g.providers ?? []).join(", ")}. The contract is stable; the pipeline is re-derived from the live capability graph on every call.`,
          parameters: Object.entries(g.have).map(([name, t]) => ({ name, in: "query", required: true, schema: { ...jsonSchemaFor(t), "x-rightclick-type": t } })),
          responses: {
            "200": {
              description: "Result of the goal",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      result: { ...jsonSchemaFor(g.want), "x-rightclick-type": g.want },
                      pipeline: { type: "array", items: { type: "string" } },
                      verification: { type: "string", enum: ["verified", "refuted", "unverified"] },
                      receipt: { type: "string", description: "Head of this instance's receipt hash chain" },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
    return {
      openapi: "3.1.0",
      info: {
        title: `${this.name}`,
        version: VERSION,
        description: `An API synthesized by RightClick X. Every operation is a published goal executed over a live, self-maintaining capability graph.`,
      },
      servers: [{ url: baseUrl }],
      paths,
    };
  }

  /** Turn a proven pipeline into a first-class capability. Powers compound. */
  private async crystallize(p: Plan, types: Record<string, SemType>, intent?: string) {
    const id = `composite:${(await sha256(p.steps.map((s) => s.capability).join(">") + p.result)).slice(0, 12)}`;
    if (this.graph.get(id)) return { id, title: this.graph.get(id)!.title, newPowers: 0 };
    const usedInputs = new Set(p.steps.flatMap((s) => s.bindings.map((b) => b.from)).filter((f) => f.startsWith("$in.")).map((f) => f.slice(4)));
    const stepCaps = p.steps.map((s) => this.graph.get(s.capability)!);
    const title = `${intent ? intent.charAt(0).toUpperCase() + intent.slice(1) + ": " : ""}${stepCaps.map((c) => c.title).join(" → ")}`;
    const cap: Capability = {
      id,
      title,
      description: `Crystallized pipeline across ${new Set(stepCaps.map((c) => c.provider)).size} providers, proven by a successful run.`,
      provider: "composite:crystallized",
      source: "composite",
      inputs: [...usedInputs].map((n) => ({ name: n, type: types[n], required: true })),
      outputs: [{ name: "", type: p.resultType, required: true }],
      risk: stepCaps.some((c) => c.risk === "destructive") ? "destructive" : stepCaps.some((c) => c.risk === "write") ? "write" : stepCaps.some((c) => c.risk === "external") ? "external" : "read",
      tags: [...new Set([...(intent ? intent.split(/\s+/) : []), "composite", "crystallized", ...stepCaps.flatMap((c) => c.tags)])].slice(0, 30),
      invoke: { kind: "composite", steps: p.steps, result: p.result, signatures: stepCaps.map(signature) },
    };
    const delta = this.graph.addCapability(cap, {
      id: "composite:crystallized",
      title: "Crystallized pipelines",
      source: "composite",
      origin: this.name,
      learnedAt: new Date().toISOString(),
    });
    // A crystallized pipeline starts with the track record of its proof run.
    this.ledger.record(id, true, 0);
    this.graph.emit("capability.crystallized", { id, title, steps: p.steps.length, newPowers: delta.newPowers });
    this.persist();
    return { id, title, newPowers: delta.newPowers };
  }

  private async runSteps(steps: PlanStep[], resultRef: string, inputs: Record<string, unknown>) {
    const outputs: unknown[] = [];
    const runs: string[] = [];
    const resolve = (ref: string) => {
      if (ref.startsWith("$in.")) return inputs[ref.slice(4)];
      const m = /^(\d+)\.?(.*)$/.exec(ref)!;
      return pick(outputs[Number(m[1])], m[2] || undefined);
    };
    for (const step of steps) {
      const args: Record<string, unknown> = {};
      for (const b of step.bindings) args[b.port] = resolve(b.from);
      const r = await this.run(step.capability, args);
      runs.push(r.runId);
      if (r.status === "failed") throw new StepError(r.failedCapability ?? step.capability, `${step.capability}: ${r.error}`);
      outputs.push(r.output);
    }
    return { output: resolve(resultRef), runs };
  }

  // ================================================================ context_graph / watch

  graphQuery(opts: { op: string; id?: string; query?: string; from?: SemType; to?: SemType; limit?: number }) {
    switch (opts.op) {
      case "stats":
        return { providers: this.graph.providers.size, ...this.graph.powers() };
      case "types":
        return this.graph.census();
      case "search":
        return this.graph.search(opts.query ?? "", opts.limit ?? 10).map(({ capability: c, score }) => ({ id: c.id, title: c.title, provider: c.provider, source: c.source, score: Number(score.toFixed(3)) }));
      case "neighbors":
        if (!opts.id) throw new Error("neighbors needs id");
        return this.graph.neighbors(opts.id);
      case "paths":
        if (!opts.from || !opts.to) throw new Error("paths needs from and to types");
        return plan(this.graph, this.ledger, { have: { input: opts.from }, want: opts.to, limit: opts.limit ?? 10 }).map((p) => ({ summary: p.summary, steps: p.steps.length, providers: p.providers, cost: Number(p.cost.toFixed(2)) }));
      case "export":
        return this.exportGraph();
      case "edges":
        return this.graph.sampleEdges(opts.limit ?? 2000);
      default:
        throw new Error(`unknown graph op: ${opts.op} (stats|types|search|neighbors|paths|export|edges)`);
    }
  }

  exportGraph() {
    return { name: this.name, region: this.info.region, version: VERSION, capabilities: this.graph.list() };
  }

  async watch(opts: { since?: number; waitMs?: number } = {}): Promise<{ cursor: number; events: GraphEvent[] }> {
    const since = opts.since ?? 0;
    let events = this.graph.since(since);
    if (!events.length && opts.waitMs) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(opts.waitMs!, 60_000));
        const off = this.graph.subscribe(done);
        function done() {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
      events = this.graph.since(since);
    }
    return { cursor: this.graph.cursor, events };
  }

  // ================================================================ execution

  mcp(endpoint: string): McpClient {
    let c = this.mcpClients.get(endpoint);
    if (!c) this.mcpClients.set(endpoint, (c = new McpClient(endpoint, this.net)));
    return c;
  }

  private async execute(cap: Capability, args: Record<string, unknown>): Promise<unknown> {
    const inv = cap.invoke;
    switch (inv.kind) {
      case "builtin": {
        const fn = this.builtins.get(inv.fn);
        if (!fn) throw new Error(`builtin missing: ${inv.fn}`);
        return fn(args as Record<string, any>, this.net);
      }
      case "platform": {
        const fn = this.platformFns.get(inv.fn);
        if (!fn) throw new Error(`platform capability not available on ${this.info.name}: ${inv.fn}`);
        return fn(args as Record<string, any>);
      }
      case "http": {
        let url = inv.url;
        for (const p of inv.pathParams) {
          const raw = String(args[p] ?? "");
          const enc = inv.multiSegment?.includes(p) ? raw.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(raw);
          url = url.replace(`{${p}}`, enc);
        }
        const u = new URL(url);
        const constants = inv.constants ?? {};
        for (const q of inv.queryParams) {
          const v = args[q];
          if (v === undefined || v === null || v === "") continue;
          if (Array.isArray(v)) for (const x of v) u.searchParams.append(q, String(x));
          else u.searchParams.set(q, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
        if (inv.method === "GET") for (const [k, v] of Object.entries(constants)) u.searchParams.set(k, v);
        const headers: Record<string, string> = { accept: "application/json, text/html;q=0.9, */*;q=0.5" };
        for (const h of inv.headerParams) if (args[h] != null) headers[h] = String(args[h]);
        let body: string | undefined;
        if (inv.body === "json") {
          headers["content-type"] = "application/json";
          body = JSON.stringify(Object.fromEntries(inv.bodyParams.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])));
        } else if (inv.body === "raw") {
          headers["content-type"] = "application/json";
          body = typeof args.body === "string" ? args.body : JSON.stringify(args.body ?? null);
        } else if (inv.body === "form") {
          headers["content-type"] = "application/x-www-form-urlencoded";
          const f = new URLSearchParams(constants);
          for (const k of inv.bodyParams) if (args[k] != null) f.set(k, String(args[k]));
          body = f.toString();
        }
        const res = await request(this.net, u.toString(), { method: inv.method, headers, body });
        const out = await readBody(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(JSON.stringify(preview(out))).slice(0, 300)}`);
        return out;
      }
      case "graphql": {
        const provided = Object.keys(args).filter((k) => args[k] !== undefined);
        const variables: Record<string, unknown> = {};
        for (const k of provided) {
          const t = inv.args[k] ?? "";
          variables[k] = /^(Int|Float)!?$/.test(t) ? Number(args[k]) : args[k];
        }
        const res = await request(this.net, inv.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: buildDocument(inv, provided), variables }),
        });
        const j: any = await readBody(res);
        if (!res.ok || (j?.errors?.length && !j?.data?.[inv.field])) throw new Error(`GraphQL: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
        return j.data[inv.field];
      }
      case "mcp":
        return this.mcp(inv.endpoint).call(inv.tool, args, cap.outputs.some((o) => o.name !== ""));
      case "peer": {
        const res = await request(this.net, `${inv.endpoint}/api/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: inv.id, args }),
        });
        const j: any = await readBody(res);
        if (!res.ok || j?.status === "failed") throw new Error(`peer: ${j?.error ?? res.status}`);
        return j.output;
      }
      case "composite":
        throw new Error("composite capabilities run through run()");
    }
  }

  // ================================================================ persistence

  private persist(): void {
    if (!this.store || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 50);
  }

  async flush(): Promise<void> {
    if (!this.store) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const reflections: Reflection[] = [...this.graph.providers.values()]
      .filter((p) => p.source !== "builtin" && p.source !== "platform")
      .map((p) => ({ provider: p, capabilities: p.capabilityIds.map((id) => this.graph.get(id)!).filter(Boolean) }));
    await this.store.save({ version: 1, reflections, ledger: this.ledger.toJSON(), receipts: this.chain.receipts.slice(-300), published: [...this.published.values()] });
  }
}

const EXAMPLES: Record<string, unknown> = {
  url: "https://example.com",
  text: "Hello world",
  language: "es",
  place: "Lisbon",
  country: "PT",
  email: "someone@example.com",
  number: 1,
  "geo.lat": 38.72,
  "geo.lon": -9.14,
  domain: "example.com",
  datetime: "2026-10-15T12:00:00Z",
};

function coerceArgs(cap: Capability, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const p of cap.inputs) {
    const v = out[p.name];
    if (v === undefined) continue;
    if ((p.type === "number" || p.type.startsWith("geo.")) && typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) out[p.name] = Number(v);
    if (p.type === "boolean" && typeof v === "string") out[p.name] = v === "true";
  }
  const missing = cap.inputs.filter((p) => p.required && (out[p.name] === undefined || out[p.name] === null)).map((p) => p.name);
  if (missing.length) throw new Error(`missing required input(s): ${missing.join(", ")}`);
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "goal";
}

function camel(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function jsonSchemaFor(t: SemType): Record<string, unknown> {
  if (t === "number" || t.startsWith("geo.")) return { type: "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t === "json") return {};
  if (t.startsWith("list:")) return { type: "array", items: jsonSchemaFor(t.slice(5)) };
  if (t === "url" || t === "image.url") return { type: "string", format: "uri" };
  if (t === "email") return { type: "string", format: "email" };
  if (t === "datetime") return { type: "string", format: "date-time" };
  return { type: "string" };
}

export function preview(v: unknown, n = 300): unknown {
  if (typeof v === "string") return v.length > n ? v.slice(0, n) + "…" : v;
  const s = JSON.stringify(v);
  if (s && s.length > n * 4) return s.slice(0, n * 4) + "…";
  return v;
}
