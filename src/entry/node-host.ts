// Server-runtime glue (Node, Bun, Deno): HTTP serving, stdio MCP, file state.

import type { RightClick, PersistedState, Store } from "../runtime.ts";
import { backupSuffix, decodeState, encodeState, FILE_STORE_CAS_REQUIREMENT, migrationReplaces } from "../core/state-format.ts";
import { StateConflictError } from "../core/state-conflict.ts";
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
  private tail: Promise<void> = Promise.resolve();
  /** The file as loaded, held until a save has replaced it: if that save changes its format or
   *  inference version, these exact bytes are kept on disk first. */
  private loaded?: { value: unknown; bytes: Uint8Array };
  // Undefined means the file has never been observed, null means it was absent.
  private expected?: Uint8Array | null;
  private onBackup?: (path: string) => void;
  constructor(file: string, opts: { onBackup?: (path: string) => void } = {}) {
    this.file = file;
    this.onBackup = opts.onBackup;
  }
  async load(): Promise<PersistedState | null> {
    const fs = await import("node:fs/promises");
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.expected = null; this.loaded = undefined; return null; }
      throw error;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    const state = decodeState(value);
    this.loaded = { value, bytes };
    this.expected = bytes;
    return state;
  }
  async save(state: PersistedState): Promise<void> {
    // Capture the caller's snapshot before yielding; later graph mutations must
    // not change an already requested save. A flush queues behind prior saves.
    const protectedState = state.version === 2 ? { ...state, requirements: [...new Set([...(state.requirements ?? []), FILE_STORE_CAS_REQUIREMENT])] } : state;
    const content = encodeState(protectedState);
    const next = this.tail.then(() => this.write(content, protectedState));
    this.tail = next.catch(() => {});
    return next;
  }
  private async write(content: string, state: PersistedState): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Cooperating writers serialize the read/compare/rename sequence. A lock left
    // by a crash is intentionally not stolen: an operator must investigate it.
    const lock = `${this.file}.lock`;
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new StateConflictError("another writer holds the file lock");
      throw error;
    }
    try {
      let current: Uint8Array | null;
      try { current = await fs.readFile(this.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") current = null; else throw error; }
      // An uninitialized adapter may create a new file, but must not overwrite an
      // existing snapshot it never observed. A stale snapshot must be reloaded.
      const expected = this.expected === undefined ? null : this.expected;
      const same = current === null ? expected === null : expected !== null && current.length === expected.length && current.every((b, i) => b === expected[i]);
      if (!same) throw new StateConflictError("persisted snapshot changed; restart and reload before saving");
      // Keep a byte-exact backup before replacing an older format.
      const replaced = this.loaded && migrationReplaces(this.loaded.value, state);
      let backup: string | undefined;
      if (replaced) {
        backup = `${this.file}${backupSuffix(replaced)}`;
        const handle = await fs.open(backup, "wx", 0o600);
        try {
          await handle.writeFile(this.loaded!.bytes);
          await handle.sync();
        } finally { await handle.close(); }
      }
      // Distinct staging paths avoid collisions; the lock and snapshot check above
      // provide the cooperating-writer protection.
      const tmp = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(tmp, "wx", 0o600);
      try {
        try { await handle.writeFile(content); }
        finally { await handle.close(); }
        await fs.rename(tmp, this.file);
        this.expected = new TextEncoder().encode(content);
        this.loaded = undefined;
        if (backup) this.onBackup?.(backup);
      } finally {
        await fs.unlink(tmp).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    } finally { await fs.rmdir(lock); }
  }
}
