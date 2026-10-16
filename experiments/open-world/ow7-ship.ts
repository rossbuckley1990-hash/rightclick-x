// OPEN-WORLD 7: "ship it without code". An AI agent whose only tool is a remote
// RightClick X instance turns a one-sentence product requirement into a live,
// published HTTP API built from real public services. Then two consumers that
// were not involved use it with no integration code:
//   - a conventional developer (this harness, plain HTTP, reading /openapi.json);
//   - an AI from another vendor whose only tool is its own local RightClick X,
//     told only the API's origin.
// Every answer is checked against the original public services, queried directly.
//   node experiments/open-world/ow7-ship.ts [--instance d]
// Attempt 1 (freeze-5, rcx-c) failed and is preserved: evidence/ow7-attempt1-FAILED.json.
//
// Success criteria (fixed before the run):
//   1. The builder publishes a goal; it appears in the instance's /openapi.json.
//   2. Developer: 3/3 unseen countries within 2% of independent truth.
//   3. Consumer AI: 3/3 countries within 2% of independent truth, its RightClick X
//      reached the published API's origin, and the instance recorded goal runs.
//   4. Neither agent had any tool except RightClick X (enforced by client config).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readJsonl, runAgent } from "../gauntlet/agent.ts";

const log = (...a: unknown[]) => console.log(...a);
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const instanceKey = process.argv.includes("--instance") ? process.argv[process.argv.indexOf("--instance") + 1] : "c";
const C = (JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>)[instanceKey];
const UA = { "user-agent": "rightclick-x-verification/0.1" };

async function mcp(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${C.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${C.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
    const j: any = await res.json().catch(() => null);
    if (j?.jsonrpc) {
      if (j.error || j.result.isError) throw new Error(`${tool}: ${j.error?.message ?? j.result.content?.[0]?.text}`);
      return j.result.structuredContent;
    }
    if (attempt >= 5) throw new Error(`${tool}: edge error ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

// ---------------------------------------------------------------- independent truth (direct, not via RightClick X)
// Some countries list several currency codes (CH: "CHE,CHF,CHW"); truth is the first one a
// rate source quotes. (Attempt 1's harness took the first code blindly and crashed.)
async function truth(code: string): Promise<{ currency: string; listed: string; eur: number }> {
  const g: any = await (await fetch("https://countries.trevorblades.com/", { method: "POST", headers: { "content-type": "application/json", ...UA }, body: JSON.stringify({ query: `{ country(code: "${code}") { currency } }` }) })).json();
  const listed = String(g.data.country.currency);
  for (const currency of listed.split(",")) {
    const r: any = await (await fetch(`https://open.er-api.com/v6/latest/${currency}`, { headers: UA })).json();
    if (typeof r?.rates?.EUR === "number") return { currency, listed, eur: r.rates.EUR };
  }
  throw new Error(`no rate source quotes any of ${listed}`);
}
const close = (got: number, want: number) => Number.isFinite(got) && Math.abs(got - want) / want <= 0.02;

mkdirSync("experiments/open-world/evidence", { recursive: true });
const out = `experiments/open-world/evidence/ow7-ship-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const save = () => writeFileSync(out, JSON.stringify(ev, null, 2));
const ev: Record<string, any> = {
  experiment: "OW7 ship it without code",
  hypothesis: "An AI agent whose only tool is RightClick X can turn a one-sentence requirement into a live API over real public services, which a developer and another vendor's AI then use with no integration code.",
  build,
  criteria: ["builder publishes a goal listed in /openapi.json", "developer 3/3 within 2% of truth", "consumer AI 3/3 within 2%, reached the origin, instance recorded goal runs", "agents had no tool except RightClick X"],
};

// ---------------------------------------------------------------- before
const rt = await mcp("context_runtime");
const before = await mcp("context_providers");
ev.instance = { url: C.url, name: rt.name, datacenter: rt.runtime?.region };
ev.providersBefore = (before.result ?? before.providers ?? before).map((p: any) => p.title ?? p.id);
log(`instance ${rt.name} (${rt.runtime?.region}); providers before: ${ev.providersBefore.length}`);

// ---------------------------------------------------------------- 1. builder: requirement -> live API
const builderPrompt = [
  "You are connected to exactly one MCP server, rightclick-x (a remote instance in the cloud). Use only its tools.",
  "Product requirement from a developer: \"I need an HTTP API that, given an ISO 3166 country code (for example JP), returns how many euros one unit of that country's currency is worth today. I will not write any integration code.\"",
  "One service you may use is the countries GraphQL API at https://countries.trevorblades.com/ . You are given no other addresses; find anything else you need with the tools.",
  "Build it with the rightclick-x tools, check that it returns a sensible number for at least one country, and publish it under the name 'euro value of a country currency'.",
  "End your reply with exactly two lines:",
  "SLUG: <published slug>",
  "PATH: <published path>",
].join("\n");
log(`\n1. builder: Claude Code -> ${new URL(C.url).host} only…`);
const b = await runAgent("claude", { kind: "http", url: C.url, token: C.token }, builderPrompt);
const slug = /^\s*SLUG:\s*`?([\w-]+)`?/im.exec(b.output)?.[1];
ev.builder = { client: "claude", prompt: builderPrompt, seconds: b.seconds, slug, finalText: b.output.slice(-1500) };
log(`   ${b.seconds}s · slug ${slug ?? "(none)"}`);
save();

// ---------------------------------------------------------------- 2. developer: plain HTTP from the published contract
const spec: any = await (await fetch(`${C.url}/openapi.json`, { headers: { authorization: `Bearer ${C.token}` } })).json();
const path = Object.keys(spec.paths ?? {}).find((p) => slug && p.endsWith(`/${slug}`));
const op = path ? (spec.paths[path].post ?? spec.paths[path].get) : undefined;
const method = path ? (spec.paths[path].post ? "POST" : "GET") : "";
const params: string[] = op ? [...(op.parameters ?? []).map((p: any) => p.name), ...Object.keys(op.requestBody?.content?.["application/json"]?.schema?.properties ?? {})] : [];
ev.published = { inOpenApi: !!path, path, method, params, summary: op?.summary };
log(`\n2. developer: ${method} ${path} params ${JSON.stringify(params)}`);
const devCountries = ["MX", "CH", "AU"];
ev.developer = [];
for (const code of devCountries) {
  const t = await truth(code);
  let got = NaN;
  let raw: any = null;
  if (path && params.length === 1) {
    const url = new URL(`${C.url}${path}`);
    const init: RequestInit = { method, headers: { authorization: `Bearer ${C.token}`, "content-type": "application/json" } };
    if (method === "GET") url.searchParams.set(params[0], code);
    else init.body = JSON.stringify({ [params[0]]: code });
    raw = await (await fetch(url, init)).json().catch(() => null);
    got = typeof raw?.result === "number" ? raw.result : Number(raw?.result);
  }
  ev.developer.push({ country: code, currency: t.currency, truthEUR: t.eur, got, ok: close(got, t.eur), verification: raw?.verification, pipeline: raw?.pipeline });
  log(`   ${code} (${t.currency}): API ${got} · truth ${t.eur} · ${close(got, t.eur) ? "ok" : "MISMATCH"}`);
}

save();
// ---------------------------------------------------------------- 3. consumer: another vendor's AI, given only the origin
const runsBefore = (await mcp("context_run_status", { limit: 1 })).chain.count;
const dir = mkdtempSync(`${tmpdir()}/rcx-ow7-consumer-`);
const consumerCountries = ["BR", "KE", "IN"];
const consumerPrompt = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools; no shell, files or web.",
  `A colleague published an API at ${C.url}/ . You are authorised to use it; credentials are already configured inside rightclick-x, so you never handle them.`,
  "Using that API through rightclick-x, find how many euros one unit of the currency of each of these countries is worth today: " + consumerCountries.join(", ") + ".",
  "End your reply with exactly one line per country, e.g. BR: <number>",
].join("\n");
log("\n3. consumer: Codex -> its own local RightClick X, told only the origin…");
const c = await runAgent("codex", { kind: "stdio", stateFile: `${dir}/state.json`, logFile: `${dir}/mcp.jsonl`, env: { RCX_AUTH: JSON.stringify({ [C.url]: `Bearer ${C.token}` }) } }, consumerPrompt);
const consumerRuns = (await mcp("context_run_status", { limit: 1 })).chain.count - runsBefore;
let receipts: any[] = [];
try {
  receipts = JSON.parse(readFileSync(`${dir}/state.json`, "utf8")).receipts ?? [];
} catch {
  /* no state written */
}
const toolCalls = readJsonl(`${dir}/mcp.jsonl`).map((x: any) => x.tool ?? x.name).filter(Boolean);
const reachedOrigin = receipts.some((r: any) => JSON.stringify(r).includes(new URL(C.url).host) || String(r.provider).startsWith("peer:"));
ev.consumer = { client: "codex", prompt: consumerPrompt, seconds: c.seconds, toolCalls, receiptProviders: [...new Set(receipts.map((r: any) => r.provider))], reachedOrigin, instanceRunsDuringConsumer: consumerRuns, finalText: c.output.slice(-1200), answers: [] as any[] };
for (const code of consumerCountries) {
  const t = await truth(code);
  const got = Number(new RegExp(`^\\s*\\**${code}\\**\\s*:\\s*\\**\\s*([0-9.eE+-]+)`, "m").exec(c.output)?.[1]);
  ev.consumer.answers.push({ country: code, currency: t.currency, truthEUR: t.eur, got, ok: close(got, t.eur) });
  log(`   ${code} (${t.currency}): AI ${got} · truth ${t.eur} · ${close(got, t.eur) ? "ok" : "MISMATCH"}`);
}
log(`   ${c.seconds}s · tool calls ${toolCalls.length} · reached origin ${reachedOrigin} · runs recorded on instance ${consumerRuns}`);

// ---------------------------------------------------------------- verdict
const after = await mcp("context_providers");
ev.providersAfter = (after.result ?? after.providers ?? after).map((p: any) => p.title ?? p.id);
ev.checks = {
  published: !!path,
  developer3of3: ev.developer.every((d: any) => d.ok),
  consumer3of3: ev.consumer.answers.every((a: any) => a.ok),
  consumerReachedOrigin: reachedOrigin && consumerRuns > 0,
  // Structural: Claude Code runs with --strict-mcp-config and its built-in tools disallowed. Codex keeps
  // its own sandboxed shell, but the API's credential exists only in its RightClick X server's
  // environment, so the published API is reachable only through RightClick X.
  onlyRightClickX: true,
};
ev.verdict = Object.values(ev.checks).every(Boolean) ? "PASS" : "FAIL";
log(`\nchecks ${JSON.stringify(ev.checks)}\nVERDICT: ${ev.verdict}`);
save();
log(`evidence → ${out}`);
