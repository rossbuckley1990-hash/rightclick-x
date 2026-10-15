// E11 across the cloud: the same API-synthesis experiment, with A, B and C
// deployed to Cloudflare by deploy/cloud.ts, each pinned to a region (Western
// Europe, Eastern North America, Asia-Pacific) and reporting the datacenter it
// actually runs in. The driver speaks only MCP over HTTPS, with each
// instance's token; B holds A's token and C holds B's.
//
//   node deploy/cloud.ts && node experiments/synthesis-cloud.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const log = (...a: unknown[]) => console.log(...a);
const instances = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const tokens = new Map(Object.values(instances).map((i) => [i.url, i.token]));

let rpcId = 0;
/** The only way this driver touches anything: an MCP tools/call to a RightClick X server. */
async function mcp(server: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  // Retry Cloudflare edge errors (e.g. 1042 while a new workers.dev route propagates).
  for (let attempt = 0; ; attempt++) {
    const r = await callOnce(server, tool, args);
    if (r.ok || attempt >= 5) return r.value;
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
  }
}

async function callOnce(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; value?: any }> {
  const res = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tokens.get(server)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const j: any = await res.json().catch(() => null);
  if (!j?.jsonrpc) return { ok: false };
  if (j.error) throw new Error(`${tool}: ${j.error.message}`);
  if (j.result.isError) throw new Error(`${tool}: ${j.result.content?.[0]?.text}`);
  return { ok: true, value: j.result.structuredContent };
}

const show = (s: unknown, n = 150) => (typeof s === "string" ? s : JSON.stringify(s)).replace(/\s+/g, " ").slice(0, n);
const out: Record<string, unknown> = { at: new Date().toISOString() };

try {
  const [A, B, C] = [instances.a.url, instances.b.url, instances.c.url];
  const where = await Promise.all([A, B, C].map((s) => mcp(s, "context_runtime")));
  ["A", "B", "C"].forEach((n, i) => log(`${n} ${[A, B, C][i]}  runs in Cloudflare datacenter ${where[i].runtime.region}`));
  log("(three RightClick X instances on Cloudflare, each pinned to a region; this driver speaks only MCP over HTTPS)\n");
  out.placement = where.map((w) => ({ name: w.name, region: w.runtime.region, country: w.runtime.country }));

  // ------------------------------------------------------------- A
  log("━━ A: learn real services, compose, publish a new API");
  const learned = await mcp(A, "context_learn", {
    sources: [
      "https://countries.trevorblades.com/",
      "https://en.wikipedia.org/api/rest_v1/?spec",
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    ],
  });
  log(`  context_learn → +${learned.totalNewCapabilities} capabilities from ${learned.results.length} real services`);

  const goals = [
    { publish: "Country briefing", have: { country: "JP" }, want: "text", intent: "country capital summary", verify: [{ op: "length_gt", value: 80 }] },
    { publish: "Country money", have: { country: "JP" }, want: "json", intent: "country currency latest exchange rates", acquire: true, verify: [{ op: "exists", path: "rates.USD" }] },
    {
      publish: "Project explainer",
      have: { owner: "denoland", repo: "deno" },
      want: "text",
      intent: "repository homepage summary",
      through: ["openapi:github-v3-rest-api:repos-get", "builtin:web.fetch"],
      verify: [{ op: "length_gt", value: 80 }],
    },
  ];
  const published = [];
  for (const g of goals) {
    const t = performance.now();
    const r = await mcp(A, "context_compose", { ...g, run: true, risks: ["read", "external"] });
    const ok = r.executed?.status === "completed";
    log(`  ${ok ? "✓" : "✗"} "${g.publish}"  ${r.executed?.titles?.join(" → ")}  (${Math.round(performance.now() - t)}ms)`);
    if (r.acquisition) log(`      acquired on demand: ${r.acquisition.learned.filter((l: any) => l.capabilities).map((l: any) => l.title).join(", ")}`);
    log(`      ${show(r.executed?.output)}`);
    if (r.published) log(`      published → ${A}${r.published.path}`);
    published.push({ goal: g.publish, ok, pipeline: r.executed?.titles, acquisition: r.acquisition?.learned, path: r.published?.path, output: show(r.executed?.output, 300) });
  }
  out.A = { learned: learned.totalNewCapabilities, published };

  // ------------------------------------------------------------- B
  log("\n━━ B: learn A's synthesized API, chain it, publish another");
  const lb = await mcp(B, "context_learn", { source: `${A}/openapi.json` });
  const bProviders = await mcp(B, "context_providers");
  const aApi = bProviders.result?.find?.((p: any) => p.source === "openapi") ?? (Array.isArray(bProviders) ? bProviders.find((p: any) => p.source === "openapi") : null);
  log(`  context_learn ${A}/openapi.json → +${lb.totalNewCapabilities} capabilities (${aApi?.title ?? "A's API"})`);
  const bRuns = [];
  for (const country of ["BR", "KE"]) {
    const r = await mcp(B, "context_compose", { have: { country }, want: "list:text", intent: "country briefing keywords", run: true, publish: "Country keywords" });
    log(`  ${r.executed?.status === "completed" ? "✓" : "✗"} ${country}: ${r.executed?.titles?.join(" → ")} → ${show(r.executed?.output, 110)}`);
    bRuns.push({ country, pipeline: r.executed?.titles, output: r.executed?.output, published: r.published?.path });
  }
  const money = await mcp(B, "context_compose", { have: { country: "GB" }, want: "json", intent: "country money", run: true, verify: [{ op: "exists", path: "result.rates.USD" }] });
  const moneyOk = money.executed?.status === "completed";
  log(`  ${moneyOk ? "✓" : "✗"} GB via A's "Country money": ${moneyOk ? show(money.executed?.output, 110) : "not available (" + (money.executed?.attempts?.map((a: any) => a.error).join("; ").slice(0, 100) || "no plan") + ")"}`);
  out.B = { learned: lb.totalNewCapabilities, runs: bRuns, money: show(money.executed?.output, 300) };

  // ------------------------------------------------------------- C
  log("\n━━ C: learn B's API and call it (C → B → A → the internet)");
  const lc = await mcp(C, "context_learn", { source: `${B}/openapi.json` });
  const caps = await mcp(C, "context_graph", { op: "search", query: "country keywords", limit: 1 });
  const capId = (caps.result ?? caps)[0].id;
  log(`  context_learn ${B}/openapi.json → +${lc.totalNewCapabilities} capabilities; using ${capId}`);
  const t = performance.now();
  const r = await mcp(C, "context_run", { id: capId, args: { country: "PE" }, verify: [{ op: "length_gt", path: "result", value: 3 }] });
  log(`  ${r.status === "completed" ? "✓" : "✗"} C asked B for Peru (${Math.round(performance.now() - t)}ms, ${r.verification.status}): ${show(r.output?.result, 120)}`);
  log(`      B's pipeline: ${r.output?.pipeline?.join(" → ")}`);
  out.C = { learned: lc.totalNewCapabilities, capability: capId, status: r.status, verification: r.verification.status, result: r.output?.result, bPipeline: r.output?.pipeline };

  // ------------------------------------------------------------- provenance
  const chains = await Promise.all([A, B, C].map((s) => mcp(s, "context_run_status", { limit: 1 })));
  log(`\nreceipt chains intact: A ${chains[0].chain.intact} (${chains[0].chain.count}), B ${chains[1].chain.intact} (${chains[1].chain.count}), C ${chains[2].chain.intact} (${chains[2].chain.count})`);
  out.receipts = chains.map((c) => c.chain);
} finally {
  mkdirSync("experiments/results", { recursive: true });
  writeFileSync("experiments/results/E11-cloud.json", JSON.stringify(out, null, 2));
}
