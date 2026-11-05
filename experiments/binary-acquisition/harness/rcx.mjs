#!/usr/bin/env node
// A plain MCP stdio client for the Stage 2 experiments (harness code, not product code).
// It spawns the frozen server `node bin/rcx.ts mcp` the way an MCP host does, initialises, passes
// one tools/list or tools/call through unchanged, then closes the server's stdin and waits for it
// to exit, so the server persists its state.
//
//   rcx tools
//   rcx call <tool> '<json>'            rcx call <tool> --args-file <file.json>
//   rcx bytes <path>                    print {"type":"bytes","base64":…} for a file (plumbing)
//   rcx save <artefact-ref> <path>      write an artefact a run returned to a file (plumbing)
//
// Environment (set by the lane wrapper, never by the agent): RCX_FROZEN (frozen source tree),
// RCX_STATE_FILE, RCX_INVESTIGATE / RCX_EXECUTE, CALL_LOG (JSONL of every call).
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [cmd, a1, ...rest] = process.argv.slice(2);
if (cmd === "bytes") {
  process.stdout.write(JSON.stringify({ type: "bytes", base64: readFileSync(a1).toString("base64") }));
  process.exit(0);
}
const frozen = process.env.RCX_FROZEN;
if (!frozen || !["tools", "call", "save"].includes(cmd ?? "")) {
  console.error("usage: rcx tools | call <tool> '<json>' | call <tool> --args-file <f> | bytes <path> | save <ref> <path>");
  process.exit(2);
}
const t0 = Date.now();
const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], { cwd: frozen, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
const pending = new Map();
let nextId = 1;
createInterface({ input: child.stdout }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
async function finish(code, rec) {
  child.stdin.end();
  await new Promise((res) => { if (child.exitCode !== null) return res(); const t = setTimeout(() => { child.kill(); res(); }, 120_000); child.on("exit", () => { clearTimeout(t); res(); }); });
  if (process.env.CALL_LOG) appendFileSync(process.env.CALL_LOG, JSON.stringify({ at: new Date(t0).toISOString(), ms: Date.now() - t0, cmd, tool: cmd === "call" ? a1 : null, argsBytes: rec.argsBytes ?? 0, resultBytes: rec.resultBytes ?? 0, isError: rec.isError ?? false }) + "\n");
  process.exit(code);
}
try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "rcx-stage2-harness", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  if (cmd === "tools") {
    const r = await rpc("tools/list", {});
    const text = JSON.stringify(r, null, 1);
    process.stdout.write(text + "\n");
    await finish(0, { resultBytes: text.length });
  } else if (cmd === "save") {
    const [path] = rest;
    const chunks = [];
    for (let offset = 0; ;) {
      const r = await rpc("tools/call", { name: "context_run_status", arguments: { artefact: a1, offset } });
      if (r.isError) { process.stdout.write(r.content?.[0]?.text ?? "error\n"); await finish(1, { isError: true }); }
      const v = JSON.parse(r.content[0].text);
      chunks.push(Buffer.from(v.base64, "base64"));
      offset += v.length;
      if (v.complete) break;
    }
    writeFileSync(path, Buffer.concat(chunks));
    process.stdout.write(`saved ${Buffer.concat(chunks).length} bytes to ${path}\n`);
    await finish(0, {});
  } else {
    const raw = rest[0] === "--args-file" ? readFileSync(rest[1], "utf8") : (rest[0] ?? "{}");
    const args = JSON.parse(raw);
    const r = await rpc("tools/call", { name: a1, arguments: args });
    const text = r.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(r);
    process.stdout.write(text + "\n");
    await finish(r.isError ? 1 : 0, { argsBytes: raw.length, resultBytes: text.length, isError: !!r.isError });
  }
} catch (e) {
  console.error(`harness: ${e.message}${stderr ? `\n${stderr.slice(0, 2000)}` : ""}`);
  await finish(1, { isError: true });
}
