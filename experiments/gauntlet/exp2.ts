// EXPERIMENT 2: the integration that invented itself.
// Services selected after the freeze: the public countries GraphQL API (address
// given) and an exchange-rate API that RightClick X must find on its own in
// public directories (no address given). Claude Code builds and saves the
// integration; RightClick X restarts; Codex reuses it for a new country.
// Verification fetches the original sources directly (harness-side, labelled).
//   node experiments/gauntlet/exp2.ts

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { readJsonl, runAgent } from "./agent.ts";

const log = (...a: unknown[]) => console.log(...a);
const dir = mkdtempSync(`${tmpdir()}/rcx-exp2-`);
const stateFile = `${dir}/state.json`;
const logFile = `${dir}/mcp-calls.jsonl`;
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidence: Record<string, any> = { experiment: 2, hypothesis: "RightClick X can construct, save and reuse (after restart, from another MCP client) an integration between independent services nobody connected in its codebase.", build, startedAt: new Date().toISOString(), runs: [] };

// ---- independent verification (harness-side, direct to the original sources) ----
async function truthFor(code: string) {
  const g: any = await (await fetch("https://countries.trevorblades.com/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ country(code: "${code}") { currency } }` }) })).json();
  const currency = String(g.data.country.currency).split(",")[0];
  const fx: any = await (await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`)).json();
  return { currency, usd: fx.rates?.USD as number, fxDate: fx.date };
}
function check(answer: string | undefined, t: { currency: string; usd: number }) {
  const m = /([A-Z]{3})\D+([\d.]+)/.exec(answer ?? "");
  const currencyOk = m?.[1] === t.currency;
  const rateOk = !!m && Math.abs(Number(m[2]) - t.usd) <= Math.max(1e-6, t.usd * 0.005);
  return { parsed: m ? { currency: m[1], usd: Number(m[2]) } : null, currencyOk, rateOk, verified: currencyOk && rateOk };
}

// ---- Run 1: Claude Code builds and saves the integration ----
const prompt1 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "A public GraphQL API about countries is available at https://countries.trevorblades.com/ .",
  "Task: for the country with ISO code KE, report the latest exchange rate from that country's currency to US dollars.",
  "You are not given any exchange-rate service. If rightclick-x cannot do this with what it knows, use its research or acquisition abilities to find a suitable public service yourself.",
  "Once it works, save the working workflow as a reusable capability named 'Country currency in USD' so it can be used again later.",
  "End with a final line: ANSWER: <currency code> <rate to USD>",
].join("\n");
log("Run 1 · Claude Code builds the integration (KE)…");
const r1 = await runAgent("claude", { kind: "stdio", stateFile, logFile }, prompt1);
const t1 = await truthFor("KE");
const c1 = check(r1.answer, t1);
const calls1 = readJsonl(logFile);
log(`  answer: ${r1.answer} · truth: ${t1.currency} ${t1.usd} (${t1.fxDate}) · verified ${c1.verified} · ${r1.seconds}s · ${calls1.length} MCP calls`);
evidence.runs.push({ run: 1, client: "claude", prompt: prompt1, answer: r1.answer, independentTruth: t1, check: c1, seconds: r1.seconds, mcpCalls: calls1.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args })), finalText: r1.output.slice(-1500) });

// What was saved (read from RightClick X's own persisted state; harness-side inspection).
const state1 = JSON.parse(readFileSync(stateFile, "utf8"));
const published = state1.published ?? [];
const crystallized = (state1.reflections ?? []).flatMap((r: any) => r.capabilities).filter((c: any) => c.source === "composite");
const learnedProviders = (state1.reflections ?? []).map((r: any) => ({ id: r.provider.id, source: r.provider.source, origin: r.provider.origin }));
log(`  saved: ${published.length} published goal(s) ${published.map((p: any) => `"${p.title}" (${(p.lastPipeline ?? []).join(" → ")})`).join("; ")} · ${crystallized.length} crystallized pipeline(s)`);
evidence.afterRun1 = { published, crystallized: crystallized.map((c: any) => ({ id: c.id, title: c.title })), learnedProviders };

// ---- Restart + Run 2: a different client reuses it ----
const callsBefore = calls1.length;
const prompt2 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "Earlier, someone saved a reusable capability in rightclick-x for converting a country's currency into US dollars.",
  "Find it with the rightclick-x tools and use it for the country with ISO code BR.",
  "End with a final line: ANSWER: <currency code> <rate to USD>",
].join("\n");
log("Run 2 · RightClick X restarted (new process, same saved state) · Codex reuses it (BR)…");
const r2 = await runAgent("codex", { kind: "stdio", stateFile, logFile }, prompt2);
const t2 = await truthFor("BR");
const c2 = check(r2.answer, t2);
const calls2 = readJsonl(logFile).slice(callsBefore);
const usedSaved = calls2.some((c) => c.tool === "context_compose" || c.tool === "context_run") && JSON.stringify(calls2).match(/composite:|Country currency in USD|country-currency-in-usd/i) !== null;
log(`  answer: ${r2.answer} · truth: ${t2.currency} ${t2.usd} (${t2.fxDate}) · verified ${c2.verified} · ${r2.seconds}s · ${calls2.length} MCP calls · referenced saved capability: ${usedSaved}`);
evidence.runs.push({ run: 2, client: "codex", restartedRightClickX: true, prompt: prompt2, answer: r2.answer, independentTruth: t2, check: c2, seconds: r2.seconds, mcpCalls: calls2.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args })), referencedSavedCapability: usedSaved, finalText: r2.output.slice(-1500) });

const state2 = JSON.parse(readFileSync(stateFile, "utf8"));
const receipts = state2.receipts ?? [];
const compositeRuns = receipts.filter((r: any) => r.provider === "composite:crystallized");
evidence.receipts = { total: receipts.length, compositeRuns: compositeRuns.length, providers: [...new Set(receipts.map((r: any) => r.provider))] };
evidence.verdict = c1.verified && c2.verified && published.length > 0 ? "PASS" : "FAIL";
evidence.finishedAt = new Date().toISOString();
log(`\nVERDICT: ${evidence.verdict}`);
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/ow3-gauntlet2-two-provider.json", JSON.stringify(evidence, null, 2));
