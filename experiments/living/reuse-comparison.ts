// Frozen development comparison. The prompts/configuration contain the task;
// neither execution host contains a provider-specific integration.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { codexSession } from "../north-star/codex-session.ts";
import { includedModelAvailable } from "./session-models.ts";
import { startContainedSession, presentSession, type Wire } from "./challenge-session.ts";
import { publicReadTransport } from "./public-read-transport.ts";

const [configFile, destination] = process.argv.slice(2);
if (!configFile || !destination) throw new Error("usage: reuse-comparison.ts CONFIG NEW_OUTPUT_DIRECTORY");
const out = resolve(destination), configPath = resolve(configFile), config = JSON.parse(readFileSync(configPath, "utf8"));
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourcePaths = ["src", "bin", "experiments/living", "experiments/north-star/codex-session.ts", "experiments/north-star/codex-preflight.py",
  "experiments/north-star/common.ts", "experiments/north-star/quota.ts", "package.json", "package-lock.json", "tsconfig.json", "docs/adaptive/REUSE-COMPARISON-PLAN.md", "test/coding-baseline.test.ts"];
const names = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", ...sourcePaths], { encoding: "utf8" }).trim().split("\n");
const sources = Object.fromEntries(names.map(name => {
  const data = readFileSync(name), frozen = execFileSync("git", ["show", `${revision}:${name}`]);
  if (hash(data) !== hash(frozen)) throw new Error("unfrozen source: " + name);
  return [name, hash(data)];
}));
for (const file of ["experiments/living/reuse-comparison.ts", "experiments/living/coding-host.ts", "experiments/living/check-reuse-comparison.py"])
  if (!sources[file]) throw new Error("uncommitted evaluation source: " + file);
if (hash(readFileSync(configPath)) !== sources["experiments/living/reuse-comparison.json"]) throw new Error("configuration differs from freeze");
if (!/^sha256:[a-f0-9]{64}$/.test(config.image)) throw new Error("immutable local image required");
mkdirSync(out);
const save = (file: string, value: unknown) => writeFileSync(join(out, file), JSON.stringify(value, null, 2) + "\n");
save("provenance.json", { revision, sources, config, started: new Date().toISOString(),
  scope: "same-author exposed two-arm development comparison; not independent four-arm holdout or authority proof" });
const retained: Record<string, any> = {}, sessions: any[] = [];
for (const task of config.tasks) {
  const directory = join(out, task.id); mkdirSync(directory);
  const log = (file: string, row: unknown) => appendFileSync(join(directory, file), JSON.stringify(row) + "\n");
  const write = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2) + "\n");
  execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(directory, "preflight")], { stdio: "pipe" });
  if (!includedModelAvailable(JSON.parse(readFileSync(join(directory, "preflight/preflight.json"), "utf8")), config.model))
    throw new Error("included allowance/model preflight not established");
  for (const file of ["network.jsonl", "refusals.jsonl", "mcp.jsonl"]) writeFileSync(join(directory, file), "", { flag: "wx" });
  const network: any[] = [], tools: any[] = [], refusals: any[] = [];
  const transport = publicReadTransport(config.sources, (row, data) => {
    const record = { ...row, ...(data ? { sha256: hash(data) } : {}) };
    if (data) writeFileSync(join(directory, `response-${row.id}.bin`), data);
    network.push(record); log("network.jsonl", record);
  });
  const bridge = async (wire: Wire) => {
    try {
      const response = await transport(wire.url, { method: wire.method, headers: wire.headers,
        ...(!["GET", "HEAD"].includes(wire.method) ? { body: Buffer.from(wire.body, "base64") } : {}) });
      return { response: { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()).toString("base64") } };
    } catch (error) {
      const record = { url: wire.url, method: wire.method, reason: String(error) };
      refusals.push(record); log("refusals.jsonl", record); return { refused: true, reason: String(error) };
    }
  };
  const before = retained[task.arm] ?? null; write("before.json", before);
  const started = performance.now();
  const container = await startContainedSession({ output: directory, image: config.image, ...(task.arm === "C" ? { host: "coding" as const } : {}),
    config: { state: before ?? undefined, origins: config.sources.map((s: any) => new URL(s.url).origin), environment: { catalogs: [], origins: [] } },
    fetch: bridge, onTool: row => { tools.push(row); log("mcp.jsonl", row); } });
  const presentation = await presentSession(container.peer);
  const startupMilliseconds = performance.now() - started;
  let record: any;
  try {
    const instructions = task.arm === "C"
      ? "Use only the coding tools. You can execute JavaScript, fetch authorised public interfaces, and retain real code plus documentation with write_file. Check your saved files first. Save a reusable, parameterised solution after obtaining a correct result. Fresh sessions inherit these files."
      : "Use only RightClick X context_* tools. You can learn the advertised contracts, connect and execute operations, and retain a reusable checked capability with context_compose publish. Check retained capabilities first. Fresh sessions inherit the runtime state.";
    const prompt = `${instructions}
Authorised source advertisements (same in both arms): ${JSON.stringify(config.sources)}.
The operator permits credential-free public reads on these origins, including GraphQL queries. No other origin, mutation, credentials or execution route is authorised.
Task: obtain the PRIMARY RESEARCH PUBLICATION for structure ${task.entryId}: its DOI, exact publication title as a JSON array, and publisher. Use actual execution, never memory. Establish that it is the primary research paper, not the structure dataset. Check the result. You may inspect or repair your solution as necessary; all costs count.
Return exactly entry_id, doi, title and publisher in a JSON object between lines BEGIN and END. If the identifier is absent or a correct result cannot be established, return UNABLE: followed by the reason. Do not invent a result or change policy.`;
    writeFileSync(join(directory, "prompt.txt"), prompt);
    const name = task.arm === "C" ? "coding" : "rightclick-x";
    const session = await codexSession({ prompt, model: config.model, allowed: `mcp__${name}`, evidenceDir: directory, timeoutMs: 300_000,
      servers: { [name]: { url: presentation.url + "/mcp", startup_timeout_sec: 40, tool_timeout_sec: 90 } } });
    const snapshot = await container.peer.call("snapshot"); write("after.json", snapshot);
    retained[task.arm] = snapshot.state;
    record = { task, ...session, startupMilliseconds, tools: tools.length, requests: network.length, discoveryRequests: network.filter(r => r.discovery).length,
      refusals: refusals.length, retainedBytes: Buffer.byteLength(JSON.stringify(snapshot.state)), rss: snapshot.rss };
    sessions.push(record); save("sessions.json", sessions);
  } finally {
    const closeStarted = performance.now(); await presentation.close(); await container.close();
    write("shutdown.json", { milliseconds: performance.now() - closeStarted });
    if (record) { record.teardownMilliseconds = performance.now() - closeStarted; save("sessions.json", sessions); }
  }
  console.log(JSON.stringify({ id: task.id, seconds: record.seconds, tokens: record.tokens, requests: record.requests, tools: record.tools, blocked: record.blocked ?? null }));
  if (record.blocked || record.timedOut || record.exit !== 0) throw new Error("invalid model session; preserved without automatic retry");
}
execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(out, "postflight")], { stdio: "pipe" });
for (const [name, digest] of Object.entries(sources)) if (hash(readFileSync(name)) !== digest) throw new Error("source changed during experiment: " + name);
save("finished.json", { at: new Date().toISOString(), sessions: sessions.length });
