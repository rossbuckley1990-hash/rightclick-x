// Read-only disclosure comparison on the same retained state; no AI or target execution.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [rootArg, revision, statePath, output] = process.argv.slice(2);
const root = realpathSync(rootArg);
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const commit = execFileSync("git", ["rev-parse", `${revision}^{commit}`], { cwd: repo, encoding: "utf8" }).trim();
const sourceHashes: Record<string, string> = {};
for (const name of execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "src"], { cwd: repo, encoding: "utf8" }).trim().split("\n")) {
  const bytes = readFileSync(`${root}/${name}`);
  if (sha(bytes) !== sha(execFileSync("git", ["show", `${commit}:${name}`], { cwd: repo }))) throw new Error(`source mismatch: ${name}`);
  sourceHashes[name] = sha(bytes);
}
const stateBytes = readFileSync(statePath), state = JSON.parse(stateBytes.toString());
const { RightClick } = await import(pathToFileURL(`${root}/src/runtime.ts`).href);
const { handle } = await import(pathToFileURL(`${root}/src/interface/mcp-server.ts`).href);
const programs = state.reflections.filter((r: any) => r.provider.source === "cli").map((r: any) => r.provider.origin);
const events: string[] = [];
const rc = await RightClick.create({ directories: [], sandbox: null, authority: { investigate: programs, execute: programs },
  network: { origins: [], blockPrivate: true }, fetch: async () => { events.push("network"); throw new Error("unexpected fetch"); },
  onInvestigationStart: () => events.push("investigation"),
  store: { load: async () => structuredClone(state), save: async () => { events.push("save"); } },
});
const graphBefore = JSON.stringify(rc.exportGraph());
const request = (method: string, params: unknown) => handle(rc, { jsonrpc: "2.0", id: 1, method, params });
const initialize = await request("initialize", { protocolVersion: "2025-06-18" });
const tools = await request("tools/list", {});
const capabilities = [];
for (const cap of rc.graph.list().filter((c: any) => ["cli", "goal", "composite"].includes(c.invoke.kind))) {
  const brief = await request("tools/call", { name: "context_explain", arguments: { id: cap.id } });
  const full = await request("tools/call", { name: "context_explain", arguments: { id: cap.id, detail: "full" } });
  capabilities.push({ id: cap.id, brief, full, briefWire: JSON.stringify(brief), fullWire: JSON.stringify(full) });
}
if (JSON.stringify(rc.exportGraph()) !== graphBefore || events.length || rc.runs.size) throw new Error("read-only disclosure changed state or dispatched");
writeFileSync(output, JSON.stringify({ scope: "same-state deterministic disclosure; no model tokens, latency or economics claim", commit, sourceHashes,
  statePath, stateSha256: sha(stateBytes), node: process.version, programs, events, runs: rc.runs.size,
  graphUnchanged: true, initialize, tools, initializeWire: JSON.stringify(initialize), toolsWire: JSON.stringify(tools), capabilities }, null, 2) + "\n", { flag: "wx" });
