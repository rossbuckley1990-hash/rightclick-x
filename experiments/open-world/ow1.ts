// OPEN-WORLD EXPERIMENTS 1 + 3: three independent real providers, three
// protocols. The agent gets the countries GraphQL address only; it must find an
// exchange-rate service and a Wikipedia MCP server itself via RightClick X's
// directory research. Claude Code builds and saves; RightClick X restarts;
// Codex reuses with a new country. Verification (harness-side) queries the
// original services directly.
//   node experiments/open-world/ow1.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readJsonl, runAgent } from "../gauntlet/agent.ts";

const log = (...a: unknown[]) => console.log(...a);
const dir = mkdtempSync(`${tmpdir()}/rcx-ow1-`);
const stateFile = `${dir}/state.json`;
const logFile = `${dir}/mcp-calls.jsonl`;
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const ev: Record<string, any> = {
  experiment: "OW1+OW3",
  objective: "Country briefing: the capital, a Wikipedia summary of it, and the currency's rate to USD, from three independent providers in three protocols; saved and reused after restart by a different AI client.",
  build,
  startedAt: new Date().toISOString(),
  runs: [],
};

// ---- independent verification (harness-side, direct to the original sources) ----
async function truth(code: string) {
  const g: any = await (await fetch("https://countries.trevorblades.com/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ country(code: "${code}") { name capital currency } }` }) })).json();
  const c = g.data.country;
  const currency = String(c.currency).split(",")[0];
  const fx: any = await (await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`)).json();
  const wiki: any = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.capital)}`, { headers: { "user-agent": "rightclick-x-verification/0.1" } })).json();
  return { country: c.name, capital: c.capital, currency, usd: fx.rates?.USD as number, fxDate: fx.date, wikiExtract: String(wiki.extract ?? "") };
}
function check(answer: string | undefined, t: Awaited<ReturnType<typeof truth>>) {
  const [cap, money, summary] = (answer ?? "").split("|").map((s) => s.trim());
  const m = /([A-Z]{3})\D*(-?\d+(?:\.\d+)?)/.exec(money ?? "");
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-zà-ÿ]{5,}/g) ?? []);
  const overlap = [...words(summary ?? "")].filter((w) => words(t.wikiExtract).has(w)).length;
  return {
    capitalOk: !!cap && cap.toLowerCase().includes(t.capital.toLowerCase()),
    currencyOk: m?.[1] === t.currency,
    rateOk: !!m && Math.abs(Number(m[2]) - t.usd) <= t.usd * 0.005,
    summaryGrounded: !!summary && summary.toLowerCase().includes(t.capital.toLowerCase()) && overlap >= 3,
    summaryWordOverlapWithWikipedia: overlap,
  };
}
const ok = (c: ReturnType<typeof check>) => c.capitalOk && c.currencyOk && c.rateOk && c.summaryGrounded;

// ---- Run 1: Claude Code builds and saves ----
const prompt1 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "A public GraphQL API about countries is available at https://countries.trevorblades.com/ . You are not given any other service address.",
  "Task: produce a short briefing for the country with ISO code PT:",
  "  (a) its capital city, and a short summary of that capital from Wikipedia, obtained through a Wikipedia MCP server you find in the official MCP Registry using rightclick-x's research or acquisition abilities;",
  "  (b) the latest exchange rate from the country's currency to US dollars, from a public exchange-rate service you find the same way.",
  "Save each working workflow as a reusable capability, named 'Capital briefing' and 'Currency in USD'.",
  "End with a final line: ANSWER: <capital> | <currency code> <rate to USD> | <first sentence of the capital summary>",
].join("\n");
log("Run 1 · Claude Code · PT…");
const r1 = await runAgent("claude", { kind: "stdio", stateFile, logFile }, prompt1);
const t1 = await truth("PT");
const c1 = check(r1.answer, t1);
const calls1 = readJsonl(logFile);
log(`  answer: ${r1.answer?.slice(0, 160)}`);
log(`  truth:  ${t1.capital} | ${t1.currency} ${t1.usd} (${t1.fxDate}) | ${t1.wikiExtract.slice(0, 90)}…`);
log(`  checks: ${JSON.stringify(c1)} · ${r1.seconds}s · ${calls1.length} MCP calls`);
const s1 = JSON.parse(readFileSync(stateFile, "utf8"));
const providers = (s1.reflections ?? []).map((x: any) => ({ id: x.provider.id, protocol: x.provider.source, origin: x.provider.origin, capabilities: x.capabilities.length }));
const executed = [...new Set((s1.receipts ?? []).map((x: any) => x.provider))];
log(`  learned: ${providers.map((p: any) => `${p.id} [${p.protocol}]`).join(", ")}`);
log(`  executed: ${executed.join(", ")}`);
log(`  saved: ${(s1.published ?? []).map((p: any) => `"${p.title}" (${(p.lastPipeline ?? []).join(" → ")})`).join("; ")}`);
ev.runs.push({ run: 1, client: "claude", prompt: prompt1, answer: r1.answer, independentTruth: t1, check: c1, verified: ok(c1), seconds: r1.seconds, mcpCalls: calls1.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args, error: c.error })), finalText: r1.output.slice(-2000) });
ev.afterRun1 = { providersLearned: providers, providersExecuted: executed, published: s1.published ?? [] };

// ---- Restart + Run 2: Codex reuses with a new input ----
const n1 = calls1.length;
const prompt2 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "Earlier, someone saved reusable capabilities in rightclick-x: a 'Capital briefing' and a 'Currency in USD' for a country code.",
  "Find them with the rightclick-x tools and use them for the country with ISO code KE.",
  "End with a final line: ANSWER: <capital> | <currency code> <rate to USD> | <first sentence of the capital summary>",
].join("\n");
log("Run 2 · RightClick X restarted · Codex · KE…");
const r2 = await runAgent("codex", { kind: "stdio", stateFile, logFile }, prompt2);
const t2 = await truth("KE");
const c2 = check(r2.answer, t2);
const calls2 = readJsonl(logFile).slice(n1);
log(`  answer: ${r2.answer?.slice(0, 160)}`);
log(`  truth:  ${t2.capital} | ${t2.currency} ${t2.usd} (${t2.fxDate}) | ${t2.wikiExtract.slice(0, 90)}…`);
log(`  checks: ${JSON.stringify(c2)} · ${r2.seconds}s · ${calls2.length} MCP calls (${[...new Set(calls2.map((c) => c.tool))].join(", ")})`);
ev.runs.push({ run: 2, client: "codex", restartedRightClickX: true, prompt: prompt2, answer: r2.answer, independentTruth: t2, check: c2, verified: ok(c2), seconds: r2.seconds, mcpCalls: calls2.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args, error: c.error })), finalText: r2.output.slice(-2000) });

const s2 = JSON.parse(readFileSync(stateFile, "utf8"));
ev.receipts = { total: (s2.receipts ?? []).length, providers: [...new Set((s2.receipts ?? []).map((x: any) => x.provider))] };
const protocols = new Set(providers.filter((p: any) => executed.includes(p.id) || ev.receipts.providers.includes(p.id)).map((p: any) => p.protocol));
ev.protocolsExecuted = [...protocols];
ev.verdict = ok(c1) && ok(c2) && (s1.published ?? []).length >= 2 ? (protocols.size >= 3 ? "PASS" : "PASS (fewer than three protocols executed)") : "FAIL";
ev.finishedAt = new Date().toISOString();
log(`\nprotocols executed: ${[...protocols].join(", ")} · VERDICT: ${ev.verdict}`);
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/ow1-ow3-three-providers.json", JSON.stringify(ev, null, 2));
