// E11-cloud, GitHub leg: A (Amsterdam) now holds an origin-pinned GitHub
// credential (RCX_AUTH secret, api.github.com only). The goal is constrained
// to read/external capabilities, so no GitHub write can be planned. B (Newark)
// then learns A's updated API and uses the new endpoint. MCP over HTTPS only.
//   node experiments/github-cloud.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const instances = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const tokenFor = new Map(Object.values(instances).map((i) => [i.url, i.token]));
const [A, B] = [instances.a.url, instances.b.url];

async function mcp(server: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${server}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenFor.get(server)}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    });
    const j: any = await res.json().catch(() => null);
    if (j?.jsonrpc) {
      if (j.error || j.result.isError) throw new Error(`${tool}: ${j.error?.message ?? j.result.content?.[0]?.text}`);
      return j.result.structuredContent;
    }
    if (attempt >= 5) throw new Error(`${tool}: edge error ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
const show = (s: unknown, n = 160) => (typeof s === "string" ? s : JSON.stringify(s)).replace(/\s+/g, " ").slice(0, n);

const where = await mcp(A, "context_runtime");
console.log(`A runs in ${where.runtime.region}`);
const t = performance.now();
const r = await mcp(A, "context_compose", {
  have: { owner: "denoland", repo: "deno" },
  want: "text",
  intent: "repository homepage summary",
  through: ["openapi:github-v3-rest-api:repos-get", "builtin:web.fetch"],
  risks: ["read", "external"],
  verify: [{ op: "length_gt", value: 80 }],
  run: true,
  publish: "Project explainer",
});
const ok = r.executed?.status === "completed";
console.log(`${ok ? "✓" : "✗"} A "Project explainer": ${r.executed?.titles?.join(" → ")} (${Math.round(performance.now() - t)}ms)`);
for (const a of r.executed?.attempts ?? []) console.log(`   ✗ ${a.failed}: ${a.error.slice(0, 140)}`);
console.log(`   ${show(r.executed?.output)}`);

const lb = await mcp(B, "context_learn", { source: `${A}/openapi.json` });
const cap = (await mcp(B, "context_graph", { op: "search", query: "project explainer", limit: 1 })).result[0].id;
const repos = [["nodejs", "node"], ["vercel", "next.js"]];
const fromB = [];
for (const [owner, repo] of repos) {
  const tb = performance.now();
  const x = await mcp(B, "context_run", { id: cap, args: { owner, repo }, verify: [{ op: "length_gt", path: "result", value: 80 }] });
  console.log(`${x.status === "completed" && x.verification.status === "verified" ? "✓" : "✗"} B (Newark) → A (Amsterdam) → GitHub → ${owner}/${repo}'s homepage (${Math.round(performance.now() - tb)}ms): ${show(x.output?.result, 120)}`);
  fromB.push({ repo: `${owner}/${repo}`, status: x.status, verification: x.verification.status, pipeline: x.output?.pipeline, preview: show(x.output?.result, 300) });
}
const chain = await mcp(A, "context_run_status", { limit: 1 });
console.log(`A receipts ${chain.chain.count}, intact ${chain.chain.intact}`);
mkdirSync("experiments/results", { recursive: true });
writeFileSync(
  "experiments/results/E11-cloud-github.json",
  JSON.stringify({ at: new Date().toISOString(), aRegion: where.runtime.region, explainer: { ok, pipeline: r.executed?.titles, attempts: r.executed?.attempts, output: show(r.executed?.output, 400), published: r.published }, bLearned: lb.totalNewCapabilities, fromB, receipts: chain.chain }, null, 2),
);
