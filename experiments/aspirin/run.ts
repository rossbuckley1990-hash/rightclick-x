// Real local HTTP, durable SQLite and independent observer/worker/fault processes.
// Development evidence only. Does not invoke a model or use customer data.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "rcx-aspirin-")), database = join(root, "invoices.sqlite"), mode = join(root, "mode.json"), state = join(root, "runtime.json");
const scripts = new URL("./", import.meta.url);
function child(file: string, args: string[]) { return spawn(process.execPath, [new URL(file, scripts).pathname, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH } }); }
async function once(file: string, args: string[]): Promise<string> {
  const p = child(file, args); let out = "", err = "";
  p.stdout.on("data", b => out += b); p.stderr.on("data", b => err += b);
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { p.kill(); reject(new Error("child deadline")); }, 30_000);
    p.on("error", reject); p.on("close", code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`child failed ${code}: ${err.slice(0, 800)}`)); }); });
}
async function service(role: string) {
  const p = child("service.ts", [role, database, mode]);
  const url = await new Promise<string>((resolve, reject) => {
    let buffer = ""; const timer = setTimeout(() => reject(new Error("service startup deadline")), 5000);
    p.stdout.on("data", b => { buffer += b; if (buffer.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(buffer.split("\n")[0]).url); } });
    p.on("error", reject); p.on("exit", code => { clearTimeout(timer); reject(new Error(`service exited ${code}`)); });
  }); return { p, url };
}
const fault = (value: object) => once("fault.ts", [mode, JSON.stringify(value)]);
await fault({ version: 1 });
const provider = await service("provider"), observer = await service("observer");
const events: any[] = [];
const invoice = (id: string, amount = 1250) => ({ request_id: id, customer: "customer-A", currency: "USD", lines: [{ unit_minor: amount, quantity: 2 }, { unit_minor: 37, quantity: 3 }] });
async function run(label: string, id: string, adapter = "none", file = state, permission = "allowed") {
  const request = invoice(id);
  const started = performance.now();
  const result = JSON.parse(await once("worker.ts", [provider.url, observer.url, file, JSON.stringify(request), adapter, permission]));
  // Evidence has synthetic data only. Exact result retained for independent review.
  events.push({ label, request, result, wallMs: performance.now() - started });
  return result;
}
let failure: string | undefined;
try {
  const day1 = await run("day-one-rest", "one");
  assert.equal(day1.status, "verified", JSON.stringify(day1));
  await fault({ version: 2 });
  assert.equal((await fetch(`${provider.url}/v1/invoices`, { headers: { Authorization: "Bearer synthetic-provider" } })).status, 410);
  assert.equal((await fetch(`${provider.url}/openapi.json`, { headers: { Authorization: "Bearer synthetic-provider" } })).status, 410);
  const day2 = await run("day-two-graphql-recovery", "two", "fixture");
  assert.equal(day2.status, "verified", JSON.stringify(day2));
  const cold = await run("fresh-process-no-agent", "three");
  assert.equal(cold.status, "verified", JSON.stringify(cold));
  assert.equal(cold.route, "retained");
  assert.equal(cold.measurements.fallbackCalls, 0);
  const duplicate = await run("idempotent-same-request", "three");
  assert.equal(duplicate.status, "verified");
  const concurrent = await Promise.all([run("concurrent-a", "parallel"), run("concurrent-b", "parallel")]);
  assert.ok(concurrent.some(r => r.status === "verified"), JSON.stringify(concurrent));
  const denied = await run("unauthorised-worker", "denied", "fixture", join(root, "denied.json"), "denied");
  assert.notEqual(denied.status, "verified");
  await fault({ version: 2, lie: true });
  const lie = await run("misleading-unit-contract", "lie", "fixture", join(root, "lie.json"));
  assert.notEqual(lie.status, "verified");
  await fault({ version: 2, rateLimit: true });
  const limited = await run("rate-limited", "limited", "fixture", join(root, "limited.json"));
  assert.notEqual(limited.status, "verified");
  await fault({ version: 2, loseResponse: true });
  const lost = await run("response-lost-after-commit", "lost", "fixture", join(root, "lost.json"));
  assert.notEqual(lost.status, "verified");
  await fault({ version: 2 });
  const retry = await run("fresh-process-must-not-replay-unknown", "lost", "fixture", join(root, "lost.json"));
  assert.notEqual(retry.status, "verified");
  await fault({ version: 2, slowResponse: true });
  const slow = await run("timeout-after-commit", "slow", "fixture", join(root, "slow.json"));
  assert.equal(slow.status, "ambiguous");
  await fault({ version: 2 });
  const slowRetry = await run("timeout-cold-restart-no-replay", "slow", "fixture", join(root, "slow.json"));
  assert.equal(slowRetry.status, "ambiguous");
  const db = new DatabaseSync(database, { readOnly: true });
  const rows = db.prepare("SELECT request_id, customer, currency, total_minor, invoice_id FROM invoices ORDER BY request_id").all() as any[];
  const calls = db.prepare("SELECT request_id, outcome, COUNT(*) AS count FROM calls GROUP BY request_id, outcome ORDER BY request_id").all() as any[];
  for (const id of ["one", "two", "three", "parallel", "lost", "slow"]) {
    assert.equal(rows.filter(r => r.request_id === id).length, 1);
    const row = rows.find(r => r.request_id === id)!;
    assert.deepEqual({ ...row }, { request_id: id, customer: "customer-A", currency: "USD", total_minor: 2611, invoice_id: `INV-${id}` });
  }
  assert.equal(rows.filter(r => ["denied", "limited"].includes(r.request_id)).length, 0);
  assert.equal(calls.find(r => r.request_id === "lost")?.count, 1, "unknown write must not be replayed");
  assert.equal(calls.find(r => r.request_id === "slow")?.count, 1, "timed-out write must not be replayed");
  events.push({ label: "independent-database-observation", rows, calls, databaseHash: createHash("sha256").update(await readFile(database)).digest("hex") });
  db.close();
} catch (e) { failure = String(e); }
finally { provider.p.kill(); observer.p.kill(); }
const report = { schema: "rightclick-x/aspirin-development@1", at: new Date().toISOString(), passed: !failure, failure, root, modelInvocations: 0,
  limitations: ["Engineering-authored development fixture, not independent held-out evaluation", "Fallback proposals are scripted; model reasoning and model costs are not established", "SQLite uniqueness supplies provider idempotency; not universal exactly-once semantics", "Worker processes receive original business contract and invocation only; no conversation", "Observer is a separate read-only process; not cryptographic attestation"], events };
const destination = process.argv[2] ?? join(root, "report.json");
await writeFile(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, report: destination, events: events.length, failure: failure?.slice(0, 180) }));
if (failure) process.exitCode = 1;
