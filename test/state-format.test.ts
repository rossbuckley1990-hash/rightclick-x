import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick, SEMANTICS } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { MemoryStore } from "./helpers.ts";
import { decodeState, encodeState, STATE_FORMAT } from "../src/core/state-format.ts";
import { KvStore } from "../src/entry/edge.ts";
import { DurableStore } from "../src/entry/durable.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";

test("unsupported persisted versions or requirements refuse before execution or overwrite", async () => {
  const seed = new MemoryStore(); const rc = await RightClick.create({ store: seed, sandbox: null, directories: [] });
  await rc.flush();
  for (const change of [
    { version: 99 }, { version: 2 }, { format: "rightclick-x/runtime-state@99" },
    { version: 2, requirements: ["unknown-execution-obligation@9"] },
  ]) {
    const state = { ...structuredClone(seed.state!), ...change };
    if (change.version === 2 && !("requirements" in change)) delete (state as any).requirements;
    let writes = 0, calls = 0;
    await assert.rejects(async () => {
      const current = await RightClick.create({ sandbox: null, directories: [],
        fetch: async () => { calls++; return Response.json({}); },
        store: { load: async () => state as any, save: async () => { writes++; } } });
      await current.flush();
    }, /state|requirement|format/i);
    assert.equal(writes, 0); assert.equal(calls, 0);
  }
});

test("store read errors and corrupt files never become an empty runtime", async () => {
  let writes = 0;
  await assert.rejects(RightClick.create({ sandbox: null, directories: [], store: {
    load: async () => { throw new Error("storage temporarily unavailable"); },
    save: async () => { writes++; },
  } }), /storage temporarily unavailable/);
  assert.equal(writes, 0);
  const dir = await mkdtemp(join(tmpdir(), "rcx-state-invalid-"));
  try {
    const file = join(dir, "state.json");
    for (const bytes of ["{truncated", "null", "[]", '{"version":99}', '{"version":1,"reflections":[]}']) {
      await writeFile(file, bytes);
      await assert.rejects(async () => {
        const current = await RightClick.create({ sandbox: null, directories: [], store: new FileStore(file) });
        await current.flush();
      });
      assert.equal(await readFile(file, "utf8"), bytes);
    }
    await assert.rejects(new FileStore(dir).load());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("inference migration cannot discard retained work with an unknown outcome", async () => {
  const store = new MemoryStore(); const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  await rc.flush();
  for (const field of ["httpContinuations", "workflowContinuations"]) {
    const state = { ...structuredClone(store.state!), semantics: SEMANTICS - 1, [field]: [{ runId: "unfinished" }] };
    let writes = 0;
    await assert.rejects(RightClick.create({ sandbox: null, directories: [], store: {
      load: async () => state, save: async () => { writes++; },
    } }), /continuation|checkpoint|retained/i);
    assert.equal(writes, 0);
  }
});

test("a valid pending HTTP operation blocks inference migration without discarding its checkpoint", async () => {
  const store = new MemoryStore(); let calls = 0;
  const options = { store, sandbox: null, directories: [], httpContinuation: { maxRequests: 1 },
    fetch: async () => { calls++; return new Response(null, { status: 202, headers: { location: "/jobs/j1", "retry-after": "0" } }); } };
  const rc = await RightClick.create(options);
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Pending" }, servers: [{ url: "https://pending.invalid" }],
    paths: {
      "/begin": { post: { operationId: "begin", responses: { "202": { description: "Accepted" } } } },
      "/jobs/{id}": { get: { operationId: "job", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "202": { description: "Waiting" } } } },
    } }, "https://pending.invalid/spec"));
  const pending = await rc.run("openapi:pending:begin");
  assert.equal(pending.status, "pending"); await rc.flush();
  assert.equal(store.state!.httpContinuations!.length, 1);
  const requirements = store.state!.requirements!;
  store.state!.requirements = requirements.filter(r => r !== "declared-continuation-contracts@1");
  const olderDigest = structuredClone(store.state), oldCount = calls;
  await assert.rejects(RightClick.create(options), /unsupported retained HTTP contract digest/);
  assert.equal(calls, oldCount);
  assert.deepEqual(store.state, olderDigest);
  store.state!.requirements = requirements;
  store.state!.semantics = SEMANTICS - 1;
  const before = structuredClone(store.state); const count = calls;
  await assert.rejects(RightClick.create(options), /cannot migrate inference with retained HTTP/);
  assert.equal(calls, count);
  assert.deepEqual(store.state, before);
  store.state!.semantics = SEMANTICS;
  const restored = await RightClick.create(options);
  assert.equal((restored.runStatus({ runId: pending.runId }) as any).status, "pending");
  await restored.flush();
});

test("legacy state migrates without discovery and the envelope retains a reusable capability", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-state-upgrade-"));
  try {
    const memory = new MemoryStore(); const seed = await RightClick.create({ store: memory, sandbox: null, directories: [] });
    const initial = await seed.compose({ have: { text: { type: "text", value: "first" } }, want: "hash",
      through: ["builtin:text.sha256"], run: true, publish: "Retained hash", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] });
    assert.equal(initial.executed?.status, "completed");
    await seed.flush();
    const legacy = { ...memory.state!, version: 1 as const }; delete legacy.requirements;
    const file = join(dir, "state.json"); await writeFile(file, JSON.stringify(legacy));
    let requests = 0;
    const fresh = await RightClick.create({ store: new FileStore(file), sandbox: null, directories: [],
      fetch: async () => { requests++; throw new Error("unexpected discovery"); } });
    const run = await fresh.run("goal:retained-hash", { text: "different input" });
    assert.equal(run.status, "completed"); assert.equal(run.verification.status, "checked");
    assert.notEqual(run.output, initial.executed!.output); assert.equal(requests, 0);
    await fresh.flush();
    const envelope = JSON.parse(await readFile(file, "utf8"));
    assert.equal(envelope.format, STATE_FORMAT);
    assert.equal(Array.isArray(envelope.reflections), false);
    assert.equal(envelope.state.version, 2);
    assert.deepEqual(decodeState(envelope), await new FileStore(file).load());
    await assert.rejects(new FileStore(file).save(legacy), /legacy.*read-only/);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), envelope);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("built-in KV and chunked adapters use the same legacy-refusing state encoding", async () => {
  const memory = new MemoryStore(); const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.flush();
  memory.state!.ledger.large = { text: "retained".repeat(40_000) };
  const kv = new Map<string, string>();
  const keyValue = new KvStore({ get: async (key: string) => kv.get(key) ?? null,
    put: async (key: string, value: string) => { kv.set(key, value); } });
  await keyValue.save(memory.state!);
  assert.deepEqual(await keyValue.load(), memory.state);
  assert.equal(JSON.parse(kv.get("rcx-state")!).format, STATE_FORMAT);
  kv.set("rcx-state", "null");
  await assert.rejects(keyValue.load(), /invalid runtime state/);
  const chunks = new Map<string, any>();
  const durable = new DurableStore({
    get: async (key: string | string[]) => Array.isArray(key) ? new Map(key.map(k => [k, chunks.get(k)])) : chunks.get(key),
    put: async (key: string | object, value?: unknown) => {
      if (typeof key === "string") chunks.set(key, value);
      else for (const [k, v] of Object.entries(key)) chunks.set(k, v);
    },
    delete: async (keys: string[]) => { for (const k of keys) chunks.delete(k); },
    list: async ({ prefix }: { prefix: string }) => new Map([...chunks].filter(([k]) => k.startsWith(prefix))),
  });
  await durable.save(memory.state!);
  assert.ok(chunks.get("state:meta").chunks > 1);
  assert.deepEqual(await durable.load(), memory.state);
  // Chunks belong to the manifest's generation (see test/durable-store.test.ts for the layout).
  const { chunks: count, generation } = chunks.get("state:meta");
  const envelope = JSON.parse(Array.from({ length: count }, (_, i) => chunks.get(`state:${generation}:${i}`)).join(""));
  assert.equal(envelope.format, STATE_FORMAT);
  chunks.delete(`state:${generation}:1`);
  await assert.rejects(durable.load());
});

test("envelope integrity and unknown operation kinds refuse instead of partial restoration", async () => {
  const store = new MemoryStore(); const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  await rc.flush();
  const encoded = JSON.parse(encodeState(store.state!));
  for (const changed of [{ ...encoded, reflections: [] }, { ...encoded, format: STATE_FORMAT + "-future" },
    { ...encoded, state: { ...encoded.state, requirements: ["future@1"] } }]) {
    assert.throws(() => decodeState(changed), /state/);
  }
  const state = structuredClone(store.state!);
  state.reflections.push({ provider: {} as any, capabilities: [{ inputs: [], outputs: [], invoke: { kind: "future-effect" } } as any] });
  await assert.rejects(RightClick.create({ store: { load: async () => state, save: async () => { throw new Error("must not write"); } },
    sandbox: null, directories: [] }), /unsupported runtime state capability/);
});
