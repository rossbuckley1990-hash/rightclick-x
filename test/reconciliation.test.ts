import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerifiedReconciliation, verifyReconciliation } from "../src/reconciliation.ts";
import { FileStore, ProcessMemoryStore } from "../src/entry/node-host.ts";
import { startServices } from "../experiments/reconciliation/service.ts";
import { fixtureAuth, fixtureContract } from "../experiments/reconciliation/setup.ts";
import { check } from "../src/core/verify.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "rcx-reconcile-test-"));
  const s = await startServices(join(root, "ledger.sqlite"));
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });
  const contract = await fixtureContract(s.gateway, s.checker);
  const options = { store: new FileStore(join(root, "state.json")), auth: fixtureAuth(s.gateway, s.checker), timeoutMs: 1500 };
  return { ...s, contract, options, create: () => VerifiedReconciliation.create(contract, { ...options, store: new FileStore(join(root, "state.json")) }) };
}

test("read-only product distinguishes match and mismatch, then reuses on a fresh runtime", async t => {
  const f = await fixture(t);
  const first = await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" });
  assert.equal(first.outcome, "VERIFIED MATCH", JSON.stringify(first));
  assert.equal(first.differenceMinor, "0");
  assert.deepEqual(first.units, { currency: "USD", unit: "minor", basis: "settled" });
  assert.equal(first.durable, true);
  const second = await (await f.create()).reconcile({ account: "ACC-88", period: "2026-10" });
  assert.equal(second.outcome, "VERIFIED MISMATCH", JSON.stringify(second));
  assert.equal(second.state, "verified");
  assert.equal(second.differenceMinor, "51");
  assert.equal(second.route, "retained");
  assert.equal(second.measurements?.fallbackCalls, 0);
});

for (const fault of ["amount", "currency", "identity", "period", "precision", "units", "basis", "checker-drift", "rate-limit", "loss", "pending"]) {
  test(`reconciliation refuses ${fault} without publication or write dispatch`, async t => {
    const f = await fixture(t);
    f.db.prepare("UPDATE control SET fault=?").run(fault);
    const result = await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" });
    assert.equal(result.outcome, "UNRESOLVED/UNVERIFIED", JSON.stringify(result));
    assert.equal(result.durable, false);
    if (fault === "pending") assert.equal(result.state, "pending");
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM calls WHERE method NOT IN ('GET','HEAD') AND queryOnly=0").get()!.n, 0,
      "every non-GET dispatch must independently match an exact read-only GraphQL document");
    const state = await f.options.store.load();
    assert.equal(state?.published?.length ?? 0, 0);
    if (fault === "checker-drift") assert.equal(f.db.prepare("SELECT COUNT(*) n FROM calls WHERE path='/v1/settlements'").get()!.n, 0);
  });
}

test("a real REST removal and GraphQL discovery preserves independent checks", async t => {
  const f = await fixture(t);
  assert.equal((await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" })).outcome, "VERIFIED MATCH");
  f.db.exec("UPDATE control SET version=2");
  const changed = await (await f.create()).reconcile({ account: "ACC-88", period: "2026-10" });
  assert.equal(changed.outcome, "VERIFIED MISMATCH", JSON.stringify(changed));
  const reused = await (await f.create()).reconcile({ account: "ACC-99", period: "2026-10" });
  assert.equal(reused.outcome, "VERIFIED MATCH", JSON.stringify(reused));
  assert.equal(reused.route, "retained");
});

test("a changed checker cannot be silently repinned on an existing goal", async t => {
  const f = await fixture(t);
  assert.equal((await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" })).state, "verified");
  f.db.exec("UPDATE control SET version=2, fault='checker-drift'");
  const before = f.db.prepare("SELECT COUNT(*) n FROM calls WHERE path='/v1/settlements'").get()!.n;
  assert.notEqual((await (await f.create()).reconcile({ account: "ACC-88", period: "2026-10" })).state, "verified");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM calls WHERE path='/v1/settlements'").get()!.n, before);
});

test("missing pins, volatile storage and a same-origin checker fail admission", async t => {
  const f = await fixture(t);
  await assert.rejects(VerifiedReconciliation.create(f.contract, { ...f.options, store: new ProcessMemoryStore() }), /persistent/);
  await assert.rejects(VerifiedReconciliation.create({ ...f.contract, checker: { ...f.contract.checker, contract: "" } }, f.options), /pinned/);
  await assert.rejects(VerifiedReconciliation.create({ ...f.contract, checker: { ...f.contract.checker, source: f.gateway } }, f.options), /separately/);
});

test("publication failure does not claim a durable reconciliation", async t => {
  const f = await fixture(t);
  const save = f.options.store.save.bind(f.options.store);
  f.options.store.save = async state => { if (state.published?.length) throw new Error("disk unavailable"); return save(state); };
  const r = await (await VerifiedReconciliation.create(f.contract, f.options)).reconcile({ account: "ACC-77", period: "2026-10" });
  assert.equal(r.outcome, "UNRESOLVED/UNVERIFIED");
  assert.equal(r.durable, false);
});

test("the shared oracle rejects matching wrong identities and fractional or unsafe integers", () => {
  const expected = { currency: "USD", unit: "minor" as const, basis: "settled" };
  const input = { account: "A", period: "closed-1" }, digest = "rule";
  const row = { ...expected, ...input, amountMinor: 42 };
  for (const delta of [{ account: "B" }, { period: "closed-2" }, { currency: "CAD" }, { amountMinor: 0.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }]) {
    const bad = { ...row, ...delta };
    assert.equal(verifyReconciliation(input, expected, bad, { authoritative: bad, secondary: bad, rulesDigest: digest }, digest).valid, false);
  }
  assert.equal(check({}, [{ op: "input_equals", path: "missing", input: "missing" }]).status, "refuted");
});

test("pending reads remain ambiguous on restart and do not dispatch another request", async t => {
  const f = await fixture(t);
  f.db.exec("UPDATE control SET fault='pending'");
  const first = await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" });
  assert.equal(first.state, "pending");
  const calls = f.db.prepare("SELECT COUNT(*) n FROM calls WHERE path='/v1/settlements'").get()!.n;
  const next = await (await f.create()).reconcile({ account: "ACC-88", period: "2026-10" });
  assert.equal(next.state, "ambiguous");
  assert.equal(next.durable, false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM calls WHERE path='/v1/settlements'").get()!.n, calls);
});

test("provider unavailability is not a semantic contradiction", async t => {
  const f = await fixture(t);
  f.db.exec("UPDATE control SET fault='unavailable'");
  const r = await (await f.create()).reconcile({ account: "ACC-77", period: "2026-10" });
  // A dispatched read without a validated result retains its execution checkpoint.
  // Preserve that uncertainty rather than labelling the service response a contradiction.
  assert.equal(r.state, "ambiguous");
  assert.deepEqual(r.failedChecks, []);
});

test("a completed product call drains scheduled persistence before another owner starts", async t => {
  const f = await fixture(t);
  let saves = 0;
  const save = f.options.store.save.bind(f.options.store);
  f.options.store.save = async state => { saves++; await save(state); };
  const Reconciler = process.env.RCX_RECONCILIATION_TARGET
    ? (await import(`${process.env.RCX_RECONCILIATION_TARGET}/src/reconciliation.ts`)).VerifiedReconciliation : VerifiedReconciliation;
  const r = await (await Reconciler.create(f.contract, f.options)).reconcile({ account: "ACC-77", period: "2026-10" });
  assert.equal(r.state, "verified");
  const completedSaves = saves;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(saves, completedSaves, "no background writer may outlive the reported completed transaction");
});
