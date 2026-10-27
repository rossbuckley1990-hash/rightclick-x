import { test } from "node:test";
import assert from "node:assert/strict";
import { ProcessMemoryStore } from "../src/entry/node-host.ts";
import { goalDefinitionDigest } from "../src/core/goal-identity.ts";
import type { PersistedState } from "../src/runtime.ts";

const state = (): PersistedState => ({ version: 2, requirements: [], reflections: [], ledger: {}, receipts: [], published: [] });
function barrier() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }

test("independent runtime views CAS shared process-local state and snapshots cannot mutate it", async () => {
  const backend = new ProcessMemoryStore();
  const a = backend.forRuntime(), b = backend.forRuntime();
  assert.equal(await a.load(), null); assert.equal(await b.load(), null);
  const input = state(); await a.save(input); input.ledger.changed = true;
  await assert.rejects(b.save(state()), /state changed/);
  const read = await b.load(); assert.deepEqual(read?.ledger, {});
  read!.ledger.changed = true; assert.deepEqual((await a.load())?.ledger, {});
  await b.save(state());
  await assert.rejects(a.save(state()), /state changed/);
});

test("process-local lease blocks concurrent replacement and rejects stale and revoked pins", async () => {
  const backend = new ProcessMemoryStore(), a = backend.forRuntime(), b = backend.forRuntime();
  const s = state();
  const goal = { slug: "g", revision: "v1" } as NonNullable<PersistedState["published"]>[number];
  s.published = [goal]; await a.load(); await a.save(s); await b.load();
  const pin = { slug: "g", digest: await goalDefinitionDigest(goal) };
  const entered = barrier(), finish = barrier();
  const lease = a.withGoalLease!([pin], async () => { entered.release(); await finish.promise; });
  await entered.promise;
  await assert.rejects(b.save({ ...s, published: [] }), /lease/);
  await assert.rejects(b.withGoalLease!([pin], async () => {}), /lease/);
  finish.release(); await lease;
  await b.save({ ...s, published: [] });
  let called = false;
  await assert.rejects(a.withGoalLease!([pin], async () => { called = true; }), /stale, revoked/);
  assert.equal(called, false);
});

test("separate process-local backends do not claim shared authority", async () => {
  const a = new ProcessMemoryStore().forRuntime(), b = new ProcessMemoryStore().forRuntime();
  await a.load(); await a.save(state()); assert.equal(await b.load(), null);
});

test("uncoordinated adapters and unrevisioned legacy goals fail before goal dispatch", async () => {
  const { RightClick } = await import("../src/runtime.ts");
  const backend = new ProcessMemoryStore();
  const creator = await RightClick.create({ store: backend, sandbox: null, directories: [] });
  const created = await creator.compose({ have: { text: { type: "text", value: "seed" } }, want: "hash", through: ["builtin:text.sha256"], run: true, publish: "Memory digest" });
  await creator.flush();
  assert.ok(created.published);
  const seeded = await backend.load(); assert.ok(seeded);
  const unsupported = { load: async () => structuredClone(seeded), save: async () => {} };
  const remote = await RightClick.create({ store: unsupported, sandbox: null, directories: [] });
  const rejected = await remote.run(created.published!.id, { text: "next" });
  assert.notEqual(rejected.status, "completed");
  assert.match(JSON.stringify(rejected), /cannot guarantee freshness/);
  const legacy = structuredClone(seeded);
  delete legacy.published![0].revision;
  const legacyBackend = new ProcessMemoryStore(); await legacyBackend.load(); await legacyBackend.save(legacy);
  const legacyRuntime = await RightClick.create({ store: legacyBackend, sandbox: null, directories: [] });
  const refused = await legacyRuntime.run(created.published!.id, { text: "next" });
  assert.notEqual(refused.status, "completed");
  assert.match(JSON.stringify(refused), /explicitly republish/);
  assert.equal((await legacyBackend.load())!.published![0].revision, undefined);
});
