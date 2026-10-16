// OPEN-WORLD EXPERIMENT 5: the Chameleon Challenge.
// One scenario combining: real independent providers in three protocols
// (countries GraphQL given by address; an exchange-rate service and a Wikipedia
// MCP server found by RightClick X itself), a CONTROLLED owned translation
// service on Cloudflare (labelled), MCP-only agents from two vendors, saved
// capabilities reused after restart, an environmental change (the controlled
// service moves protocol), and an accurate-failure check (service deleted).
// The workflow is not revealed; the harness verifies every fact independently.
//   node experiments/open-world/ow5.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { translate } from "../../demo/services.ts";
import { readJsonl, runAgent, type Client } from "../gauntlet/agent.ts";

const CFG = "experiments/open-world/service/wrangler.toml";
const log = (...a: unknown[]) => console.log(...a);
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const wrangler = (args: string[], input?: string) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", input, stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "pipe"] });
const adminToken = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
const dir = mkdtempSync(`${tmpdir()}/rcx-ow5-`);
const stateFile = `${dir}/state.json`;
const logFile = `${dir}/mcp-calls.jsonl`;
const ev: Record<string, any> = { experiment: "OW5 Chameleon Challenge", build, startedAt: new Date().toISOString(), phases: [] };

// ---------------------------------------------------------------- controlled service (test infrastructure)
async function stable(url: string, up: boolean, n = 5) {
  let streak = 0;
  for (let i = 0; i < 150 && streak < n; i++) {
    const r = await fetch(`${url}/__admin/version`, { headers: { authorization: `Bearer ${adminToken}` } }).catch(() => null);
    streak = !!r?.ok === up ? streak + 1 : 0;
    await new Promise((res) => setTimeout(res, 2000));
  }
  if (streak < n) throw new Error(`service not stably ${up ? "up" : "down"}`);
}
async function deploy(): Promise<string> {
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(wrangler(["deploy", "-c", CFG]))![0];
  wrangler(["secret", "put", "ADMIN_TOKEN", "-c", CFG], adminToken);
  await stable(url, true);
  return url;
}
const setVersion = (url: string, version: number) => fetch(`${url}/__admin/version`, { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ version }) });

// ---------------------------------------------------------------- independent verification
async function truth(code: string) {
  const g: any = await (await fetch("https://countries.trevorblades.com/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ country(code: "${code}") { capital currency } }` }) })).json();
  const currency = String(g.data.country.currency).split(",")[0];
  const fx: any = await (await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`)).json();
  const wiki: any = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(g.data.country.capital)}`, { headers: { "user-agent": "rightclick-x-verification/0.1" } })).json();
  return { capital: g.data.country.capital as string, currency, usd: fx.rates?.USD as number, wikiExtract: String(wiki.extract ?? "") };
}
const field = (text: string, key: string) => new RegExp(`^\\s*${key}:\\s*(.+)$`, "mi").exec(text)?.[1]?.trim().replace(/^["`*]+|["`*]+$/g, "");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
function check(out: string, t: Awaited<ReturnType<typeof truth>>, translationExpected: boolean) {
  const capital = field(out, "CAPITAL");
  const rate = field(out, "RATE");
  const sentence = field(out, "SENTENCE") ?? "";
  const translation = field(out, "TRANSLATION") ?? "";
  const m = /([A-Z]{3})\D*(-?\d+(?:\.\d+)?)/.exec(rate ?? "");
  const words = (s: string) => (s.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? []);
  const sentenceGrounded = words(sentence).length >= 4 && words(sentence).filter((w) => t.wikiExtract.toLowerCase().includes(w)).length / words(sentence).length >= 0.8;
  const unavailable = /unavailable|not available|could not|cannot|failed/i.test(translation) || translation === "";
  return {
    capitalOk: !!capital && capital.toLowerCase().includes(t.capital.toLowerCase()),
    rateOk: m?.[1] === t.currency && Math.abs(Number(m![2]) - t.usd) <= t.usd * 0.005,
    sentenceGrounded,
    // The controlled service's documented behaviour is exact, so the translation is checked exactly.
    translationOk: translationExpected ? !!sentence && norm(translation) === norm(translate(sentence, "es")) : unavailable,
    translationReportedUnavailable: unavailable,
  };
}

async function phase(name: string, client: Client, code: string, prompt: string, translationExpected: boolean) {
  const before = readJsonl(logFile).length;
  log(`\n${name} · ${client} · ${code}`);
  const r = await runAgent(client, { kind: "stdio", stateFile, logFile }, prompt);
  const t = await truth(code);
  const c = check(r.output, t, translationExpected);
  const calls = readJsonl(logFile).slice(before);
  const verified = c.capitalOk && c.rateOk && c.sentenceGrounded && c.translationOk;
  log(`  ${verified ? "VERIFIED" : "NOT VERIFIED"} · ${JSON.stringify(c)} · ${r.seconds}s · ${calls.length} MCP calls`);
  for (const k of ["CAPITAL", "RATE", "SENTENCE", "TRANSLATION"]) log(`  ${k}: ${(field(r.output, k) ?? "(none)").slice(0, 140)}`);
  ev.phases.push({ name, client, code, prompt, independentTruth: { ...t, wikiExtract: t.wikiExtract.slice(0, 400) }, check: c, verified, seconds: r.seconds, mcpCalls: calls.map((x) => ({ tool: x.tool, ok: x.ok, ms: x.ms, args: x.args, error: x.error })), finalText: r.output.slice(-2500) });
  return verified;
}

// ---------------------------------------------------------------- run
log(`build ${build.slice(0, 10)} · deploying the controlled translation service…`);
const svc = await deploy();
await setVersion(svc, 1);
ev.controlledService = svc;
const FORMAT = ["End with exactly these four lines:", "CAPITAL: <capital city>", "RATE: <currency code> <rate to USD>", "SENTENCE: <the first sentence of the Wikipedia summary of the capital>", "TRANSLATION: <that sentence as returned by the translation service, or 'unavailable'>"].join("\n");
const p1 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "Two services are known to you: a public GraphQL API about countries at https://countries.trevorblades.com/ and a translation service at " + svc + "/ (a controlled test service).",
  "Anything else you need (for example exchange rates, or Wikipedia, which you should reach through a Wikipedia MCP server from the official MCP Registry) must be found with rightclick-x's research or acquisition abilities.",
  "Task: a briefing for the country with ISO code PE: its capital; the latest exchange rate from its currency to USD; the first sentence of the Wikipedia summary of the capital; and that sentence translated into Spanish (language code es) by the translation service.",
  "Save working workflows as reusable capabilities so the briefing can be produced again later for other countries.",
  FORMAT,
].join("\n");
const ok1 = await phase("Phase 1: build", "claude", "PE", p1, true);

log("\nEnvironmental change: the controlled translation service moves from REST to GraphQL (contract v3)…");
await setVersion(svc, 3);
ev.change = { from: "REST v1", to: "GraphQL v3" };
const p2 = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "Someone saved reusable capabilities in rightclick-x for producing a country briefing (capital, exchange rate to USD, Wikipedia summary of the capital, and a Spanish translation of its first sentence).",
  "Use them for the country with ISO code JP. If something has changed or no longer works, use rightclick-x to adapt.",
  FORMAT,
].join("\n");
const ok2 = await phase("Phase 2: restart + different client + changed environment", "codex", "JP", p2, true);

log("\nEnvironmental change: the controlled translation service is deleted…");
wrangler(["delete", "-c", CFG, "--force"], "y\n");
await stable(svc, false);
const p3 = p2.replace("JP", "BR");
const ok3 = await phase("Phase 3: a provider disappears", "claude", "BR", p3, false);

log("\nRestoring the controlled service…");
await deploy();
await setVersion(svc, 1);

const s = JSON.parse(readFileSync(stateFile, "utf8"));
ev.providersLearned = (s.reflections ?? []).map((x: any) => ({ id: x.provider.id, protocol: x.provider.source, origin: x.provider.origin }));
ev.published = (s.published ?? []).map((p: any) => ({ title: p.title, pipeline: p.lastPipeline, calls: p.calls }));
ev.verdict = ok1 && ok2 && ok3 ? "PASS" : "FAIL";
ev.finishedAt = new Date().toISOString();
log(`\nproviders learned: ${ev.providersLearned.map((p: any) => `${p.id} [${p.protocol}]`).join(", ")}`);
log(`VERDICT: ${ev.verdict}`);
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/ow5-chameleon-challenge.json", JSON.stringify(ev, null, 2));
