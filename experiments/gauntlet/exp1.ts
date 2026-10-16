// EXPERIMENT 1: the unknown internet. The agent is given NO service addresses.
// RightClick X must find suitable public services through public directories
// (APIs.guru, the official MCP Registry), learn them, use them, and save the
// workflows. Harness-side verification queries the original services directly.
//   node experiments/gauntlet/exp1.ts [claude|codex]

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readJsonl, runAgent, type Client } from "./agent.ts";

const client = (process.argv[2] ?? "claude") as Client;
const model = process.argv[3];
const tag = model ? `${client}-${model}` : client;
const log = (...a: unknown[]) => console.log(...a);
const dir = mkdtempSync(`${tmpdir()}/rcx-exp1-`);
const stateFile = `${dir}/state.json`;
const logFile = `${dir}/mcp-calls.jsonl`;
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const prompt = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools. You are not given any service addresses.",
  "Research objective, for someone planning a trip to Toronto:",
  "  1. What is the next upcoming public holiday in the Canadian province of Ontario (province code ON), and on what date?",
  "  2. What is today's exchange rate from Canadian dollars (CAD) to euros (EUR)?",
  "Use rightclick-x's research and acquisition abilities to find suitable public services in public directories, learn them, and use them to answer.",
  "Save each working workflow as a reusable capability (names: 'Next Ontario holiday' and 'CAD to EUR').",
  "End with a final line: ANSWER: <holiday name> | <YYYY-MM-DD> | <CAD to EUR rate>",
].join("\n");

log(`Experiment 1 · ${tag} · no addresses given…`);
const r = await runAgent(client, { kind: "stdio", stateFile, logFile }, prompt, 900_000, model);
const calls = readJsonl(logFile);

// ---- independent verification (harness-side, direct to the original sources) ----
const on: any = await (await fetch("https://canada-holidays.ca/api/v1/provinces/ON")).json();
const next = on.province?.nextHoliday;
const fx: any = await (await fetch("https://api.exchangerate-api.com/v4/latest/CAD")).json();
const truth = { holiday: next?.nameEn, date: next?.date, cadToEur: fx.rates?.EUR, fxDate: fx.date };
const [aName, aDate, aRate] = (r.answer ?? "").split("|").map((s) => s.trim());
const check = {
  dateOk: aDate === truth.date,
  nameOk: !!aName && !!truth.holiday && (aName.toLowerCase().includes(truth.holiday.toLowerCase().split(" ")[0]) || truth.holiday.toLowerCase().includes(aName.toLowerCase().split(" ")[0])),
  // First number in the field ("0.628 EUR per CAD" → 0.628).
  rateOk: !!aRate && Math.abs(Number(/-?\d+(?:\.\d+)?/.exec(aRate)?.[0]) - truth.cadToEur) <= truth.cadToEur * 0.005,
};
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const providers = (state.reflections ?? []).map((x: any) => ({ id: x.provider.id, protocol: x.provider.source, origin: x.provider.origin, source: x.provider.meta?.source, capabilities: x.capabilities.length }));
const usedProviders = [...new Set((state.receipts ?? []).map((x: any) => x.provider))];
const researched = calls.filter((c) => c.tool === "context_research" || (c.tool === "context_compose" && c.args?.acquire));
const verdict = check.dateOk && check.nameOk && check.rateOk ? "PASS" : "FAIL";

log(`  answer: ${r.answer}`);
log(`  truth:  ${truth.holiday} | ${truth.date} | ${truth.cadToEur} (${truth.fxDate})`);
log(`  checks: ${JSON.stringify(check)} · ${r.seconds}s · ${calls.length} MCP calls (${[...new Set(calls.map((c) => c.tool))].join(", ")})`);
log(`  providers learned: ${providers.map((p: any) => `${p.id} [${p.protocol}]`).join(", ")}`);
log(`  providers actually executed: ${usedProviders.join(", ")}`);
log(`  saved: ${(state.published ?? []).map((p: any) => p.title).join(", ") || "(none)"}`);
log(`VERDICT: ${verdict}`);

mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync(
  `experiments/open-world/evidence/ow2-discovery-${tag}.json`,
  JSON.stringify(
    {
      experiment: 1,
      hypothesis: "Given no addresses, an AI can acquire useful capabilities from unfamiliar real services via public directories, without SDKs or integration code.",
      build,
      client,
      model: model ?? "client default",
      prompt,
      answer: r.answer,
      independentTruth: truth,
      check,
      seconds: r.seconds,
      mcpCalls: calls.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args, error: c.error })),
      discoveryCalls: researched.length,
      providersLearned: providers,
      providersExecuted: usedProviders,
      published: state.published ?? [],
      verdict,
      finalText: r.output.slice(-2000),
    },
    null,
    2,
  ),
);
