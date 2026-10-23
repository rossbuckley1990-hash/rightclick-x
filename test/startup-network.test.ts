// What each entrypoint asks of the network when it starts (docs/STARTUP-NETWORK.md). Restoring
// state contacts nothing; the only startup requests are the ones an entrypoint makes on purpose,
// and none of them can hold startup indefinitely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type PersistedState } from "../src/runtime.ts";
import { encodeState } from "../src/core/state-format.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";

/** A state an older build left: one network provider, so a naive restore would re-learn it. */
async function staleState(): Promise<PersistedState> {
  const memory = new MemoryStore();
  const rc = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  await rc.learn({ spec: reflectOpenAPI({ openapi: "3.0.0", info: { title: "Items", version: "1" }, servers: [{ url: "https://items.example" }],
    paths: { "/items/{id}": { get: { operationId: "getItem", summary: "Get an item", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } } }, "https://items.example/openapi.json") });
  await rc.flush();
  const state = structuredClone(memory.state!);
  state.reflections.forEach((r) => (r.provider.meta = { ...r.provider.meta, source: "https://items.example/openapi.json" }));
  return { ...state, semantics: 1 };
}

/** Replace the global fetch for one test, recording every request. `hang` never answers unless aborted. */
function spyFetch(hang = false) {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(input instanceof Request ? input.url : input));
    if (!hang) return Promise.resolve(new Response("{}", { status: 404 }));
    return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("restoring state contacts no network source, even with an environment catalog configured", async () => {
  const store = new MemoryStore();
  store.state = await staleState();
  const spy = spyFetch();
  try {
    await RightClick.create({ store, sandbox: null, directories: [],
      environment: { catalogs: ["https://catalog.example/.well-known/api-catalog"], origins: ["https://catalog.example"] } });
    assert.deepEqual(spy.requests, [], "startup made network requests");
  } finally { spy.restore(); }
});

test("an edge Worker cold start contacts nothing unless RCX_SOURCES names sources to learn", async () => {
  const { default: edge } = await import("../src/entry/edge.ts");
  const state = encodeState(await staleState());
  const kv = { get: async (k: string) => (k === "rcx-state" ? state : null), put: async () => {}, list: async () => ({ keys: [] }) };
  const spy = spyFetch();
  try {
    const res = await edge.fetch(new Request("https://edge.test/api/runtime", { method: "POST", headers: { authorization: "Bearer t" } }), { RCX_TOKEN: "t", RCX_STATE: kv });
    assert.equal(res.status, 200);
    assert.deepEqual(spy.requests, [], "a Worker cold start made network requests");
  } finally { spy.restore(); }
});

test("a Durable Object starts promptly when the trace endpoint never answers", { timeout: 15_000 }, async () => {
  const { RightClickInstance } = await import("../src/entry/durable.ts");
  const data = new Map<string, unknown>();
  const storage = {
    get: async (k: string | string[]) => Array.isArray(k) ? new Map(k.filter((x) => data.has(x)).map((x) => [x, data.get(x)])) : data.get(k),
    put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === "string") data.set(k, v); else for (const [x, y] of Object.entries(k)) data.set(x, y); },
    delete: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) data.delete(x); return true; },
  };
  const spy = spyFetch(true);
  try {
    const instance = new RightClickInstance({ storage }, { RCX_TOKEN: "t", RCX_LOCATION: "weur" });
    const t0 = Date.now();
    const res = await instance.fetch(new Request("https://do.test/api/runtime", { method: "POST", headers: { authorization: "Bearer t" } }));
    assert.equal(res.status, 200);
    assert.ok(Date.now() - t0 < 10_000, `the Durable Object waited ${Date.now() - t0} ms for the trace endpoint`);
    assert.deepEqual(spy.requests, ["https://cloudflare.com/cdn-cgi/trace"], "the only startup request is the location trace");
  } finally { spy.restore(); }
});
