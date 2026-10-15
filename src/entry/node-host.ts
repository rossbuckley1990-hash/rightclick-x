// Server-runtime glue (Node, Bun, Deno): HTTP serving, stdio MCP, file state.

import type { RightClick, PersistedState, Store } from "../runtime.ts";
import { handle, type JsonRpc } from "../interface/mcp-server.ts";

export type FetchHandler = (req: Request) => Promise<Response>;

export interface Served {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serve a fetch handler. Uses Bun.serve / Deno.serve natively, node:http otherwise. */
export async function serve(handler: FetchHandler, port = 8787, hostname = "127.0.0.1"): Promise<Served> {
  const g = globalThis as any;
  if (g.Bun?.serve) {
    const s = g.Bun.serve({ port, hostname, fetch: handler, idleTimeout: 0 });
    return { url: `http://${hostname}:${s.port}`, port: s.port, close: async () => s.stop(true) };
  }
  if (g.Deno?.serve) {
    const s = g.Deno.serve({ port, hostname, onListen() {} }, handler);
    return { url: `http://${hostname}:${s.addr.port}`, port: s.addr.port, close: () => s.shutdown() };
  }
  const http = await import("node:http");
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const request = new Request(`http://${req.headers.host ?? `${hostname}:${port}`}${req.url}`, {
        method: req.method,
        headers,
        body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return res.end();
      const reader = response.body.getReader();
      req.on("close", () => reader.cancel().catch(() => {}));
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error)?.message ?? e));
    }
  });
  await new Promise<void>((r) => server.listen(port, hostname, r));
  const actual = (server.address() as { port: number }).port;
  return {
    url: `http://${hostname}:${actual}`,
    port: actual,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

/** MCP over stdio: newline-delimited JSON-RPC. Logs go to stderr only. */
export async function serveStdio(rc: RightClick): Promise<void> {
  const g = globalThis as any;
  const proc = g.process;
  let buf = "";
  proc.stdin.setEncoding("utf8");
  proc.stdin.on("data", async (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: JsonRpc | JsonRpc[];
      try {
        msg = JSON.parse(line);
      } catch {
        proc.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
        continue;
      }
      const msgs = Array.isArray(msg) ? msg : [msg];
      for (const m of msgs) {
        const out = await handle(rc, m);
        if (out) proc.stdout.write(JSON.stringify(out) + "\n");
      }
    }
  });
  await new Promise<void>((r) => proc.stdin.on("end", r));
  await rc.flush();
}

export class FileStore implements Store {
  private file: string;
  constructor(file: string) {
    this.file = file;
  }
  async load(): Promise<PersistedState | null> {
    const fs = await import("node:fs/promises");
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }
  async save(state: PersistedState): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state));
    await fs.rename(tmp, this.file);
  }
}
