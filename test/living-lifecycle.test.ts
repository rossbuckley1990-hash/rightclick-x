import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityLog, ACTIVITY_LIMIT } from "../src/core/activity.ts";
import { capabilityState, capabilityPage } from "../src/interface/dashboard-state.ts";
import { createHandler } from "../src/interface/http.ts";
import { RightClick } from "../src/runtime.ts";
import { world, learnAll, MemoryStore } from "./helpers.ts";

test("retained composition links real runs and survives restart without copying raw execution data", async () => {
  const store = new MemoryStore();
  const { rc } = await world({}, { store });
  await learnAll(rc);
  const result = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "Observed weather", verify: [{ op: "equals", value: "Se esperan nublado cielos con una máxima de 19°C y una suave brisa hoy." }] });
  assert.equal(result.executed?.status, "completed");
  const id = result.published!.id, state = capabilityState(rc, id);
  assert.equal(Object.keys(state.states).length, 6);
  assert.equal(state.states.assurance.state, "predicates-passed-on-run");
  assert.equal(state.states.reusability.state, "retained-contract");
  assert.equal(state.states.authority.state, "unknown");
  assert.equal(state.states.executability.state, "requires-plan");
  assert.equal(state.states.validity.state, "descriptor-matches-observation");
  assert.ok(state.lastObservation!.providers!.length >= 2);
  assert.deepEqual(state.lastObservation!.runs, result.executed!.runs);
  for (const run of result.executed!.runs) assert.equal(rc.activity.forRun(run)?.receipt, rc.runs.get(run)?.receipt.hash);
  rc.published.get("observed-weather")!.trust = "verified";
  assert.equal(capabilityState(rc, id).states.assurance.state, "predicates-passed-on-run");
  await rc.run("builtin:html.text", { html: "<p>raw-secret-output</p>" }, { verify: [{ op: "equals", value: "raw-secret-output" }] });
  assert.doesNotMatch(JSON.stringify(rc.activity.snapshot()), /raw-secret-output|Lima/);
  await rc.flush();
  const restarted = (await world({}, { store })).rc;
  assert.equal(restarted.runs.size, 0, "raw response history is not restored");
  assert.equal(capabilityState(restarted, id).lastObservation!.id, state.lastObservation!.id);
  assert.equal(capabilityState(restarted, id).states.authority.state, "unknown");
  const resumed = restarted.activity.read({ after: rc.activity.read().cursor, epoch: rc.activity.epoch });
  assert.equal(resumed.reset, "runtime-restarted");
  assert.equal(resumed.entries.filter(e => e.kind === "provider.learned").length, rc.activity.read().entries.filter(e => e.kind === "provider.learned").length, "loading persisted descriptors is not new discovery");
  await restarted.flush();
});

test("withdrawal and changed dependency defeat historical success without granting authority", async () => {
  const store = new MemoryStore(), { rc } = await world({}, { store });
  await learnAll(rc);
  const r = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "Weather", verify: [{ op: "exists" }] });
  const id = r.published!.id, before = capabilityState(rc, id);
  const leaf = before.lastObservation!.contracts!.find(c => c.provider !== "goals" && c.capability !== id && rc.graph.get(c.capability)?.invoke.kind !== "composite")!;
  const cap = rc.graph.get(leaf.capability)!;
  cap.risk = "destructive";
  assert.equal(capabilityState(rc, id).states.validity.state, "dependencies-changed");
  assert.equal(capabilityState(rc, cap.id).states.executability.state, "locally-blocked");
  rc.graph.forget(cap.provider);
  assert.equal(capabilityState(rc, id).states.validity.state, "dependencies-changed");
  assert.equal(capabilityState(rc, cap.id).states.discovery.state, "absent");
  assert.equal(capabilityState(rc, r.crystallized!.id).states.validity.state, "unavailable");
  assert.ok(rc.activity.read({ limit: 100 }).entries.some(e => e.kind === "capability.retired" && e.subjects?.includes(r.crystallized!.id)));
  await rc.flush();
  const restored = (await world({}, { store })).rc;
  assert.equal(capabilityState(restored, id).states.validity.state, "dependencies-changed");
  assert.ok(restored.activity.read({ limit: 100 }).entries.some(e => e.kind === "provider.forgotten" && e.providers?.includes(cap.provider)));
  await restored.flush();
});

test("refusals, unavailable plans and failed checks are real events without provider-error leakage", async () => {
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedRisks: [] } } });
  const cap = rc.graph.list()[0];
  const r = await rc.run(cap.id, { token: "a-sensitive-input" });
  assert.equal(r.status, "failed");
  assert.equal(rc.activity.latest(cap.id)?.status, "refused");
  assert.equal(capabilityState(rc, cap.id).states.authority.state, "unknown");
  assert.equal(capabilityState(rc, cap.id).states.executability.state, "locally-blocked");
  const noPlan = await rc.compose({ have: {}, want: "absent-type", run: true });
  assert.equal(noPlan.executed, undefined);
  assert.equal(rc.activity.read().entries.at(-1)?.status, "unavailable");
  await assert.rejects(rc.run("missing", { password: "raw-password" }));
  assert.equal(rc.activity.latest("missing")?.reason, "unknown-capability");
  cap.risk = "destructive";
  await assert.rejects(rc.run(cap.id), /operator/);
  assert.equal(rc.activity.latest(cap.id)?.reason, "destructive-approval-required");
  assert.doesNotMatch(JSON.stringify(rc.activity.snapshot()), /raw-password|a-sensitive-input/);
});

test("withdrawal records identifiers even for operations never executed", async () => {
  const store = new MemoryStore(), { rc } = await world({}, { store });
  await learnAll(rc);
  const provider = rc.graph.providers.get("mcp:skycast")!;
  const ids = [...provider.capabilityIds];
  assert.equal(rc.runs.size, 0);
  rc.graph.forget(provider.id);
  const event = rc.activity.read({ limit: 100 }).entries.findLast(e => e.kind === "provider.forgotten")!;
  assert.deepEqual(event.subjects, ids);
  await rc.flush();
  const restored = (await world({}, { store })).rc;
  assert.deepEqual(restored.activity.read({ limit: 100 }).entries.find(e => e.id === event.id)?.subjects, ids);
  assert.ok(ids.every(id => capabilityState(restored, id).states.discovery.state === "absent"));
  await restored.flush();
});

test("bounded history reports overflow, restart, invalid cursor and truncated evidence", () => {
  const log = new ActivityLog();
  for (let i = 0; i < ACTIVITY_LIMIT + 10; i++) log.append({ kind: "execution.finished", status: "completed", subjects: [`cap-${i}`] });
  assert.equal(log.snapshot().entries.length, ACTIVITY_LIMIT);
  assert.equal(log.read().discarded, 10);
  assert.equal(log.read({ after: 1 }).reset, "history-gap");
  assert.equal(log.read({ after: NaN }).reset, "history-gap");
  assert.equal(log.read({ after: 99999 }).reset, "history-gap");
  assert.equal(log.read({ after: 10, limit: Infinity }).entries.length, 50);
  assert.equal(log.read({ after: 10, limit: 3 }).hasMore, true);
  const huge = log.append({ kind: "execution.finished", status: "completed", subjects: Array(300).fill("😀".repeat(3000)), output: "must not persist" } as any);
  assert.equal(huge.truncated, true);
  assert.ok(JSON.stringify(huge).length < 16000);
  assert.doesNotMatch(JSON.stringify(huge), /must not persist/);
  const restored = new ActivityLog();
  restored.restore(log.snapshot());
  assert.equal(restored.read({ epoch: log.epoch }).reset, "runtime-restarted");
  const copy = restored.read(); copy.entries[0].status = "forged";
  assert.notEqual(restored.read().entries[0].status, "forged");
});

test("old persisted state remains readable and forged publication trust supplies no outcome evidence", async () => {
  const store = new MemoryStore(), { rc } = await world({}, { store });
  await learnAll(rc);
  const r = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", run: true, publish: "Legacy" });
  assert.ok(r.published);
  await rc.flush();
  delete store.state!.activity;
  store.state!.published![0].trust = "verified";
  const restored = (await world({}, { store })).rc;
  const state = capabilityState(restored, r.published.id);
  assert.equal(state.states.assurance.state, "not-assessed");
  assert.equal(state.states.validity.state, "not-assessed");
  assert.equal(state.states.authority.state, "unknown");
  await restored.flush();
});

test("dashboard lifecycle endpoints remain authenticated, bounded, searchable and side-effect free", async () => {
  const { rc } = await world(); await learnAll(rc);
  const handle = createHandler(rc, { token: "fixture" });
  const before = JSON.stringify(rc.activity.snapshot()), cursor = rc.graph.cursor;
  const urls = ["/api/overview", "/api/activity", "/api/capabilities?limit=900", "/api/capability?id=missing"];
  for (const path of urls) {
    assert.equal((await handle(new Request(`https://runtime.test${path}`))).status, 401);
    const response = await handle(new Request(`https://runtime.test${path}`, { headers: { authorization: "Bearer fixture" } }));
    assert.equal(response.status, 200);
    if (path.includes("limit")) assert.equal((await response.json() as any).limit, 50);
  }
  const one = capabilityPage(rc, { search: "weather", limit: 1 });
  assert.equal(one.items.length, 1);
  assert.ok(one.total >= 1);
  const p = one.items[0].provider!;
  assert.ok(capabilityPage(rc, { provider: p }).items.every(c => c.provider === p));
  assert.equal(JSON.stringify(rc.activity.snapshot()), before);
  assert.equal(rc.graph.cursor, cursor);
  assert.equal(rc.runs.size, 0);
});
