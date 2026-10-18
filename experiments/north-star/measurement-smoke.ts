// Disposable development fixture; no model calls, no holdout/economic claim.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assessObservation, sha256 } from "./observation.ts";
import { subscriptionEnvironment, type Task } from "./common.ts";

const out = resolve(process.argv[2] ?? "docs/adaptive/evidence/telemetry/process-smoke");
mkdirSync(out, { recursive: true });
const work = realpathSync(mkdtempSync(`${tmpdir()}/rcx-measure-process-`));
const target = `${work}/shout`;
writeFileSync(target, '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "usage: shout [-u] [file]"; echo "  -u    print the output in upper case"; exit 0; fi\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi\n', { mode: 0o755 });
const task = (input: string): Task => ({ id: input, program: "shout", kind: "feasible", request: "uppercase", input: { stdin: input + "\n" }, expected: input.toUpperCase() + "\n", valid: true });
const observations: Record<string, unknown> = {};

async function client(id: string, baseline = false) {
  const env = baseline ? { DS_PROGRAM: target, DS_LOG: `${out}/${id}.calls.jsonl`, DS_OBSERVATION_LOG: `${out}/${id}.jsonl`, DS_SESSION_ID: id } : { RCX_INVESTIGATE: target, RCX_STATE_FILE: `${out}/state.json`, RCX_MCP_LOG: `${out}/${id}.calls.jsonl`, RCX_OBSERVATION_LOG: `${out}/${id}.jsonl`, RCX_SESSION_ID: id };
  const child = spawn(process.execPath, [resolve(`experiments/north-star/${baseline ? "surface" : "measured-candidate"}.ts`)], { env: { ...subscriptionEnvironment(process.env), ...env }, cwd: work, stdio: ["pipe", "pipe", "pipe"] });
  let next = 0, stderr = "", transcript = "";
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  child.stderr.on("data", data => { stderr += data; });
  const closed = new Promise<void>((done, fail) => { child.on("error", fail); child.on("close", code => { writeFileSync(`${out}/${id}.stderr`, stderr); writeFileSync(`${out}/${id}.mcp.jsonl`, transcript); for (const p of pending.values()) p.reject(new Error(`MCP closed: ${code}: ${stderr}`)); code === 0 ? done() : fail(new Error(`MCP exited ${code}: ${stderr}`)); }); });
  closed.catch(() => {});
  createInterface({ input: child.stdout }).on("line", line => {
    transcript += line + "\n";
    const message = JSON.parse(line), p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  });
  const request = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "measurement-smoke", version: "1" } });
  return {
    request,
    async call(name: string, args = {}) {
      const r = await request("tools/call", { name, arguments: args });
      assert.notEqual(r.isError, true, JSON.stringify(r));
      return r.structuredContent ?? JSON.parse(r.content[0].text);
    },
    async close() { child.stdin.end(); try { await closed; } finally { clearTimeout(timer); } },
  };
}

const baseline = await client("baseline", true);
assert.equal((await baseline.call("run_program", { args: ["-u"], stdin: task("baseline input").input.stdin })).stdout, task("baseline input").expected);
await baseline.close();
observations.baseline = assessObservation(`${out}/baseline.jsonl`, "baseline", target, task("baseline input"));
assert.equal((observations.baseline as any).taskExecutionObserved, true);
assert.equal((observations.baseline as any).investigationsStarted, null);

const cold = await client("cold");
assert.equal((await cold.request("tools/list")).tools.length, 13);
const providers = await cold.call("context_providers");
assert.equal(JSON.stringify(providers).includes("platform:"), false, "host evidence cannot be exposed as workspace capabilities");
await cold.call("context_learn", { source: `cli:${target}` });
const cap = (await cold.call("context_explain", { id: "cli:shout:u" })).capability;
assert.equal((await cold.call("context_run", { id: cap.id, args: { [cap.inputs[0].name]: task("cold input").input.stdin } })).output, task("cold input").expected);
await cold.close();
observations.cold = assessObservation(`${out}/cold.jsonl`, "cold", target, task("cold input"));
assert.equal((observations.cold as any).investigationsStarted, 1);
assert.equal((observations.cold as any).taskExecutionObserved, true);

const warm = await client("warm");
await warm.call("context_learn", { source: `cli:${target}` });
assert.equal((await warm.call("context_run", { id: cap.id, args: { [cap.inputs[0].name]: task("fresh process input").input.stdin } })).output, task("fresh process input").expected);
await warm.close();
observations.warm = assessObservation(`${out}/warm.jsonl`, "warm", target, task("fresh process input"));
assert.equal((observations.warm as any).investigationsStarted, 0);
assert.equal((observations.warm as any).invocations.investigation, 0);
assert.equal((observations.warm as any).taskExecutionObserved, true);

const builtin = await client("builtin");
await builtin.call("context_run", { id: "builtin:text.sha256", args: { text: "input" } });
await builtin.close();
observations.builtin = assessObservation(`${out}/builtin.jsonl`, "builtin", target, task("fresh process input"));
assert.equal((observations.builtin as any).targetExecuted, false);
assert.equal((observations.builtin as any).taskExecutionObserved, false);
const summary = { schema: 1, scope: "development measurement smoke; no model or economic evidence", targetSha256: sha256(readFileSync(target)), observations };
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
