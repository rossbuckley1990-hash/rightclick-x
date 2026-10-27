// Workers KV is a read-only state source (#12 part 4). KV is eventually consistent (changes can
// take 60 s or more to reach other locations), allows one write per second per key, and has no
// atomic operations; the edge Worker it backs runs as many isolates. It cannot give state one
// writer, so the runtime never writes it. Cloudflare's documented pattern is to route writes
// through one Durable Object (src/entry/durable.ts); KV can hold a state seeded from there or by
// the operator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type PersistedState } from "../src/runtime.ts";
import { KvStore } from "../src/entry/edge.ts";
import { encodeState } from "../src/core/state-format.ts";
import { MemoryStore } from "./helpers.ts";

function kv(seed?: string) {
  const data = new Map<string, string>(seed ? [["rcx-state", seed]] : []);
  const writes: string[] = [];
  return {
    data, writes,
    api: {
      get: async (key: string) => data.get(key) ?? null,
      getWithMetadata: async (key: string) => ({ value: data.get(key) ?? null, metadata: null }),
      put: async (key: string, value: string) => { writes.push(key); data.set(key, value); },
    },
  };
}

async function saved(label: string): Promise<PersistedState> {
  const memory = new MemoryStore();
  const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.compose({ have: { text: { type: "text", value: label } }, want: "hash", through: ["builtin:text.sha256"], run: true, publish: `Digest ${label}` });
  await rc.flush();
  return structuredClone(memory.state!);
}

test("a runtime on KV state loads it and never writes KV, whatever it does", async () => {
  const seeded = await saved("seeded");
  const k = kv(encodeState(seeded));
  const rc = await RightClick.create({ store: new KvStore(k.api), sandbox: null, directories: [] });
  assert.ok(rc.graph.get("goal:digest-seeded"), "the seeded saved goal did not load");
  const result = await rc.run("goal:digest-seeded", { text: "again" });
  assert.notEqual(result.status, "completed", "eventually consistent KV cannot authorize goal execution");
  assert.match(JSON.stringify(result), /authoritative lease-capable store/);
  const pub = await rc.compose({ have: { text: { type: "text", value: "new" } }, want: "hash", through: ["builtin:text.sha256"], run: true, publish: "New digest" });
  await rc.flush().catch(() => {});
  await new Promise((done) => setTimeout(done, 100)); // any debounced save would have run by now
  assert.deepEqual(k.writes, [], "the runtime wrote Workers KV");
  assert.equal(pub.published?.durable, false, "a goal on read-only KV was reported as saved");
  assert.match(pub.published?.persistence ?? "", /read-only.*Durable Object/);
  const storage = (rc.runtime() as any).storage;
  assert.equal(storage.status, "read-only");
  assert.match(storage.detail, /Durable Object/);
});

test("a legacy KV state loads without being migrated in place", async () => {
  const legacy: Record<string, any> = { ...(await saved("legacy")), version: 1, semantics: 13 };
  delete legacy.requirements;
  const text = JSON.stringify(legacy);
  const k = kv(text);
  const rc = await RightClick.create({ store: new KvStore(k.api), sandbox: null, directories: [] });
  await rc.flush().catch(() => {});
  assert.ok(rc.graph.get("goal:digest-legacy"));
  assert.deepEqual(k.writes, []);
  assert.equal(k.data.get("rcx-state"), text, "the KV value changed");
});

test("the KV adapter refuses a direct save rather than accepting it silently", async () => {
  const k = kv();
  await assert.rejects(new KvStore(k.api).save(await saved("direct")), /read-only/);
  assert.deepEqual(k.writes, []);
});
