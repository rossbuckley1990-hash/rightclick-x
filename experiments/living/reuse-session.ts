// Fresh isolated deterministic client of retained knowledge. No model or
// acquisition step is included; requests use the same bounded public transport.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { startContainedSession } from "./challenge-session.ts";
import { publicReadTransport, type PublicSource } from "./public-read-transport.ts";
import { TransportRefused } from "../../src/reflectors/net.ts";

const [configFile, snapshotFile, destination, image] = process.argv.slice(2);
if (!configFile || !snapshotFile || !destination || !image) throw new Error("usage: reuse-session.ts CONFIG SNAPSHOT NEW_OUTPUT IMAGE");
const config = JSON.parse(readFileSync(configFile, "utf8")), snapshot = readFileSync(snapshotFile, "utf8");
if (config.goals?.length || config.runs?.length !== 1) throw new Error("one retained invocation required");
const state = JSON.parse(snapshot).state, sources = config.sources as PublicSource[];
if (!state) throw new Error("retained snapshot missing");
const output = resolve(destination);
mkdirSync(output, { recursive: false });
const save = (name: string, value: unknown) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n");
const origins = [...new Set(sources.map(s => new URL(s.url).origin))], network: any[] = [], tools: unknown[] = [];
const net = publicReadTransport(sources, (row, bytes) => {
  network.push(row); save("public-network", network);
  if (bytes) writeFileSync(join(output, `public-response-${row.id}.bin`), bytes);
});
save("provenance", { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), config,
  restored: { snapshot: resolve(snapshotFile), sha256: createHash("sha256").update(snapshot).digest("hex") },
  scope: "same-author fresh contained process; deterministic reuse, not a fresh AI model or holdout" });
const session = await startContainedSession({ output, image,
  config: { origins, state, environment: { catalogs: [], origins: [] } }, onTool: row => { tools.push(row); save("tool-calls", tools); },
  fetch: async wire => {
    try {
      const response = await net(wire.url, { method: wire.method, headers: wire.headers,
        ...(!["GET", "HEAD"].includes(wire.method) ? { body: Buffer.from(wire.body, "base64") } : {}) });
      return { response: { status: response.status, headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()).toString("base64") } };
    } catch (error) {
      return error instanceof TransportRefused ? { refused: true, reason: error.message } : { reason: "public read outcome unresolved" };
    }
  } });
try {
  const baseline = await session.peer.call("snapshot");
  save("baseline", baseline);
  if (network.length) throw new Error("restoration unexpectedly used the network");
  const requested = config.runs[0];
  const envelope: any = await (await session.peer.http("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "context_run", arguments: { id: requested.capability, args: requested.args } } })).json();
  if (envelope.error) throw new Error(JSON.stringify(envelope.error));
  const run = JSON.parse(envelope.result.content[0].text);
  save("run-0", run);
  if (run.status !== "completed" || network.some(row => row.discovery) || network.length !== 2) throw new Error("retained public invocation failed or rediscovered");
  save("summary", { status: "PASS", requests: network.length, discoveryRequests: 0, toolCalls: tools.length,
    initialOperations: baseline.graph.capabilities.length, retainedGoals: baseline.state.published.length });
} finally {
  try { save("final", await session.peer.call("snapshot")); }
  finally { await session.close(); }
}
