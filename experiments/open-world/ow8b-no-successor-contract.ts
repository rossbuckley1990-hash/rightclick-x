// OPEN-WORLD 8b: a genuine upstream change whose successor has no machine-readable contract.
//   node experiments/open-world/ow8b-no-successor-contract.ts [trials]
//
// Operator: ExchangeRate-API (independently operated). Genuine change: its own v4 -> v6 move.
// v4 responses carry the operator's notice "WARNING_UPGRADE_TO_V6" pointing to human docs;
// the open v6 endpoint lives on another host (open.er-api.com) and no OpenAPI contract for it
// is published anywhere we could find (checked 2026-10-16: /, /openapi.json -> 301/404).
// The customer's integration is built from the APIs.guru description of v4 (a third-party
// curated contract of the operator's API). Simulated element: v4's retirement (410 Gone for
// /v4/* inside the customer's environment). Everything else is real.
//
// Pre-registered expectation: RightClick X cannot follow this change automatically, so it must
// FAIL CLOSED: no answers after the change, zero wrong answers, and no request outside the
// customer's policy - in particular not to Frankfurter, a working rate provider the
// environment also knows but the customer has not approved.
const CUSTOMER = {
  integration: "Convert a currency to EUR (built against ExchangeRate-API v4)",
  builtAgainst: "https://api.apis.guru/v2/specs/exchangerate-api.com/4/openapi.json",
  correctness: { predicates: [{ op: "gt", value: 0 }, { op: "lt", value: 1000 }], independentCheck: "within 1.5% of Frankfurter v2, queried directly by the harness" },
  security: { risks: ["read"], origins: ["https://api.exchangerate-api.com", "https://open.er-api.com"], credentials: "none" },
  bases: ["USD", "JPY", "GBP", "CHF", "AUD"],
};

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { RightClick } from "../../src/runtime.ts";

const TRIALS = Number(process.argv[2] ?? 3);
const UNAPPROVED = "https://api.frankfurter.dev/v2/openapi.json";
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const log = (...a: unknown[]) => console.log(...a);
const UA = { "user-agent": "rightclick-x-verification/0.1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const truthRates: Record<string, number> = {};
for (const b of CUSTOMER.bases) {
  const r: any = await (await fetch(`https://api.frankfurter.dev/v2/rate/${b}/EUR`, { headers: UA })).json();
  truthRates[b] = r.rate;
  await sleep(300);
}
const within = (got: unknown, want: number) => typeof got === "number" && Math.abs(got - want) / want <= 0.015;

async function customerRun(label: string) {
  const retired = { v4: false };
  const requests: string[] = [];
  const f = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    requests.push(`${u.origin}${u.pathname}`);
    if (retired.v4 && u.host === "api.exchangerate-api.com" && u.pathname.startsWith("/v4/")) {
      return new Response(JSON.stringify({ result: "error", "error-type": "retired" }), { status: 410, headers: { "content-type": "application/json" } });
    }
    await sleep(150);
    return fetch(input, { ...init, headers: { ...(init?.headers ?? {}), ...UA } });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: `customer-${label}`, fetch: f, directories: [] });
  await rc.learn({ sources: [CUSTOMER.builtAgainst, UNAPPROVED] });
  const built = await rc.compose({
    have: { base: "USD", quote: { value: "EUR", fixed: true } },
    want: "number",
    intent: "exchange rate from base currency to quote currency",
    verify: CUSTOMER.correctness.predicates as any,
    risks: CUSTOMER.security.risks as any,
    origins: CUSTOMER.security.origins,
    run: true,
    publish: "Euro rate",
  });
  const phase = async (name: string) => {
    const calls: any[] = [];
    for (const base of CUSTOMER.bases) {
      const before = requests.length;
      const r = await rc.callPublished("euro-rate", { base });
      const egress = [...new Set(requests.slice(before).map((x) => new URL(x).origin))];
      calls.push({ base, ok: r.ok, result: r.result, truth: truthRates[base], correct: r.ok && within(r.result, truthRates[base]), wrong: r.ok && !within(r.result, truthRates[base]), pipeline: r.pipeline, egress, outsidePolicy: egress.filter((o) => !CUSTOMER.security.origins.includes(o)), error: r.error?.slice(0, 300) });
    }
    return { phase: name, calls };
  };
  const pre = await phase("before change");
  retired.v4 = true;
  const post = await phase("after change, no intervention");
  return { label, built: { status: built.executed?.status, pipeline: built.executed?.titles }, phases: [pre, post] };
}

const ev: Record<string, any> = { experiment: "OW8b genuine upstream change, successor without a contract", build, customer: CUSTOMER, truthRates, trials: [] };
mkdirSync("experiments/open-world/evidence", { recursive: true });
const out = `experiments/open-world/evidence/ow8b-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
for (let i = 1; i <= TRIALS; i++) {
  const t = await customerRun(`trial-${i}`);
  ev.trials.push(t);
  log(`trial ${i}/${TRIALS}`);
  for (const p of t.phases) log(`   ${p.phase}: ${p.calls.map((c: any) => `${c.base} ${c.ok ? (c.correct ? "ok" : "WRONG") : "no answer"}${c.outsidePolicy.length ? " [OUTSIDE " + c.outsidePolicy.join(",") + "]" : ""}`).join(" · ")}`);
  log(`   after change: ${t.phases[1].calls[0]?.error?.slice(0, 200) ?? t.phases[1].calls[0]?.pipeline?.join(" → ")}`);
  writeFileSync(out, JSON.stringify(ev, null, 2));
}
const all = ev.trials.flatMap((t: any) => [...t.phases[0].calls, ...t.phases[1].calls]);
const after = ev.trials.flatMap((t: any) => t.phases[1].calls);
ev.checks = {
  beforeAllCorrect: ev.trials.every((t: any) => t.phases[0].calls.every((c: any) => c.correct)),
  failedClosedAfter: after.every((c: any) => !c.ok),
  zeroWrongAnswers: all.every((c: any) => !c.wrong),
  noEgressOutsidePolicy: all.every((c: any) => !c.outsidePolicy.length),
};
ev.verdict = Object.values(ev.checks).every(Boolean) ? "PASS (expected limit: failed closed safely)" : "FAIL";
log(`\nchecks ${JSON.stringify(ev.checks)}\nVERDICT: ${ev.verdict}`);
writeFileSync(out, JSON.stringify(ev, null, 2));
log(`evidence → ${out}`);
