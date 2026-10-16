// RightClick X runtime: one object that owns the live graph and implements
// the whole context_* family. Every interface (MCP, HTTP API, CLI, dashboard,
// federation) is a thin shell around this class.

import { CapabilityGraph, signature, tokenize, type GraphEvent, type LearnDelta } from "./core/graph.ts";
import { Ledger, ReceiptChain, sha256, type Receipt } from "./core/ledger.ts";
import { shapeOf, type IdentityState } from "./core/identities.ts";
import { egressOf, plan, type Plan } from "./core/planner.ts";
import { distance, inferType, inspectValue, type Inspection } from "./core/semantics.ts";
import type { Capability, CapabilityAnchor, FetchLike, PlanStep, Reflection, SemType } from "./core/types.ts";
import { check, pick, type Predicate, type PredicateResult, type OutcomeWitness, type WitnessResult } from "./core/verify.ts";
import { builtinReflection, type BuiltinFn } from "./reflectors/builtins.ts";
import { DEFAULT_DIRECTORIES, type Candidate, type Directory } from "./reflectors/directories.ts";
import { discover, type Discovery, type SourceKind } from "./reflectors/discover.ts";
import { buildDocument, checkSelection } from "./reflectors/graphql.ts";
import { McpClient } from "./reflectors/mcp.ts";
import { Authority, readBody, request, type Net, type NetworkPolicy } from "./reflectors/net.ts";
import { detectRuntime, platformReflection, type PlatformFn, type RuntimeInfo } from "./reflectors/platform.ts";

export const VERSION = "0.1.0";
/** Bump whenever semantic inference changes: persisted reflections are then re-derived from their sources. */
export const SEMANTICS = 13;

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
  /** Credential fingerprints per origin when this state was saved (never the credentials). */
  authFingerprints?: Record<string, string>;
  /** Semantic-inference version the reflections were typed with. */
  semantics?: number;
  /** Identifier-scheme evidence learned from observed values (core/identities.ts). */
  identities?: IdentityState;
  /** Capability ids that changed meaning on re-learning and are not yet acknowledged. */
  meaningChanges?: MeaningChange[];
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
  witnesses?: OutcomeWitness[];
  /** Inputs pinned when the goal was published; part of the goal, not parameters of its API. */
  fixed?: Record<string, unknown>;
  /** The customer's egress policy: origins this goal may send data to, in every run and repair. */
  origins?: string[];
  risks?: Capability["risk"][];
  through?: string[];
  anchors?: CapabilityAnchor[];
  maxSteps?: number;
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
  /** Destructive capabilities need `confirm: true` from the caller ("confirm", default) or run directly ("allow"). */
  destructive?: "confirm" | "allow";
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
  witnesses?: WitnessResult[];
  attempts?: Array<{ summary: string; failed: string; error: string; healing?: string }>;
  /** A failed run of a learned operation: what re-reading its contract found, and what was retried. */
  healing?: { source: string; error: string; note: string; drift?: SourceDrift; retried?: string };
  /** The id now invokes a different operation than before re-learning. */
  changedMeaning?: MeaningChange;
}

export class ConfirmationRequired extends Error {
  capability: string;
  constructor(capability: string, title: string) {
    super(`"${title}" (${capability}) is destructive: call again with confirm: true to run it`);
    this.capability = capability;
  }
}

class StepError extends Error {
  capability: string;
  constructor(capability: string, message: string) {
    super(message);
    this.capability = capability;
  }
}

/** A fan-out step refused before any call: its list is longer than the cap. The provider did nothing wrong. */
class FanOutRefused extends StepError {}

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
    witnesses?: WitnessResult[];
    /** Steps that ran once per list item: how many items the list had, how many ran, how many did not fit the scheme's shapes. */
    fanOuts?: FanOutReport[];
  };
  crystallized?: { id: string; title: string; newPowers: number };
  /** Present when the goal was published as an endpoint. */
  published?: { id: string; slug: string; path: string };
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
  /** Modified ids that now invoke a different operation (not just a moved or reshaped one). */
  changedMeaning?: string[];
}

/** A capability id that re-learning pointed at a different operation. */
export interface MeaningChange {
  id: string;
  source: string;
  at: string;
  /** What the id invoked before and invokes now, e.g. "GET /items/{}/children". */
  before: string;
  after: string;
  /** The one capability that now carries the operation this id used to name, if there is one. */
  successor?: string;
}

/**
 * What a learned capability invokes, independent of where the API is served
 * and which release of it: method and full path (host, parameter names and
 * whole version segments such as v1 or 2.1 left out), GraphQL operation and
 * field, or MCP tool, plus its risk. Contracts split one path between their
 * server base and their paths differently from release to release, so the
 * base is not used. Ids with the same key call the same operation; an id
 * whose key changes now calls a different one.
 */
function operationOf(c: Capability): string | undefined {
  const inv = c.invoke;
  let op: string;
  if (inv.kind === "http") {
    const path = inv.url
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "")
      .replace(/[?#].*$/, "")
      .split("/")
      .filter((seg) => seg && !(/^v?\d+(?:\.\d+)*$/i.test(seg) && /^v|\./i.test(seg)))
      .map((seg) => (/^\{[^}]*\}$/.test(seg) ? "{}" : seg))
      .join("/");
    op = `${inv.method.toUpperCase()} /${path}`;
  } else if (inv.kind === "graphql") op = `${inv.operation} ${inv.field}`;
  else if (inv.kind === "mcp") op = `tool ${inv.tool}`;
  else return undefined;
  return c.risk === "read" ? op : `${op} (${c.risk})`;
}

const HEALABLE = new Set(["http", "graphql", "mcp"]);
/** A failed plain run re-reads a contract at most this often (transient 5xx, timeouts and rate limits repeat). */
const HEAL_REREAD_MS = 60_000;

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
  /** When a failed plain run last re-read each contract source, so repeated failures do not re-read it on every call. */
  private healReads = new Map<string, number>();
  /** Ids re-learning pointed at a different operation; id-addressed runs refuse them until acknowledged. */
  readonly meaningChanges = new Map<string, MeaningChange>();
  /** Optional sink for an audit log of MCP tool calls (set by hosts, e.g. RCX_MCP_LOG). */
  toolCallSink?: (entry: { at: string; tool: string; args: unknown; ok: boolean; ms: number; error?: string }) => void;
  private directories: Directory[];
  private builtins = new Map<string, BuiltinFn>();
  private platformFns = new Map<string, PlatformFn>();
  private mcpClients = new Map<string, McpClient>();
  private store?: Store;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private runCounter = 0;
  private destructivePolicy: "confirm" | "allow" = "confirm";

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
    rc.destructivePolicy = opts.destructive ?? "confirm";
    rc.graph.add(b.reflection);
    const p = await platformReflection(rc.info, { bindings: opts.bindings, workspace: opts.workspace });
    rc.platformFns = p.fns;
    if (p.reflection.capabilities.length) rc.graph.add(p.reflection);
    const saved = await opts.store?.load().catch(() => null);
    if (saved?.version === 1) {
      const stale = saved.semantics !== SEMANTICS;
      rc.graph.identities.load(saved.identities);
      for (const r of saved.reflections) rc.graph.add(r);
      rc.ledger.load(saved.ledger);
      rc.chain.restore(saved.receipts ?? []);
      for (const g of saved.published ?? []) {
        rc.published.set(g.slug, g);
        rc.registerGoal(g);
      }
      for (const m of saved.meaningChanges ?? []) if (rc.graph.get(m.id)) rc.meaningChanges.set(m.id, m);
      // Credentials changed for an origin: its past auth and rate-limit failures no longer apply.
      const now = await rc.net.auth.fingerprints();
      const changed = new Set(Object.keys(now).filter((o) => saved.authFingerprints?.[o] !== now[o]));
      for (const o of Object.keys(saved.authFingerprints ?? {})) if (!(o in now)) changed.add(o);
      if (changed.size) {
        const originOf = (id: string) => {
          const inv = rc.graph.get(id)?.invoke as any;
          try {
            return new URL(inv?.url ?? inv?.endpoint ?? "").origin;
          } catch {
            return "";
          }
        };
        rc.ledger.forgive((id, e) => changed.has(originOf(id)) && /\b(401|403|429)\b|rate limit/i.test(e.lastError ?? ""));
      }
      // Reflections typed by older inference rules are re-derived from their sources,
      // one targeted probe each (the kind is known), so upgrades reach persisted graphs.
      if (stale) {
        const kinds: Record<string, SourceKind> = {};
        for (const p of rc.graph.providers.values()) {
          if (["openapi", "graphql", "mcp", "web", "peer"].includes(p.source)) kinds[(p.meta?.source as string | undefined) ?? p.origin] = p.source as SourceKind;
        }
        if (Object.keys(kinds).length) await rc.learn({ sources: Object.keys(kinds), kinds });
        rc.persist();
      }
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
      memoryMB: typeof (globalThis as any).process?.memoryUsage === "function" ? Math.round((globalThis as any).process.memoryUsage().rss / 1e6) : undefined,
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

  async learn(opts: { source?: string; sources?: string[]; deep?: boolean; spec?: Reflection; kinds?: Record<string, SourceKind>; net?: Net }) {
    const sources = [...(opts.source ? [opts.source] : []), ...(opts.sources ?? [])];
    // Batch learning measures powers once for the whole batch, not per provider.
    const batchBefore = this.graph.powers().total;
    this.graph.measuring = sources.length <= 3;
    const results: Array<{ source: string; probes: Discovery["probes"]; learned: LearnDelta[]; drift?: SourceDrift; withdrawn?: string[]; error?: string }> = [];
    if (opts.spec) results.push({ source: opts.spec.provider.origin, probes: [], learned: [this.graph.add(opts.spec)] });
    await Promise.all(
      sources.map(async (source) => {
        try {
          const net = opts.net ?? this.net;
          const d = await discover(net, source, { deep: opts.deep, mcp: (u) => this.mcp(u, net), kind: opts.kinds?.[source] });
          // Re-learning a source replaces everything it produced before, even when
          // the provider changed protocol (OpenAPI -> GraphQL -> MCP) and so its id.
          const previous = [...this.graph.providers.values()].filter((p) => p.meta?.source === source);
          const before = new Map(previous.flatMap((p) => p.capabilityIds.map((id) => [id, this.graph.get(id) ? signature(this.graph.get(id)!) : ""] as const)));
          const operationsBefore = new Map(previous.flatMap((p) => p.capabilityIds.map((id) => [id, this.graph.get(id) ? operationOf(this.graph.get(id)!) : undefined] as const)));
          if (!d.reflections.length && previous.length) {
            // The provider is gone: withdraw what it offered and retire anything built on it.
            const compositesBefore = this.graph.list().filter((c) => c.source === "composite").map((c) => c.id);
            const removed = previous.flatMap((p) => p.capabilityIds);
            for (const p of previous) this.graph.forget(p.id);
            const drift: SourceDrift = {
              changed: true,
              providersBefore: previous.map((p) => p.id),
              providersAfter: [],
              added: [],
              removed,
              modified: [],
              retired: compositesBefore.filter((id) => !this.graph.get(id)),
            };
            this.graph.emit("provider.withdrawn", { source, providers: drift.providersBefore, capabilities: removed.length, retired: drift.retired });
            results.push({ source, probes: d.probes, learned: [], drift, withdrawn: drift.providersBefore });
            return;
          }
          d.reflections = d.reflections.map((r) => this.distinctIdentity(r, source));
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
            drift.changedMeaning = this.noteMeaningChanges(source, drift.modified, operationsBefore);
            if (drift.changed) this.graph.emit("provider.drifted", { source, ...drift });
          }
          results.push({ source, probes: d.probes, learned, drift });
        } catch (e) {
          results.push({ source, probes: [], learned: [], error: String((e as Error).message ?? e) });
        }
      }),
    );
    this.graph.measuring = true;
    for (const id of this.meaningChanges.keys()) if (!this.graph.get(id)) this.meaningChanges.delete(id);
    this.persist();
    const powers = this.graph.powers();
    return {
      results,
      totalNewCapabilities: results.flatMap((r) => r.learned).reduce((s, l) => s + l.capabilitiesAdded, 0),
      totalNewPowers: powers.total - batchBefore,
      graph: { providers: this.graph.providers.size, ...powers },
    };
  }

  /**
   * A modified id may still call the same operation (moved base, new optional
   * parameter) or a different one (an operationId reassigned between releases).
   * The second kind is recorded so an id-addressed run cannot follow it
   * silently; the change is measured against what callers last saw.
   */
  private noteMeaningChanges(source: string, modified: string[], operationsBefore: Map<string, string | undefined>): string[] {
    const fromSource = this.graph.list().filter((c) => this.graph.providers.get(c.provider)?.meta?.source === source);
    const changed: string[] = [];
    for (const id of modified) {
      const now = this.graph.get(id)!;
      const after = operationOf(now);
      const seen = this.meaningChanges.get(id)?.before ?? operationsBefore.get(id);
      if (!seen || !after || seen === after) {
        this.meaningChanges.delete(id);
        continue;
      }
      changed.push(id);
      const successors = fromSource.filter((c) => c.id !== id && operationOf(c) === seen);
      this.meaningChanges.set(id, { id, source, at: new Date().toISOString(), before: seen, after, ...(successors.length === 1 ? { successor: successors[0].id } : {}) });
    }
    return changed;
  }

  /**
   * Provider ids come from what a source calls itself ("openapi:polyglot").
   * Two different sources with the same name must not overwrite each other, so
   * a name already held by another source is qualified with this source's host.
   */
  private distinctIdentity(r: Reflection, source: string): Reflection {
    const holder = (id: string) => this.graph.providers.get(id);
    const ownedElsewhere = (id: string) => {
      const p = holder(id);
      return !!p && (p.meta?.source as string | undefined) !== source;
    };
    if (!ownedElsewhere(r.provider.id)) return r;
    const host = new URL(source).host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let id = `${r.provider.id}@${host}`;
    for (let n = 2; ownedElsewhere(id); n++) id = `${r.provider.id}@${host}-${n}`;
    const old = r.provider.id;
    const rename = (cid: string) => (cid.startsWith(`${old}:`) ? `${id}:${cid.slice(old.length + 1)}` : cid);
    return {
      provider: { ...r.provider, id, capabilityIds: r.provider.capabilityIds.map(rename) },
      capabilities: r.capabilities.map((c) => ({ ...c, id: rename(c.id), provider: id })),
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

  async run(
    id: string,
    args: Record<string, unknown> = {},
    opts: {
      verify?: Predicate[];
      confirm?: boolean;
      /** Run an id that re-learning pointed at a different operation, having seen the change. */
      acknowledgeChange?: boolean;
      activeGoals?: string[];
      net?: Net;
      /** Internal: a plan step or pinned witness. Its caller chose it by current contract and does its own repair. */
      planned?: boolean;
    } = {},
  ): Promise<RunRecord> {
    const cap = this.graph.get(id);
    if (!cap) throw new Error(`unknown capability: ${id}`);
    // Destructive effects keep the user's authority: they need an explicit confirmation.
    if (cap.risk === "destructive" && this.destructivePolicy === "confirm" && !opts.confirm) {
      throw new ConfirmationRequired(cap.id, cap.title);
    }
    // An id the caller chose for what it used to do must not quietly do something else.
    const change = opts.planned ? undefined : this.meaningChanges.get(cap.id);
    const refused = change && !opts.acknowledgeChange
      ? `${cap.id} changed meaning when ${change.source} was re-learned (${change.at}): it called ${change.before}, it now calls ${change.after}. Not run.${change.successor ? ` The operation it used to call is now ${change.successor}.` : ""} Call again with acknowledgeChange: true to run the new operation.`
      : undefined;
    if (change && !refused) this.meaningChanges.delete(cap.id);
    const runId = `run_${Date.now().toString(36)}_${(++this.runCounter).toString(36)}`;
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let output: unknown;
    let error: string | undefined;
    let steps: string[] | undefined;
    let failedCapability: string | undefined;
    let verification: RunRecord["verification"] = { status: "unverified", results: [] };
    let witnesses: WitnessResult[] = [];
    let attempts: RunRecord["attempts"];
    let healing: RunRecord["healing"];
    try {
      if (refused) throw new Error(refused);
      const coerced = coerceArgs(cap, args);
      if (cap.invoke.kind === "goal") {
        const r = await this.executeGoal(cap.invoke.slug, coerced, opts.confirm, opts.activeGoals);
        output = r.executed?.output;
        steps = r.executed?.runs;
        witnesses = r.executed?.witnesses ?? [];
        attempts = r.executed?.attempts;
        verification = r.executed?.verification ?? { status: "refuted", results: [] };
        if (r.executed?.status !== "completed") throw new Error(attempts?.map((a) => a.error).join("; ") || "no pipeline found for saved goal");
      } else if (cap.invoke.kind === "composite") {
        const r = await this.runSteps(cap.invoke.steps, cap.invoke.result, coerced, opts.confirm, opts.activeGoals, opts.net);
        output = r.output;
        steps = r.runs;
        verification = check(output, cap.invoke.verify ?? []);
        if (verification.status === "refuted") throw new Error("stored verification refuted");
        witnesses = await this.checkWitnesses(cap.invoke.witnesses ?? [], coerced, output, r.runs, opts.net);
        if (witnesses.some((w) => w.status !== "completed")) throw new Error("independent outcome witness refuted: " + witnesses.filter((w) => w.status !== "completed").map((w) => w.error ?? w.capability).join("; "));
        if (witnesses.length) verification = { ...verification, status: "verified" };
      } else {
        try {
          output = await this.execute(cap, coerced, opts.net);
        } catch (e) {
          if (opts.planned || !HEALABLE.has(cap.invoke.kind)) throw e;
          const h = await this.healRun(cap, args, String((e as Error)?.message ?? e), opts.net);
          healing = h.healing;
          if (!h.healed) throw new Error(`${healing.error}; ${healing.note}`);
          output = h.output;
        }
      }
      const extra = check(output, opts.verify ?? []);
      verification = { status: extra.status === "refuted" ? "refuted" : verification.status === "verified" || extra.status === "verified" ? "verified" : "unverified", results: [...verification.results, ...extra.results] };
      if (verification.status === "refuted") throw new Error("verification refuted: " + JSON.stringify(extra.results.filter((p) => !p.ok)));
    } catch (e) {
      error = String((e as Error)?.message ?? e);
      if (e instanceof StepError) failedCapability = e.capability;
      verification = { ...verification, status: "refuted" };
    }
    const durationMs = Math.round((performance.now() - t0) * 10) / 10;
    const ok = !error && verification.status !== "refuted";
    // A refusal says nothing about how the operation behaves.
    if (!refused) this.ledger.record(cap.id, ok, durationMs, error);
    // Identifier values a successful call accepted and returned link ports across providers.
    if (ok && cap.invoke.kind !== "composite" && cap.invoke.kind !== "goal" && this.graph.identities.observe(cap, args, output)) this.graph.relink();
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
      ...(witnesses.length ? { witnesses } : {}),
      ...(attempts ? { attempts } : {}),
      ...(healing ? { healing } : {}),
      ...(change ? { changedMeaning: change } : {}),
    };
    if (change && !refused) this.persist();
    this.runs.set(runId, rec);
    if (this.runs.size > RUN_BUFFER) this.runs.delete(this.runs.keys().next().value!);
    this.graph.emit("run.completed", { runId, capability: cap.id, title: cap.title, provider: cap.provider, ok, durationMs, verification: verification.status });
    this.persist();
    return rec;
  }

  /**
   * A plain run of a learned operation failed. The provider may have changed
   * its API, so re-read its contract once, as compose does for a failed step.
   * If it drifted, retry the operation the caller meant: the same id while it
   * still names that operation, else the one capability that now does. A
   * changed id is never followed, and repair obeys the run's egress policy.
   */
  private async healRun(cap: Capability, args: Record<string, unknown>, error: string, net: Net = this.net): Promise<{ healing: NonNullable<RunRecord["healing"]>; healed: boolean; output?: unknown }> {
    const provider = this.graph.providers.get(cap.provider);
    const source = provider?.meta?.source as string | undefined;
    const healing: NonNullable<RunRecord["healing"]> = { source: source ?? "", error, note: "" };
    const done = (note: string) => ({ healing: { ...healing, note }, healed: false });
    if (!source) return done("no contract source to re-read");
    const allowed = net.policy?.origins;
    if (allowed && !allowed.includes(new URL(source).origin)) return done(`contract source ${new URL(source).origin} is outside the egress policy; not re-read`);
    const last = this.healReads.get(source);
    if (last !== undefined && Date.now() - last < HEAL_REREAD_MS) return done(`contract at ${source} was re-read ${Math.round((Date.now() - last) / 1000)}s ago for an earlier failure; not re-read again yet`);
    this.healReads.set(source, Date.now());
    const meant = operationOf(cap);
    const r = (await this.learn({ source, deep: true, net })).results[0];
    const d = r?.drift;
    if (d) healing.drift = d;
    if (r?.withdrawn) return done(`provider gone at ${source}: withdrew ${r.withdrawn.join(", ")}`);
    if (r?.error) return done(`re-reflected ${source}: ${r.error}`);
    if (!d?.changed) return done(`re-reflected ${source}: no contract change`);
    let note = `API drift at ${source}: +${d.added.length} −${d.removed.length} ~${d.modified.length} capabilities`;
    const current = this.graph.get(cap.id);
    const change = this.meaningChanges.get(cap.id);
    if (change) note += `; ${cap.id} now calls ${change.after}, not ${change.before}`;
    const equivalent = current && !change && operationOf(current) === meant
      ? [current]
      : this.graph.list().filter((c) => this.graph.providers.get(c.provider)?.meta?.source === source && operationOf(c) === meant);
    if (equivalent.length !== 1) return done(`${note}; ${equivalent.length ? "ambiguous" : "no"} equivalent of ${meant}`);
    const next = equivalent[0];
    healing.retried = next.id;
    note += `; retried ${next.id === cap.id ? "the same operation" : `its operation, now ${next.id}`}`;
    try {
      const output = await this.execute(next, coerceArgs(next, args), net);
      return { healing: { ...healing, note }, healed: true, output };
    } catch (e) {
      return done(`${note}: ${String((e as Error)?.message ?? e)}`);
    }
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

  /** Pin the checker contract so a saved proof cannot silently become a different test. */
  private pinWitnesses(witnesses: OutcomeWitness[]): OutcomeWitness[] {
    if (!Array.isArray(witnesses) || witnesses.length > 16) throw new Error("witnesses must be an array of at most 16 checks");
    return witnesses.map((w) => {
      const c = this.graph.get(w.capability);
      if (!c || c.risk !== "read" || c.invoke.kind === "goal" || c.invoke.kind === "composite") throw new Error(`witness must be an available read-only provider capability: ${w.capability}`);
      if (!Array.isArray(w.verify) || !w.verify.length) throw new Error(`witness needs nonempty verification predicates: ${w.capability}`);
      if (w.contract && w.contract !== signature(c)) throw new Error(`witness contract changed: ${w.capability}; establish a new check explicitly`);
      for (const binding of Object.values(w.args ?? {})) {
        if (!binding || typeof binding !== "object" || Object.keys(binding).length !== 1 || !("input" in binding || "output" in binding || "value" in binding)) throw new Error("witness arguments must use exactly one of input, output or value");
        if ("input" in binding && typeof binding.input !== "string" || "output" in binding && typeof binding.output !== "string") throw new Error("witness input/output paths must be strings");
      }
      return structuredClone({ ...w, args: w.args ?? {}, contract: signature(c) });
    });
  }

  private async checkWitnesses(witnesses: OutcomeWitness[], inputs: Record<string, unknown>, output: unknown, runIds: string[], net?: Net): Promise<WitnessResult[]> {
    const providers = new Set<string>();
    const visit = (id: string) => {
      const r = this.runs.get(id);
      if (!r) return;
      providers.add(r.provider);
      for (const child of r.steps ?? []) visit(child);
    };
    runIds.forEach(visit);
    const evidence: WitnessResult[] = [];
    for (const original of witnesses) {
      try {
        const w = this.pinWitnesses([original])[0];
        const cap = this.graph.get(w.capability)!;
        if (providers.has(cap.provider)) throw new Error("outcome witness must be separate from the providers producing the result");
        const args: Record<string, unknown> = {};
        for (const [key, binding] of Object.entries(w.args)) {
          const value = "input" in binding ? pick(inputs, binding.input) : "output" in binding ? pick(output, binding.output) : binding.value;
          if (value === undefined) throw new Error(`unresolved witness argument: ${key}`);
          args[key] = value;
        }
        const r = await this.run(w.capability, args, { verify: w.verify, net, planned: true });
        evidence.push({ capability: w.capability, runId: r.runId, status: r.status, verification: r.verification, output: r.output, ...(r.error ? { error: r.error } : {}) });
      } catch (e) {
        evidence.push({ capability: original.capability, runId: "", status: "failed", verification: { status: "refuted", results: [] }, error: String((e as Error)?.message ?? e) });
      }
    }
    return evidence;
  }

  private describeAnchor(cap: Capability): CapabilityAnchor {
    // Object wrappers and renamed output paths are transport details. Keep the
    // multiset of leaf meanings, so a different result shape cannot qualify.
    const leaves = cap.outputs.filter((port) => !cap.outputs.some((other) =>
      other !== port && (port.name === "" || other.name.startsWith(`${port.name}.`))));
    return {
      id: cap.id,
      source: this.graph.providers.get(cap.provider)?.meta?.source as string | undefined,
      title: cap.title.trim().toLowerCase().replace(/\s+/g, " "),
      risk: cap.risk,
      inputTypes: cap.inputs.filter((p) => p.required).map((p) => p.type).sort(),
      outputTypes: leaves.map((p) => p.type).sort(),
      ...this.operationField(cap),
    };
  }

  private operationField(cap: Capability): { operation?: string } {
    const operation = operationOf(cap);
    return operation ? { operation } : {};
  }

  private pinAnchors(through: string[]): CapabilityAnchor[] {
    return through.map((reference) => {
      // An absent explicit id is an error, not a search phrase that may select
      // some unrelated operation or disappear from the caller's constraints.
      const cap = this.graph.get(reference) ?? (!/^[\w-]+:/.test(reference) ? this.graph.search(reference, 1)[0]?.capability : undefined);
      if (!cap) throw new Error(`unresolved required anchor: ${reference}`);
      return this.describeAnchor(cap);
    });
  }

  private resolveAnchors(anchors: CapabilityAnchor[]): string[] {
    return anchors.map((anchor) => {
      const sameRole = (cap: Capability) => {
        const candidate = this.describeAnchor(cap);
        return candidate.source === anchor.source && candidate.risk === anchor.risk &&
          JSON.stringify(candidate.inputTypes) === JSON.stringify(anchor.inputTypes) && JSON.stringify(candidate.outputTypes) === JSON.stringify(anchor.outputTypes);
      };
      const equivalent = (cap: Capability) => sameRole(cap) && this.describeAnchor(cap).title === anchor.title;
      // What the anchor invoked when pinned; an older pin learns it from a recorded change of meaning.
      const pinned = anchor.operation ?? this.meaningChanges.get(anchor.id)?.before;
      const carriesPinned = (cap: Capability) => !!pinned && sameRole(cap) && this.operationField(cap).operation === pinned;
      const exact = this.graph.get(anchor.id);
      if (exact) {
        if (pinned ? carriesPinned(exact) : equivalent(exact)) return exact.id;
        // The id now names something else (an operationId reassigned between releases,
        // same title and types). Follow the operation the goal was built on, if exactly
        // one capability at that source still carries it; never the id.
        const successors = pinned && anchor.source ? this.graph.list().filter((c) => c.id !== exact.id && carriesPinned(c)) : [];
        if (successors.length === 1) return successors[0].id;
        throw new Error(`required anchor contract changed meaning: ${anchor.id}${pinned && this.operationField(exact).operation !== pinned ? ` (it called ${pinned}, it now calls ${this.operationField(exact).operation})` : ""}`);
      }
      let candidates = anchor.source ? this.graph.list().filter(equivalent) : [];
      if (!candidates.length && anchor.source) candidates = this.graph.list().filter(carriesPinned);
      if (candidates.length !== 1) throw new Error(`${candidates.length ? "ambiguous" : "unresolved"} required anchor: ${anchor.id}; expected one equivalent operation at ${anchor.source ?? "its original identity"}, found ${candidates.length}`);
      return candidates[0].id;
    });
  }

  // ================================================================ context_compose

  async compose(opts: {
    have: Record<string, unknown>;
    want: SemType;
    intent?: string;
    run?: boolean;
    verify?: Predicate[];
    witnesses?: OutcomeWitness[];
    maxSteps?: number;
    limit?: number;
    crystallize?: boolean;
    risks?: Capability["risk"][];
    /** Capability ids or search phrases the pipeline must pass through. */
    through?: string[];
    /** Internal persisted anchor contracts; callers specify through instead. */
    anchors?: CapabilityAnchor[];
    /** Egress policy: only use capabilities that send data to these origins, including during repair. */
    origins?: string[];
    /** If the graph can't do it, research public directories, learn candidates and re-plan. */
    acquire?: boolean;
    /** After a verified run, publish this goal as an API endpoint under this name. */
    publish?: string;
    /** Required to run plans that contain destructive capabilities. */
    confirm?: boolean;
    /** Internal recursion guard, carried through nested saved goals. */
    activeGoals?: string[];
  }): Promise<ComposeResult> {
    const witnesses = this.pinWitnesses(opts.witnesses ?? []);
    const values: Record<string, unknown> = {};
    const types: Record<string, SemType> = {};
    const fixed: Record<string, unknown> = {};
    for (let [k, v] of Object.entries(opts.have)) {
      // {"value": "EUR", "fixed": true}: a constant of the goal rather than a parameter of a published API.
      if (v && typeof v === "object" && !Array.isArray(v) && (v as any).fixed === true && "value" in (v as any)) {
        fixed[k] = (v as any).value;
        v = "type" in (v as any) ? { type: (v as any).type, value: (v as any).value } : (v as any).value;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && "type" in (v as any) && "value" in (v as any)) {
        types[k] = (v as any).type;
        values[k] = (v as any).value;
        continue;
      }
      const byName = inferType(k, typeof v === "number" ? { type: "number" } : { type: "string" });
      types[k] = byName !== "text" && byName !== "id" ? byName : inspectValue(v).type;
      // The value can be more specific than the name: a "repo" written as owner/repo is a full name.
      if (types[k] === "repo" && /^[\w.-]+\/[\w.-]+$/.test(String(v))) types[k] = "repo.full";
      values[k] = v;
    }
    const anchors = opts.anchors ?? this.pinAnchors(opts.through ?? []);
    const through = this.resolveAnchors(anchors);
    const activeGoalIds = new Set((opts.activeGoals ?? []).map((s) => `goal:${s}`));
    // Saved composites that include an active goal must not recurse through it either.
    const containsActive = (c: Capability, seen = new Set<string>()): boolean => {
      if (activeGoalIds.has(c.id)) return true;
      if (seen.has(c.id) || c.invoke.kind !== "composite") return false;
      seen.add(c.id);
      return c.invoke.steps.some((s) => { const child = this.graph.get(s.capability); return !!child && containsActive(child, seen); });
    };
    const blocked = new Set(this.graph.list().filter((c) => containsActive(c)).map((c) => c.id));
    const origins = opts.origins?.length ? opts.origins.map((o) => new URL(o).origin) : undefined;
    // Everything this goal does on the network - its steps, checks and repairs, including
    // every redirect hop - goes through a handle that enforces the caller's origins.
    const net: Net = origins ? { ...this.net, policy: { blockPrivate: false, ...this.net.policy, origins } } : this.net;
    // A caller's value named and shaped like a learned identifier scheme's carries that scheme.
    const schemes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, this.graph.identities.schemesFor(this.graph.capabilities.values(), k, v)]).filter(([, s]) => s.length));
    const goal = { have: types, want: opts.want, intent: opts.intent, maxSteps: opts.maxSteps, limit: opts.limit ?? 5, risks: opts.risks, through, exclude: blocked, origins, schemes };
    let plans = plan(this.graph, this.ledger, goal);
    const titles = (p: Plan) => p.steps.map((s) => this.graph.get(s.capability)!.title + (s.bindings.some((b) => b.each) ? " (each)" : ""));
    const result: ComposeResult = {
      goal: { have: types, want: opts.want, intent: opts.intent, through },
      plans: plans.map((p) => ({ ...p, titles: titles(p) })),
    };

    // Acquisition on demand: nothing in the graph can do this yet, so go and
    // find something in the world that can, learn it, and plan again.
    let candidates: Candidate[] | null = null;
    // Under an egress policy, self-maintenance traffic (re-reading contracts, looking for
    // successors, searching directories) obeys the same origins as the data itself.
    const allowedOrigin = (url: string) => {
      if (!origins) return true;
      try {
        return origins.includes(new URL(url).origin);
      } catch {
        return false;
      }
    };
    const acquireMore = async (): Promise<boolean> => {
      if (!opts.acquire || origins) return false;
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
    const exclude = new Set<string>(blocked);
    let lastWitnesses: WitnessResult[] = [];
    // Measured before anything runs: withdrawal during healing would otherwise erase the evidence.
    const baselineCoverage = plans[0] ? this.leafCoverage(plans[0], opts.intent) : 0;
    const refreshed = new Set<string>();
    const t0 = performance.now();
    for (let attempt = 0; attempt < 6 && plans.length; attempt++) {
      const p = plans[0];
      try {
        const r = await this.runSteps(p.steps, p.result, values, opts.confirm, opts.activeGoals, net);
        let verification = check(r.output, opts.verify ?? []);
        if (verification.status === "refuted") throw new StepError(p.steps[p.steps.length - 1].capability, `verification refuted: ${JSON.stringify(verification.results.filter((x) => !x.ok))}`);
        lastWitnesses = await this.checkWitnesses(witnesses, values, r.output, r.runs, net);
        if (lastWitnesses.some((w) => w.status !== "completed")) throw new StepError(p.steps[p.steps.length - 1].capability, `verification refuted by independent outcome witness: ${lastWitnesses.filter((w) => w.status !== "completed").map((w) => w.error ?? w.capability).join("; ")}`);
        if (lastWitnesses.length) verification = { ...verification, status: "verified" };
        result.executed = {
          summary: p.summary,
          titles: titles(p),
          output: r.output,
          status: "completed",
          verification,
          runs: r.runs,
          attempts,
          durationMs: Math.round(performance.now() - t0),
          witnesses: lastWitnesses,
          ...(r.fanOuts.length ? { fanOuts: r.fanOuts } : {}),
        };
        if (opts.crystallize !== false && p.steps.length > 1) result.crystallized = await this.crystallize(p, types, opts.intent, opts.verify, witnesses);
        if (opts.publish) {
          const slug = slugify(opts.publish);
          this.published.set(slug, {
            slug,
            title: opts.publish,
            have: types,
            want: opts.want,
            intent: opts.intent,
            verify: structuredClone(opts.verify),
            witnesses,
            ...(Object.keys(fixed).length ? { fixed: structuredClone(fixed) } : {}),
            ...(origins ? { origins } : {}),
            risks: structuredClone(opts.risks ?? [...new Set(p.steps.map((s) => this.graph.get(s.capability)!.risk))]),
            through: structuredClone(opts.through),
            anchors: structuredClone(anchors),
            maxSteps: opts.maxSteps,
            publishedAt: new Date().toISOString(),
            calls: 0,
            lastPipeline: titles(p),
            providers: [...new Set(p.steps.map((st) => this.graph.get(st.capability)!.provider))],
          });
          this.registerGoal(this.published.get(slug)!);
          result.published = { id: `goal:${slug}`, slug, path: `/x/${slug}` };
          this.graph.emit("goal.published", { slug, title: opts.publish, pipeline: titles(p) });
          this.persist();
        }
        return result;
      } catch (e) {
        const failed = e instanceof StepError || e instanceof ConfirmationRequired ? e.capability : p.steps[0].capability;
        const attempt: { summary: string; failed: string; error: string; healing?: string } = { summary: p.summary, failed, error: String((e as Error)?.message ?? e) };
        attempts.push(attempt);
        // Self-maintenance: the provider may have changed its API. Re-reflect its
        // source once; if the contract drifted, the graph now describes the new
        // API and stale crystallized pipelines are retired, so just re-plan.
        const source = this.graph.providers.get(this.graph.get(failed)?.provider ?? "")?.meta?.source as string | undefined;
        const failedEgress = this.graph.get(failed) ? egressOf(this.graph.get(failed)!, this.graph) : "anywhere";
        let drifted = false;
        let gone = false;
        if (e instanceof ConfirmationRequired) attempt.healing = "not run: destructive step needs confirm: true; looking for a non-destructive route";
        else if (e instanceof FanOutRefused) attempt.healing = "not run: the list is longer than the fan-out cap; looking for another route";
        else if (source && !allowedOrigin(source) && !refreshed.has(source)) {
          refreshed.add(source);
          attempt.healing = `contract source ${new URL(source).origin} is outside the egress policy; not re-read`;
          gone = /HTTP (404|410)\b/.test(attempt.error);
        } else if (source && !refreshed.has(source) && !(e instanceof StepError && /verification refuted/.test(attempt.error))) {
          refreshed.add(source);
          const r = await this.learn({ source, deep: true, net });
          const d = r.results[0]?.drift;
          drifted = !!d?.changed;
          attempt.healing = r.results[0]?.withdrawn
            ? `provider gone at ${source}: withdrew ${r.results[0].withdrawn.join(", ")} (${d!.removed.length} capabilities, ${d!.retired.length} pipeline(s) retired)`
            : r.results[0]?.error
            ? `re-reflected ${source}: ${r.results[0].error}`
            : drifted
              ? `API drift at ${source}: ${d!.providersBefore.join(",")} → ${d!.providersAfter.join(",")}; +${d!.added.length} −${d!.removed.length} ~${d!.modified.length} capabilities; ${d!.retired.length} pipeline(s) retired`
              : `re-reflected ${source}: no contract change`;
          // The contract is gone or unreadable: look for its successor where it lived (same
          // origin only, so a repair never moves the caller's data somewhere new by itself).
          gone = !!(r.results[0]?.withdrawn || r.results[0]?.error);
        }
        // The operation or its contract is gone: look for the successor where it lived - the
        // contract's origin and the API's own origin - never anywhere the policy does not allow.
        if (gone) {
          const homes = new Set<string>();
          if (source) homes.add(`${new URL(source).origin}/`);
          if (failedEgress !== "anywhere") for (const o of failedEgress) homes.add(`${o}/`);
          for (const home of homes) {
            if (refreshed.has(home) || !allowedOrigin(home)) continue;
            refreshed.add(home);
            const s = await this.learn({ source: home, net });
            const found = s.results[0]?.learned?.length ?? 0;
            attempt.healing = `${attempt.healing ? attempt.healing + "; " : ""}looked for a successor at ${home}: ${found ? `learned ${found} provider(s)` : s.results[0]?.error ?? "nothing found"}`;
            if (found) drifted = true;
          }
        }
        if (!drifted) {
          exclude.add(failed);
          // A crystallized pipeline in a failed plan is suspect as a whole.
          for (const s of p.steps) if (this.graph.get(s.capability)?.invoke.kind === "composite") exclude.add(s.capability);
        }
        // Refresh hard anchors in this same call. A changed protocol may have a
        // new operation id, but the source and role must still match uniquely.
        // Missing/ambiguous anchors end recovery; they are never dropped.
        try {
          goal.through = this.resolveAnchors(anchors);
          result.goal.through = goal.through;
        } catch (anchorError) {
          attempt.error += `; ${String((anchorError as Error)?.message ?? anchorError)}`;
          plans = [];
          break;
        }
        // Healing must preserve the meaning of the goal: a recovery plan may not
        // cover less of the intent than the plan it replaces (an invoice total
        // is a number, but it is not a tax rate).
        // Naming varies between providers, so allow losing up to a quarter of the
        // intent's terms, never more (an invoice total covers far less of
        // "tax rate invoice customer country" than any real tax-rate route).
        // Judge by what the underlying capabilities cover: a saved pipeline's
        // title repeats the goal's words, which must not raise the bar.
        const floor = Math.ceil(baselineCoverage * 0.75);
        const keep = (ps: Plan[]) => ps.filter((x) => x.intentScore >= floor);
        plans = keep(plan(this.graph, this.ledger, { ...goal, exclude }));
        if (!plans.length && (await acquireMore())) plans = keep(plan(this.graph, this.ledger, { ...goal, exclude }));
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
      witnesses: lastWitnesses,
    };
    return result;
  }

  /** Distinct intent terms covered by the titles and tags of a plan's leaf capabilities (saved pipelines expanded). */
  private leafCoverage(p: Plan, intent?: string): number {
    const want = new Set(tokenize(intent ?? ""));
    if (!want.size) return 0;
    const covered = new Set<string>();
    const visit = (id: string, depth = 0) => {
      const c = this.graph.get(id);
      if (!c) return;
      if (c.invoke.kind === "composite" && depth < 4) return c.invoke.steps.forEach((s) => visit(s.capability, depth + 1));
      for (const t of tokenize(`${c.title} ${c.tags.join(" ")}`)) if (want.has(t)) covered.add(t);
    };
    for (const s of p.steps) visit(s.capability);
    return covered.size;
  }

  /** Make a durable goal discoverable through the same graph and context_run tool. */
  private registerGoal(g: PublishedGoal): void {
    const risks = g.risks ?? ["read"];
    const risk = risks.includes("destructive") ? "destructive" : risks.includes("write") ? "write" : risks.includes("external") ? "external" : "read";
    this.graph.addCapability({
      id: `goal:${g.slug}`, title: g.title, provider: "goal:published", source: "composite",
      description: `Reusable goal: ${g.intent ?? g.want}. Finds a current implementation on every call, repairs changed APIs, and re-runs its stored checks${g.witnesses?.length ? ` plus ${g.witnesses.length} independent outcome witness(es)` : ""}. Invoke with context_run; no need to reconstruct the pipeline.`,
      inputs: goalParams(g).map(([name, type]) => ({ name, type, required: true })),
      outputs: [{ name: "", type: g.want, required: true }], risk,
      tags: ["saved", "goal", "reusable", ...(g.intent ?? g.title).split(/\s+/)],
      invoke: { kind: "goal", slug: g.slug },
    }, { id: "goal:published", title: "Reusable environmental capabilities", source: "composite", origin: this.name, learnedAt: g.publishedAt });
  }

  private async executeGoal(slug: string, args: Record<string, unknown>, confirm?: boolean, activeGoals: string[] = []): Promise<ComposeResult> {
    const g = this.published.get(slug);
    if (!g) throw new Error(`no published goal: ${slug}`);
    if (activeGoals.includes(slug) || activeGoals.length >= 8) throw new Error(`recursive saved goal: ${slug}`);
    // Older persisted goals can acquire descriptors only while their original
    // anchors still exist. Missing old ids fail explicitly rather than weaken.
    if (!g.anchors) {
      g.anchors = this.pinAnchors(g.through ?? []);
      this.persist();
    }
    const missing = goalParams(g).map(([k]) => k).filter((k) => args[k] === undefined || args[k] === "");
    if (missing.length) throw new Error(`missing parameter(s): ${missing.join(", ")}`);
    const have: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(g.have)) {
      // Pinned inputs come from the goal itself; a caller cannot override them.
      const raw = g.fixed && k in g.fixed ? g.fixed[k] : args[k];
      const value = (t === "number" || t.startsWith("geo.")) && typeof raw === "string" ? Number(raw) : raw;
      have[k] = { type: t, value };
    }
    const r = await this.compose({ have, want: g.want, intent: g.intent, verify: g.verify, witnesses: g.witnesses, risks: g.risks, through: g.through, anchors: g.anchors, maxSteps: g.maxSteps, origins: g.origins, run: true, confirm, activeGoals: [...activeGoals, slug] });
    g.calls++;
    if (r.executed?.status === "completed") {
      g.lastPipeline = r.executed.titles;
      g.providers = [...new Set(r.executed.runs.map((id) => this.runs.get(id)?.provider).filter((x): x is string => !!x))];
    }
    this.persist();
    return r;
  }

  /** Serve a published goal: fixed contract, implementation re-derived from the live graph. */
  async callPublished(slug: string, args: Record<string, unknown>) {
    const r = await this.executeGoal(slug, args);
    return {
      ok: r.executed?.status === "completed",
      result: r.executed?.output ?? null,
      pipeline: r.executed?.titles ?? [],
      verification: r.executed?.verification.status ?? "refuted",
      witnesses: r.executed?.witnesses ?? [],
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
          parameters: goalParams(g).map(([name, t]) => ({ name, in: "query", required: true, schema: { ...jsonSchemaFor(t), "x-rightclick-type": t } })),
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

  /** Save a successful pipeline with the checks that justified keeping it. */
  private async crystallize(p: Plan, types: Record<string, SemType>, intent?: string, verify?: Predicate[], witnesses?: OutcomeWitness[]) {
    const id = `composite:${(await sha256(JSON.stringify({ steps: p.steps, result: p.result, types, verify, witnesses }))).slice(0, 12)}`;
    if (this.graph.get(id)) return { id, title: this.graph.get(id)!.title, newPowers: 0 };
    const usedInputs = new Set(p.steps.flatMap((s) => s.bindings.map((b) => b.from)).filter((f) => f.startsWith("$in.")).map((f) => f.slice(4)));
    for (const w of witnesses ?? []) for (const b of Object.values(w.args)) if ("input" in b) usedInputs.add(b.input.split(".")[0]);
    const stepCaps = p.steps.map((s) => this.graph.get(s.capability)!);
    const title = `${intent ? intent.charAt(0).toUpperCase() + intent.slice(1) + ": " : ""}${stepCaps.map((c) => c.title).join(" → ")}`;
    const cap: Capability = {
      id,
      title,
      description: `Saved pipeline across ${new Set(stepCaps.map((c) => c.provider)).size} providers. Every invocation repeats ${verify?.length ?? 0} result check(s) and ${witnesses?.length ?? 0} independent outcome witness(es). A successful sample is not a guarantee for every input.`,
      provider: "composite:crystallized",
      source: "composite",
      inputs: [...usedInputs].map((n) => ({ name: n, type: types[n], required: true })),
      outputs: [{ name: "", type: p.resultType, required: true }],
      risk: stepCaps.some((c) => c.risk === "destructive") ? "destructive" : stepCaps.some((c) => c.risk === "write") ? "write" : stepCaps.some((c) => c.risk === "external") ? "external" : "read",
      tags: [...new Set([...(intent ? intent.split(/\s+/) : []), "composite", "crystallized", ...stepCaps.flatMap((c) => c.tags)])].slice(0, 30),
      invoke: { kind: "composite", steps: p.steps, result: p.result, signatures: stepCaps.map(signature), verify: structuredClone(verify), witnesses: structuredClone(witnesses) },
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

  private async runSteps(steps: PlanStep[], resultRef: string, inputs: Record<string, unknown>, confirm?: boolean, activeGoals?: string[], net?: Net) {
    const outputs: unknown[] = [];
    const runs: string[] = [];
    const fanOuts: FanOutReport[] = [];
    // Steps that fanned out hold one output per item; a path reads into each of them.
    const fanned = new Set<number>();
    const resolve = (ref: string) => {
      if (ref.startsWith("$in.")) return inputs[ref.slice(4)];
      const m = /^(\d+)\.?(.*)$/.exec(ref)!;
      const i = Number(m[1]);
      return fanned.has(i) ? (outputs[i] as unknown[]).map((o) => pick(o, m[2] || undefined)) : pick(outputs[i], m[2] || undefined);
    };
    for (const [index, step] of steps.entries()) {
      const args: Record<string, unknown> = {};
      for (const b of step.bindings) if (!b.each) args[b.port] = resolve(b.from);
      const fan = step.bindings.find((b) => b.each);
      if (!fan) {
        const r = await this.run(step.capability, args, { confirm, activeGoals, net, planned: true });
        runs.push(r.runId);
        if (r.status === "failed") throw new StepError(r.failedCapability ?? step.capability, `${step.capability}: ${r.error}`);
        outputs.push(r.output);
        continue;
      }
      const { max, shapes } = fan.each!;
      const listed = fanItems(resolve(fan.from));
      // Through a learned scheme, only items shaped like the scheme's identifiers are its identifiers.
      const items = shapes?.length ? listed.filter((x) => typeof x === "string" && shapes.includes(shapeOf(x))) : listed;
      const report: FanOutReport = { step: index, capability: step.capability, port: fan.port, items: listed.length, ran: 0, skipped: listed.length - items.length, max };
      fanOuts.push(report);
      if (items.length > max) throw new FanOutRefused(step.capability, `${step.capability}: fan-out over ${items.length} items of ${fan.from} exceeds the cap of ${max}; not run`);
      // One item at a time: a list never turns into a burst of requests against one provider.
      const each: unknown[] = [];
      for (const item of items) {
        const r = await this.run(step.capability, { ...args, [fan.port]: item }, { confirm, activeGoals, net, planned: true });
        runs.push(r.runId);
        report.ran++;
        if (r.status === "failed") throw new StepError(r.failedCapability ?? step.capability, `${step.capability} (item ${JSON.stringify(item)}, ${report.ran} of ${items.length}): ${r.error}`);
        each.push(r.output);
      }
      outputs.push(each);
      fanned.add(index);
    }
    return { output: resolve(resultRef), runs, fanOuts };
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

  mcp(endpoint: string, net: Net = this.net): McpClient {
    // A policy-scoped handle gets its own session; shared sessions use the unscoped network.
    if (net !== this.net) return new McpClient(endpoint, net);
    let c = this.mcpClients.get(endpoint);
    if (!c) this.mcpClients.set(endpoint, (c = new McpClient(endpoint, this.net)));
    return c;
  }

  private async execute(cap: Capability, args: Record<string, unknown>, net: Net = this.net): Promise<unknown> {
    const inv = cap.invoke;
    switch (inv.kind) {
      case "builtin": {
        const fn = this.builtins.get(inv.fn);
        if (!fn) throw new Error(`builtin missing: ${inv.fn}`);
        return fn(args as Record<string, any>, net);
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
        const res = await request(net, u.toString(), { method: inv.method, headers, body });
        const out = await readBody(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(JSON.stringify(preview(out))).slice(0, 300)}`);
        if (inv.entry) {
          // A keyed map holds many answers; the caller asked for one. A missing key is an error, never a guess.
          const key = String(args[inv.entry.keyInput] ?? "");
          const map = pick(out, inv.entry.map);
          if (!map || typeof map !== "object" || !Object.prototype.hasOwnProperty.call(map, key)) throw new Error(`no ${inv.entry.map} entry for "${key}"`);
          return (map as Record<string, unknown>)[key];
        }
        return out;
      }
      case "graphql": {
        const sel = inv.selectPort ? args[inv.selectPort] : undefined;
        const doc = sel !== undefined && sel !== null && sel !== "" ? { ...inv, selection: checkSelection(sel) } : inv;
        const provided = Object.keys(args).filter((k) => args[k] !== undefined && k !== inv.selectPort);
        const variables: Record<string, unknown> = {};
        for (const k of provided) {
          const t = inv.args[k] ?? "";
          variables[k] = /^(Int|Float)!?$/.test(t) ? Number(args[k]) : args[k];
        }
        const res = await request(net, inv.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: buildDocument(doc, provided), variables }),
        });
        const j: any = await readBody(res);
        if (!res.ok || (j?.errors?.length && !j?.data?.[inv.field])) throw new Error(`GraphQL: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
        return j.data[inv.field];
      }
      case "mcp":
        return this.mcp(inv.endpoint, net).call(inv.tool, args, cap.outputs.some((o) => o.name !== ""));
      case "peer": {
        const res = await request(net, `${inv.endpoint}/api/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: inv.id, args }),
        });
        const j: any = await readBody(res);
        if (!res.ok || j?.status === "failed") throw new Error(`peer: ${j?.error ?? res.status}`);
        return j.output;
      }
      case "composite":
      case "goal":
        throw new Error("composite capabilities run through run()");
    }
  }

  // ================================================================ persistence

  persist(): void {
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
    await this.store.save({ version: 1, reflections, ledger: this.ledger.toJSON(), receipts: this.chain.receipts.slice(-300), published: [...this.published.values()], meaningChanges: [...this.meaningChanges.values()], authFingerprints: await this.net.auth.fingerprints(), semantics: SEMANTICS, identities: this.graph.identities.toJSON() });
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

/** A published goal's caller-facing parameters: its inputs minus the ones pinned at publish time. */
export function goalParams(g: PublishedGoal): Array<[string, SemType]> {
  return Object.entries(g.have).filter(([k]) => !(g.fixed && k in g.fixed));
}

function coerceArgs(cap: Capability, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const p of cap.inputs) {
    const v = out[p.name];
    if (v === undefined) continue;
    // Keep decimal text intact across reusable wrappers until a converter or
    // the concrete numeric wire contract consumes it.
    const numericQuantityWire = p.type.startsWith("quantity:") && !["builtin", "composite", "goal", "peer"].includes(cap.invoke.kind);
    if ((p.type === "number" || p.type.startsWith("geo.") || numericQuantityWire) && typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) out[p.name] = Number(v);
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
  if (t === "number" || t.startsWith("geo.") || t.startsWith("quantity:")) return { type: "number" };
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

export interface FanOutReport {
  step: number;
  capability: string;
  port: string;
  /** Distinct items the list held. */
  items: number;
  /** Items the step ran on before finishing or failing. */
  ran: number;
  /** Items left out because they did not have the shape of the scheme's identifiers. */
  skipped: number;
  max: number;
}

/** The distinct, non-empty items of a list value (nested lists flattened; a single value is a list of one). */
function fanItems(v: unknown): unknown[] {
  const flat = (Array.isArray(v) ? v : [v]).flat(Infinity).filter((x) => x !== null && x !== undefined && x !== "");
  const seen = new Set<string>();
  return flat.filter((x) => {
    const k = JSON.stringify(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
