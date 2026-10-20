// Offline comparison: actual retained public graph + protocol-general mock effect.
// Every transport is counted. No model, credential, private network or external API.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const [rootArg, outputArg] = process.argv.slice(2);
if (!rootArg || !outputArg) throw new Error("usage: node experiments/living/planning-refusal.ts SOURCE_ROOT NEW_RESULT.json");
const root = resolve(rootArg);
const { RightClick } = await import(pathToFileURL(resolve(root, "src/runtime.ts")).href);
const { reflectOpenAPI } = await import(pathToFileURL(resolve(root, "src/reflectors/openapi.ts")).href);
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const stateBytes = await readFile(new URL("../../docs/adaptive/evidence/living-public/attempt3/state.json", import.meta.url));
const sourceFiles = ["src/runtime.ts", "src/core/planner.ts", "src/interface/graphql-server.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(resolve(root, name)))])));
const samples = [];
for (let sample = 0; sample < 10; sample++) {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], sandbox: null,
    authority: { execution: { allowedOrigins: [], allowedRisks: ["read"] } },
    store: { load: async () => JSON.parse(stateBytes.toString()), save: async () => {} },
    fetch: async () => { calls++; throw new Error("unexpected network access"); } });
  const ledgerBefore = hash(JSON.stringify(rc.ledger.toJSON()));
  const graphSize = rc.graph.capabilities.size;
  const start = performance.now();
  const result = await rc.run("goal:structure-primary-publication-metadata", { entry_id: "2LYZ" });
  samples.push({ sample, durationMs: performance.now() - start, status: result.status, error: result.error,
    planningRefusal: result.planningRefusal ?? null, calls, graphSize,
    ledgerUnchanged: hash(JSON.stringify(rc.ledger.toJSON())) === ledgerBefore });
  await rc.flush();
}

const scopes = [];
for (const scope of ["omitted", "empty-risks", "empty-origins"] as const) {
  let dispatches = 0;
  const rc = await RightClick.create({ directories: [], sandbox: null,
    fetch: async () => { dispatches++; return Response.json({ result: "stored" }); } });
  const content = (properties: object, required: string[] = []) =>
    ({ "application/json": { schema: { type: "object", properties, required } } });
  rc.graph.add(reflectOpenAPI({
    openapi: "3.1.0", info: { title: "Archive" }, servers: [{ url: "https://archive.test" }],
    paths: { "/records": { post: {
      operationId: "store", summary: "Store record",
      requestBody: { required: true, content: content({ text: { type: "string" } }, ["text"]) },
      responses: { "200": { content: content({ result: { type: "string" } }) } },
    } } },
  }, "https://archive.test/spec"));
  const start = performance.now();
  const result = await rc.compose({ have: { text: "test record" }, want: "text", intent: "store record",
    through: ["openapi:archive:store"], run: true,
    ...(scope === "empty-risks" ? { risks: [] } : scope === "empty-origins" ? { origins: [] } : {}) });
  scopes.push({ scope, durationMs: performance.now() - start, dispatches, plans: result.plans.length,
    execution: result.executed?.status ?? null, planningRefusal: result.planningRefusal ?? null });
}
const times = samples.map(s => s.durationMs).sort((a, b) => a - b);
await writeFile(resolve(outputArg), JSON.stringify({ version: 1, runtime: process.version, root, sourceHashes,
  stateSha256: hash(stateBytes), transport: "counted offline mock only", samples, scopes,
  timing: { count: times.length, medianMs: (times[4] + times[5]) / 2, minMs: times[0], maxMs: times.at(-1) } }, null, 2) + "\n",
{ flag: "wx" });
console.log(JSON.stringify({ output: resolve(outputArg), samples: samples.length, scopes: scopes.map(s => ({ scope: s.scope, dispatches: s.dispatches })) }));
