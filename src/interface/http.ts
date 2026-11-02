// One web-standard fetch handler: (Request) => Response. It runs unchanged on
// Cloudflare Workers, Deno Deploy, Bun.serve, Vercel/Netlify edge, and Node
// (via the adapter in entry/node-http.ts).
//
// Routes
//   GET  /                              live dashboard
//   GET  /.well-known/rightclick.json   public manifest (lets peers find us)
//   POST /mcp                           MCP Streamable HTTP (JSON responses)
//   GET  /api/graph                     graph export, used by federation
//   GET  /api/viz                       nodes + edges for the dashboard
//   GET  /events                        server-sent event stream of graph changes
//   POST /api/run                       run a capability (peers call this)
//   POST /api/<tool>                    any context_* tool, JSON in/out

import { VERSION, type RightClick } from "../runtime.ts";
import { clientErrorText, ClientFacingError, toClientError } from "./client-error.ts";
import { DASHBOARD_HTML } from "./dashboard.ts";
import { dashboardMetrics, capabilityPage, capabilityState } from "./dashboard-state.ts";
import { executeGraphQL } from "./graphql-server.ts";
import { handle, type JsonRpc } from "./mcp-server.ts";
import { TOOLS, dispatch } from "./tools.ts";
import { authorityEvidenceReader, type AuthorityEvidenceSource } from "./authority-evidence.ts";

export interface HttpOptions {
  /** Bearer token required for every non-public route. */
  token?: string;
  /** Allow unauthenticated access (only sensible on loopback). */
  open?: boolean;
  /** Largest accepted request body (default 1 MiB). Enforced on the actual bytes, so
   *  chunked transfer or a missing content-length cannot bypass it. */
  maxBodyBytes?: number;
  /** Requests per minute per caller. Pre-authentication requests share a bounded bucket
   *  keyed on the connection's remote address (or one global bucket when the host does not
   *  expose one); a verified credential gets its own bucket. Default 600, 0 disables. */
  ratePerMinute?: number;
  /** Trust proxy-set client addresses (`x-forwarded-for`, `cf-connecting-ip`) when bucketing.
 *  Enable only when every request reaches this handler through a proxy you control that
   *  overwrites these headers; a direct-to-origin client can set them itself. Default false. */
  trustProxyHeaders?: boolean;
  /** The connection's remote address, when the host exposes one (the Node adapter attaches
   *  `req.socket.remoteAddress` automatically). Used to bucket unauthenticated traffic;
   *  never a client-supplied value. */
  remoteAddress?: (req: Request) => string | undefined;
  /** Optional host-owned native verifier. Read-only evidence, never execution permission. */
  authorityEvidence?: AuthorityEvidenceSource;
}

/** Where the Node adapter pins the socket's remote address onto the web-standard Request. */
export const REMOTE_ADDRESS: unique symbol = Symbol("rcx.remoteAddress");

/** The remote address the request actually came from, or undefined when the host does not
 *  expose one (edge runtimes): then unauthenticated traffic shares one global bucket. */
function remoteAddressOf(req: Request, opts: HttpOptions): string | undefined {
  const hooked = opts.remoteAddress?.(req);
  if (hooked) return hooked;
  const attached = (req as unknown as Record<symbol, unknown>)[REMOTE_ADDRESS];
  return typeof attached === "string" && attached ? attached : undefined;
}

/** Canonical form of a peer address: IPv4-mapped IPv6 collapses to IPv4, the zone index
 *  and case are normalized, and a trailing port is dropped for both families. */
export function normalizeAddress(address: string): string {
  let a = address.trim().toLowerCase();
  a = a.replace(/%[\w.]+$/, ""); // zone index (fe80::1%eth0)
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4mapped) a = v4mapped[1];
  const bracketed = /^\[(.+)\]:(\d+)$/.exec(a);
  if (bracketed) return bracketed[1];
  const v4port = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(a);
  if (v4port) return v4port[1];
  return a;
}

/** The address a pre-authentication request is bucketed on. Order of trust:
 *  the connection's remote address; then — only behind an explicitly configured trusted
 *  proxy — the proxy-set client address (the LAST x-forwarded-for entry: the one the proxy
 *  appended), or the platform-set cf-connecting-ip. A client-supplied prefix or an
 *  untrusted header never selects a bucket. */
function preAuthKey(req: Request, opts: HttpOptions): string {
  const remote = remoteAddressOf(req, opts);
  if (remote) return "addr:" + normalizeAddress(remote);
  if (opts.trustProxyHeaders) {
    const cf = req.headers.get("cf-connecting-ip"); // set by the Cloudflare edge, not the caller — behind a trusted proxy
    if (cf) return "cf:" + normalizeAddress(cf);
    const xff = req.headers.get("x-forwarded-for");
    const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return "xff:" + normalizeAddress(last);
  }
  return "preauth"; // no host-provided address: every unauthenticated request shares one bucket
}

/** FNV-1a: fast, non-cryptographic. Bucket identity only — the credential is never stored. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Token-bucket rate limiter, keyed per caller. Bounded: at most `maxBuckets` tracked keys,
 *  least-recently-used evicted, so no amount of key spray grows its memory. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private perMinute: number;
  private maxBuckets: number;
  constructor(perMinute: number, maxBuckets = 4096) {
    this.perMinute = perMinute;
    this.maxBuckets = maxBuckets;
  }
  take(key: string): boolean {
    if (!this.perMinute) return true;
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    // Re-insert so eviction order is usage order, not creation order.
    this.buckets.delete(key);
    const allowed = b.tokens >= 1;
    if (allowed) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxBuckets) this.buckets.delete(this.buckets.keys().next().value!);
    return allowed;
  }
  /** Test visibility into the bound: how many buckets are tracked. */
  tracked(): number { return this.buckets.size; }
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });

/** The client error boundary for HTTP routes (H2, #38): a stable code and a safe message;
 *  raw exception text stays in the server log, referenced by the opaque ref. */
function clientError(e: unknown, args?: Record<string, unknown>, status = 400): Response {
  const view = toClientError(e, args);
  if (view.ref) console.error(`[rcx-diagnostic ${view.ref}] ${String(view.detail).slice(0, 500)}`);
  return json({ error: clientErrorText(view), ...(view.ref ? { ref: view.ref } : {}) }, status);
}

function authorized(req: Request, opts: HttpOptions): boolean {
  if (opts.open && !opts.token) return true;
  if (!opts.token) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (got.length !== opts.token.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ opts.token.charCodeAt(i);
  return diff === 0;
}

/** Body over the configured cap: refused whether or not content-length said so. */
class BodyTooLarge extends Error {
  constructor(maxBytes: number) {
    super(`request body larger than ${maxBytes} bytes`);
  }
}

/** Reads the body while enforcing the cap on the actual bytes, so chunked transfer or a
 *  missing content-length cannot bypass it. */
async function readBody(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** JSON body under the cap. Strict mode throws on bad JSON (the route answers 400); lenient
 *  mode keeps the previous `{}` semantics of the parse sites. */
async function readJson(req: Request, maxBytes: number, lenient = false): Promise<any> {
  const text = await readBody(req, maxBytes);
  if (!text) {
    if (lenient) return {};
    throw new ClientFacingError("invalid_argument", "request body must be valid JSON");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    if (lenient) return {};
    throw e instanceof SyntaxError ? new ClientFacingError("invalid_argument", "request body must be valid JSON") : e;
  }
}

export function createHandler(rc: RightClick, opts: HttpOptions = {}): (req: Request) => Promise<Response> {
  const limiter = new RateLimiter(opts.ratePerMinute ?? 600);
  const maxBody = opts.maxBodyBytes ?? 1024 * 1024;
  // Identity is established only AFTER authentication succeeds: the bucket key for an
  // authenticated caller is derived from the server's own configured credential, so no
  // client-supplied value can ever select it. Unauthenticated requests are bucketed on the
  // connection's real address (or one shared bucket), which invented bearer tokens cannot rotate.
  const principalKey = opts.token ? "authed:" + hash32(opts.token) : undefined;
  const authorityEvidence = authorityEvidenceReader(opts.authorityEvidence, link =>
    link.runtimeId === rc.activity.epoch &&
    !!rc.activity.forRun(link.runId)?.subjects?.includes(link.capabilityId));
  return async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
        },
      });
    }
    if (req.method === "GET" && path === "/") {
      return new Response(DASHBOARD_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (req.method === "GET" && path === "/.well-known/rightclick.json") {
      return json({ rightclick: VERSION, name: rc.name, region: rc.info.region, runtime: rc.info.name, api: "/api", mcp: "/mcp", openapi: "/openapi.json", graphql: "/graphql", auth: opts.token ? "bearer" : opts.open ? "none" : "locked" });
    }
    if (req.method === "GET" && path === "/health") return json({ ok: true, version: VERSION });

    // Identity before limiting: authentication is a constant-time compare against the
    // operator's configured credential, so it is safe to run first. A request that
    // authenticates is bucketed only on the verified principal — the key is derived from
    // the server's own configuration, not from anything the client sent, so no header or
    // token spray can select or rotate it. A request that does not authenticate draws from
    // a bounded pre-authentication bucket keyed on where the connection actually came
    // from; rotating invented bearer tokens buys nothing.
    const preKey = preAuthKey(req, opts);
    // Fast path when the header is honest; readBody enforces the cap on the actual bytes too.
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > maxBody) return json({ error: new BodyTooLarge(maxBody).message }, 413);

    if (opts.token) {
      if (!authorized(req, opts)) {
        if (!limiter.take(preKey)) return json({ error: "rate limited", hint: "Slow down or raise ratePerMinute." }, 429);
        return json(
          {
            error: "unauthorized",
            hint: opts.token ? "Send Authorization: Bearer <RCX_TOKEN>." : "This deployment has no RCX_TOKEN set, so its API is locked. Set the RCX_TOKEN secret to enable it.",
          },
          401,
        );
      }
      // The verified principal's own budget: attacker noise on the shared address bucket
      // can never throttle a legitimate authenticated caller.
      if (!limiter.take(principalKey!)) return json({ error: "rate limited", hint: "Slow down or raise ratePerMinute." }, 429);
    } else if (opts.open) {
      // Tokenless open deployment: the connection's address bucket is the only limit.
      if (!limiter.take(preKey)) return json({ error: "rate limited", hint: "Slow down or raise ratePerMinute." }, 429);
    } else {
      // No credential configured and not open: the API is locked. The answer is static,
      // but the bounded pre-authentication limit still applies so a flood cannot proceed
      // unchecked.
      if (!limiter.take(preKey)) return json({ error: "rate limited", hint: "Slow down or raise ratePerMinute." }, 429);
      return json(
        { error: "unauthorized", hint: "This deployment has no RCX_TOKEN set, so its API is locked. Set the RCX_TOKEN secret to enable it." },
        401,
      );
    }

    try {
      if (path === "/mcp") {
        if (req.method !== "POST") return new Response("MCP endpoint: POST JSON-RPC here.", { status: 405, headers: { allow: "POST" } });
        const body = (await readJson(req, maxBody)) as JsonRpc | JsonRpc[];
        const msgs = Array.isArray(body) ? body : [body];
        const out = (await Promise.all(msgs.map((m) => handle(rc, m)))).filter((m): m is JsonRpc => !!m);
        if (!out.length) return new Response(null, { status: 202 });
        return json(Array.isArray(body) ? out : out[0]);
      }
      if (req.method === "GET" && path === "/api/graph") return json(rc.exportGraph());
      if (req.method === "GET" && path === "/openapi.json") return json(rc.openApi(url.origin));
      if (req.method === "POST" && path === "/graphql") return json(await executeGraphQL(rc, (await readJson(req, maxBody, true)) as any));
      const x = /^\/x\/([a-z0-9-]+)$/.exec(path);
      if (x && (req.method === "GET" || req.method === "POST")) {
        // GET is safe by HTTP's contract (links, prefetch, crawlers): only read-only goals answer it.
        const risk = rc.graph.get(`goal:${x[1]}`)?.risk;
        if (req.method === "GET" && risk && risk !== "read") return new Response(JSON.stringify({ error: `goal ${x[1]} can change state (${risk}); use POST` }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
        // Lenient read: malformed JSON keeps the historical {} semantics; an oversized body
        // still throws BodyTooLarge up to the outer catch (413), never silently swallowed.
        const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : ((await readJson(req, maxBody, true)) as Record<string, unknown>);
        try {
          const out = await rc.callPublished(x[1], args);
          return json(out, out.status === "pending" ? 202 : out.ok ? 200 : 502);
        } catch (e) {
          return clientError(e, args);
        }
      }
      if (req.method === "GET" && path === "/api/viz") return json(viz(rc));
      if (req.method === "GET" && path === "/api/authority-evidence") return json(await authorityEvidence());
      if (req.method === "GET" && path === "/api/overview") return json({
        metrics: dashboardMetrics(rc), runtime: rc.runtime(), providers: rc.providers().slice(0, 200).map(p => ({ id: p.id, title: p.title, source: p.source, capabilities: p.capabilities })),
        providerCount: rc.graph.providers.size, providersOmitted: Math.max(0, rc.graph.providers.size - 200),
      });
      if (req.method === "GET" && path === "/api/activity") return json(rc.activity.read({
        after: url.searchParams.has("after") ? Number(url.searchParams.get("after")) : undefined,
        epoch: url.searchParams.get("epoch") ?? undefined, limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
      }));
      if (req.method === "GET" && path === "/api/capability") return json(capabilityState(rc, url.searchParams.get("id") ?? ""));
      if (req.method === "GET" && path === "/api/capabilities") return json(capabilityPage(rc, {
        search: url.searchParams.get("search") ?? undefined, provider: url.searchParams.get("provider") ?? undefined,
        offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 25),
      }));
      if (req.method === "GET" && path === "/events") return events(rc, Number(url.searchParams.get("since") ?? rc.graph.cursor));
      if (req.method === "GET" && path === "/api/tools") return json(TOOLS);
      if (req.method === "POST" && path === "/api/run") {
        const a = (await readJson(req, maxBody)) as any;
        try {
          return json(await rc.run(a.id, a.args ?? {}, { verify: a.verify, acknowledgeChange: a.acknowledgeChange }));
        } catch (e) {
          return clientError(e, a.args);
        }
      }
      const m = /^\/api\/(?:context_)?([a-z_]+)$/.exec(path);
      if (req.method === "POST" && m) {
        const name = `context_${m[1]}`;
        if (!TOOLS.some((t) => t.name === name)) return json({ error: `unknown tool ${name}` }, 404);
        const args = await readJson(req, maxBody, true);
        try {
          return json(await dispatch(rc, name, args));
        } catch (e) {
          return clientError(e, args);
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof BodyTooLarge) return json({ error: e.message }, 413);
      return clientError(e);
    }
  };
}

function viz(rc: RightClick) {
  const nodes = rc.graph.list().map((c) => ({ id: c.id, title: c.title, provider: c.provider, source: c.source }));
  const links = rc.graph.sampleEdges(4000);
  return { nodes, links, powers: rc.graph.powers(), metrics: dashboardMetrics(rc), providers: rc.providers(), runtime: rc.runtime(), recent: rc.runStatus({ limit: 15 }) };
}

function events(rc: RightClick, since: number): Response {
  const enc = new TextEncoder();
  let off: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (e: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      for (const e of rc.graph.since(since)) send(e);
      off = rc.graph.subscribe(send);
      ping = setInterval(() => ctrl.enqueue(enc.encode(`: ping\n\n`)), 15_000);
    },
    cancel() {
      off?.();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
