import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/entry/node-host.ts";
import type { PersistedState } from "../src/runtime.ts";
import { STATE_REQUIREMENTS } from "../src/core/state-format.ts";

function snapshot(index: number): PersistedState {
  return { version: 2, requirements: [...STATE_REQUIREMENTS], reflections: [], receipts: [], ledger: { marker: { index, padding: "x".repeat(1000) } } };
}

test("overlapping saves preserve call order, own their temporary file and finish without rename races", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-store-concurrency-"));
  try {
    const store = new FileStore(join(dir, "state.json"));
    const results = await Promise.allSettled(Array.from({ length: 64 }, (_, i) => store.save(snapshot(i))));
    assert.equal(results.filter(r => r.status === "rejected").length, 0);
    assert.equal((await store.load())?.ledger.marker.index, 63);
    assert.deepEqual(await readdir(dir), ["state.json"]);
    const other = new FileStore(join(dir, "state.json"));
    const independent = await Promise.allSettled([store.save(snapshot(64)), other.save(snapshot(65))]);
    assert.ok(independent.every(r => r.status === "fulfilled"));
    assert.ok([64, 65].includes((await store.load())?.ledger.marker.index));
    assert.deepEqual(await readdir(dir), ["state.json"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("save snapshots mutable input at call time, and a rejected save does not poison the queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-store-snapshot-"));
  try {
    const store = new FileStore(join(dir, "state.json"));
    const state = snapshot(1);
    const pending = store.save(state); state.ledger.marker.index = 2;
    await pending;
    assert.equal((await store.load())?.ledger.marker.index, 1);
    const bad = snapshot(3); bad.ledger.cycle = bad;
    await assert.rejects(store.save(bad), /circular/i);
    await store.save(snapshot(4));
    assert.equal((await store.load())?.ledger.marker.index, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
