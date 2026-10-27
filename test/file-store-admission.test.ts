import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { goalDefinitionDigest } from "../src/core/goal-identity.ts";

function barrier() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), "rcx-local-admission-"));
  const store = new FileStore(join(dir, "state.json"));
  const rc = await RightClick.create({ store, directories: [] });
  const created = await rc.compose({ have: { text: { type: "text", value: "old", fixed: true } }, want: "hash",
    through: ["builtin:text.sha256"], run: true, publish: "shared" });
  assert.equal(created.published?.durable, true);
  await rc.flush();
  return { dir, store, rc, pins: [{ slug: "shared", digest: await goalDefinitionDigest(rc.published.get("shared")!) }] };
}

test("same-store save finishes before a goal lease; unrelated flush cannot deadlock its owner", { timeout: 10000 }, async () => {
  const { dir, store, rc, pins } = await fixture();
  const atRename = barrier(), releaseSave = barrier(), leased = barrier(), releaseGoal = barrier();
  const rename = fs.rename;
  let paused = false, invoked = false;
  try {
    fs.rename = async (...args) => {
      if (!paused) { paused = true; atRename.open(); await releaseSave.promise; }
      return rename(...args);
    };
    syncBuiltinESMExports();
    const saving = rc.flush();
    await atRename.promise;
    const goal = store.withGoalLease(pins, async () => {
      invoked = true; leased.open(); await releaseGoal.promise;
      // This owner-scoped flush queues after a rejected unrelated flush.
      await rc.flush();
      return "complete";
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(invoked, false, "the goal cannot dispatch while the earlier save owns the lock");
    releaseSave.open();
    await saving;
    await leased.promise;
    await assert.rejects(rc.flush(), /local saved-goal lease is pending or active/);
    assert.equal(rc.runtime().storage.status, "failed");
    releaseGoal.open();
    assert.equal(await goal, "complete");
    assert.equal(rc.runtime().storage.status, "saved");
    await rc.flush();
  } finally {
    releaseSave.open(); releaseGoal.open();
    fs.rename = rename; syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("uncertain preceding save refuses a pending goal before dispatch", { timeout: 10000 }, async () => {
  const { dir, store, rc, pins } = await fixture();
  const atRename = barrier(), releaseSave = barrier(), rename = fs.rename;
  let invoked = false;
  try {
    fs.rename = async () => { atRename.open(); await releaseSave.promise; throw new Error("synthetic rename uncertainty"); };
    syncBuiltinESMExports();
    const saving = rc.flush();
    // Attach rejection handler before releasing the barrier.
    const failedSave = assert.rejects(saving, /commit outcome unknown/);
    await atRename.promise;
    const goal = store.withGoalLease(pins, async () => { invoked = true; });
    const deniedGoal = assert.rejects(goal, /commit outcome unknown/);
    releaseSave.open();
    await failedSave; await deniedGoal;
    assert.equal(invoked, false);
    assert.equal(rc.runtime().storage.status, "failed");
  } finally {
    releaseSave.open(); fs.rename = rename; syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the lease stays held until an admitted owner save finishes", { timeout: 10000 }, async () => {
  const { dir, store, pins } = await fixture();
  const atRename = barrier(), releaseSave = barrier(), rename = fs.rename;
  try {
    const state = await store.load(); assert.ok(state);
    fs.rename = async (...args) => { atRename.open(); await releaseSave.promise; return rename(...args); };
    syncBuiltinESMExports();
    let done = false;
    const goal = store.withGoalLease(pins, async () => { void store.save(state); return "complete"; }).then(value => { done = true; return value; });
    await atRename.promise;
    assert.equal(done, false);
    const rival = new FileStore(join(dir, "state.json"));
    await assert.rejects(rival.withGoalLease(pins, async () => {}), /file lock/);
    releaseSave.open();
    assert.equal(await goal, "complete");
  } finally {
    releaseSave.open(); fs.rename = rename; syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("an owner save with an uncertain commit reports an unknown outcome and never replays", { timeout: 10000 }, async () => {
  const { dir, store, pins } = await fixture();
  const rename = fs.rename;
  let effects = 0;
  try {
    const state = await store.load(); assert.ok(state);
    fs.rename = async () => { throw new Error("synthetic uncertain rename"); };
    syncBuiltinESMExports();
    await assert.rejects(store.withGoalLease(pins, async () => {
      effects++;
      await assert.rejects(store.save(state), /commit outcome unknown/);
    }), /outcome unknown after persistence failure; do not replay/);
    await assert.rejects(store.withGoalLease(pins, async () => { effects++; }), /commit outcome unknown/);
    assert.equal(effects, 1);
  } finally {
    fs.rename = rename; syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
