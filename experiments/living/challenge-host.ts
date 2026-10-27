// Persistent, credential-free runtime inside the existing isolated Linux profile.
// The operator transports HTTP envelopes over stdio; all tools and dashboard
// requests still go through the product's ordinary HTTP handler.
import { createInterface } from "node:readline";
import { RightClick } from "../../src/runtime.ts";
import { ProcessMemoryStore } from "../../src/entry/node-host.ts";
import { createHandler } from "../../src/interface/http.ts";
import { TransportRefused } from "../../src/reflectors/net.ts";
import type { FetchLike } from "../../src/core/types.ts";

const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const streams = new Map<number, ReadableStreamDefaultReader<Uint8Array>>();
let sequence = 0, store: ProcessMemoryStore | undefined, runtime: RightClick | undefined;
let handler: ReturnType<typeof createHandler> | undefined;
let configured = false;
const lines = createInterface({ input: process.stdin });
const authorityRead = (signal: AbortSignal) => new Promise<any>((resolve, reject) => {
  const id = ++sequence;
  const abort = () => { pending.delete(id); clearTimeout(timer); reject(new Error("authority evidence unavailable")); };
  const timer = setTimeout(abort, 5000);
  pending.set(id, { resolve: reply => {
    signal.removeEventListener("abort", abort);
    if (reply.value) resolve(reply.value); else reject(new Error("authority evidence unavailable"));
  }, reject, timer });
  signal.addEventListener("abort", abort, { once: true });
  send({ op: "authority-read", id });
});
const bridge: FetchLike = async (input, init, context) => {
  const request = new Request(input, init), id = ++sequence;
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > 4 * 1024 * 1024) throw new Error("session request exceeds bound");
  const reply = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("session transport outcome unresolved"));
    }, 40_000);
    pending.set(id, { resolve, reject, timer });
    send({ op: "fetch", id, context, request: { method: request.method, url: request.url,
      headers: Object.fromEntries(request.headers), body: body.toString("base64") } });
  });
  if (reply.refused) throw new TransportRefused("operator transport refused: " + String(reply.reason ?? "no permission"));
  if (!reply.response) throw new Error("session transport outcome unresolved");
  return new Response([204, 205, 304].includes(reply.response.status) ? null : Buffer.from(reply.response.body, "base64"),
    { status: reply.response.status, headers: reply.response.headers });
};
let requests = Promise.resolve();
lines.on("line", line => {
  if (Buffer.byteLength(line) > 20 * 1024 * 1024) { process.exitCode = 1; lines.close(); return; }
  let message: any;
  try { message = JSON.parse(line); } catch { process.exitCode = 1; lines.close(); return; }
  if (message.op === "fetch-result" || message.op === "authority-result") {
    const item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); item.resolve(message); }
    return;
  }
  if (message.op === "cancel") { void streams.get(message.id)?.cancel(); return; }
  // Sequential external commands keep snapshots and operator steps coherent;
  // fetch replies above must remain concurrent with a pending tool call.
  requests = requests.then(async () => {
    try {
      if (message.op === "configure") {
        if (configured) throw new Error("session already configured");
        configured = true;
        const config = message.config;
        store = new ProcessMemoryStore();
        await store.load();
        if (config.state != null) await store.save(config.state);
        runtime = await RightClick.create({ name: "Living capability session", directories: [], sandbox: null,
          fetch: bridge, network: { blockPrivate: false, origins: config.origins },
          authority: { investigate: [], execute: [], execution: { allowedOrigins: config.origins, allowedRisks: ["read", "write"] }, publish: "checked" },
          environment: config.environment, workflowRecovery: true,
          store });
        handler = createHandler(runtime, { open: true,
          ...(config.authorityEvidence ? { authorityEvidence: { ...config.authorityEvidence, read: authorityRead } } : {}) });
        runtime.toolCallSink = row => send({ op: "tool-observation", row });
        send({ op: "reply", id: message.id, value: { ready: true, summary: runtime.startupSummary(), node: process.version } });
      } else if (message.op === "http") {
        if (!handler) throw new Error("session not configured");
        const wire = message.request;
        const request = new Request(wire.url, { method: wire.method, headers: wire.headers,
          ...(!["GET", "HEAD"].includes(wire.method) ? { body: Buffer.from(wire.body, "base64") } : {}) });
        const response = await handler(request);
        if (response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
          streams.set(message.id, reader);
          send({ op: "reply", id: message.id, value: { status: response.status, headers: Object.fromEntries(response.headers), stream: true } });
          void (async () => {
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                send({ op: "stream", id: message.id, body: Buffer.from(chunk.value).toString("base64") });
              }
            } finally { streams.delete(message.id); send({ op: "stream-end", id: message.id }); }
          })().catch(() => { /* disconnect is not execution failure */ });
        } else {
          send({ op: "reply", id: message.id, value: { status: response.status, headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()).toString("base64") } });
        }
      } else if (message.op === "snapshot") {
        if (!runtime) throw new Error("session not configured");
        await runtime.flush();
        send({ op: "reply", id: message.id, value: { state: await store!.load(), activity: runtime.activity.snapshot(),
          graph: runtime.exportGraph(), summary: runtime.startupSummary(), rss: process.memoryUsage().rss } });
      } else if (message.op === "close") {
        for (const reader of streams.values()) await reader.cancel();
        await runtime?.flush();
        send({ op: "reply", id: message.id, value: { closed: true } });
        lines.close(); process.stdin.destroy();
      } else throw new Error("unsupported session command");
    } catch (error) { send({ op: "reply", id: message.id, error: String(error) }); }
  });
});
lines.on("close", () => {
  for (const reader of streams.values()) void reader.cancel();
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("session transport closed; outcome unresolved")); }
  pending.clear();
  void requests.then(() => runtime?.flush()).catch(() => { process.exitCode = 1; });
});
