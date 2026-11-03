import { RightClick, type RuntimeOptions, type Store } from "./runtime.ts";
import { RecoveringWorkflow, type FallbackAgent, type FallbackLimits, type RecoveryResult } from "./recovery.ts";
import { check, type OutcomeWitness, type Predicate, type WitnessResult } from "./core/verify.ts";
import { sha256, stableStringify } from "./core/ledger.ts";
import { INTROSPECTION_QUERIES, buildDocument } from "./reflectors/graphql.ts";
import { TransportRefused } from "./reflectors/net.ts";
import type { ExecutionPolicy } from "./core/execution-policy.ts";

/** One closed accounting period, one account, one currency; no FX or unit conversion. */
export interface ReconciliationContract {
  name: string;
  secondarySource: string;
  approvedOrigins: string[];
  /** Explicit query-only POST destinations. Discovery never probes other POST endpoints. */
  approvedGraphqlEndpoints: string[];
  expected: { currency: string; unit: "minor"; basis: string };
  /** Independently maintained reader of authoritative and secondary records.
   * Operator ownership is a host assertion, not inferred from provider metadata. */
  checker: { source: string; capability: string; contract: string; owner: "operator"; rulesDigest: string };
}
export interface ReconciliationOptions {
  store: Store;
  auth?: RuntimeOptions["auth"];
  fetch?: RuntimeOptions["fetch"];
  timeoutMs?: number;
  fallback?: FallbackAgent;
  limits?: FallbackLimits;
}
export interface ReconciliationInput { account: string; period: string }
export interface MoneyObservation extends ReconciliationInput {
  currency: string; unit: "minor"; basis: string; amountMinor: number;
}
export interface ReconciliationResult {
  outcome: "VERIFIED MATCH" | "VERIFIED MISMATCH" | "UNRESOLVED/UNVERIFIED";
  state: "verified" | "contradicted" | "pending" | "ambiguous" | "unsupported" | "unverified";
  explanation: string;
  differenceMinor?: string;
  route?: RecoveryResult["route"];
  durable: boolean;
  evidence?: { contractHash: string; inputHash: string; observationHash: string;
    checkerContract: string; rulesDigest: string; goal?: string; witnessRun: string };
  measurements?: RecoveryResult["measurements"];
  failedChecks?: Array<{ scope: "candidate" | "witness"; path: string; rule: string }>;
}

export function observationChecks(expected: ReconciliationContract["expected"], prefix = ""): Predicate[] {
  const p = (name: string) => prefix ? `${prefix}.${name}` : name;
  return [{ op: "type", ...(prefix ? { path: prefix } : {}), value: "object" },
    { op: "input_equals", path: p("account"), input: "account" },
    { op: "input_equals", path: p("period"), input: "period" },
    { op: "equals", path: p("currency"), value: expected.currency },
    { op: "equals", path: p("unit"), value: expected.unit },
    { op: "equals", path: p("basis"), value: expected.basis },
    { op: "safe_integer", path: p("amountMinor") }];
}

/** The same operator-owned checks are usable by static, generated and agent clients. */
export function verifyReconciliation(input: ReconciliationInput, expected: ReconciliationContract["expected"],
  candidate: unknown, witness: unknown, rulesDigest: string): { valid: boolean; differenceMinor?: string } {
  const inputs = { ...input };
  if (check(candidate, observationChecks(expected), inputs).status !== "checked" ||
      check(witness, [...observationChecks(expected, "authoritative"), ...observationChecks(expected, "secondary"),
        { op: "equals", path: "rulesDigest", value: rulesDigest }], inputs).status !== "checked") return { valid: false };
  const w = witness as { authoritative: MoneyObservation; secondary: MoneyObservation };
  if (stableStringify(candidate) !== stableStringify(w.secondary)) return { valid: false };
  return { valid: true, differenceMinor: String(BigInt(w.authoritative.amountMinor) - BigInt(w.secondary.amountMinor)) };
}

/** Mandatory protocol; neither discovery nor a fallback may supply or weaken these checks. */
export function reconciliationWitness(contract: ReconciliationContract): OutcomeWitness {
  return { capability: contract.checker.capability, contract: contract.checker.contract,
    args: { account: { input: "account" }, period: { input: "period" } },
    verify: [...observationChecks(contract.expected, "authoritative"), ...observationChecks(contract.expected, "secondary"),
      { op: "equals", path: "rulesDigest", value: contract.checker.rulesDigest }], agree: { path: "secondary" } };
}

export function reconciliationExecutionPolicy(origins: string[]): ExecutionPolicy {
  return { allowedRisks: ["read"], allowedInvocations: ["http", "graphql", "goal", "composite"], allowedOrigins: [...origins] };
}

/** Read-only product boundary. It owns its runtime; callers cannot inject a broadly authorised one.
 * This does not prevent a dishonest remote GET/query implementation from causing external effects.
 * Operator credentials must themselves be restricted to read-only accounts/scopes.
 */
export class VerifiedReconciliation {
  readonly #workflow: RecoveringWorkflow;
  readonly #contract: ReconciliationContract;
  private constructor(rc: RightClick, contract: ReconciliationContract, options: ReconciliationOptions) {
    this.#contract = structuredClone(contract);
    this.#workflow = new RecoveringWorkflow(rc, { name: contract.name,
      sources: [contract.secondarySource, contract.checker.source], origins: contract.approvedOrigins,
      have: { account: "account", period: "text" }, want: "json", intent: "account settlement observation",
      risks: ["read"], verify: observationChecks(contract.expected), witnesses: [reconciliationWitness(contract)],
    }, options.fallback, options.limits);
  }

  static async create(contract: ReconciliationContract, options: ReconciliationOptions): Promise<VerifiedReconciliation> {
    if (options.store?.durability !== "persistent" || options.store.readOnly || !options.store.withGoalLease)
      throw new Error("reconciliation requires a persistent writable store with authoritative goal leases");
    if (contract.checker?.owner !== "operator" || !/^sha256:[a-f0-9]{64}$/.test(contract.checker.contract) ||
        !/^sha256:[a-f0-9]{64}$/.test(contract.checker.rulesDigest)) throw new Error("operator-owned pinned checker and rules digest required");
    if (!/^[A-Z]{3}$/.test(contract.expected.currency) || contract.expected.unit !== "minor" || !contract.expected.basis?.trim())
      throw new Error("explicit currency, integer minor units and accounting basis required");
    const secondary = new URL(contract.secondarySource), checker = new URL(contract.checker.source);
    if (secondary.origin === checker.origin) throw new Error("checker must have a separately approved origin");
    for (const url of [secondary, checker]) if (!/^https?:$/.test(url.protocol) || url.username || url.password || !contract.approvedOrigins.includes(url.origin))
      throw new Error("source outside approved HTTP origins");
    const config = structuredClone(contract);
    for (const endpoint of config.approvedGraphqlEndpoints) {
      const url = new URL(endpoint);
      if (url.username || url.password || !config.approvedOrigins.includes(url.origin)) throw new Error("GraphQL endpoint outside approved origins");
    }
    let rc: RightClick | undefined;
    const transport: NonNullable<RuntimeOptions["fetch"]> = async (input, init, context) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (!config.approvedOrigins.includes(url.origin)) throw new TransportRefused("reconciliation origin not approved");
      if (!["GET", "HEAD"].includes(request.method)) {
        let approved = false;
        if (request.method === "POST" && config.approvedGraphqlEndpoints.includes(request.url)) {
          try {
            const body = await request.clone().json() as { query?: string; variables?: Record<string, unknown> };
            // Discovery can only send the runtime's finite introspection documents.
            approved = !context && INTROSPECTION_QUERIES.includes(body.query ?? "");
            const cap = context && rc?.graph.get(context.capabilityId);
            if (cap?.invoke.kind === "graphql" && cap.invoke.operation === "query" && cap.invoke.endpoint === request.url &&
                rc?.capabilityExecution(cap.id)?.allowed && body.variables && typeof body.variables === "object" && !Array.isArray(body.variables))
              approved = body.query === buildDocument(cap.invoke, Object.keys(body.variables));
          } catch { /* Unrecognised POST is refused before network dispatch. */ }
        }
        if (!approved) throw new TransportRefused("reconciliation permits GET/HEAD and approved generated GraphQL queries only");
      }
      return (options.fetch ?? fetch)(input, init, context);
    };
    rc = await RightClick.create({ directories: [], store: options.store, auth: options.auth, fetch: transport,
      timeoutMs: options.timeoutMs ?? 5000, workflowRecovery: true,
      authority: { publish: "verified", retry: [], execution: reconciliationExecutionPolicy(config.approvedOrigins) } });
    return new VerifiedReconciliation(rc, config, options);
  }

  async reconcile(input: ReconciliationInput): Promise<ReconciliationResult> {
    const unknown = (state: ReconciliationResult["state"], explanation: string): ReconciliationResult =>
      ({ outcome: "UNRESOLVED/UNVERIFIED", state, explanation, durable: false });
    if (!input || Object.keys(input).sort().join(",") !== "account,period" ||
        [input.account, input.period].some(s => typeof s !== "string" || !s.trim() || s.length > 256))
      return unknown("unsupported", "Supply one account and one closed accounting period.");
    const r = await this.#workflow.execute({ ...input });
    const execution = r.evidence && ("executed" in r.evidence ? r.evidence.executed : "verification" in r.evidence ? r.evidence : undefined);
    const witnesses = execution?.witnesses as WitnessResult[] | undefined;
    if (r.status !== "verified") {
      const failedChecks: NonNullable<ReconciliationResult["failedChecks"]> = [
        ...(execution?.verification.results ?? []).filter(p => !p.ok).map(p => ({ scope: "candidate" as const, path: p.predicate.path ?? "", rule: p.predicate.op })),
        ...(witnesses ?? []).flatMap(w => w.verification.results.filter(p => !p.ok).map(p => ({ scope: "witness" as const, path: p.predicate.path ?? "", rule: p.predicate.op }))),
        ...(witnesses ?? []).filter(w => w.agreement && !w.agreement.ok).map(() => ({ scope: "witness" as const, path: "secondary", rule: "exact agreement" })),
      ];
      const state = execution?.status === "pending" ? "pending" : r.status === "ambiguous" ? "ambiguous"
        : failedChecks.length ? "contradicted"
        : r.status === "refused" || (r.status === "unresolved" && !execution) ? "unsupported" : "unverified";
      return { ...unknown(state, failedChecks.length ? "Independent observation or semantic checks failed; no reconciliation was verified." : r.reason),
        failedChecks, route: r.route, measurements: r.measurements };
    }
    const witness = witnesses?.find(w => w.capability === this.#contract.checker.capability);
    const checked = verifyReconciliation(input, this.#contract.expected, r.output, witness?.output, this.#contract.checker.rulesDigest);
    if (!checked.valid || !witness) return { ...unknown("contradicted", "Observation evidence did not satisfy the reconciliation contract."), route: r.route, measurements: r.measurements };
    return { outcome: checked.differenceMinor === "0" ? "VERIFIED MATCH" : "VERIFIED MISMATCH", state: "verified",
      explanation: "Pinned independent observations agree on identity, period, currency, units and accounting basis. Amounts were compared exactly.",
      differenceMinor: checked.differenceMinor, route: r.route, durable: r.durable, measurements: r.measurements,
      evidence: { contractHash: await sha256(stableStringify(this.#contract)), inputHash: await sha256(stableStringify(input)),
        observationHash: await sha256(stableStringify({ candidate: r.output, witness: witness.output })),
        checkerContract: this.#contract.checker.contract, rulesDigest: this.#contract.checker.rulesDigest, goal: r.goal, witnessRun: witness.runId } };
  }
}
