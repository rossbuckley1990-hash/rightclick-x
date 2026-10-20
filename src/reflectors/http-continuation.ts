// A deliberately narrow HTTP profile: 202 status resource(s), then 303 to a
// result representation. A 200 monitor is not a completion signal. No inferred
// body-state vocabulary, arbitrary URL probing, write replay or repair.
import type { Capability } from "../core/types.ts";
import { sha256, stableStringify } from "../core/ledger.ts";
import { isSensitiveName } from "../core/secrets.ts";
import { cancelBody, readBody, request, type Net } from "./net.ts";

export interface HttpContinuationOptions { maxRequests?: number; timeoutMs?: number }
export interface HttpContinuationEvidence {
  profile: "http-202-303";
  stopped: "result" | "disabled" | "no-location" | "unknown-target" | "changed-contract" | "denied" | "rate-limited" | "budget" | "cancelled" | "unavailable" | "monitor-response" | "unsupported-status";
  requests: Array<{ capability: string; contractDigest: string; actionDigest: string; status?: number }>;
}
export type ContinuationPolicy = { maxRequests: number; timeoutMs: number };
export function continuationPolicy(opts?: HttpContinuationOptions | false): ContinuationPolicy {
  if (opts === false) return { maxRequests: 0, timeoutMs: 1 };
  const maxRequests = opts?.maxRequests ?? 4, timeoutMs = opts?.timeoutMs ?? 20_000;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 8 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("invalid HTTP continuation budget: 1..8 requests, 1..30000ms");
  }
  return { maxRequests, timeoutMs };
}

/** Snapshot before dispatch: a response cannot introduce its own execution route. */
export function continuationTargets(cap: Capability, graph: Capability[]) {
  const candidates = graph.filter(c => c.provider === cap.provider && c.risk === "read" && c.invoke.kind === "http" &&
    c.invoke.method === "GET" && !c.invoke.entry);
  // Refuse an oversized routing set rather than taking a misleading subset.
  if (candidates.length > 128) return [];
  return candidates.map(c => ({ cap: structuredClone(c), signature: contractIdentity(c) }));
}
type Target = ReturnType<typeof continuationTargets>[number];
// Exact local comparison, including risk/provider. This is not an authority
// signature or proof. Use the existing receipt digest only for recorded evidence.
function contractIdentity(c: Capability) {
  return stableStringify({ id: c.id, provider: c.provider, risk: c.risk, inputs: c.inputs,
    outputs: c.outputs.filter(p => !p.observed), invoke: c.invoke });
}

/** Match the transport route without reinterpreting a string as another resource identity. */
function routeArgs(cap: Capability, url: URL): Record<string, string> | undefined {
  const inv = cap.invoke;
  if (inv.kind !== "http" || inv.multiSegment?.length) return;
  const base = new URL(inv.url);
  if (base.origin !== url.origin || base.search || base.hash) return;
  const from = base.pathname.split("/"), to = url.pathname.split("/");
  if (from.length !== to.length) return;
  const args: Record<string, string> = Object.create(null);
  for (let i = 0; i < from.length; i++) {
    // URL serialisation escapes template braces.
    const param = /^\{([^{}]+)\}$/.exec(decodeURIComponent(from[i]));
    if (param && inv.pathParams.includes(param[1])) {
      if (!to[i] || args[param[1]] !== undefined) return;
      args[param[1]] = decodeURIComponent(to[i]);
      if (args[param[1]].includes("/")) return;
    } else if (from[i] !== to[i]) return;
  }
  for (const [k, v] of url.searchParams) {
    if (args[k] !== undefined || isSensitiveName(k) ||
        !inv.queryParams.includes(k) && !Object.hasOwn(inv.constants ?? {}, k)) return;
    if (Object.hasOwn(inv.constants ?? {}, k) && inv.constants![k] !== v) return;
    args[k] = v;
  }
  if (Object.entries(inv.constants ?? {}).some(([k, v]) => args[k] !== v) ||
      cap.inputs.some(p => p.required && args[p.name] === undefined)) return;
  return args;
}

function delay(res: Response): number {
  const value = res.headers.get("retry-after");
  if (!value) return 100;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // Date.parse also accepts non-HTTP strings such as "0.5". Do not turn an
  // invalid retry instruction into immediate polling. Obsolete date forms
  // are conservatively unsupported by this bounded profile.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return Infinity;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toUTCString() === value ? Math.max(0, date - Date.now()) : Infinity;
}
async function wait(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!ms) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function followHttp202(opts: {
  response: Response; url: string; targets: Target[]; net: Net; policy: ContinuationPolicy;
  current: (id: string) => Capability | undefined;
  authorize: (cap: Capability, args: Record<string, string>) => void;
  signal?: AbortSignal;
}): Promise<{ evidence: HttpContinuationEvidence; output?: unknown }> {
  const evidence: HttpContinuationEvidence = { profile: "http-202-303", stopped: "disabled", requests: [] };
  const stop = (reason: HttpContinuationEvidence["stopped"], res?: Response) => {
    if (res) cancelBody(res);
    evidence.stopped = reason;
    return { evidence };
  };
  let res = opts.response, url = opts.url, result = false;
  const origin = new URL(url).origin, deadline = Date.now() + opts.policy.timeoutMs;
  if (!opts.policy.maxRequests) return stop("disabled", res);
  // The initial transport may already have followed a redirect. This profile
  // does not guess a continuation context for that different resource.
  if (res.url && res.url !== url) return stop("unknown-target", res);
  for (let i = 0; i < opts.policy.maxRequests; i++) {
    if (opts.signal?.aborted) return stop("cancelled", res);
    const location = res.headers.get("location");
    if (!location && (i === 0 || res.status === 303)) return stop("no-location", res);
    let next: URL, match: Array<{ target: Target; args: Record<string, string> }>;
    try {
      next = new URL(location ?? url, url);
      if (next.origin !== origin || next.username || next.password || next.hash || next.href.length > 4096) return stop("unknown-target", res);
      match = opts.targets.flatMap(target => {
        const args = routeArgs(target.cap, next);
        return args ? [{ target, args }] : [];
      });
    } catch { return stop("unknown-target", res); }
    if (match.length !== 1) return stop("unknown-target", res);
    const { target, args } = match[0];
    const pause = delay(res);
    if (!Number.isFinite(pause) || Date.now() + pause >= deadline) return stop("budget", res);
    result = res.status === 303;
    cancelBody(res);
    try { await wait(pause, opts.signal); }
    catch { return stop("cancelled"); }
    const observation: HttpContinuationEvidence["requests"][number] = {
      capability: target.cap.id, contractDigest: await sha256(target.signature),
      actionDigest: await sha256(JSON.stringify({ method: "GET", url: next.href })),
    };
    // Hashing yields: recheck authority and the contract after it, immediately
    // before transport dispatch. Independent transport enforcement is still required.
    const current = opts.current(target.cap.id);
    if (!current || contractIdentity(current) !== target.signature) return stop("changed-contract");
    try { opts.authorize(current, args); }
    catch { return stop("denied"); }
    if (opts.signal?.aborted) return stop("cancelled");
    if (Date.now() >= deadline) return stop("budget");
    evidence.requests.push(observation);
    try {
      // No caller headers, content-negotiation retry, automatic redirects or
      // initial action replay. The normal origin credential broker is used.
      res = await request({ ...opts.net, timeoutMs: Math.min(opts.net.timeoutMs, deadline - Date.now()) },
        next.href, { method: "GET", headers: { accept: "application/json" }, redirect: "manual", signal: opts.signal });
      observation.status = res.status;
      url = next.href;
      if (res.status === 200) {
        if (!result) return stop("monitor-response", res);
        const output = await readBody(res, 16 * 1024 * 1024);
        if (output === "" || output === undefined) return stop("unsupported-status");
        evidence.stopped = "result";
        return { evidence, output };
      }
      if (res.status === 401 || res.status === 403) return stop("denied", res);
      if (res.status === 429) return stop("rate-limited", res);
      if (res.status >= 500 || res.status === 404 || res.status === 410) return stop("unavailable", res);
      if (res.status !== 202 && res.status !== 303) return stop("unsupported-status", res);
    } catch (error) {
      const denied = /^blocked by (network|egress) policy/.test(String((error as Error)?.message));
      return stop(opts.signal?.aborted ? "cancelled" : denied ? "denied" : "unavailable");
    }
  }
  return stop("budget", res);
}
