// Baseline surface: a minimal MCP stdio server exposing ONE tool that runs a fixed command-line
// program (DS_PROGRAM) in the same host sandbox RightClick X uses. No investigation, no graph, no
// capability learning: the agent gets the raw interaction surface and nothing else.
//   DS_PROGRAM=/usr/bin/tidy node experiments/universal-capability-engine/direct-surface.ts
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hostSandbox } from "../../src/core/sandbox.ts";

const PROGRAM = process.env.DS_PROGRAM!;
const LOG = process.env.DS_LOG;
const sandbox = await hostSandbox();
const tool = {
  name: "run_program",
  description: "Run the command-line program available on this machine (sandboxed: no network, files only in a temporary directory). Pass argv (no program name), optional stdin text, and optional files {name: content} created in the working directory before the run. Returns exit code, stdout and stderr.",
  inputSchema: { type: "object", properties: { args: { type: "array", items: { type: "string" } }, stdin: { type: "string" }, files: { type: "object", additionalProperties: { type: "string" } } } },
  annotations: { readOnlyHint: true },
};
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "surface", version: "0.1" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [tool] } });
  else if (msg.method === "tools/call") {
    const a = msg.params?.arguments ?? {};
    const r = sandbox ? await sandbox.run(PROGRAM, (a.args ?? []).map(String), { stdin: a.stdin ?? "", files: a.files ?? {} }) : null;
    if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), tool: "run_program", args: a.args ?? [], stdinBytes: String(a.stdin ?? "").length, exit: r?.code }) + "\n");
    const text = r ? JSON.stringify({ exit: r.code, stdout: r.stdout.slice(0, 60_000), stderr: r.stderr.slice(0, 4000), timedOut: r.timedOut }) : "unavailable: no sandbox";
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }], isError: !r } });
  } else if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
}
