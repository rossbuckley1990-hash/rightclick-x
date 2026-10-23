// Offline replay of a retained real-model request. No model or provider calls.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const [runtimeRoot, destination] = process.argv.slice(2);
if (!runtimeRoot || !destination) throw new Error("usage: measure-output-requirements.ts RUNTIME_ROOT NEW_OUTPUT_FILE");
const { RightClick } = await import(pathToFileURL(resolve(runtimeRoot, "src/runtime.ts")).href);
const files = (directory: string): string[] => readdirSync(resolve(runtimeRoot, directory), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const sourceHash = createHash("sha256");
for (const path of ["package.json", ...files("src")].sort()) {
  sourceHash.update(path + "\0"); sourceHash.update(readFileSync(resolve(runtimeRoot, path))); sourceHash.update("\0");
}
const root = "docs/adaptive/evidence/reuse-comparison-attempt3/warm2-d/";
const bytes = readFileSync(root + "before.json");
const state = JSON.parse(bytes.toString());
const call = readFileSync(root + "mcp.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line)).find(row => row.tool === "context_compose");
let requests = 0;
const rc = await RightClick.create({ directories: [], sandbox: null,
  fetch: async () => { requests++; throw new Error("offline replay forbids all network"); },
  store: { load: async () => structuredClone(state), save: async () => {} } });
const before = rc.graph.capabilities.size;
const started = performance.now();
const result = await rc.compose(call.args);
const milliseconds = performance.now() - started;
const data = { runtimeRoot: resolve(runtimeRoot), node: process.version,
  sourceTreeSha256: sourceHash.digest("hex"),
  stateSha256: createHash("sha256").update(bytes).digest("hex"), request: call.args,
  milliseconds, rss: process.memoryUsage().rss, requests, before, after: rc.graph.capabilities.size,
  outcome: result.outcome, plans: result.plans.length, executed: !!result.executed, published: !!result.published };
writeFileSync(destination, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ milliseconds, requests, outcome: result.outcome?.status, plans: result.plans.length }));
if (requests || result.executed || result.published || result.outcome?.status !== "unavailable") throw new Error("replay did not preserve refusal");
