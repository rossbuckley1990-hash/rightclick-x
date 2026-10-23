// Generic instrumented MCP host. Provider names and operation mappings belong
// to retained runtime state, never this host.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { RightClick } from "../../src/runtime.ts";
import { FileStore, serveStdio } from "../../src/entry/node-host.ts";
import { publicReadTransport, type PublicSource } from "./public-read-transport.ts";

const [configFile, evidenceDirectory, stateFile, mode] = process.argv.slice(2);
if (!configFile || !evidenceDirectory || !stateFile || !["allowed", "denied"].includes(mode)) throw new Error("invalid evaluation host arguments");
const sources = JSON.parse(readFileSync(configFile, "utf8")).sources as PublicSource[];
const out = resolve(evidenceDirectory), origins = [...new Set(sources.map(s => new URL(s.url).origin))];
const save = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n");
const net = publicReadTransport(sources, (row, data) => {
  if (data) writeFileSync(join(out, `response-${row.id}.bin`), data);
  appendFileSync(join(out, "network.jsonl"), JSON.stringify({ ...row,
    ...(data ? { sha256: createHash("sha256").update(data).digest("hex") } : {}) }) + "\n");
});
writeFileSync(join(out, "network.jsonl"), "", { flag: "wx" });
writeFileSync(join(out, "mcp.jsonl"), "", { flag: "wx" });
const rc = await RightClick.create({ name: "Retained public capability", directories: [], sandbox: null,
  fetch: net, network: { blockPrivate: true, origins }, store: new FileStore(resolve(stateFile)),
  authority: { investigate: [], execute: [], execution: { allowedRisks: ["read"], allowedOrigins: mode === "allowed" ? origins : [] }, publish: "checked" } });
save("startup.json", { pid: process.pid, node: process.version, mode, origins, summary: rc.startupSummary(),
  providers: rc.graph.providers.size, operations: rc.graph.capabilities.size, activity: rc.activity.snapshot() });
rc.toolCallSink = row => appendFileSync(join(out, "mcp.jsonl"), JSON.stringify(row) + "\n");
let closing: Promise<void> | undefined;
function close() {
  return closing ??= rc.flush().then(() => { save("shutdown.json", { activity: rc.activity.snapshot() }); });
}
process.once("SIGTERM", () => { void close().then(() => process.exit(0), () => process.exit(1)); });
try { await serveStdio(rc); } finally { await close(); }
