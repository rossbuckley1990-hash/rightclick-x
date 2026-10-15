// X4: one RightClick X instance, real HTTP, N simultaneous MCP tool calls.
// A burst of context_inspect measures raw server overhead; a burst of
// context_compose (plan + run across GraphQL, MCP and OpenAPI services)
// measures the whole engine under load. The receipt chain must stay intact.
//   node experiments/stress-concurrency.ts [n=1000]

import { mkdirSync, writeFileSync } from "node:fs";
import { createHandler } from "../src/interface/http.ts";
import { serve } from "../src/entry/node-host.ts";
import { RightClick } from "../src/runtime.ts";
import { startStage } from "../demo/stage.ts";

const N = Number(process.argv[2] ?? 1000);
const stage = await startStage();
const rc = await RightClick.create({ name: "rcx-load" });
await rc.learn({ sources: [stage.polyglot, stage.atlas, stage.skycast] });
const server = await serve(createHandler(rc, { open: true }), 0);
const PLACES = ["Lisbon", "Tokyo", "Nairobi", "Lima"];

async function burst(label: string, body: (i: number) => unknown) {
  const lat: number[] = [];
  let errors = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const t = performance.now();
      try {
        const res = await fetch(`${server.url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(i)) });
        const j: any = await res.json();
        if (!res.ok || j.error || j.result?.isError) errors++;
      } catch {
        errors++;
      }
      lat.push(performance.now() - t);
    }),
  );
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  const p = (q: number) => Math.round(lat[Math.floor((lat.length - 1) * q)]);
  const row = { label, calls: N, errors, wallMs: Math.round(wall), throughputPerSec: Math.round((N / wall) * 1000), p50ms: p(0.5), p99ms: p(0.99) };
  console.log(JSON.stringify(row));
  return row;
}

const rows = [
  await burst("context_inspect", (i) => ({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "context_inspect", arguments: { value: `https://example.com/${i}` } } })),
  await burst("context_compose (plan + run, 3 protocols)", (i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "tools/call",
    params: { name: "context_compose", arguments: { have: { place: PLACES[i % 4], language: "es" }, want: "text", intent: "weather translated", run: true } },
  })),
];
const chain = await rc.verifyReceipts();
console.log(`receipts ${chain.count}, chain intact: ${chain.intact}`);
await server.close();
await stage.stop();
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/X4-concurrency.json", JSON.stringify({ at: new Date().toISOString(), rows, receipts: chain }, null, 2));
