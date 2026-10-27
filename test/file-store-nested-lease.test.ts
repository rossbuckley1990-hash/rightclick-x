import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/entry/node-host.ts";
import type { PersistedState } from "../src/runtime.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test("an admitted nested invocation retains the file lock after its parent returns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-nested-lease-"));
  try {
    const state: PersistedState = { version: 2, requirements: [], reflections: [], ledger: {}, receipts: [], published: [] };
    const store = new FileStore(join(dir, "state.json"));
    await store.load(); await store.save(state);
    const competitor = new FileStore(join(dir, "state.json")); await competitor.load();
    const entered = barrier(), finish = barrier(), outerReturned = barrier();
    let nested!: Promise<void>;
    const outer = store.withGoalLease([], async () => {
      nested = store.withGoalLease([], async () => { entered.release(); await finish.promise; });
      await entered.promise;
    }).finally(() => outerReturned.release());
    await entered.promise;
    // Let the outer callback settle; a concurrent writer must remain blocked.
    await new Promise(resolve => setTimeout(resolve, 30));
    try { await assert.rejects(competitor.save(state), /lock/); }
    finally { finish.release(); }
    await nested; await outer; await outerReturned.promise;
    await competitor.save(state);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
