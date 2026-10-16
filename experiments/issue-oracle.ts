// E12: Issue Oracle. GitHub (REST/OpenAPI) × DeepWiki (MCP), fused by
// RightClick X with no integration code, published as an API, used from
// another region. This driver only speaks MCP to the Cloudflare instances;
// RightClick X alone talks to GitHub and DeepWiki. Read-only throughout.
//
//   A (Amsterdam): learns DeepWiki's MCP server (GitHub's API is already in
//     its graph), finds a real open issue through its own GitHub capability,
//     composes a fan-in pipeline (issue body + repository full name →
//     DeepWiki's codebase model), and publishes it as "Issue oracle".
//   B (Newark): learns A's API and asks it about a different open issue.
//
//   node experiments/issue-oracle.ts [owner] [repo]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [owner, repo] = [process.argv[2] ?? "modelcontextprotocol", process.argv[3] ?? "typescript-sdk"];
const instances = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const tokenFor = new Map(Object.values(instances).map((i) => [i.url, i.token]));
const [A, B] = [instances.a.url, instances.b.url];
const log = (...a: unknown[]) => console.log(...a);
const show = (s: unknown, n = 300) => (typeof s === "string" ? s : JSON.stringify(s) ?? "").replace(/\s+/g, " ").slice(0, n);

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

const out: Record<string, unknown> = { at: new Date().toISOString(), repo: `${owner}/${repo}`, driver: "MCP tools/call only" };
const ISSUES_GET = "openapi:github-v3-rest-api:issues-get";
const REPOS_GET = "openapi:github-v3-rest-api:repos-get";
const ASK = "mcp:deepwiki:ask-wiki-question";

const where = await Promise.all([A, B].map((s) => mcp(s, "context_runtime")));
log(`A ${A} in ${where[0].runtime.region} · B ${B} in ${where[1].runtime.region}\n`);

// 1. A learns DeepWiki (GitHub's 1,242 operations are already in its graph).
const l = await mcp(A, "context_learn", { source: "https://mcp.deepwiki.com/mcp" });
log(`A context_learn DeepWiki MCP → +${l.totalNewCapabilities} capabilities`);

// 2. A finds real open issues through its own reflected GitHub capability.
const list = await mcp(A, "context_run", { id: "openapi:github-v3-rest-api:issues-list-for-repo", args: { owner, repo, state: "open", per_page: 10 } });
const issues = (list.output as any[]).filter((i) => !i.pull_request && (i.body ?? "").length > 80).slice(0, 2);
if (issues.length < 2) throw new Error(`not enough open issues with bodies in ${owner}/${repo}`);
log(`A context_run issues-list-for-repo → #${issues[0].number} "${issues[0].title}", #${issues[1].number} "${issues[1].title}"\n`);

// 3. A composes the fan-in and publishes it.
const t = performance.now();
const r = await mcp(A, "context_compose", {
  have: { owner, repo, issue_number: issues[0].number },
  want: "text",
  intent: "answer issue",
  through: [ISSUES_GET, REPOS_GET, ASK],
  risks: ["read", "external"],
  verify: [{ op: "length_gt", value: 200 }],
  run: true,
  publish: "Issue oracle",
});
const ok = r.executed?.status === "completed";
log(`${ok ? "✓" : "✗"} A composed "Issue oracle" in ${Math.round(performance.now() - t)}ms`);
const p = r.plans?.[0];
if (p) for (const [i, s] of p.steps.entries()) log(`   step ${i}: ${p.titles[i]}  ← ${s.bindings.map((b: any) => `${b.port}=${b.from}`).join(", ")}`);
for (const a of r.executed?.attempts ?? []) log(`   ✗ ${a.failed}: ${a.error.slice(0, 140)}`);
log(`   issue #${issues[0].number}: "${issues[0].title}"`);
log(`   answer: ${show(r.executed?.output, 600)}`);
if (r.published) log(`   published → ${A}${r.published.path}`);
out.compose = { ok, pipeline: r.executed?.titles, bindings: p?.steps.map((s: any) => s.bindings), issue: { number: issues[0].number, title: issues[0].title }, answer: show(r.executed?.output, 2000), published: r.published };

// 4. B, in another region, learns A's API and uses it for a different issue.
const lb = await mcp(B, "context_learn", { source: `${A}/openapi.json` });
const capId = (await mcp(B, "context_graph", { op: "search", query: "issue oracle", limit: 1 })).result[0].id;
const tb = performance.now();
const x = await mcp(B, "context_run", { id: capId, args: { owner, repo, issue_number: issues[1].number }, verify: [{ op: "length_gt", path: "result", value: 200 }] });
const bOk = x.status === "completed" && x.verification.status === "verified";
log(`\n${bOk ? "✓" : "✗"} B (${where[1].runtime.region}) → A's "Issue oracle" → GitHub + DeepWiki for #${issues[1].number} "${issues[1].title}" (${Math.round(performance.now() - tb)}ms)`);
log(`   answer: ${show(x.output?.result, 600)}`);
out.fromB = { ok: bOk, learned: lb.totalNewCapabilities, issue: { number: issues[1].number, title: issues[1].title }, pipeline: x.output?.pipeline, answer: show(x.output?.result, 2000) };

const chains = await Promise.all([A, B].map((s) => mcp(s, "context_run_status", { limit: 1 })));
log(`\nreceipts: A ${chains[0].chain.count} intact ${chains[0].chain.intact} · B ${chains[1].chain.count} intact ${chains[1].chain.intact}`);
out.receipts = chains.map((c) => c.chain);
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/E12-issue-oracle.json", JSON.stringify(out, null, 2));
