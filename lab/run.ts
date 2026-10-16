// The Chameleon Lab harness.
//
// Question: can an unchanged MCP server discover unfamiliar, authorised
// software capabilities, compose a useful workflow, verify its result, and
// adapt when the underlying software changes?
//
// - Product build must be frozen (git tag lab-freeze*, no changes under src/ bin/).
// - Environment is generated from lab/fixtures.json with a fresh seed AFTER the freeze.
// - RightClick X runs as a separate process; this harness is only an MCP client (stdio).
// - Results are checked against the harness's own copy of the synthetic data.
//
//   npm run lab            (random seed)
//   npm run lab -- 12345   (reproduce a seed)

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { breakingRelease, generate, LabService, type Dataset, type ServiceSpec } from "./environment.ts";

const seed = Number(process.argv[2] ?? Math.floor(Math.random() * 1e9));
const log = (...a: unknown[]) => console.log(...a);
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const results: Record<string, any> = { seed, startedAt: new Date().toISOString(), steps: [], benchmarks: {} };
const step = (n: number, title: string, ok: boolean, detail: Record<string, unknown> = {}) => {
  results.steps.push({ n, title, ok, ...detail });
  log(`${ok ? "✓" : "✗"} ${String(n).padStart(2)}. ${title}`);
  for (const [k, v] of Object.entries(detail)) if (v !== undefined) log(`      ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

// ------------------------------------------------------------ freeze check
const git = (...a: string[]) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const head = git("rev-parse", "HEAD");
const tags = git("tag", "--points-at", "HEAD").split("\n").filter((t) => t.startsWith("lab-freeze"));
const productChanges = git("status", "--porcelain", "--", "src", "bin");
results.freeze = { commit: head, tags, productCodeUnchanged: productChanges === "", frozen: tags.length > 0 && productChanges === "" };
log(`RightClick X build ${head.slice(0, 10)} ${results.freeze.frozen ? `frozen (${tags.join(", ")})` : "NOT frozen"}; seed ${seed}\n`);

// ------------------------------------------------------------ environment (generated now)
const env = generate(seed);
const truth: Dataset = structuredClone(env.data); // the harness's independent copy
const expectedRate = (invoice: string) => truth.rates[truth.customers.find((c) => c.customer === truth.invoices.find((i) => i.invoice === invoice)!.customer)!.country];
const services: Record<string, LabService> = {};
for (const k of ["invoices", "customers", "taxPrimary"] as const) {
  services[k] = new LabService(env.services[k] as ServiceSpec, env.data);
  await services[k].start();
}
// A second tax provider exists in the fixtures but is introduced only in step 14.
const newcomer = new LabService(env.services.taxBackup, env.data);
for (const [k, s] of Object.entries(services)) log(`  ${k.padEnd(10)} ${s.spec.brand.padEnd(18)} ${s.spec.protocol.padEnd(8)} "${s.spec.operation}"  ${s.spec.input.name} → ${s.spec.outputs.map((f) => f.name).join(", ")}  ${s.url}`);
results.environment = Object.fromEntries(Object.entries(services).map(([k, s]) => [k, { brand: s.spec.brand, protocol: s.spec.protocol, operation: s.spec.operation, input: s.spec.input.name, outputs: s.spec.outputs.map((f) => f.name) }]));
step(1, "Start disposable services generated from fixtures", true, { services: Object.keys(services).length });

// ------------------------------------------------------------ MCP client (stdio)
const stateDir = mkdtempSync(`${tmpdir()}/rcx-lab-`);
const tStart = performance.now();
const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], { env: { ...process.env, RCX_STATE_FILE: `${stateDir}/state.json`, RCX_WORKSPACE: stateDir }, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map<number, (v: any) => void>();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
let nextId = 0;
const rpc = (method: string, params?: unknown): Promise<any> =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content?.[0]?.text}`);
  return r.result.structuredContent;
};

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chameleon-lab", version: "1" } });
results.benchmarks.startupMs = ms(tStart);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = (await rpc("tools/list")).result.tools.map((t: any) => t.name);
step(2, "Connect an MCP client to RightClick X (stdio)", init.result?.serverInfo?.name === "rightclick-x" && tools.length === 13, { server: init.result?.serverInfo, tools: tools.length, startupMs: results.benchmarks.startupMs });

const lat: number[] = [];
for (let i = 0; i < 50; i++) {
  const t = performance.now();
  await call("context_runtime");
  lat.push(performance.now() - t);
}
lat.sort((a, b) => a - b);
results.benchmarks.mcpLatencyMs = { p50: Math.round(lat[24] * 100) / 100, p95: Math.round(lat[47] * 100) / 100 };

// ------------------------------------------------------------ objective
const OBJECTIVE = "For an invoice, find the tax rate that applies in its customer's country.";
const goal = (invoice: string) => ({ have: { invoice_id: invoice }, want: "number", intent: "tax rate invoice customer country", verify: [{ op: "type", value: "number" }] });
step(3, `Present a business objective: "${OBJECTIVE}"`, true, { goal: goal("<invoice>") });

// ------------------------------------------------------------ discovery
let t = performance.now();
const learned = await call("context_learn", { sources: Object.values(services).map((s) => s.url) });
results.benchmarks.discoveryMs = ms(t);
const probes = learned.results.flatMap((r: any) => r.probes.filter((p: any) => p.ok).map((p: any) => p.kind));
step(4, "Discover contracts from root addresses only (no protocols, no schemas given)", probes.length === 3, { found: probes, newCapabilities: learned.totalNewCapabilities, ms: results.benchmarks.discoveryMs });
t = performance.now();
const stats = await call("context_graph", { op: "stats" });
results.benchmarks.graphStatsMs = ms(t);
results.benchmarks.graph = stats;

// ------------------------------------------------------------ identify + compose
const invoices = truth.invoices.map((i) => i.invoice);
t = performance.now();
const preview = await call("context_compose", goal(invoices[0]));
results.benchmarks.planningMs = ms(t);
const plan0 = preview.plans?.[0];
step(5, "Identify suitable capabilities", !!plan0, { candidatePlans: preview.plans?.length, best: plan0?.titles, providers: plan0?.providers, planningMs: results.benchmarks.planningMs });
step(6, "Compose a multi-provider workflow", (plan0?.providers?.length ?? 0) >= 3, { steps: plan0?.steps?.map((s: any, i: number) => `${plan0.titles[i]} ← ${s.bindings.map((b: any) => `${b.port}=${b.from}`).join(", ")}`) });

/** Providers that actually served a run, looking inside saved (composite) pipelines. */
const providerOf = async (runIds: string[]): Promise<string[]> => {
  const out: string[] = [];
  for (const id of runIds) {
    const r = await call("context_run_status", { runId: id });
    if (r.steps?.length) out.push(...(await providerOf(r.steps)));
    else out.push(r.provider);
  }
  return out;
};
const runGoal = async (invoice: string) => {
  const t0 = performance.now();
  const r = await call("context_compose", { ...goal(invoice), run: true });
  return { r, ms: ms(t0), expected: expectedRate(invoice), got: r.executed?.output, correct: r.executed?.status === "completed" && r.executed.output === expectedRate(invoice) };
};

// ------------------------------------------------------------ execute + verify + save
const e1 = await runGoal(invoices[0]);
results.benchmarks.executionMs = e1.ms;
step(7, "Execute the workflow", e1.r.executed?.status === "completed", { invoice: invoices[0], pipeline: e1.r.executed?.titles, ms: e1.ms });
step(8, "Verify against independently held test data", e1.correct, { expected: e1.expected, got: e1.got });
const firstVia = await providerOf(e1.r.executed?.runs ?? []);
results.firstRunProviders = firstVia;
const e2 = await runGoal(invoices[1]);
step(9, "Save the successful composition and reuse it", !!e1.r.crystallized && e2.correct && e2.r.executed?.titles.length === 1, { saved: e1.r.crystallized?.title, reusedAs: e2.r.executed?.titles, expected: e2.expected, got: e2.got, ms: e2.ms });

// ------------------------------------------------------------ change an interface
const tax = services.taxPrimary;
const before = tax.spec;
tax.spec = breakingRelease(before, seed + 1);
const after = tax.spec;
step(10, `Change the tax provider's interface (${before.brand})`, true, {
  before: `${before.protocol} "${before.operation}" ${before.input.name} → ${before.outputs.map((f) => f.name).join(", ")}`,
  after: `${after.protocol} "${after.operation}" ${after.input.name} → ${after.nest}.{${after.outputs.map((f) => f.name).join(", ")}}`,
});
const e3 = await runGoal(invoices[2]);
results.benchmarks.recoveryAfterChangeMs = e3.ms;
const viaChanged = await providerOf(e3.r.executed?.runs ?? []);
step(11, "Recover without changing integration code", e3.correct && e3.r.executed?.attempts?.some((a: any) => /API drift/.test(a.healing ?? "")), {
  healing: e3.r.executed?.attempts?.map((a: any) => a.healing).filter(Boolean),
  via: viaChanged,
  expected: e3.expected,
  got: e3.got,
  ms: e3.ms,
});

// ------------------------------------------------------------ remove the provider
const listProviders = async () => {
  const p = await call("context_providers");
  return (p.result ?? p) as Array<{ id: string; title: string; capabilities: number }>;
};
const capCount = async () => (await call("context_runtime")).graph.capabilities as number;
const provBefore = await listProviders();
const capsBefore = await capCount();
const savedBefore = provBefore.find((p) => p.id === "composite:crystallized")?.capabilities ?? 0;
await tax.stop();
step(12, `Remove the tax provider (${before.brand})`, true, {});
const e4 = await runGoal(invoices[3]);
const provAfter = await listProviders();
const capsAfter = await capCount();
const savedAfter = provAfter.find((p) => p.id === "composite:crystallized")?.capabilities ?? 0;
const withdrawn = provBefore.filter((p) => !provAfter.some((q) => q.id === p.id)).map((p) => p.title);
step(13, "Withdraw its capabilities accurately; report the objective as impossible, not faked", e4.r.executed?.status !== "completed" && withdrawn.length === 1 && capsAfter < capsBefore && savedAfter < savedBefore, {
  status: e4.r.executed?.status ?? "no plan",
  healing: e4.r.executed?.attempts?.map((a: any) => a.healing).filter(Boolean),
  withdrawn,
  capabilities: `${capsBefore} → ${capsAfter}`,
  savedPipelines: `${savedBefore} → ${savedAfter}`,
});

// ------------------------------------------------------------ introduce a new provider
await newcomer.start();
const ln = await call("context_learn", { source: newcomer.url });
const e5 = await runGoal(invoices[4]);
results.benchmarks.recoveryAfterNewProviderMs = e5.ms;
step(14, `Introduce a different tax provider (${newcomer.spec.brand}, ${newcomer.spec.protocol}): the objective works again`, e5.correct, {
  learned: ln.results.flatMap((r: any) => r.probes.filter((p: any) => p.ok).map((p: any) => `${p.kind}: ${p.detail}`)),
  via: await providerOf(e5.r.executed?.runs ?? []),
  expected: e5.expected,
  got: e5.got,
  ms: e5.ms,
});

const runtime = await call("context_runtime");
results.benchmarks.memoryMB = runtime.memoryMB;
const chain = await call("context_run_status", { limit: 1 });
results.receipts = chain.chain;

// ------------------------------------------------------------ report
child.stdin.end();
for (const s of [...Object.values(services), newcomer]) await s.stop().catch(() => {});
const passed = results.steps.filter((s: any) => s.ok).length;
results.passed = passed;
results.total = results.steps.length;
log(`\n${passed}/${results.steps.length} steps passed · receipts ${chain.chain.count} (intact ${chain.chain.intact}) · memory ${runtime.memoryMB} MB`);
log(`benchmarks: ${JSON.stringify(results.benchmarks)}`);
mkdirSync("lab/results", { recursive: true });
writeFileSync(`lab/results/seed-${seed}.json`, JSON.stringify(results, null, 2));
writeFileSync("lab/results/latest.json", JSON.stringify(results, null, 2));
process.exit(passed === results.steps.length ? 0 : 1);
