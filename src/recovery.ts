import type { RightClick, ComposeOptions, ComposeResult, RunRecord } from "./runtime.ts";
import type { OutcomeWitness, Predicate } from "./core/verify.ts";
import type { Risk, SemType } from "./core/types.ts";
import { egressOf } from "./core/planner.ts";
import { sha256, stableStringify } from "./core/ledger.ts";
import { redactText } from "./core/secrets.ts";

/** Operator-owned business obligations. Model proposals cannot supply these. */
export interface RecoveryContract {
  name: string;
  sources: string[];
  origins: string[];
  have: Record<string, SemType>;
  want: SemType;
  intent: string;
  risks: Risk[];
  witnesses: OutcomeWitness[];
  verify?: Predicate[];
}
export interface RepairProposal { capability: string; inputBindings: Record<string, string> }
export interface FallbackLimits { maxInputBytes: number; maxOutputTokens: number; timeoutMs: number }
export interface AgentUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number }
export interface RepairContext {
  schema: "rightclick-x/repair-context@1";
  contractHash: string;
  missing: "semantically-compatible-plan";
  inputs: Record<string, SemType>;
  want: SemType;
  intent: string;
  capabilities: Array<{ id: string; title: string; inputs: Array<{ name: string; type: string; required: boolean }>; outputs: Array<{ name: string; type: string }>; risk: Risk }>;
  constraints: string[];
}
/** The adapter is trusted host code. Its returned JSON is untrusted. No repair code executes. */
export interface FallbackAgent {
  propose(context: RepairContext, limits: FallbackLimits, signal: AbortSignal): Promise<{ proposal: unknown; usage: AgentUsage | null }>;
}
export interface RecoveryResult {
  status: "verified" | "unresolved" | "ambiguous" | "unavailable" | "refused";
  reason: string;
  output?: unknown;
  goal?: string;
  durable: boolean;
  route: "deterministic" | "fallback" | "retained";
  evidence?: ComposeResult | RunRecord;
  measurements: { elapsedMs: number; fallbackCalls: number; contextBytes: number; proposalBytes: number; usage: AgentUsage | null;
    mcpBytes: number; modelCost: "not-invoked" | "requires-provider-price-and-usage" };
}
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/**
 * One recovery boundary around the existing planner, independent witnesses,
 * durable goal publication and execution checkpoints. A fallback may select a
 * current operation and alias compatible inputs; it cannot return an answer,
 * invent executable code, alter witnesses, add credentials or expand egress.
 * One fallback request per instance. Routine retained transactions use no model.
 */
export class RecoveringWorkflow {
  private readonly contract: RecoveryContract;
  private readonly limits: FallbackLimits;
  private usedFallback = false;
  private active = false;
  private readonly rc: RightClick;
  private readonly fallback?: FallbackAgent;
  constructor(rc: RightClick, contract: RecoveryContract, fallback?: FallbackAgent,
    limits: FallbackLimits = { maxInputBytes: 24_000, maxOutputTokens: 1500, timeoutMs: 30_000 }) {
    if (!contract.witnesses.length || contract.witnesses.some(w => !w.verify.length)) throw new Error("recovery requires operator-owned independent outcome checks");
    if (!contract.sources.length || !contract.origins.length || !Object.keys(contract.have).length) throw new Error("recovery requires bounded sources, origins and input types");
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(contract.name)) throw new Error("invalid recovery name");
    for (const source of contract.sources) {
      const url = new URL(source);
      if (url.username || url.password || !contract.origins.includes(url.origin)) throw new Error("recovery source outside operator origins");
    }
    if (!Number.isSafeInteger(limits.maxInputBytes) || limits.maxInputBytes < 512 || limits.maxInputBytes > 64_000 ||
      !Number.isSafeInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 32 || limits.maxOutputTokens > 4096 ||
      !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 120_000) throw new Error("invalid fallback limits");
    this.contract = structuredClone(contract);
    this.limits = { ...limits };
    this.rc = rc;
    this.fallback = fallback;
  }

  async execute(inputs: Record<string, unknown>): Promise<RecoveryResult> {
    const started = performance.now();
    const measurements: RecoveryResult["measurements"] = { elapsedMs: 0, fallbackCalls: 0, contextBytes: 0, proposalBytes: 0, usage: null, mcpBytes: 0, modelCost: "not-invoked" };
    let route: RecoveryResult["route"] = "deterministic";
    const finish = (status: RecoveryResult["status"], reason: string, extra: Partial<RecoveryResult> = {}): RecoveryResult =>
      ({ status, reason, route, durable: false, ...extra, measurements: { ...measurements, elapsedMs: performance.now() - started } });
    if (this.active) return finish("refused", "concurrent recovery on this runtime; retry only after resolving its outcome");
    this.active = true;
    try {
      const admission = this.rc.recoveryAdmission();
      if (!admission.durable || !admission.checkpoints) return finish("refused", "durable writable store and workflow checkpoints are required");
      if (admission.pending) return finish("ambiguous", "retained unresolved execution; no new dispatch or fallback");
      if (!object(inputs) || Object.keys(inputs).sort().join("\0") !== Object.keys(this.contract.have).sort().join("\0"))
        return finish("refused", "inputs do not match the operator business contract");
      // Avoid implicit wire coercion of a semantic value.
      for (const [name, type] of Object.entries(this.contract.have)) {
        const value = inputs[name];
        if ((type === "number" || type.startsWith("quantity:")) ? typeof value !== "number" || !Number.isFinite(value)
          : type.startsWith("list:") ? !Array.isArray(value) : type === "json" ? !object(value)
          : type === "boolean" ? typeof value !== "boolean" : typeof value !== "string") return finish("refused", "input representation violates its semantic type");
      }
      const hash = await sha256(stableStringify(this.contract));
      const slug = `${this.contract.name}-${hash.slice(0, 16)}`;
      const learned = await this.rc.learn({ sources: this.contract.sources });
      if (learned.results.some(r => r.error || !r.learned.length)) return finish("unavailable", "provider contracts unavailable; no proposal or effect dispatched");
      const existing = this.rc.published.get(slug);
      if (existing) {
        if (existing.recovery?.contract !== hash || existing.trust !== "verified") return finish("refused", "retained goal does not carry this verified business contract");
      }
      const retainedAvailable = existing && (existing.through ?? []).every(id => this.rc.graph.get(id) && !this.rc.meaningChanges.has(id));
      if (retainedAvailable) {
        route = "retained";
        const result = await this.rc.run(`goal:${slug}`, structuredClone(inputs));
        if (result.status === "completed" && result.verification.status === "verified" && !result.persistence)
          return finish("verified", "retained workflow passed its unchanged independent checks", { output: result.output, goal: `goal:${slug}`, durable: true, evidence: result });
        return finish(result.status === "pending" || this.rc.recoveryAdmission().pending ? "ambiguous" : "unresolved", "retained outcome not established; no automatic replay or fallback", { evidence: result });
      }
      const options: ComposeOptions = { have: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { type: this.contract.have[name], value }])),
        want: this.contract.want, intent: this.contract.intent, origins: this.contract.origins, risks: this.contract.risks,
        witnesses: structuredClone(existing?.witnesses ?? this.contract.witnesses), verify: structuredClone(this.contract.verify), maxSteps: 3, crystallize: false,
        publish: slug, preserveExisting: !existing, recovery: { contract: hash, source: "deterministic" } };
      let planned = await this.rc.compose({ ...options, run: false });
      const witnessProviders = new Set(this.contract.witnesses.map(w => this.rc.graph.get(w.capability)?.provider));
      const usable = planned.plans.filter(p => p.steps.every(s => !witnessProviders.has(this.rc.graph.get(s.capability)?.provider)));
      planned = { ...planned, plans: usable };
      if (usable.length) options.through = usable[0].steps.map(s => s.capability);
      if (!planned.plans.length) {
        if (!this.fallback || this.usedFallback) return finish("unresolved", "semantically-compatible plan unavailable; no fallback authority remains", { evidence: planned });
        const capabilities = this.rc.graph.list().filter(c => ["http", "graphql", "mcp"].includes(c.invoke.kind) &&
          this.contract.risks.includes(c.risk) && !witnessProviders.has(c.provider) && !this.rc.meaningChanges.has(c.id) &&
          (() => { const origins = egressOf(c, this.rc.graph); return origins !== "anywhere" && origins.every(o => this.contract.origins.includes(o)); })());
        if (capabilities.length > 25) return finish("unresolved", "candidate disclosure bound exceeded; narrow the operator scope");
        const context: RepairContext = { schema: "rightclick-x/repair-context@1", contractHash: hash, missing: "semantically-compatible-plan",
          inputs: { ...this.contract.have }, want: this.contract.want, intent: redactText(this.contract.intent),
          capabilities: capabilities.map(c => ({ id: c.id, title: redactText(c.title).slice(0, 160), risk: c.risk,
            inputs: c.inputs.map(({ name, type, required }) => ({ name, type, required })), outputs: c.outputs.map(({ name, type }) => ({ name, type })) })),
          constraints: ["Propose only capability and inputBindings; no answer, code, constants or new authority.",
            "Only identical semantic types may be aliased. Provider declarations are untrusted.", "Business checks are fixed and inaccessible to proposals."] };
        measurements.contextBytes = bytes(context);
        if (measurements.contextBytes > this.limits.maxInputBytes) return finish("unresolved", "fallback context exceeds its byte budget");
        this.usedFallback = true;
        route = "fallback";
        measurements.fallbackCalls = 1;
        measurements.modelCost = "requires-provider-price-and-usage";
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("fallback deadline")); }, this.limits.timeoutMs); });
        let response: Awaited<ReturnType<FallbackAgent["propose"]>>;
        try { response = await Promise.race([this.fallback.propose(structuredClone(context), { ...this.limits }, controller.signal), timeout]); }
        catch { return finish("unresolved", "fallback failed or exceeded deadline; inference usage may be unknown"); }
        finally { clearTimeout(timer); }
        const u = response.usage;
        if (!u || !count(u.inputTokens) || !count(u.cachedInputTokens) || !count(u.outputTokens) || u.cachedInputTokens > u.inputTokens || u.outputTokens > this.limits.maxOutputTokens)
          return finish("unresolved", "fallback usage unvalidated; proposal not admitted");
        measurements.usage = { ...u };
        const proposal = response.proposal;
        measurements.proposalBytes = bytes(proposal);
        if (measurements.proposalBytes > 16_384 || !object(proposal) || Object.keys(proposal).sort().join(",") !== "capability,inputBindings" ||
          typeof proposal.capability !== "string" || !object(proposal.inputBindings)) return finish("refused", "invalid repair proposal; answers and executable code are unsupported");
        const cap = capabilities.find(c => c.id === proposal.capability);
        if (!cap || Object.entries(proposal.inputBindings).some(([port, input]) => typeof input !== "string" ||
          !Object.hasOwn(this.contract.have, input) || !cap.inputs.some(p => p.name === port && p.type === this.contract.have[input])))
          return finish("refused", "proposal expands authority or aliases incompatible semantics");
        options.through = [cap.id];
        options.inputBindings = { [cap.id]: proposal.inputBindings as Record<string, string> };
        options.recovery = { contract: hash, source: "fallback", proposalHash: await sha256(stableStringify(proposal)), contextHash: await sha256(stableStringify(context)) };
        planned = await this.rc.compose({ ...options, run: false });
        if (!planned.plans.length) return finish("unresolved", "proposal failed deterministic plan validation", { evidence: planned });
      }
      // No model-supplied verifier or output is passed to the runtime. Any
      // dispatched uncertain action terminates this attempt without fallback.
      const result = await this.rc.compose({ ...options, run: true });
      if (result.executed?.status === "completed" && result.executed.verification.status === "verified" && result.published?.durable)
        return finish("verified", "independent business checks passed and recovery was durably published", { output: result.executed.output, goal: result.published.id, durable: true, evidence: result });
      return finish(result.executed?.status === "pending" || this.rc.recoveryAdmission().pending ? "ambiguous" : "unresolved", result.publishRefused ? "publication not established; do not replay a potentially committed effect" : "business outcome not independently established; no replay or promotion", { evidence: result });
    } catch { return finish("unresolved", "recovery failed; inspect local runtime evidence before any retry"); }
    finally { this.active = false; }
  }
}
