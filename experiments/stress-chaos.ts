// X2: chaos routing. 30 providers offer the same two capabilities
// (geocode place → coordinates, forecast coordinates → summary) with hidden,
// very different failure rates (0–90%) and latencies. RightClick X is told
// nothing about them. It must learn, from its own run receipts, which routes
// work, the way a routing protocol learns a network.
//   node experiments/stress-chaos.ts [runs=1000]

import { mkdirSync, writeFileSync } from "node:fs";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { rng } from "./universe.ts";

const RUNS = Number(process.argv[2] ?? 1000);
const P = 30;
const ORIGIN = "https://chaos.test";
// Hidden reliability reshuffles twice (phase 0, 1, 2): providers degrade and recover.
let phase = 0;
const failure = (i: number, ph = phase) => ((i * 37 + ph * 41) % 100) / 110; // 0 … 0.9
const latency = (i: number) => 2 + ((i * 53) % 40); // 2 … 41 ms
const chaos = rng(7);

const spec = (i: number) => ({
  openapi: "3.0.3",
  info: { title: `Weather vendor ${i}`, version: "1" },
  servers: [{ url: `/c/${i}` }],
  paths: {
    "/geocode": { get: { operationId: "geocode", summary: "Geocode a place", parameters: [{ name: "place", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } } } } } } } },
    "/forecast": { get: { operationId: "forecast", summary: "Weather forecast", parameters: [{ name: "latitude", in: "query", required: true, schema: { type: "number" } }, { name: "longitude", in: "query", required: true, schema: { type: "number" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { summary: { type: "string" } } } } } } } } },
  },
});

const calls = new Map<number, { ok: number; failed: number }>();
const handler = async (req: Request) => {
  const u = new URL(req.url);
  const m = /^\/c\/(\d+)\/(openapi\.json|geocode|forecast)$/.exec(u.pathname);
  if (!m) return new Response("nf", { status: 404 });
  const i = Number(m[1]);
  if (m[2] === "openapi.json") return Response.json(spec(i));
  await new Promise((r) => setTimeout(r, latency(i)));
  const c = calls.get(i) ?? { ok: 0, failed: 0 };
  calls.set(i, c);
  if (chaos() < failure(i)) {
    c.failed++;
    return new Response("{}", { status: 503 });
  }
  c.ok++;
  return m[2] === "geocode" ? Response.json({ latitude: 38.7, longitude: -9.1 }) : Response.json({ summary: `Sunny, 24°C (vendor ${i})` });
};

const f = routerFetch({ [ORIGIN]: handler });
const rc = await RightClick.create({ fetch: f, directories: [], timeoutMs: 5000 });
await rc.learn({ sources: Array.from({ length: P }, (_, i) => `${ORIGIN}/c/${i}/openapi.json`) });

// Baselines: what static integrations get from the same chaos.
async function staticCall(i: number, j: number) {
  const g = await f(`${ORIGIN}/c/${i}/geocode?place=Lisbon`);
  if (!g.ok) return false;
  return (await f(`${ORIGIN}/c/${j}/forecast?latitude=38.7&longitude=-9.1`)).ok;
}

const rounds = [];
const WINDOW = Math.max(50, Math.floor(RUNS / 10));
let firstTry = 0, final = 0, ms = 0, hardcoded = 0, random = 0;
const r = rng(99);
for (let n = 1; n <= RUNS; n++) {
  const ph = Math.min(2, Math.floor(((n - 1) * 3) / RUNS));
  if (ph !== phase) {
    phase = ph;
    console.log(`-- phase ${phase}: vendor reliability reshuffled (vendor 0 now fails ${Math.round(failure(0) * 100)}% of calls)`);
  }
  const t = performance.now();
  const c = await rc.compose({ have: { place: "Lisbon" }, want: "text", intent: "weather forecast", run: true });
  ms += performance.now() - t;
  if (c.executed?.status === "completed") final++;
  if (c.executed?.status === "completed" && !c.executed.attempts.length) firstTry++;
  if (await staticCall(0, 0)) hardcoded++;
  if (await staticCall(Math.floor(r() * P), Math.floor(r() * P))) random++;
  if (n % WINDOW === 0) {
    const row = {
      runs: n,
      phase,
      rightclickFirstTry: +(firstTry / WINDOW).toFixed(3),
      rightclickFinal: +(final / WINDOW).toFixed(3),
      hardcodedVendor0: +(hardcoded / WINDOW).toFixed(3),
      randomVendor: +(random / WINDOW).toFixed(3),
      meanMs: Math.round(ms / WINDOW),
    };
    rounds.push(row);
    console.log(JSON.stringify(row));
    firstTry = final = ms = hardcoded = random = 0;
  }
}

// Which vendors did the graph end up trusting?
const trusted = [...rc.ledger.stats]
  .filter(([id]) => id.includes(":forecast") && id.startsWith("openapi:"))
  .map(([id, e]) => ({ vendor: Number(/weather-vendor-(\d+)/.exec(id)?.[1]), runs: e.runs, observed: +(e.ok / e.runs).toFixed(2), hiddenNow: +(1 - failure(Number(/weather-vendor-(\d+)/.exec(id)?.[1]))).toFixed(2) }))
  .sort((a, b) => b.runs - a.runs)
  .slice(0, 6);
console.log("most-used forecast vendors (observed vs hidden success rate):", JSON.stringify(trusted));
const crystallized = rc.graph.list().filter((c) => c.source === "composite").length;
console.log(`crystallized routes: ${crystallized} · receipts ${rc.chain.receipts.length}, intact ${(await rc.verifyReceipts()).intact}`);
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/X2-chaos.json", JSON.stringify({ at: new Date().toISOString(), runs: RUNS, providers: P, rounds, trusted, crystallized }, null, 2));
