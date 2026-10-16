// E12b: Issue Oracle closes the loop on the owner's own repository. Through
// RightClick X only (MCP to instance A, which holds an origin-pinned GitHub
// credential): create a labelled test issue, then run one composed pipeline
//   Get an issue ∥ Get a repository → DeepWiki ask_wiki_question → Create an issue comment
// The write pipeline is previewed first and executed only if its steps are
// exactly those four, so no other GitHub write can slip in.
//   node experiments/issue-oracle-post.ts check | post

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODE = process.argv[2] ?? "check";
const owner = "rossbuckley1990-hash";
const repo = "rightclick";
const instances = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const A = instances.a.url;
const log = (...a: unknown[]) => console.log(...a);
const show = (s: unknown, n = 400) => (typeof s === "string" ? s : JSON.stringify(s) ?? "").replace(/\s+/g, " ").slice(0, n);

async function mcp(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${A}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${instances.a.token}` },
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

const ASK = "mcp:deepwiki:ask-wiki-question";
const ANCHORS = ["openapi:github-v3-rest-api:issues-get", "openapi:github-v3-rest-api:repos-get", ASK, "openapi:github-v3-rest-api:issues-create-comment"];

if (MODE === "check") {
  const r = await mcp("context_run", { id: ASK, args: { repoName: `${owner}/${repo}`, question: "In two sentences, what does this repository do?" } });
  log(`DeepWiki on ${owner}/${repo}: ${r.status}`);
  log(`  ${show(r.output?.result ?? r.output ?? r.error)}`);
} else {
  // 1. A labelled test issue, created through RightClick X's reflected GitHub capability.
  const issue = await mcp("context_run", {
    id: "openapi:github-v3-rest-api:issues-create",
    args: {
      owner,
      repo,
      title: "[test] Issue Oracle: how does RightClick discover what an installed app can do?",
      body:
        "This is a test issue created by RightClick X (rightclick-x) to demonstrate **Issue Oracle**: GitHub's REST API and DeepWiki's MCP server joined by a composed pipeline with no integration code.\n\n" +
        "Question: when an app like BBEdit is installed, how does RightClick discover the capabilities it exposes through macOS Services, and how are those capabilities executed and verified?\n\n" +
        "An answer from DeepWiki's model of this codebase will be posted below as a comment by the same pipeline. Safe to close.",
    },
    verify: [{ op: "exists", path: "number" }],
  });
  if (issue.status !== "completed") throw new Error(`issue creation failed: ${issue.error}`);
  const number = issue.output.number;
  log(`1. created test issue #${number}: ${issue.output.html_url}`);

  // 2. Preview the write pipeline; refuse to run anything but the four anchored steps.
  const goal = {
    have: { owner, repo, issue_number: number },
    want: "json",
    intent: "answer issue comment",
    through: ANCHORS,
    risks: ["read", "external", "write"],
    maxSteps: 4,
  };
  const preview = await mcp("context_compose", goal);
  const p = preview.plans?.[0];
  if (!p) throw new Error("no plan for the write pipeline");
  for (const [i, s] of p.steps.entries()) log(`   step ${i}: ${p.titles[i]}  ← ${s.bindings.map((b: any) => `${b.port}=${b.from}`).join(", ")}`);
  const ids = p.steps.map((s: any) => s.capability).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...ANCHORS].sort())) throw new Error(`plan has unexpected steps: ${ids.join(", ")}`);
  const comment = p.steps.find((s: any) => s.capability.endsWith("issues-create-comment"));
  const bodyFrom = comment.bindings.find((b: any) => b.port === "body")?.from;
  const askIndex = p.steps.findIndex((s: any) => s.capability === ASK);
  if (!bodyFrom?.startsWith(`${askIndex}.`)) throw new Error(`comment body would not come from DeepWiki's answer: ${bodyFrom}`);
  log(`2. preview OK: exactly the four anchored steps; comment body ← DeepWiki's answer`);

  // 3. Run the same goal.
  const t = performance.now();
  const r = await mcp("context_compose", { ...goal, run: true, verify: [{ op: "exists", path: "html_url" }] });
  const ok = r.executed?.status === "completed";
  if (ok && JSON.stringify([...r.executed.titles].sort()) !== JSON.stringify([...p.titles].sort())) throw new Error("executed plan differs from preview");
  log(`3. ${ok ? "✓" : "✗"} pipeline ran in ${Math.round(performance.now() - t)}ms: ${r.executed?.titles?.join(" → ")}`);
  for (const a of r.executed?.attempts ?? []) log(`   ✗ ${a.failed}: ${a.error.slice(0, 160)}`);
  log(`   comment: ${r.executed?.output?.html_url}`);

  // 4. Read it back through RightClick X.
  const back = await mcp("context_run", { id: "openapi:github-v3-rest-api:issues-list-comments", args: { owner, repo, issue_number: number }, verify: [{ op: "length_gt", value: 0 }] });
  const posted = (back.output as any[])?.[0];
  log(`4. read back: ${back.output?.length} comment(s) on #${number}; by ${posted?.user?.login}`);
  log(`   ${show(posted?.body, 500)}`);
  mkdirSync("experiments/results", { recursive: true });
  writeFileSync(
    "experiments/results/E12b-issue-oracle-post.json",
    JSON.stringify({ at: new Date().toISOString(), issue: issue.output.html_url, plan: p.titles, bindings: p.steps.map((s: any) => s.bindings), ok, comment: r.executed?.output?.html_url, readBack: show(posted?.body, 2000) }, null, 2),
  );
}
