// Durable Object state is stored in chunks behind a manifest. A save that is interrupted (an
// eviction, a storage error, an exceeded limit) must leave the previous state loadable, and a
// save that migrates the state must keep what it replaced (#12 part 3).
//
// Reproduced 2026-10-23 against 161917e: chunks were written over the previous state's keys
// before the manifest, so a save that failed at the manifest left neither the old state nor the
// new one readable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type PersistedState } from "../src/runtime.ts";
import { DurableStore } from "../src/entry/durable.ts";
import { decodeState } from "../src/core/state-format.ts";
import { MemoryStore } from "./helpers.ts";

/** Durable Object storage in memory, with one injectable fault. */
function storage(fail?: (key: string) => boolean) {
  const data = new Map<string, any>();
  const check = (key: string) => { if (fail?.(key)) throw new Error(`injected storage failure at ${key}`); };
  return {
    data,
    fail: (f?: (key: string) => boolean) => { fail = f; },
    api: {
      get: async (key: string | string[]) => Array.isArray(key) ? new Map(key.filter(k => data.has(k)).map(k => [k, data.get(k)])) : data.get(key),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        const entries = typeof key === "string" ? [[key, value] as const] : Object.entries(key);
        for (const [k] of entries) check(k);
        for (const [k, v] of entries) data.set(k, structuredClone(v));
      },
      delete: async (key: string | string[]) => { for (const k of Array.isArray(key) ? key : [key]) data.delete(k); return true; },
      list: async (opts: { prefix?: string } = {}) => new Map([...data].filter(([k]) => !opts.prefix || k.startsWith(opts.prefix))),
    },
  };
}

/** The DurableStore reader as released at 161917e, kept to check what an older deployment does. */
async function frozenReader(api: any): Promise<unknown> {
  const meta = await api.get("state:meta");
  if (!meta) return null;
  if (!Number.isSafeInteger(meta.chunks) || meta.chunks <= 0) throw new Error("invalid runtime state chunk manifest");
  let text = "";
  for (let i = 0; i < meta.chunks; i += 100) {
    const keys = Array.from({ length: Math.min(100, meta.chunks - i) }, (_, k) => `state:${i + k}`);
    const got: Map<string, string> = await api.get(keys);
    for (const k of keys) {
      const part = got.get(k);
      if (typeof part !== "string" || !part.length || part.length > 100_000) throw new Error(`missing or invalid runtime state chunk: ${k}`);
      text += part;
    }
  }
  return decodeState(JSON.parse(text));
}

async function state(label: string, size: number): Promise<PersistedState> {
  const memory = new MemoryStore();
  const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.flush();
  memory.state!.ledger.large = { label, text: "x".repeat(size) };
  return structuredClone(memory.state!);
}

test("a save interrupted before its manifest leaves the previous state loadable", async () => {
  const s = storage();
  const before = await state("before", 250_000);   // 3 chunks
  const after = await state("after", 450_000);     // 5 chunks
  await new DurableStore(s.api).save(before);
  s.fail((key) => key === "state:meta");
  await assert.rejects(new DurableStore(s.api).save(after), /injected storage failure/);
  s.fail(undefined);
  assert.deepEqual(await new DurableStore(s.api).load(), before, "an interrupted save destroyed the previous state");
});

test("a save interrupted between chunk batches leaves the previous state loadable", async () => {
  // Each storage put of up to 100 chunks is atomic; an interruption between two of them is not.
  const s = storage();
  const before = await state("before", 250_000);
  await new DurableStore(s.api).save(before);
  s.fail((key) => key !== "state:meta" && Number(key.split(":").pop()) >= 100);
  await assert.rejects(new DurableStore(s.api).save(await state("after", 10_600_000)));
  s.fail(undefined);
  assert.deepEqual(await new DurableStore(s.api).load(), before);
});

test("superseded and orphaned chunk generations are removed once a save completes", async () => {
  const s = storage();
  await new DurableStore(s.api).save(await state("one", 250_000));
  s.fail((key) => key === "state:meta");
  await assert.rejects(new DurableStore(s.api).save(await state("orphan", 250_000)));
  s.fail(undefined);
  const latest = await state("two", 150_000);
  await new DurableStore(s.api).save(latest);
  const meta = s.data.get("state:meta");
  const chunkKeys = [...s.data.keys()].filter((k) => k !== "state:meta").sort();
  assert.equal(chunkKeys.length, meta.chunks, `stale chunks remain: ${chunkKeys.join(", ")}`);
  assert.deepEqual(await new DurableStore(s.api).load(), latest);
});

test("the legacy chunk layout loads, and migrating it keeps the original as the backup", async () => {
  const s = storage();
  const legacy: Record<string, any> = { ...(await state("legacy", 150_000)), version: 1, semantics: 13 };
  delete legacy.requirements;
  const text = JSON.stringify(legacy);
  const parts = Math.ceil(text.length / 100_000);
  for (let i = 0; i < parts; i++) s.data.set(`state:${i}`, text.slice(i * 100_000, (i + 1) * 100_000));
  s.data.set("state:meta", { chunks: parts });
  const store = new DurableStore(s.api);
  const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  await rc.flush();
  const meta = s.data.get("state:meta");
  assert.equal(meta.backup?.replaced, "v1");
  const kept = Array.from({ length: meta.backup.chunks }, (_, i) => s.data.get(`state:${i}`)).join("");
  assert.equal(kept, text, "the backup is not the original");
  assert.equal(decodeState(JSON.parse(kept)).version, 1);
});

test("an older reader refuses the new layout instead of reading a partial or mixed state", async () => {
  const s = storage();
  await new DurableStore(s.api).save(await state("current", 250_000));
  await assert.rejects(frozenReader(s.api), /missing or invalid runtime state chunk/);
});
