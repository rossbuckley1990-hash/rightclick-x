// Evaluation baseline only. No RightClick runtime, graph, planner or reflectors.
// Runs inside the same credential-free, network-none container as the candidate.
// Workers are isolation for accounting/cancellation, NOT a security boundary.
import { Worker } from "node:worker_threads";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const LIMIT = 256 * 1024;
export class CodeFiles {
  private files = new Map<string, string>();
  constructor(state: Record<string, string> = {}) { for (const [name, text] of Object.entries(state)) this.write(name, text); }
  write(name: string, text: string) {
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(name) || typeof text !== "string")
      throw new Error("expected flat logical filename and text");
    const bytes = Buffer.byteLength(text);
    const others = [...this.files].filter(([key]) => key !== name).reduce((n, [, value]) => n + Buffer.byteLength(value), 0);
    if (bytes > LIMIT || others + bytes > 2 * 1024 * 1024 || (!this.files.has(name) && this.files.size >= 64))
      throw new Error("file store bound exceeded");
    this.files.set(name, text); return { name, bytes };
  }
  read(name: string) { if (!this.files.has(name)) throw new Error("no such file"); return this.files.get(name)!; }
  list() { return [...this.files].map(([name, value]) => ({ name, bytes: Buffer.byteLength(value) })); }
  snapshot() { return Object.fromEntries(this.files); }
}

export type Wire = { method: string; url: string; headers: Record<string, string>; body: string };
export async function executeCode(code: string, input: unknown, transport: (wire: Wire) => Promise<any>, timeoutMs = 60_000) {
  if (typeof code !== "string" || Buffer.byteLength(code) > LIMIT || Buffer.byteLength(JSON.stringify(input ?? null)) > LIMIT)
    throw new Error("code/input bound exceeded");
  const bootstrap = `
    const { parentPort, workerData } = require('node:worker_threads');
    let id = 0; const pending = new Map();
    parentPort.on('message', reply => {
      const p = pending.get(reply.id); if (!p) return; pending.delete(reply.id);
      if (reply.error) p.reject(new Error(reply.error)); else p.resolve(reply.response);
    });
    async function bridge(url, init) {
      const request = new Request(url, init), key = ++id;
      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length > 65536) throw new Error('request bound exceeded');
      const response = await new Promise((resolve, reject) => {
        pending.set(key, {resolve, reject});
        parentPort.postMessage({op:'fetch',id:key,request:{url:request.url,method:request.method,
          headers:Object.fromEntries(request.headers),body:bytes.toString('base64')}});
      });
      return new Response([204,205,304].includes(response.status) ? null : Buffer.from(response.body,'base64'),response);
    }
    (async () => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const value = await new AsyncFunction('input','fetch',workerData.code)(workerData.input,bridge);
        parentPort.postMessage({op:'result',value});
      } catch (error) { parentPort.postMessage({op:'error',error:String(error)}); }
    })();`;
  const worker = new Worker(bootstrap, { eval: true, workerData: { code, input }, stdout: true, stderr: true });
  let stdout = "", stderr = "", bytes = 0, finished = false, calls = 0;
  const inflight = new Set<Promise<unknown>>();
  const started = performance.now();
  try {
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error("code timed out; not retried")), timeoutMs);
      const done = (error?: Error, value?: unknown) => {
        if (finished) return; finished = true; clearTimeout(timer);
        if (error) reject(error); else resolve({ value, stdout, stderr, fetches: calls, milliseconds: performance.now() - started });
      };
      const output = (data: Buffer, kind: "stdout" | "stderr") => {
        bytes += data.length;
        if (bytes > LIMIT) { done(new Error("code output bound exceeded")); return; }
        if (kind === "stdout") stdout += data; else stderr += data;
      };
      worker.stdout.on("data", data => output(data, "stdout"));
      worker.stderr.on("data", data => output(data, "stderr"));
      worker.on("error", error => done(error));
      worker.on("exit", code => { if (!finished) done(new Error(`code exited without result (${code})`)); });
      worker.on("message", async message => {
        if (finished) return;
        if (message.op === "result") {
          try {
            if (Buffer.byteLength(JSON.stringify(message.value) ?? "null") > LIMIT) throw new Error("result bound exceeded");
            done(undefined, message.value);
          } catch (error) { done(error as Error); }
        } else if (message.op === "error") done(new Error(String(message.error).slice(0, 4000)));
        else if (message.op === "fetch") {
          try {
            if (++calls > 32) throw new Error("code fetch bound exceeded");
            const request = transport(message.request); inflight.add(request);
            let response: any;
            try { response = await request; } finally { inflight.delete(request); }
            if (!finished) worker.postMessage({ id: message.id, response });
          } catch (error) { if (!finished) worker.postMessage({ id: message.id, error: String(error) }); }
        }
      });
    });
  } finally { finished = true; await worker.terminate(); await Promise.allSettled(inflight); }
}

export const codingTools = [
  { name: "run_code", description: "Execute JavaScript async function body in isolated Node. Use input and the provided fetch (standard Request/Response, only operator-approved public reads). Return a JSON value. Pass code OR a saved filename. Node builtins are available, but direct network, host files and credentials are unavailable. Code, input, output and timeout are bounded. No packages can be installed.",
    inputSchema: { type: "object", properties: { code: { type: "string" }, file: { type: "string" }, input: {} } } },
  { name: "list_files", description: "List persistent files retained across fresh agent sessions.", inputSchema: { type: "object", properties: {} } },
  { name: "read_file", description: "Read a retained code or documentation file.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "write_file", description: "Save code or documentation under a flat logical filename. Retained across fresh sessions; no host filesystem access.", inputSchema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } },
];

async function main() {
  const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
  let sequence = 0, configured = false, files = new CodeFiles(), queue = Promise.resolve();
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const bridge = (request: Wire) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("transport unresolved")); }, 40_000);
    pending.set(id, { resolve, reject, timer }); send({ op: "fetch", id, request });
  });
  const lines = createInterface({ input: process.stdin });
  const tool = async (name: string, args: any) => {
    if (name === "list_files") return files.list();
    if (name === "read_file") return files.read(args.name);
    if (name === "write_file") return files.write(args.name, args.content);
    if (name === "run_code") {
      if ((typeof args.code === "string") === (typeof args.file === "string")) throw new Error("provide code OR file");
      return executeCode(args.file === undefined ? args.code : files.read(args.file), args.input, bridge);
    }
    throw new Error("unknown tool");
  };
  const rpc = async (message: any) => {
    if (message.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "coding", version: "1" } };
    if (message.method === "tools/list") return { tools: codingTools };
    if (message.method === "tools/call") {
      const started = performance.now(); let result: any;
      try { result = { content: [{ type: "text", text: JSON.stringify(await tool(message.params.name, message.params.arguments ?? {})) }] }; }
      catch (error) { result = { isError: true, content: [{ type: "text", text: String(error) }] }; }
      send({ op: "tool-observation", row: { tool: message.params.name, args: message.params.arguments, result, milliseconds: performance.now() - started } });
      return result;
    }
    if (!message.method?.startsWith("notifications/")) throw new Error("unknown RPC method");
  };
  lines.on("line", line => {
    if (Buffer.byteLength(line) > 20 * 1024 * 1024) { process.exit(1); }
    const message = JSON.parse(line);
    if (message.op === "fetch-result") {
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (!message.response) item.reject(new Error(String(message.reason ?? "transport refused")));
      else item.resolve(message.response);
      return;
    }
    queue = queue.then(async () => {
      try {
        let value: any;
        if (message.op === "configure") {
          if (configured) throw new Error("already configured");
          files = new CodeFiles(message.config.state); configured = true; value = { ready: true, node: process.version };
        } else if (!configured) throw new Error("not configured");
        else if (message.op === "snapshot") value = { state: files.snapshot(), rss: process.memoryUsage().rss };
        else if (message.op === "http") {
          const req = message.request;
          if (req.method !== "POST" || new URL(req.url).pathname !== "/mcp") value = { status: 405, headers: {}, body: "" };
          else {
            const request = JSON.parse(Buffer.from(req.body, "base64").toString());
            const result = await rpc(request);
            value = request.id === undefined ? { status: 202, headers: {}, body: "" } : { status: 200,
              headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: request.id, result })).toString("base64") };
          }
        } else if (message.op === "close") { value = { closed: true }; lines.close(); process.stdin.destroy(); }
        else throw new Error("unsupported command");
        send({ op: "reply", id: message.id, value });
      } catch (error) { send({ op: "reply", id: message.id, error: String(error) }); }
    });
  });
  lines.on("close", () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("transport closed")); } pending.clear(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
