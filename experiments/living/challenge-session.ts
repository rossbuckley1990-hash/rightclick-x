// Development supervisor. The runtime receives no issuer control channel,
// credentials, writable source tree, Docker socket or network interface.
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, chmodSync, copyFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { Readable } from "node:stream";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** Presentation is bounded and closes on pipe EOF or an operator signal. */
export async function holdPresentation(input: Readable = process.stdin, maximumMs = 300_000) {
  if (input.readableEnded || input.destroyed) return;
  await new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      input.off("data", done); input.off("end", done); input.off("close", done);
      process.off("SIGINT", done); process.off("SIGTERM", done);
      input.pause(); resolve();
    };
    const timer = setTimeout(done, maximumMs);
    input.once("data", done); input.once("end", done); input.once("close", done);
    process.once("SIGINT", done); process.once("SIGTERM", done);
    input.resume();
  });
}
export type Wire = { method: string; url: string; headers: Record<string, string>; body: string };
type Chunk = { body?: string; end?: boolean };
export class RpcPeer {
  private sequence = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private streams = new Map<number, (chunk: Chunk) => void>();
  private failure?: Error;
  readonly ready: Promise<any>;
  readonly exited: Promise<number | null>;
  readonly process: ChildProcessWithoutNullStreams;
  constructor(process: ChildProcessWithoutNullStreams, log: string,
    onFetch?: (request: Wire) => Promise<any>, onTool?: (row: unknown) => void) {
    this.process = process;
    writeFileSync(log, "", { flag: "wx" });
    let ready!: (v: any) => void, failed!: (e: Error) => void;
    this.ready = new Promise((yes, no) => { ready = yes; failed = no; });
    // Hosts without a ready message may exit cleanly after configure.
    void this.ready.catch(() => {});
    const lines = createInterface({ input: process.stdout });
    lines.on("line", line => {
      if (Buffer.byteLength(line) > 20 * 1024 * 1024) { process.kill("SIGTERM"); return; }
      let message: any;
      try { message = JSON.parse(line); } catch { process.kill("SIGTERM"); return; }
      appendFileSync(log, line + "\n");
      if (message.op === "ready") { ready(message); return; }
      if (message.op === "tool-observation") { onTool?.(message.row); return; }
      if (message.op === "fetch") {
        void (async () => {
          let reply: any;
          try { reply = onFetch ? await onFetch(message.request) : { refused: true, reason: "no transport configured" }; }
          catch { reply = { reason: "transport outcome unresolved" }; }
          if (!process.stdin.destroyed) process.stdin.write(JSON.stringify({ op: "fetch-result", id: message.id, ...reply }) + "\n");
        })();
        return;
      }
      if (message.op === "stream" || message.op === "stream-end") {
        this.streams.get(message.id)?.({ body: message.body, end: message.op === "stream-end" });
        if (message.op === "stream-end") this.streams.delete(message.id);
        return;
      }
      if (message.op !== "reply") return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(message.id);
      if (!message.value?.stream) this.streams.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message.value);
    });
    this.exited = new Promise(resolve => {
      const stop = (error: Error, code: number | null) => {
        if (this.failure) return;
        this.failure = error;
        failed(this.failure);
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(this.failure); }
        for (const callback of this.streams.values()) callback({ end: true });
        this.pending.clear(); this.streams.clear(); resolve(code);
      };
      process.once("exit", code => stop(new Error(`session process exited (${code})`), code));
      process.once("error", error => stop(error, null));
    });
  }
  call(op: string, args: object = {}, onChunk?: (chunk: Chunk) => void, signal?: AbortSignal): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`session ${op} timed out; not retried`)); }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      if (onChunk) this.streams.set(id, onChunk);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer); this.pending.delete(id);
        this.streams.get(id)?.({ end: true }); this.streams.delete(id);
        if (!this.process.stdin.destroyed) this.process.stdin.write(JSON.stringify({ op: "cancel", id }) + "\n");
        reject(new Error("session response cancelled; operation not retried"));
      }, { once: true });
      this.process.stdin.write(JSON.stringify({ op, id, ...args }) + "\n");
    });
  }
  async http(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const request: Wire = { method: body === undefined ? "GET" : "POST", url: "http://session.local" + path,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? "" : Buffer.from(JSON.stringify(body)).toString("base64") };
    const reply = await this.call("http", { request });
    if (reply.stream) throw new Error("use the streaming proxy for events");
    return new Response([204, 205, 304].includes(reply.status) ? null : Buffer.from(reply.body, "base64"), { status: reply.status, headers: reply.headers });
  }
}

export async function startContainedSession(options: { output: string; image: string; config: object;
  fetch: (request: Wire) => Promise<any>; onTool?: (row: unknown) => void }) {
  const output = resolve(options.output), stage = mkdtempSync(join(tmpdir(), "rcx-living-session-"));
  chmodSync(stage, 0o755);
  const name = "rcx-living-" + crypto.randomUUID().slice(0, 12);
  const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  let peer: RpcPeer | undefined;
  try {
    const built = execFileSync("bun", ["build", "experiments/living/challenge-host.ts", "--target", "node",
      "--outfile", join(stage, "host.mjs")], { cwd: root, encoding: "utf8" });
    writeFileSync(join(output, "host-build.log"), built);
    copyFileSync(join(stage, "host.mjs"), join(output, "host.mjs"));
    docker(["create", "--pull", "never", "--name", name, "-i", "--network", "none", "--read-only", "--user", "10000:10000",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m", "--mount", `type=bind,src=${stage},dst=/input,readonly`,
      "--workdir", "/tmp", "--entrypoint", "node", options.image, "/input/host.mjs"]);
    const info = JSON.parse(docker(["inspect", name]))[0], host = info.HostConfig;
    if (host.NetworkMode !== "none" || !host.ReadonlyRootfs || host.Privileged ||
        info.Config.User !== "10000:10000" || JSON.stringify(host.CapDrop) !== '["ALL"]' ||
        !host.SecurityOpt.includes("no-new-privileges") || info.Mounts.length !== 1 ||
        info.Mounts[0].Source !== stage || info.Mounts[0].RW || host.PidMode || host.IpcMode === "host")
      throw new Error("container boundary inspection failed");
    writeFileSync(join(output, "container.json"), JSON.stringify({ name, image: info.Image, host, mounts: info.Mounts, user: info.Config.User }, null, 2));
    const child = spawn("docker", ["start", "-a", "-i", name], { stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", data => appendFileSync(join(output, "host.stderr.log"), data));
    peer = new RpcPeer(child, join(output, "session.jsonl"), options.fetch, options.onTool);
    await peer.call("configure", { config: options.config });
    return { peer, close: async () => {
      try { await peer!.call("close"); peer!.process.stdin.end(); await peer!.exited; }
      finally { docker(["rm", "-f", name]); rmSync(stage, { recursive: true }); }
    } };
  } catch (error) {
    peer?.process.kill("SIGTERM");
    try { docker(["rm", "-f", name]); } catch {}
    rmSync(stage, { recursive: true });
    throw error;
  }
}

/** Loopback presentation of the same product handler, including live SSE. No
 * operator/issuer controls are exposed by this server. */
export async function presentSession(peer: RpcPeer) {
  const server = createServer(async (request, response) => {
    try {
      const abort = new AbortController();
      response.once("close", () => abort.abort());
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error("request exceeds bound");
        chunks.push(Buffer.from(chunk));
      }
      let controller!: ReadableStreamDefaultController<Uint8Array>, ended = false;
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
      const result = await peer.call("http", { request: { method: request.method,
        url: `http://${request.headers.host}${request.url}`, headers: request.headers,
        body: Buffer.concat(chunks).toString("base64") } }, chunk => {
        if (ended) return;
        if (chunk.end) { ended = true; controller.close(); }
        else if (chunk.body) controller.enqueue(Buffer.from(chunk.body, "base64"));
      }, abort.signal);
      response.writeHead(result.status, result.headers);
      if (!result.stream) { response.end(Buffer.from(result.body, "base64")); return; }
      const reader = stream.getReader();
      for (;;) { const chunk = await reader.read(); if (chunk.done || response.destroyed) break; response.write(chunk.value); }
      response.end();
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  }) };
}
