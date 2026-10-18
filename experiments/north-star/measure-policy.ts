// Local runtime overhead only. This does not measure agents, model tokens, or commercial advantage.
// Run against a baseline runtime path and the current runtime with identical settings.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { median, quantile } from "./common.ts";

const runtime = resolve(process.argv[2] ?? "src/runtime.ts");
const { RightClick } = await import(pathToFileURL(runtime).href);
const results = [];
for (const policy of [undefined, { allowedRisks: ["read"] }]) {
  let effects = 0;
  const rc = await RightClick.create({ directories: [], authority: { execution: policy }, fetch: async () => { effects++; return new Response("checked value"); } });
  const capabilities = Array.from({ length: 100 }, (_, i) => ({ id: `measurement:${i}`, provider: "measurement", source: "openapi", title: `Operation ${i}`, description: "Local measurement fixture", inputs: [], outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [], invoke: { kind: "http", method: "GET", url: `https://fixture.invalid/${i}`, pathParams: [], queryParams: [], headerParams: [], body: null, bodyParams: [] } }));
  rc.graph.add({ provider: { id: "measurement", title: "Measurement", source: "openapi", origin: "https://fixture.invalid", learnedAt: new Date().toISOString(), capabilityIds: [] }, capabilities });
  const samples = [];
  for (let batch = 0; batch < 10; batch++) {
    const start = performance.now();
    for (let n = 0; n < 100; n++) {
      const run = await rc.run(`measurement:${n}`, {}, { verify: [{ op: "equals", value: "checked value" }] });
      if (run.status !== "completed" || run.verification.status !== "checked") throw new Error("measurement correctness failed");
    }
    if (batch) samples.push((performance.now() - start) / 100);
  }
  results.push({ policy: policy ?? "legacy-unrestricted", calls: effects, warmupCalls: 100, measuredCalls: 900, millisecondsPerRun: { median: median(samples), p95: quantile(samples, .95), batches: samples } });
}
console.log(JSON.stringify({ runtime, scope: "100 declared HTTP operations dispatched through an in-memory fetch double; predicate checks and receipt hashing retained. No real network, AI model, or unfamiliar-software claim.", results }, null, 2));
