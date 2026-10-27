import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, ProcessMemoryStore } from "../src/entry/node-host.ts";
import { RightClick } from "../src/runtime.ts";
import type { PersistedState, Store } from "../src/runtime.ts";

const state: PersistedState = { version: 2, requirements: [], reflections: [], ledger: {}, receipts: [], published: [] };
function barrier() { let open!: () => void; const promise = new Promise<void>(r => { open = r; }); return { promise, open }; }
for (const kind of ["file", "memory"] as const) {
  test(`${kind}: admitted nested save remains authorised after its parent returns`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-lease-life-"));
    try {
      const backend = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore();
      const store: Store = kind === "file" ? backend : (backend as ProcessMemoryStore).forRuntime();
      await store.load(); await store.save(state);
      const entered = barrier(), release = barrier(); let nested!: Promise<void>, scope!: { active: boolean };
      const outer = store.withGoalLease!([], async () => {
        scope = kind === "file" ? (backend as any).leaseContext.getStore() : (backend as any).context.getStore();
        nested = store.withGoalLease!([], async () => { entered.open(); await release.promise; await store.save(state); });
        await entered.promise;
      });
      await entered.promise;
      // The barrier is the root scope transitioning to cleanup, not elapsed time.
      while (scope.active) await new Promise<void>(resolve => setImmediate(resolve));
      release.open(); await nested; await outer;
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: finished nested scope cannot borrow the still-active parent lease`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-lease-expired-"));
    try {
      const store: Store = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore().forRuntime();
      await store.load(); await store.save(state);
      const release = barrier(); let save!: Promise<void>, again!: Promise<void>;
      await store.withGoalLease!([], async () => {
        await store.withGoalLease!([], async () => {
          save = release.promise.then(() => store.save({ ...state, ledger: { forbidden: true } }));
          again = release.promise.then(() => store.withGoalLease!([], async () => {}));
        });
        const deniedSave = assert.rejects(save, /lease/);
        const deniedLease = assert.rejects(again, /lease/);
        release.open(); await deniedSave; await deniedLease;
      });
      assert.deepEqual((await store.load())?.ledger, {});
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: a finished nested callback after release must use fresh CAS`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-nested-cas-"));
    try {
      const backend = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore();
      const store: Store = kind === "file" ? backend : (backend as ProcessMemoryStore).forRuntime();
      const rival: Store = kind === "file" ? new FileStore(join(dir, "state.json")) : (backend as ProcessMemoryStore).forRuntime();
      await store.load(); await store.save(state);
      const release = barrier(); let deferred!: Promise<void>;
      await store.withGoalLease!([], async () => {
        await store.withGoalLease!([], async () => {
          deferred = release.promise.then(() => store.save({ ...state, ledger: { stale: true } }));
        });
      });
      await rival.load(); await rival.save({ ...state, ledger: { current: true } });
      const denied = assert.rejects(deferred, /state changed|snapshot changed/);
      release.open(); await denied;
      assert.equal((await rival.load())?.ledger.current, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: nested background persistence after release acquires ordinary write authority`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-root-timer-"));
    try {
      const store: Store = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore().forRuntime();
      await store.load(); await store.save(state);
      const release = barrier(); let save!: Promise<void>;
      await store.withGoalLease!([], async () => {
        await store.withGoalLease!([], async () => {
          save = release.promise.then(() => store.save({ ...state, ledger: { ordinary: true } }));
        });
      });
      release.open(); await save;
      assert.equal((await store.load())?.ledger.ordinary, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: runtime debounced persistence created in a nested call works after release`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-runtime-timer-"));
    try {
      const backend = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore();
      const rc = await RightClick.create({ store: backend, directories: [], sandbox: null });
      await rc.flush();
      const store: Store = (rc as any).store;
      const original = store.save.bind(store);
      let completed!: (error: unknown) => void, released = false, observedAfterRelease = false;
      const saved = new Promise<unknown>(resolve => { completed = resolve; });
      store.save = async snapshot => {
        observedAfterRelease = released;
        try { await original(snapshot); completed(undefined); }
        catch (error) { completed(error); throw error; }
      };
      await store.withGoalLease!([], async () => {
        await store.withGoalLease!([], async () => { rc.persist(); });
      });
      released = true;
      assert.equal(await saved, undefined);
      assert.equal(observedAfterRelease, true);
      assert.equal(rc.runtime().storage.status, "saved");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: an admitted nested failure cannot silently complete its outer execution`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-lease-failure-"));
    try {
      const store: Store = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore().forRuntime();
      await store.load(); await store.save(state);
      const entered = barrier(), release = barrier(); let effects = 0, nested!: Promise<void>;
      const outer = store.withGoalLease!([], async () => {
        nested = store.withGoalLease!([], async () => { effects++; entered.open(); await release.promise; throw new Error("synthetic nested effect failure"); });
        // Attach a handler now; the caller intentionally does not await nested work.
        void nested.catch(() => {});
        await entered.promise;
      });
      const refused = assert.rejects(outer, /outcome unknown.*nested failure.*do not replay/);
      await entered.promise; release.open();
      await assert.rejects(nested, /synthetic nested effect failure/);
      await refused; assert.equal(effects, 1, "no automatic retry");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test(`${kind}: falsey nested rejection is still an unknown outcome`, { timeout: 10000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcx-lease-falsey-"));
    try {
      const store: Store = kind === "file" ? new FileStore(join(dir, "state.json")) : new ProcessMemoryStore().forRuntime();
      await store.load(); await store.save(state);
      let effects = 0;
      await assert.rejects(store.withGoalLease!([], async () => {
        await store.withGoalLease!([], async () => { effects++; throw undefined; }).catch(() => {});
      }), /outcome unknown.*nested failure.*do not replay/);
      assert.equal(effects, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
