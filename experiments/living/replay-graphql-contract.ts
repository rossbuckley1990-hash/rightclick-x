// Replays a retained public introspection and two actual model requests offline.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const [runtimeRoot, destination] = process.argv.slice(2);
if (!runtimeRoot || !destination) throw new Error("usage: replay-graphql-contract.ts RUNTIME_ROOT NEW_FILE");
const { RightClick } = await import(pathToFileURL(resolve(runtimeRoot, "src/runtime.ts")).href);
const files = (directory: string): string[] => readdirSync(resolve(runtimeRoot, directory), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const sourceHash = createHash("sha256");
for (const file of ["package.json", ...files("src")].sort()) {
  sourceHash.update(file + "\0"); sourceHash.update(readFileSync(resolve(runtimeRoot, file))); sourceHash.update("\0");
}
const fixture = "docs/adaptive/evidence/reuse-comparison-attempt3/cold-d/";
const rows = readFileSync(fixture + "mcp.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
const requests = rows.filter(row => row.tool === "context_run" && row.args.id.startsWith("graphql:"));
const endpoint = "https://data.rcsb.org/graphql";
const network: Array<{ method: string; kind: string; bytes: number }> = [];
const fetch = async (input: unknown, init?: RequestInit) => {
  if (String(input) !== endpoint) throw new Error("unexpected replay origin");
  const query = JSON.parse(String(init?.body ?? "{}")).query ?? "";
  const kind = !init?.body ? "probe" : query.includes("__schema") ? "introspection" : query.includes("rcsb_is_primary journal_abbrev") ? "invalid" : "corrected";
  const raw = readFileSync(fixture + `response-${({ probe: 5, introspection: 3, invalid: 4, corrected: 7 })[kind]}.bin`, "utf8");
  network.push({ method: init?.method ?? "GET", kind, bytes: Buffer.byteLength(raw) });
  return new Response(raw, { status: kind === "probe" ? 400 : 200,
    headers: { "content-type": kind === "probe" ? "text/html" : "application/json" } });
};
let state: any;
const store = { load: async () => state, save: async (value: any) => { state = structuredClone(value); } };
const rc = await RightClick.create({ directories: [], sandbox: null, fetch, store });
await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
await rc.flush();
const learned = structuredClone(state);
const graphSize = rc.graph.capabilities.size;
network.length = 0;
const started = performance.now();
const invalid = await rc.run(requests[0].args.id, requests[0].args.args, { verify: requests[0].args.verify });
const invalidMs = performance.now() - started;
const invalidTraffic = structuredClone(network);
const providerExperience = rc.ledger.get(requests[0].args.id);
state = learned;
const fresh = await RightClick.create({ directories: [], sandbox: null, fetch, store });
network.length = 0;
const restarted = await fresh.run(requests[0].args.id, requests[0].args.args);
const restartTraffic = structuredClone(network);
network.length = 0;
const corrected = await fresh.run(requests[1].args.id, requests[1].args.args);
const evidence = { sourceTreeSha256: sourceHash.digest("hex"), node: process.version,
  invalidRequest: requests[0].args, correctedRequest: requests[1].args,
  invalid: { status: invalid.status, error: invalid.error, graphqlFailure: invalid.graphqlFailure, invalidMs, traffic: invalidTraffic, providerExperience },
  restarted: { status: restarted.status, graphqlFailure: restarted.graphqlFailure, traffic: restartTraffic },
  corrected: { status: corrected.status, output: corrected.output, traffic: network },
  graphSize, finalGraphSize: fresh.graph.capabilities.size,
  retainedBytes: Buffer.byteLength(JSON.stringify(learned)),
  schemaBytes: Buffer.byteLength(JSON.stringify(fresh.graph.providers.get("graphql:data-rcsb-org-graphql")?.meta?.graphqlSelection ?? null)) };
writeFileSync(destination, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ invalid: invalid.status, invalidCalls: invalidTraffic.length, restarted: restarted.status,
  restartCalls: restartTraffic.length, corrected: corrected.status, invalidMs, retainedBytes: evidence.retainedBytes }));
if (invalid.status !== "failed" || restarted.status !== "failed" || corrected.status !== "completed") throw new Error("unexpected replay outcome");
