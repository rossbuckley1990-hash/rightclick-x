// Workers KV is eventually consistent and last-writer-wins, and the edge entry persists one state
// across many isolates (#12 part 4). Two isolates that loaded the same state each save: the second
// save replaced the first's work, and nothing kept it.
//
// KV has no compare-and-swap, so the second save still wins. What changes is that a save which
// would replace a state this isolate neither loaded nor wrote keeps that state first, under a key
// that expires after a bounded time, and reports it. A concurrent write not yet visible to this
// isolate cannot be detected; DurableStore is the consistent option for concurrent writers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type PersistedState } from "../src/runtime.ts";
import { KvStore } from "../src/entry/edge.ts";
import { MemoryStore } from "./helpers.ts";

/** Workers KV in memory: text values with metadata and an optional expiration. */
function kv() {
  const data = new Map<string, { value: string; metadata?: unknown; expirationTtl?: number }>();
  return {
    data,
    api: {
      get: async (key: string) => data.get(key)?.value ?? null,
      getWithMetadata: async (key: string) => ({ value: data.get(key)?.value ?? null, metadata: data.get(key)?.metadata ?? null }),
      put: async (key: string, value: string, opts: { metadata?: unknown; expirationTtl?: number } = {}) => {
        data.set(key, { value, metadata: opts.metadata, expirationTtl: opts.expirationTtl });
      },
    },
  };
}

async function state(label: string): Promise<PersistedState> {
  const memory = new MemoryStore();
  const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.flush();
  memory.state!.ledger.mark = { label };
  return structuredClone(memory.state!);
}

test("a save that would replace another isolate's state keeps it, bounded in time, and reports it", async () => {
  const k = kv();
  await new KvStore(k.api).save(await state("initial"));
  const reported: string[] = [];
  const a = new KvStore(k.api), b = new KvStore(k.api, { onSuperseded: (key) => reported.push(key) });
  await a.load(); await b.load();
  await a.save(await state("from A"));
  await b.save(await state("from B"));
  const kept = [...k.data.keys()].filter((key) => key.startsWith("rcx-state.superseded-"));
  assert.equal(kept.length, 1, `isolate A's state was not kept: ${[...k.data.keys()].join(", ")}`);
  assert.equal(JSON.parse(k.data.get(kept[0])!.value).state.ledger.mark.label, "from A");
  assert.ok((k.data.get(kept[0])!.expirationTtl ?? 0) > 0, "a superseded copy must not be kept forever");
  assert.deepEqual(reported, kept);
  assert.equal(JSON.parse(k.data.get("rcx-state")!.value).state.ledger.mark.label, "from B");
});

test("an isolate's own consecutive saves keep nothing extra", async () => {
  const k = kv();
  const store = new KvStore(k.api);
  await store.save(await state("one"));
  await store.save(await state("two"));
  await store.save(await state("three"));
  assert.deepEqual([...k.data.keys()], ["rcx-state"]);
});

test("a state written by another isolate after this one started empty is kept, not destroyed", async () => {
  const k = kv();
  const late = new KvStore(k.api);
  assert.equal(await late.load(), null);
  await new KvStore(k.api).save(await state("other isolate"));
  await late.save(await state("late"));
  const kept = [...k.data.keys()].filter((key) => key.startsWith("rcx-state.superseded-"));
  assert.equal(kept.length, 1);
  assert.equal(JSON.parse(k.data.get(kept[0])!.value).state.ledger.mark.label, "other isolate");
});

test("a KV binding without metadata reads makes no spurious copies", async () => {
  const k = kv();
  const { getWithMetadata: _, ...plain } = k.api;
  const store = new KvStore(plain);
  await store.save(await state("one"));
  await store.save(await state("two"));
  assert.deepEqual([...k.data.keys()], ["rcx-state"]);
});
