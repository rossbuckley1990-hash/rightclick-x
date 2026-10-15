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

export interface Net {
  fetch: FetchLike;
  auth: Authority;
  timeoutMs: number;
}

export async function request(net: Net, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(net.auth.headersFor(url))) if (!headers.has(k)) headers.set(k, v);
  if (!headers.has("user-agent")) headers.set("user-agent", "rightclick-x/0.1 (+https://github.com/rossbuckley1990-hash/rightclick)");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${net.timeoutMs}ms: ${url}`)), net.timeoutMs);
  try {
    // Manual redirects: follow only same-origin hops so pinned credentials stay put.
    let res = await net.fetch(url, { ...init, headers, signal: ctrl.signal, redirect: "manual" });
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops++ < 5) {
      const next = new URL(res.headers.get("location")!, url).toString();
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
