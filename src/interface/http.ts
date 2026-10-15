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
import { DASHBOARD_HTML } from "./dashboard.ts";
import { handle, type JsonRpc } from "./mcp-server.ts";
import { TOOLS, dispatch } from "./tools.ts";

export interface HttpOptions {
  /** Bearer token required for every non-public route. */
  token?: string;
  /** Allow unauthenticated access (only sensible on loopback). */
  open?: boolean;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });

function authorized(req: Request, opts: HttpOptions): boolean {
  if (opts.open && !opts.token) return true;
  if (!opts.token) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (got.length !== opts.token.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ opts.token.charCodeAt(i);
  return diff === 0;
}

export function createHandler(rc: RightClick, opts: HttpOptions = {}): (req: Request) => Promise<Response> {
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
      return json({ rightclick: VERSION, name: rc.name, region: rc.info.region, runtime: rc.info.name, api: "/api", mcp: "/mcp", auth: opts.token ? "bearer" : opts.open ? "none" : "locked" });
    }
    if (req.method === "GET" && path === "/health") return json({ ok: true, version: VERSION });

    if (!authorized(req, opts)) {
      return json(
        {
          error: "unauthorized",
          hint: opts.token ? "Send Authorization: Bearer <RCX_TOKEN>." : "This deployment has no RCX_TOKEN set, so its API is locked. Set the RCX_TOKEN secret to enable it.",
        },
        401,
      );
    }

    try {
      if (path === "/mcp") {
        if (req.method !== "POST") return new Response("MCP endpoint: POST JSON-RPC here.", { status: 405, headers: { allow: "POST" } });
        const body = (await req.json()) as JsonRpc | JsonRpc[];
        const msgs = Array.isArray(body) ? body : [body];
        const out = (await Promise.all(msgs.map((m) => handle(rc, m)))).filter((m): m is JsonRpc => !!m);
        if (!out.length) return new Response(null, { status: 202 });
        return json(Array.isArray(body) ? out : out[0]);
      }
      if (req.method === "GET" && path === "/api/graph") return json(rc.exportGraph());
      if (req.method === "GET" && path === "/api/viz") return json(viz(rc));
      if (req.method === "GET" && path === "/events") return events(rc, Number(url.searchParams.get("since") ?? rc.graph.cursor));
      if (req.method === "GET" && path === "/api/tools") return json(TOOLS);
      if (req.method === "POST" && path === "/api/run") {
        const a = (await req.json()) as any;
        return json(await rc.run(a.id, a.args ?? {}, { verify: a.verify }));
      }
      const m = /^\/api\/(?:context_)?([a-z_]+)$/.exec(path);
      if (req.method === "POST" && m) {
        const name = `context_${m[1]}`;
        if (!TOOLS.some((t) => t.name === name)) return json({ error: `unknown tool ${name}` }, 404);
        const args = req.headers.get("content-length") === "0" ? {} : await req.json().catch(() => ({}));
        return json(await dispatch(rc, name, args as Record<string, unknown>));
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 400);
    }
  };
}

function viz(rc: RightClick) {
  const nodes = rc.graph.list().map((c) => ({ id: c.id, title: c.title, provider: c.provider, source: c.source }));
  const links: Array<[string, string]> = [];
  for (const [a, bs] of rc.graph.edges()) for (const b of bs) if (links.length < 4000) links.push([a, b]);
  return { nodes, links, powers: rc.graph.powers(), providers: rc.providers(), runtime: rc.runtime(), recent: rc.runStatus({ limit: 15 }) };
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
