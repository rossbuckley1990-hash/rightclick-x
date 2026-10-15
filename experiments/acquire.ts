// X5: acquisition on demand, live. A runtime that knows only its builtins is
// handed goals it cannot do. It researches the public directories (APIs.guru,
// the official MCP Registry), learns APIs and MCP servers it has never seen,
// plans, runs and verifies. Read-only: compose is constrained to
// read/external capabilities, so nothing acquired can write anywhere.
//   node experiments/acquire.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { RightClick } from "../src/runtime.ts";

const GOALS = [
  { label: "Latest exchange rates for EUR", have: { currency: "EUR" }, want: "json", intent: "latest exchange rates", verify: [{ op: "contains" as const, value: "USD" }] },
  { label: "A Wikipedia summary of Ada Lovelace", have: { title: "Ada Lovelace" }, want: "text", intent: "wikipedia article summary", verify: [{ op: "contains" as const, value: "Lovelace" }, { op: "length_gt" as const, value: 150 }] },
  { label: "Public holidays (Canada)", have: { province: "ON" }, want: "json", intent: "canada public holidays province", verify: [{ op: "contains" as const, value: "Ontario" }, { op: "contains" as const, value: "date" }] },
];

const rows = [];
for (const g of GOALS) {
  const rc = await RightClick.create({ name: "rcx-acquire", timeoutMs: 20_000 });
  const before = rc.graph.capabilities.size;
  const t = performance.now();
  const r = await rc.compose({ have: g.have, want: g.want, intent: g.intent, run: true, acquire: true, risks: ["read", "external"], verify: g.verify });
  const ms = Math.round(performance.now() - t);
  const ok = r.executed?.status === "completed" && r.executed.verification.status === "verified";
  const out = typeof r.executed?.output === "string" ? r.executed.output : JSON.stringify(r.executed?.output ?? null);
  console.log(`\n${ok ? "✓" : "✗"} ${g.label}  (${ms}ms; graph ${before} → ${rc.graph.capabilities.size} capabilities)`);
  if (r.acquisition) console.log(`  researched "${r.acquisition.topic}": ${r.acquisition.considered.slice(0, 6).join(" · ")}`);
  else console.log("  (no acquisition was needed)");
  for (const l of r.acquisition?.learned ?? []) console.log(`  ${l.capabilities ? "+" : "·"} learned ${l.title} [${l.kind}] ${l.capabilities ? `${l.capabilities} capabilities` : l.error ?? "nothing usable"}`);
  if (r.executed) {
    for (const a of r.executed.attempts) console.log(`  ✗ ${a.summary.slice(0, 70)}: ${a.error.slice(0, 90)}`);
    console.log(`  ▶ ${r.executed.titles.join(" → ")}  [${r.executed.verification.status}]`);
    console.log(`  ${out.replace(/\s+/g, " ").slice(0, 200)}`);
  } else console.log("  no plan found after acquisition");
  rows.push({ goal: g.label, ok, ms, acquisition: r.acquisition, pipeline: r.executed?.titles, attempts: r.executed?.attempts, verification: r.executed?.verification.status, output: out.slice(0, 500) });
}
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/X5-acquire.json", JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
