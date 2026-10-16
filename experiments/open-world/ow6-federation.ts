// OPEN-WORLD 6 (Gauntlet Exp. 3): a task that depends on capabilities on two
// separate real machines. A (Cloudflare, Western Europe) holds a GitHub
// credential; B (Cloudflare, Eastern North America) does not, and has learned
// Wikipedia. The operator wires B to its peer A (provisioning, harness-side,
// labelled). The AI agent connects ONLY to B, over Streamable HTTP MCP.
//   node experiments/open-world/ow6-federation.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runAgent } from "../gauntlet/agent.ts";

const log = (...a: unknown[]) => console.log(...a);
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const inst = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const A = inst.a, B = inst.b;

async function mcp(server: { url: string; token: string }, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${server.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
    const j: any = await res.json().catch(() => null);
    if (j?.jsonrpc) {
      if (j.error || j.result.isError) throw new Error(`${tool}: ${j.error?.message ?? j.result.content?.[0]?.text}`);
      return j.result.structuredContent;
    }
    if (attempt >= 5) throw new Error(`${tool}: edge error ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
const ev: Record<string, any> = {
  experiment: "OW6 cross-host federation",
  hypothesis: "An AI connected to one RightClick X endpoint can complete a verified task that depends on capabilities only available on a different real machine, without the credential leaving that machine.",
  build,
  provisioning: [] as string[],
};

// ---------------------------------------------------------------- provisioning (operator setup, not the agent)
const [ra, rb] = await Promise.all([mcp(A, "context_runtime"), mcp(B, "context_runtime")]);
ev.hosts = { A: { url: A.url, name: ra.name, datacenter: ra.runtime.region, runtime: ra.runtime.name, version: ra.version }, B: { url: B.url, name: rb.name, datacenter: rb.runtime.region, runtime: rb.runtime.name, version: rb.version } };
log(`A ${ra.name} in ${ra.runtime.region} · B ${rb.name} in ${rb.runtime.region}`);
await mcp(A, "context_learn", { source: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json" });
ev.provisioning.push("A: context_learn GitHub's OpenAPI description (A holds an origin-pinned GitHub credential as a Cloudflare secret)");
await mcp(B, "context_learn", { source: "https://en.wikipedia.org/api/rest_v1/?spec" });
ev.provisioning.push("B: context_learn Wikipedia REST");
const peer = await mcp(B, "context_learn", { source: `${A.url}/` });
ev.provisioning.push(`B: context_learn ${A.url}/ (peer federation): ${peer.results[0]?.probes?.filter((p: any) => p.ok).map((p: any) => `${p.kind} ${p.detail}`).join(", ")}`);
const envB = await mcp(B, "context_research", {});
ev.credentialLocality = { B_credentialedOrigins: envB.environment.credentialedOrigins, B_holdsGitHubCredential: envB.environment.credentialedOrigins.some((o: string) => o.includes("github")) };
log(`B credentialed origins: ${JSON.stringify(ev.credentialLocality.B_credentialedOrigins)}`);
const receiptsABefore = (await mcp(A, "context_run_status", { limit: 1 })).chain.count;

// ---------------------------------------------------------------- the agent (MCP to B only)
const prompt = [
  "You are connected to exactly one MCP server, rightclick-x (a remote instance). Use only its tools.",
  "Some capabilities may be available to this instance only through other connected RightClick X instances (peers); you can find out with its tools.",
  "Task: find the real name of the GitHub user 'gvanrossum', then give the first sentence of the English Wikipedia summary about that person.",
  "End with exactly two lines:",
  "NAME: <real name>",
  "SUMMARY: <first sentence of the Wikipedia summary>",
].join("\n");
log("agent: Claude Code → B only…");
const r = await runAgent("claude", { kind: "http", url: B.url, token: B.token }, prompt);
const field = (k: string) => new RegExp(`^\\s*${k}:\\s*(.+)$`, "mi").exec(r.output)?.[1]?.trim();

// ---------------------------------------------------------------- independent verification + execution evidence
const gh: any = await (await fetch("https://api.github.com/users/gvanrossum", { headers: { "user-agent": "rightclick-x-verification" } })).json();
const wiki: any = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(gh.name)}`, { headers: { "user-agent": "rightclick-x-verification/0.1" } })).json();
const name = field("NAME") ?? "";
const summary = field("SUMMARY") ?? "";
const words = (s: string) => s.toLowerCase().match(/[a-z]{5,}/g) ?? [];
const grounded = words(summary).filter((w) => String(wiki.extract).toLowerCase().includes(w)).length;
const recentA = (await mcp(A, "context_run_status", { limit: 50 })).recent as any[];
const recentB = (await mcp(B, "context_run_status", { limit: 50 })).recent as any[];
const ranOnA = recentA.filter((x) => /users-get-by-username/.test(x.capability));
const peerOnB = recentB.filter((x) => x.provider.startsWith("peer:"));
const localOnB = recentB.filter((x) => x.provider.includes("wikimedia"));
ev.agent = { client: "claude", connectedTo: B.url, prompt, seconds: r.seconds, finalText: r.output.slice(-1500), name, summary };
ev.independentTruth = { githubName: gh.name, wikipediaExtract: String(wiki.extract).slice(0, 300) };
ev.execution = {
  A_receiptsAddedDuringTask: (await mcp(A, "context_run_status", { limit: 1 })).chain.count - receiptsABefore,
  A_githubRuns: ranOnA.map((x) => ({ capability: x.capability, status: x.status, startedAt: x.startedAt })),
  B_peerRuns: peerOnB.map((x) => ({ capability: x.capability, status: x.status })),
  B_localWikipediaRuns: localOnB.map((x) => ({ capability: x.capability, status: x.status })),
};
ev.checks = {
  nameOk: name.toLowerCase() === String(gh.name).toLowerCase(),
  summaryGrounded: grounded >= 4,
  githubStepRanOnA: ranOnA.some((x) => x.status === "completed"),
  B_reachedAThroughFederation: peerOnB.some((x) => x.status === "completed"),
  credentialStayedOnA: !ev.credentialLocality.B_holdsGitHubCredential,
};
ev.verdict = Object.values(ev.checks).every(Boolean) ? "PASS" : "FAIL";
log(`NAME: ${name} (truth ${gh.name}) · SUMMARY grounded words: ${grounded}`);
log(`A ran: ${ranOnA.map((x) => x.capability).join(", ") || "(nothing)"} · B peer runs: ${peerOnB.length} · B local Wikipedia runs: ${localOnB.length}`);
log(`checks: ${JSON.stringify(ev.checks)} · ${r.seconds}s\nVERDICT: ${ev.verdict}`);
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/ow6-federation.json", JSON.stringify(ev, null, 2));
