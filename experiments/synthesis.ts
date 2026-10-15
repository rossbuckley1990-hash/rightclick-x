// E11: API synthesis across real services, driven only through RightClick X.
//
// Three RightClick X servers run as separate processes (A, B, C). This driver
// does nothing but speak MCP to them (tools/call context_*). No upstream
// service is called by the driver; no endpoint, handler or schema is written.
//
//   A learns real services (countries GraphQL, Wikipedia REST, GitHub REST),
//     acquires one it has never seen from the public directories, composes
//     goals across them and publishes those goals as a new API (/openapi.json).
//   B learns A's synthesized API like any other, chains it into a new goal and
//     publishes that.
//   C learns B's API and calls it: C → B → A → the internet.
//
//   node experiments/synthesis.ts

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const log = (...a: unknown[]) => console.log(...a);
const procs: ChildProcess[] = [];

async function start(name: string, port: number): Promise<string> {
  const dir = mkdtempSync(`${tmpdir()}/rcx-${name}-`);
  const p = spawn(process.execPath, ["bin/rcx.ts", "serve", "--port", String(port)], {
    env: { ...process.env, RCX_NAME: name, RCX_STATE_FILE: `${dir}/state.json`, RCX_WORKSPACE: dir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  procs.push(p);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${name} did not start`);
}

let rpcId = 0;
/** The only way this driver touches anything: an MCP tools/call to a RightClick X server. */
async function mcp(server: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const j: any = await res.json();
  if (j.error) throw new Error(`${tool}: ${j.error.message}`);
  if (j.result.isError) throw new Error(`${tool}: ${j.result.content?.[0]?.text}`);
  return j.result.structuredContent;
}

const show = (s: unknown, n = 150) => (typeof s === "string" ? s : JSON.stringify(s)).replace(/\s+/g, " ").slice(0, n);
const out: Record<string, unknown> = { at: new Date().toISOString() };

try {
  const A = await start("instance-a", 8801);
  const B = await start("instance-b", 8802);
  const C = await start("instance-c", 8803);
  log(`A ${A}   B ${B}   C ${C}   (three separate RightClick X processes; this driver speaks only MCP)\n`);

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
  const money = await mcp(B, "context_compose", { have: { country: "GB" }, want: "json", intent: "country money", run: true });
  log(`  ✓ GB via A's "Country money": ${show(money.executed?.output, 110)}`);
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
  for (const p of procs) p.kill();
  mkdirSync("experiments/results", { recursive: true });
  writeFileSync("experiments/results/E11-synthesis.json", JSON.stringify(out, null, 2));
}
