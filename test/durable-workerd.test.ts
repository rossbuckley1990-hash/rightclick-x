// DurableStore on workerd's own Durable Object storage (SQLite-backed, as deploy/cloud.ts
// configures), not an in-memory model: interruption, restart, legacy migration and concurrent
// requests. Runs locally through wrangler's unstable_dev; nothing is deployed and no account is used.
//
// What this cannot show: production limits that local workerd does not enforce. It accepted a
// 200 KB value on a key-value-backed class, where production documents 128 KiB; chunk sizing is
// therefore checked against the documented limit in test/durable-store.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RightClick, type PersistedState } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";

const HARNESS = fileURLToPath(new URL("./fixtures/durable-harness/", import.meta.url));

async function start(persistTo: string) {
  const { unstable_dev } = await import("wrangler");
  return unstable_dev(join(HARNESS, "worker.ts"), {
    config: join(HARNESS, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    experimental: { disableExperimentalWarning: true },
  });
}

async function state(label: string, size = 150_000): Promise<PersistedState> {
  const memory = new MemoryStore();
  const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.flush();
  memory.state!.ledger.large = { label, text: "x".repeat(size) };
  return structuredClone(memory.state!);
}

type Worker = Awaited<ReturnType<typeof start>>;
const call = async (w: Worker, path: string, body?: unknown, raw = false) =>
  (await (await w.fetch(`http://harness${path}`, body === undefined ? undefined : { method: "POST", body: raw ? String(body) : JSON.stringify(body) })).json()) as any;

test("workerd: an interrupted save keeps the previous state, which survives a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-workerd-"));
  try {
    const a = await state("A"), b = await state("B", 250_000), c = await state("C");
    let w = await start(dir);
    try {
      assert.equal((await call(w, "/save", a)).ok, true);
      const failed = await call(w, "/save?fail=state:meta", b);
      assert.equal(failed.ok, false, "an interrupted save was reported as stored");
      assert.match(failed.error, /injected storage failure/);
      assert.deepEqual((await call(w, "/load?fresh")).state, a, "the interrupted save damaged the previous state");
    } finally { await w.stop(); }
    w = await start(dir);
    try {
      assert.deepEqual((await call(w, "/load?fresh")).state, a, "the state did not survive a restart");
      assert.equal((await call(w, "/save", c)).ok, true);
      assert.deepEqual((await call(w, "/load?fresh")).state, c);
      const { meta } = await call(w, "/meta");
      const expected = ["state:meta", ...Array.from({ length: meta.chunks }, (_, i) => `state:${meta.generation}:${i}`)].sort();
      assert.deepEqual((await call(w, "/keys")).keys, expected, "orphaned chunks remain after a restart and a save");
    } finally { await w.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("workerd: a save interrupted between chunk batches keeps the previous state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-workerd-"));
  const w = await start(dir);
  try {
    const a = await state("A");
    await call(w, "/save", a);
    const failed = await call(w, "/save?fail=batch2", await state("big", 6_500_000)); // > 100 chunks of 60,000
    assert.equal(failed.ok, false);
    assert.deepEqual((await call(w, "/load?fresh")).state, a);
  } finally { await w.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("workerd: migrating the previous release's layout keeps it as the backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-workerd-"));
  const w = await start(dir);
  try {
    const legacy: Record<string, any> = { ...(await state("legacy")), version: 1, semantics: 13 };
    delete legacy.requirements;
    const text = JSON.stringify(legacy);
    await call(w, "/legacy", text, true);
    assert.equal((await call(w, "/load")).state.version, 1);
    assert.equal((await call(w, "/save", await state("migrated"))).ok, true);
    const { meta } = await call(w, "/meta");
    assert.equal(meta.backup?.replaced, "v1");
    assert.equal((await call(w, `/read?chunks=${meta.backup.chunks}`)).text, text, "the backup is not the original bytes");
  } finally { await w.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("workerd: concurrent requests leave one consistent state and no stray chunks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-workerd-"));
  const w = await start(dir);
  try {
    const states = await Promise.all(Array.from({ length: 6 }, (_, i) => state(`concurrent-${i}`, 120_000 + i * 30_000)));
    const results = await Promise.all(states.map((s) => call(w, "/save", s)));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    const loaded = (await call(w, "/load?fresh")).state;
    assert.ok(states.some((s) => JSON.stringify(s) === JSON.stringify(loaded)), "the stored state is a mixture of concurrent saves");
    const { meta } = await call(w, "/meta");
    assert.equal((await call(w, "/keys")).keys.length, meta.chunks + 1, "stray chunks remain after concurrent saves");
  } finally { await w.stop(); rmSync(dir, { recursive: true, force: true }); }
});
