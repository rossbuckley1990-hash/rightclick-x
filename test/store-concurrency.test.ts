import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileStore } from "../src/entry/node-host.ts";
import type { PersistedState } from "../src/runtime.ts";
import { FILE_STORE_CAS_REQUIREMENT, STATE_REQUIREMENTS } from "../src/core/state-format.ts";

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
    await other.load();
    const independent = await Promise.allSettled([store.save(snapshot(64)), other.save(snapshot(65))]);
    assert.equal(independent.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(independent.filter(r => r.status === "rejected").length, 1);
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

test("separate processes cannot both replace one observed state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-store-process-cas-"));
  const file = join(dir, "state.json");
  const childPath = fileURLToPath(new URL("./fixtures/state-cas-child.ts", import.meta.url));
  try {
    const initial = new FileStore(file);
    await initial.save(snapshot(0));
    const children = ["a", "b"].map(marker => fork(childPath, [file, marker], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
    try {
      const loaded = children.map(child => new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("message", (message: any) => message.event === "loaded" ? resolve() : reject(new Error("unexpected child message")));
      }));
      await Promise.all(loaded);
      const results = children.map(child => new Promise<any>((resolve, reject) => {
        child.once("error", reject);
        child.once("message", resolve);
      }));
      for (const child of children) child.send("save");
      const observed = await Promise.all(results);
      assert.equal(observed.filter(r => r.event === "saved").length, 1);
      assert.equal(observed.filter(r => r.event === "refused" && /state conflict/i.test(r.message)).length, 1);
      assert.ok(["a", "b"].includes((await new FileStore(file).load())?.ledger.marker));
    } finally { for (const child of children) if (child.connected) child.kill(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an unobserved file or abandoned lock fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-store-fail-closed-"));
  const file = join(dir, "state.json");
  try {
    await new FileStore(file).save(snapshot(1));
    const unobserved = new FileStore(file);
    await assert.rejects(unobserved.save(snapshot(2)), /state conflict/);
    assert.ok((await unobserved.load())?.requirements?.includes(FILE_STORE_CAS_REQUIREMENT));
    await mkdir(`${file}.lock`);
    await assert.rejects(unobserved.save(snapshot(3)), /state conflict/);
    assert.equal((await new FileStore(file).load())?.ledger.marker.index, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
