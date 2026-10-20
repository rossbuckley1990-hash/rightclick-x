// Actual fresh model clients of the existing, still-running MCP endpoint.
// No retained state copies, new runtime, provider-specific host or grant route.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codexSession } from "../north-star/codex-session.ts";
import type { RpcPeer } from "./challenge-session.ts";

export interface ReuseTask { id: string; model: string; entryId: string; expected: "publication" | "unavailable" }
export function includedModelAvailable(preflight: any, model: string) {
  const limits = preflight?.responses?.["account/rateLimits/read"], bucket = limits?.rateLimitsByLimitId?.codex;
  return preflight?.passed === true && preflight.responses?.["account/read"]?.type === "chatgpt" &&
    limits?.ordinaryUsageAllowed === true && ["plus", "pro", "prolite"].includes(bucket?.planType) &&
    bucket?.credits?.hasCredits === false && bucket?.credits?.unlimited === false && bucket?.credits?.balance === "0" &&
    Number.isFinite(bucket?.primary?.usedPercent) && bucket.primary.usedPercent >= 0 && bucket.primary.usedPercent < 90 &&
    preflight.responses?.["model/list"]?.some((m: any) => m.model === model) === true;
}

export async function exerciseModels(options: {
  output: string; url: string; peer: RpcPeer; boundary: RpcPeer; tasks: ReuseTask[];
  counts(): { totalRequests: number; toolCalls: number };
}) {
  const { output, peer, boundary, tasks } = options, root = process.cwd(), destination = join(output, "models");
  const endpoint = new URL("/mcp", options.url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password)
    throw new Error("expected existing loopback MCP endpoint");
  if (tasks.length !== 3 || new Set(tasks.map(t => t.id)).size !== tasks.length ||
      tasks.some(t => !/^[a-z0-9-]+$/.test(t.id) || !/^[A-Z0-9]{4}$/.test(t.entryId) ||
        !["publication", "unavailable"].includes(t.expected))) throw new Error("invalid frozen reuse tasks");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const names = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", "src", "bin",
    "experiments/living", "experiments/actenon", "experiments/north-star/codex-session.ts",
    "experiments/north-star/codex-preflight.py", "experiments/north-star/common.ts", "experiments/north-star/quota.ts",
    "package.json", "package-lock.json", "tsconfig.json"], { encoding: "utf8" }).trim().split("\n");
  const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const sources = Object.fromEntries(names.map(name => {
    const data = readFileSync(name), frozen = execFileSync("git", ["show", `${revision}:${name}`]);
    if (hash(data) !== hash(frozen)) throw new Error("unfrozen source: " + name);
    return [name, hash(data)];
  }));
  mkdirSync(destination);
  const save = (name: string, value: unknown) =>
    writeFileSync(join(destination, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const read = (name: string) => JSON.parse(readFileSync(join(output, name + ".json"), "utf8"));
  save("provenance", { revision, sources, tasks, endpoint: endpoint.href,
    scope: "same persistent runtime; fresh same-vendor model clients, exposed development providers; no economic comparison or independent holdout" });
  const initial = await peer.call("snapshot");
  save("before", initial);
  save("effects-before", await boundary.call("snapshot"));
  const sessions: unknown[] = [];
  for (const task of tasks) {
    const directory = join(destination, task.id); mkdirSync(directory);
    execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(directory, "preflight")], { stdio: "pipe" });
    const preflight = JSON.parse(readFileSync(join(directory, "preflight/preflight.json"), "utf8"));
    if (!includedModelAvailable(preflight, task.model)) throw new Error("included allowance/model preflight not established");
    const before = options.counts(), publicBefore = read("public-network").length;
    const prompt = `Use only the connected RightClick X context_* tools. This still-running runtime already holds an established capability. Find and reuse it without acquiring contracts, repeating discovery, or constructing a replacement.
Task: obtain the PRIMARY RESEARCH PUBLICATION for structure ${task.entryId}: its DOI, exact title as a JSON array, and publisher.
Use actual execution, never memory or an inferred publication. Confirm the result is the primary research paper rather than a structure dataset.
The operator permits read-only access to the configured public services. Stored capabilities never override current permission. Do not change policy or use another route.
Return a JSON object with exactly entry_id, doi, title and publisher between lines BEGIN and END. If the identifier is unavailable, permission is denied or the required result cannot be established, return UNABLE: followed by the reason.`;
    writeFileSync(join(directory, "prompt.txt"), prompt);
    const session = await codexSession({ prompt, model: task.model, allowed: "mcp__rightclick-x",
      evidenceDir: directory, timeoutMs: 300_000,
      servers: { "rightclick-x": { url: endpoint.href, startup_timeout_sec: 40, tool_timeout_sec: 90 } } });
    const after = options.counts();
    const record = { task, ...session, before, after, tools: read("tool-calls").slice(before.toolCalls),
      publicRequests: read("public-network").slice(publicBefore) };
    sessions.push(record); save("sessions", sessions);
    console.log(JSON.stringify({ op: "model-completed", id: task.id, seconds: session.seconds,
      tokens: session.tokens, blocked: session.blocked ?? null }));
    if (session.blocked || session.timedOut || session.exit !== 0)
      throw new Error("stopped after invalid model session; evidence preserved, no automatic retry");
  }
  const final = await peer.call("snapshot");
  save("after", final);
  const existing = new Set(initial.state.workflowContinuations.map((c: any) => c.runId));
  const stopped = final.state.workflowContinuations.filter((c: any) => !existing.has(c.runId));
  assert.equal(stopped.length, 1, "only the missing-resource attempt adds a stopped checkpoint");
  const missing = tasks.filter(t => t.expected === "unavailable");
  assert.equal(missing.length, 1);
  assert.equal(stopped[0].phase, "stopped");
  assert.deepEqual(stopped[0].inputs, { entry_id: missing[0].entryId });
  assert.equal(stopped[0].composition.risk, "read");
  assert.equal(stopped[0].composition.goals[0].slug, "structure-primary-publication-metadata");
  save("effects-after", await boundary.call("snapshot"));
  execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(destination, "postflight")], { stdio: "pipe" });
  for (const [name, digest] of Object.entries(sources))
    if (hash(readFileSync(name)) !== digest) throw new Error("source changed during model session: " + name);
  return stopped.map((c: any) => c.runId) as string[];
}
