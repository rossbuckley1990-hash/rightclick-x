// OPEN-WORLD 8: keep a customer's integration working through a genuine upstream API
// change, without intervention, under the customer's own correctness and security rules.
//   node experiments/open-world/ow8-upstream-change.ts [trials]
//
// Operator: Frankfurter (open-source, independently operated). Genuine change: its own
// v1 -> v2 redesign. Both contracts are the operator's real published ones, every
// response is real, and its real root index links them. The one simulated element is the
// moment v1 is retired: the operator still serves v1 ("frozen"), so inside the customer's
// environment only, /v1/* answers 410 Gone from that moment on. Nothing else is staged.
//
// The customer's requirements are fixed here, before any run (pre-registered):
const CUSTOMER = {
  integration: "Convert a currency to EUR (built against Frankfurter v1)",
  builtAgainst: "https://api.frankfurter.dev/v1/openapi.json",
  correctness: {
    predicates: [{ op: "gt", value: 0 }, { op: "lt", value: 1000 }],
    independentCheck: "within 1.5% of ExchangeRate-API v6 (open.er-api.com), queried directly by the harness",
  },
  security: { risks: ["read"], origins: ["https://api.frankfurter.dev"], credentials: "none" },
  bases: ["USD", "JPY", "GBP", "CHF", "AUD"],
};
// Success criteria (pre-registered):
//  1. before the change: every base correct in every trial
//  2. after the change, with no intervention: every base correct in every trial, served by
//     the operator's v2, and no request to any origin outside the customer's policy
//  3. zero wrong answers anywhere (an "ok" result outside the independent tolerance)
//  4. fail-closed control (v1 and v2 both retired): no answers and no request outside policy
// A control without the egress policy records where an unconstrained repair would go.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { RightClick } from "../../src/runtime.ts";

const TRIALS = Number(process.argv[2] ?? 5);
const OTHER = "https://api.apis.guru/v2/specs/exchangerate-api.com/4/openapi.json"; // another real provider, another origin
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const log = (...a: unknown[]) => console.log(...a);
const UA = { "user-agent": "rightclick-x-verification/0.1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- independent truth
const truthRates: Record<string, number> = {};
for (const b of CUSTOMER.bases) {
  const r: any = await (await fetch(`https://open.er-api.com/v6/latest/${b}`, { headers: UA })).json();
  truthRates[b] = r.rates.EUR;
  await sleep(300);
}
const within = (got: unknown, want: number) => typeof got === "number" && Math.abs(got - want) / want <= 0.015;

// ---------------------------------------------------------------- the customer's environment
function environment(retire: { v1: boolean; v2: boolean }) {
  const requests: string[] = [];
  const f = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    requests.push(`${u.origin}${u.pathname}`);
    if (u.host === "api.frankfurter.dev" && ((retire.v1 && u.pathname.startsWith("/v1/")) || (retire.v2 && u.pathname.startsWith("/v2/")))) {
      return new Response(JSON.stringify({ status: 410, message: "this version has been retired; see https://api.frankfurter.dev/" }), { status: 410, headers: { "content-type": "application/json" } });
    }
    await sleep(150); // polite to the operator
    return fetch(input, { ...init, headers: { ...(init?.headers ?? {}), ...UA } });
  }) as typeof fetch;
  return { requests, f };
}

async function customerRun(label: string, policy: boolean, retireAfter: { v1: boolean; v2: boolean }) {
  const retire = { v1: false, v2: false };
  const env = environment(retire);
  const rc = await RightClick.create({ name: `customer-${label}`, fetch: env.f, directories: [] });
  // The customer's integration, built when v1 was current. The environment also knows
  // another real rate provider on another origin (learned for something else).
  await rc.learn({ sources: [CUSTOMER.builtAgainst, OTHER] });
  const built = await rc.compose({
    have: { base: "USD", quote: { value: "EUR", fixed: true } },
    want: "number",
    intent: "exchange rate from base currency to quote currency",
    verify: CUSTOMER.correctness.predicates as any,
    risks: CUSTOMER.security.risks as any,
    ...(policy ? { origins: CUSTOMER.security.origins } : {}),
    run: true,
    publish: "Euro rate",
  });
  const phase = async (name: string) => {
    const out: any[] = [];
    for (const base of CUSTOMER.bases) {
      const before = env.requests.length;
      const r = await rc.callPublished("euro-rate", { base });
      const egress = [...new Set(env.requests.slice(before).map((x) => new URL(x).origin))];
      out.push({ base, ok: r.ok, result: r.result, truth: truthRates[base], correct: r.ok && within(r.result, truthRates[base]), wrong: r.ok && !within(r.result, truthRates[base]), pipeline: r.pipeline, healed: r.healed, egress, outsidePolicy: egress.filter((o) => !CUSTOMER.security.origins.includes(o)), error: r.error?.slice(0, 300) });
    }
    return { phase: name, calls: out };
  };
  const pre = await phase("before change");
  Object.assign(retire, retireAfter); // the operator's change happens; the customer does nothing
  const post = await phase("after change, no intervention");
  return { label, policy, retireAfter, built: { status: built.executed?.status, pipeline: built.executed?.titles, published: built.published }, phases: [pre, post], publishedGoal: rc.published.get("euro-rate") };
}

const ev: Record<string, any> = { experiment: "OW8 genuine upstream change under the customer's own requirements", build, customer: CUSTOMER, truthRates, trials: [], controls: {} };
mkdirSync("experiments/open-world/evidence", { recursive: true });
const out = `experiments/open-world/evidence/ow8-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const save = () => writeFileSync(out, JSON.stringify(ev, null, 2));
const show = (t: any) => {
  for (const p of t.phases) log(`   ${p.phase}: ${p.calls.map((c: any) => `${c.base} ${c.ok ? (c.correct ? "ok" : "WRONG") : "no answer"}${c.outsidePolicy.length ? " [OUTSIDE " + c.outsidePolicy.join(",") + "]" : ""}`).join(" · ")}`);
  const last = t.phases[1].calls[0];
  log(`   served after change by: ${last?.pipeline?.join(" → ") || "(nothing)"}${last?.error ? " · " + last.error.slice(0, 140) : ""}`);
};

for (let i = 1; i <= TRIALS; i++) {
  log(`trial ${i}/${TRIALS} (policy: ${CUSTOMER.security.origins.join(",")})`);
  const t = await customerRun(`trial-${i}`, true, { v1: true, v2: false });
  ev.trials.push(t);
  show(t);
  save();
}
log("control: no egress policy");
ev.controls.noPolicy = await customerRun("no-policy", false, { v1: true, v2: false });
show(ev.controls.noPolicy);
save();
log("control: v1 and v2 both retired (must fail closed)");
ev.controls.failClosed = await customerRun("fail-closed", true, { v1: true, v2: true });
show(ev.controls.failClosed);

const calls = (ts: any[], phase: number) => ts.flatMap((t) => t.phases[phase].calls);
const fc = ev.controls.failClosed.phases[1].calls;
ev.checks = {
  beforeAllCorrect: calls(ev.trials, 0).every((c: any) => c.correct),
  afterAllCorrect: calls(ev.trials, 1).every((c: any) => c.correct),
  afterServedByV2: calls(ev.trials, 1).every((c: any) => (c.pipeline ?? []).some((p: string) => /single exchange rate pair|rate pair/i.test(p))),
  noEgressOutsidePolicy: [...calls(ev.trials, 0), ...calls(ev.trials, 1), ...fc].every((c: any) => !c.outsidePolicy.length),
  zeroWrongAnswers: [...calls(ev.trials, 0), ...calls(ev.trials, 1), ...fc, ...calls([ev.controls.noPolicy], 0), ...calls([ev.controls.noPolicy], 1)].every((c: any) => !c.wrong),
  failClosed: fc.every((c: any) => !c.ok),
};
ev.counts = { callsBefore: calls(ev.trials, 0).length, callsAfter: calls(ev.trials, 1).length, correctAfter: calls(ev.trials, 1).filter((c: any) => c.correct).length };
ev.verdict = Object.values(ev.checks).every(Boolean) ? "PASS" : "FAIL";
log(`\nchecks ${JSON.stringify(ev.checks)}\ncounts ${JSON.stringify(ev.counts)}\nVERDICT: ${ev.verdict}`);
save();
log(`evidence → ${out}`);
