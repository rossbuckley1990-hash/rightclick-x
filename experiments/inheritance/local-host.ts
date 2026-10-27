// Experiment-only host. No remote capabilities can be learned or executed.
// It retains the ordinary runtime and MCP implementation, with a host-owned
// deny-all network transport, execution policy and restricted tool surface.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { handle, type JsonRpc } from "../../src/interface/mcp-server.ts";
import { hostSandbox } from "../../src/core/sandbox.ts";
import { phaseTools, refusalForTool } from "./guards.ts";

const [stateFile, workspace, traceFile, phase, ...programs] = process.argv.slice(2);
if (!stateFile || !workspace || !traceFile || !["creator", "reuser"].includes(phase) || programs.length !== 4)
  throw new Error("invalid local-host configuration");
const sandbox = await hostSandbox();
if (!sandbox || sandbox.policy.network || sandbox.policy.writeRoots.length || sandbox.policy.readRoots.length)
  throw new Error("no working, un-widened, network-denied CLI sandbox; refusing to start");
const stage = phase as "creator" | "reuser";
const tools = phaseTools(stage);
const rc = await RightClick.create({ directories: [], workspace, store: new FileStore(stateFile), sandbox,
  fetch: async () => { throw new Error("inheritance fixture: all network access denied"); },
  network: { origins: [], blockPrivate: true },
  authority: { investigate: programs, execute: programs, publish: "verified",
    execution: { allowedRisks: ["read"], allowedOrigins: [], allowedCapabilities: ["builtin:*", "cli:*", "composite:*", "goal:*"] } },
});
const log = (row: unknown) => appendFileSync(traceFile, JSON.stringify(row) + "\n");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  let parsed: JsonRpc | JsonRpc[];
  try { parsed = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); continue; }
  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    let response: JsonRpc | null;
    const name = message.params?.name, args = message.params?.arguments ?? {};
    const refusal = message.method === "tools/call" ? refusalForTool(stage, name, args, programs) : "";
    if (refusal) response = { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: refusal }] } };
    else response = await handle(rc, message);
    if (response && message.method === "tools/list") {
      const result = response.result as { tools: Array<{ name: string }> };
      result.tools = result.tools.filter(tool => tools.has(tool.name));
    }
    if (message.method === "tools/call") log({ request: message, response });
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  }
}
await rc.flush();
