// Optional host-owned evidence reader. This interface never grants authority,
// validates proofs itself, or participates in planning/dispatch/persistence.
export interface AuthorityDecision {
  artifactDigest: string;
  actionDigest: string | null;
  targetDigest: string;
  principal: string;
  operation: string;
  outcome: "executed" | "refused" | "unresolved";
  reason: string | null;
  occurredAt: string;
}
export interface AuthorityEvidenceBatch { version: 1; verifiedAt: string; records: AuthorityDecision[] }
export interface AuthorityEvidenceSource {
  /** Operator-configured verifier and protected boundary, never provider metadata. */
  name: string;
  boundary: string;
  /** Fingerprint of the verification trust anchor, not a credential. */
  trustAnchor: string;
  read(signal: AbortSignal): Promise<AuthorityEvidenceBatch>;
  timeoutMs?: number;
}
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const label = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$/.test(v);
const time = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const scope = "Historical exact-action decisions checked by the operator-configured verifier. They do not grant current permission, establish business success, prove complete history or cover other execution routes. No runtime-call linkage is asserted.";

export function authorityEvidenceReader(source?: AuthorityEvidenceSource) {
  if (source && (!label(source.name) || !label(source.boundary) || !hash(source.trustAnchor) ||
      typeof source.read !== "function" || (source.timeoutMs !== undefined &&
      (!Number.isInteger(source.timeoutMs) || source.timeoutMs < 1 || source.timeoutMs > 5000)))) {
    throw new Error("invalid operator authority-evidence configuration");
  }
  // An uncooperative source cannot accumulate new requests after timing out.
  let pending: Promise<unknown> | undefined, controller: AbortController | undefined;
  return async () => {
    const readAt = new Date().toISOString();
    const base = { version: 1, readAt, scope, currentAuthority: "unknown", runtimeLinkage: "not-established",
      source: source ? { name: source.name, boundary: source.boundary, trustAnchor: source.trustAnchor } : null };
    if (!source) return { ...base, status: "not-configured", verifiedAt: null, records: [] };
    if (!pending) {
      controller = new AbortController();
      const signal = controller.signal;
      const task = Promise.resolve().then(() => source.read(signal));
      pending = task;
      void task.finally(() => { if (pending === task) pending = undefined; }).catch(() => {});
    }
    const currentController = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw: any = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { currentController?.abort(); reject(new Error("evidence unavailable")); }, source.timeoutMs ?? 1000);
      })]);
      const now = Date.now();
      if (!raw || raw.version !== 1 || !time(raw.verifiedAt) || Math.abs(now - Date.parse(raw.verifiedAt)) > 60_000 ||
          !Array.isArray(raw.records) || raw.records.length > 100) throw new Error("invalid evidence batch");
      const records: AuthorityDecision[] = raw.records.map((r: any) => {
        if (!r || !hash(r.artifactDigest) || !(r.actionDigest === null || hash(r.actionDigest)) ||
            !hash(r.targetDigest) || !label(r.principal) || !label(r.operation) ||
            !["executed", "refused", "unresolved"].includes(r.outcome) ||
            !(r.reason === null || label(r.reason)) || !time(r.occurredAt) ||
            Date.parse(r.occurredAt) > Date.parse(raw.verifiedAt) + 1000) throw new Error("invalid authority record");
        // Explicit projection: no proof, secret, body, URL or arbitrary provider
        // property can enter the dashboard merely by accompanying a record.
        return { artifactDigest: r.artifactDigest, actionDigest: r.actionDigest, targetDigest: r.targetDigest,
          principal: r.principal, operation: r.operation, outcome: r.outcome, reason: r.reason, occurredAt: r.occurredAt };
      });
      if (new Set(records.map(r => r.artifactDigest)).size !== records.length) throw new Error("duplicate authority artifact");
      return { ...base, status: "available", verifiedAt: raw.verifiedAt, records };
    } catch {
      return { ...base, status: "unavailable", verifiedAt: null, records: [] };
    } finally { if (timer) clearTimeout(timer); }
  };
}
