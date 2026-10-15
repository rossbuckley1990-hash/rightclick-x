// Networking shared by every reflector and executor.
//
// Credentials are origin-pinned: a header configured for https://api.a.com is
// attached only to requests whose origin is exactly that, so a reflected
// capability (or a redirect) can never carry a key to some other host.

import type { FetchLike } from "../core/types.ts";

export class Authority {
  private byOrigin = new Map<string, Record<string, string>>();

  set(originOrUrl: string, headers: Record<string, string>): void {
    this.byOrigin.set(new URL(originOrUrl).origin, headers);
  }

  headersFor(url: string): Record<string, string> {
    try {
      return this.byOrigin.get(new URL(url).origin) ?? {};
    } catch {
      return {};
    }
  }

  origins(): string[] {
    return [...this.byOrigin.keys()];
  }

  /** A non-reversible fingerprint per origin, to notice when credentials change. */
  async fingerprints(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [origin, headers] of this.byOrigin) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(headers)));
      out[origin] = [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return out;
  }

  /**
   * Load from RCX_AUTH, a JSON object of origin -> header value or header map:
   *   {"https://api.example.com": "Bearer abc", "https://x.dev": {"X-Key": "k"}}
   */
  loadEnv(raw: string | undefined): void {
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string | Record<string, string>>;
    for (const [origin, v] of Object.entries(parsed)) {
      this.set(origin, typeof v === "string" ? { Authorization: v } : v);
    }
  }
}

export interface NetworkPolicy {
  /** Refuse private, loopback, link-local and metadata addresses (SSRF protection). */
  blockPrivate: boolean;
  /** Hosts or origins allowed even when private, e.g. "localhost:8080" or "http://10.0.0.5". */
  allow?: string[];
  /** Hosts always refused. */
  deny?: string[];
}

export interface Net {
  fetch: FetchLike;
  auth: Authority;
  timeoutMs: number;
  policy?: NetworkPolicy;
}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "169.254.169.254", "fd00:ec2::254"]);

export function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || METADATA_HOSTS.has(h)) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateAddress(mapped[1]);
  }
  return false;
}

/** Throws if the URL is not allowed by the network policy. Resolves hostnames on server runtimes. */
export async function checkUrl(policy: NetworkPolicy | undefined, raw: string): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`blocked by network policy: ${u.protocol} URLs are not allowed`);
  if (!policy) return;
  const matches = (list?: string[]) => (list ?? []).some((x) => x === u.host || x === u.hostname || x === u.origin);
  if (matches(policy.deny)) throw new Error(`blocked by network policy: ${u.host} is denied`);
  if (!policy.blockPrivate || matches(policy.allow)) return;
  if (isPrivateAddress(u.hostname)) throw new Error(`blocked by network policy: ${u.hostname} is a private or metadata address`);
  // DNS can point a public-looking name at a private address; check what it resolves to.
  const g = globalThis as any;
  if (g.process?.versions?.node && !/^[\d.]+$|:/.test(u.hostname)) {
    try {
      const dns = await import("node:dns/promises");
      const addrs = await dns.lookup(u.hostname, { all: true });
      if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`blocked by network policy: ${u.hostname} resolves to a private address`);
    } catch (e) {
      if (String((e as Error).message).startsWith("blocked")) throw e;
    }
  }
}

export async function request(net: Net, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(net.auth.headersFor(url))) if (!headers.has(k)) headers.set(k, v);
  if (!headers.has("user-agent")) headers.set("user-agent", "rightclick-x/0.1 (+https://github.com/rossbuckley1990-hash/rightclick)");
  await checkUrl(net.policy, url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${net.timeoutMs}ms: ${url}`)), net.timeoutMs);
  try {
    // Manual redirects: follow only same-origin hops so pinned credentials stay put.
    let res = await net.fetch(url, { ...init, headers, signal: ctrl.signal, redirect: "manual" });
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops++ < 5) {
      const next = new URL(res.headers.get("location")!, url).toString();
      await checkUrl(net.policy, next);
      const sameOrigin = new URL(next).origin === new URL(url).origin;
      const h = new Headers(headers);
      if (!sameOrigin) for (const k of Object.keys(net.auth.headersFor(url))) h.delete(k);
      for (const [k, v] of Object.entries(net.auth.headersFor(next))) h.set(k, v);
      const method = res.status === 303 ? "GET" : init.method;
      res = await net.fetch(next, { ...init, method, body: method === "GET" ? undefined : init.body, headers: h, signal: ctrl.signal, redirect: "manual" });
      url = next;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("json") || /^\s*[{[]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  return text;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "x"
  );
}
