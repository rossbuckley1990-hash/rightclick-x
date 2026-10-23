// Exact retained public warm-session replay; no live network or model calls.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const [source, phase, destination] = process.argv.slice(2);
if (!source || !["warm1-d", "warm2-d"].includes(phase) || !destination) throw new Error("usage: replay-retained-result.ts SOURCE warm1-d|warm2-d NEW_FILE");
const { RightClick } = await import(pathToFileURL(resolve(source, "src/runtime.ts")).href);
const { dispatch } = await import(pathToFileURL(resolve(source, "src/interface/tools.ts")).href);
const files = (directory: string): string[] => readdirSync(resolve(source, directory), { withFileTypes: true })
  .flatMap(f => f.isDirectory() ? files(`${directory}/${f.name}`) : [`${directory}/${f.name}`]);
const hash = createHash("sha256");
for (const file of ["package.json", ...files("src")].sort()) {
  hash.update(file + "\0"); hash.update(readFileSync(resolve(source, file))); hash.update("\0");
}
const fixture = `docs/adaptive/evidence/reuse-comparison-attempt3/${phase}/`;
const stateBytes = readFileSync(fixture + "before.json");
let state = JSON.parse(stateBytes.toString());
const recorded = readFileSync(fixture + "network.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line)).slice(0, 2);
const request = readFileSync(fixture + "mcp.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line)).find(r => r.tool === "context_run").args;
const calls: any[] = [];
const fetch = async (input: any, init?: RequestInit) => {
  const r = new Request(input, init);
  const actual = { url: r.url, method: r.method, ...(r.method === "GET" ? {} : { body: await r.text() }) };
  const expected = recorded[calls.length];
  calls.push(actual);
  if (!expected || actual.url !== expected.url || actual.method !== expected.method || actual.body !== expected.body)
    throw new Error("unexpected replay request");
  return new Response(readFileSync(fixture + `response-${expected.id}.bin`), { status: expected.status, headers: { "content-type": "application/json" } });
};
const store = { load: async () => state, save: async (x: any) => { state = structuredClone(x); } };
const options = { directories: [], sandbox: null, fetch, store };
const rc = await RightClick.create(options);
const goalsBefore = structuredClone(state.published);
const graphBefore = rc.graph.capabilities.size;
const before = await dispatch(rc, "context_explain", { id: request.id });
const started = performance.now();
const run = await dispatch(rc, "context_run", request);
const milliseconds = performance.now() - started;
await rc.flush();
const after = await dispatch(rc, "context_explain", { id: request.id });
const projected = await dispatch(rc, "context_run_status", { runId: run.runId,
  view: { fields: ["message.DOI", "message.title", "message.publisher"] } });
const callsBeforeRestart = calls.length;
const fresh = await RightClick.create(options);
const restarted = await dispatch(fresh, "context_explain", { id: request.id });
const result = { phase, request, sourceTreeSha256: hash.digest("hex"), stateSha256: createHash("sha256").update(stateBytes).digest("hex"),
  before, run, after, projected, restarted, calls, callsBeforeRestart, graphBefore, graphAfter: fresh.graph.capabilities.size,
  goalsBefore, goalsAfter: state.published, milliseconds,
  bytes: { before: Buffer.byteLength(JSON.stringify(before)), after: Buffer.byteLength(JSON.stringify(after)),
    run: Buffer.byteLength(JSON.stringify(run)), projected: Buffer.byteLength(JSON.stringify(projected)) } };
writeFileSync(destination, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ phase, status: run.status, calls: calls.length, milliseconds, bytes: result.bytes }));
if (run.status !== "completed" || calls.length !== 2) throw new Error("replay failed; evidence retained");
