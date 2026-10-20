// Bounded deterministic HTTP execution overhead. No network or model use.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]);
const { RightClick } = await import(pathToFileURL(root + "/src/runtime.ts").href);
const { reflectOpenAPI } = await import(pathToFileURL(root + "/src/reflectors/openapi.ts").href);
let requests = 0, contexts = 0;
const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (_url: unknown, _init: unknown, context?: unknown) => {
  requests++; if (context) contexts++; return Response.json({ count: 7 });
} });
rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Counters" }, servers: [{ url: "https://unused.test" }],
  paths: { "/count": { get: { operationId: "count", responses: { "200": { content: { "application/json": {
    schema: { type: "object", properties: { count: { type: "integer" } } },
  } } } } } } } }, "https://unused.test/openapi.json"));
const graphBefore = rc.graph.list().length;
const run = async () => {
  const result = await rc.run("openapi:counters:count", {}, { verify: [{ op: "equals", path: "count", value: 7 }] });
  if (result.status !== "completed" || result.verification.status !== "checked") throw new Error("incorrect benchmark outcome");
};
for (let n = 0; n < 100; n++) await run();
const rssBefore = process.memoryUsage().rss, start = performance.now();
for (let n = 0; n < 1000; n++) await run();
console.log(JSON.stringify({ milliseconds: performance.now() - start, rssBefore, rssAfter: process.memoryUsage().rss,
  measuredRuns: 1000, warmupRuns: 100, requests, contexts, graphBefore, graphAfter: rc.graph.list().length }));
