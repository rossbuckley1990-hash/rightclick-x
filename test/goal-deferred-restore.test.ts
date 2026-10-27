import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, SEMANTICS, type OperatorAuthority } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";

const producer = "https://producer.test", witness = "https://witness.test";
const spec = (origin: string, changedWitness = false) => ({
  openapi: "3.0.0", info: { title: origin === producer ? "Producer" : "Witness", version: "1" }, servers: [{ url: origin }],
  paths: origin === producer ? { "/item/{id}": { get: { operationId: "getItem", summary: "Get item",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } } } } } }
    : { [changedWitness ? "/changed-check" : "/check"]: { get: { operationId: "checkItem", summary: "Check item independently",
    parameters: ["id", "text"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } } },
});

async function fixture(authority?: OperatorAuthority) {
  const store = new MemoryStore(), observed: string[] = [], urls: string[] = [];
  let changedWitness = false, onProducer: (() => Promise<void>) | undefined, onContract: (() => Promise<void>) | undefined;
  const fetcher: typeof fetch = async input => {
    const u = new URL(String(input)); urls.push(u.href); observed.push(`${u.origin}${u.pathname}`);
    if (u.pathname === "/openapi.json") { await onContract?.(); return Response.json(spec(u.origin, changedWitness)); }
    if (u.origin === producer && u.pathname.startsWith("/item/")) {
      await onProducer?.(); return Response.json({ text: `item:${u.pathname.split("/").pop()}` });
    }
    if (u.origin === witness && u.pathname === "/check") return Response.json({ valid: u.searchParams.get("text") === `item:${u.searchParams.get("id")}` });
    throw new Error(`unexpected fixture request ${u.pathname}`);
  };
  const options = { store, directories: [], fetch: fetcher, network: { blockPrivate: true, origins: [producer, witness] } };
  const creator = await RightClick.create(options);
  await creator.learn({ sources: [`${producer}/openapi.json`, `${witness}/openapi.json`] });
  const item = creator.graph.list().find(c => c.title === "Get item")!.id;
  const check = creator.graph.list().find(c => c.title === "Check item independently")!.id;
  const result = await creator.compose({ have: { id: { type: "text", value: "a" } }, want: "json", through: [item], run: true,
    publish: "Item lookup", witnesses: [{ capability: check, args: { id: { input: "id" }, text: { output: "text" } },
      verify: [{ op: "equals", path: "valid", value: true }] }] });
  assert.equal(result.executed?.verification.status, "verified");
  await creator.flush();
  store.state!.semantics = SEMANTICS - 1;
  observed.length = 0; urls.length = 0;
  const fresh = await RightClick.create({ ...options, authority });
  return { fresh, store, observed, urls, item, check, changeWitness: () => { changedWitness = true; },
    gateProducer: (gate: () => Promise<void>) => { onProducer = gate; }, gateContract: (gate: () => Promise<void>) => { onContract = gate; } };
}

test("a deferred producer and pinned witness re-derive under the saved-goal lease", async () => {
  const f = await fixture();
  assert.equal(f.fresh.graph.get(f.item), undefined);
  const result = await f.fresh.run("goal:item-lookup", { id: "b" });
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.verification.status, "verified");
  assert.deepEqual(result.output, { text: "item:b" });
  assert.ok(f.observed.includes(`${producer}/openapi.json`));
  assert.ok(f.observed.includes(`${witness}/openapi.json`));
  assert.ok(f.observed.includes(`${witness}/check`));
  assert.ok(f.urls.filter(url => url.includes("/openapi.json")).every(url => !url.includes("?")), "contract discovery does not send caller inputs");
});

for (const mode of ["stale", "revoked", "denied"] as const) test(`${mode} saved-goal authority refuses before deferred discovery`, async () => {
  const f = await fixture(mode === "denied" ? { execution: { deniedCapabilities: ["goal:item-lookup"] } } : undefined);
  if (mode === "stale") f.store.state!.published![0].revision = "different-version";
  if (mode === "revoked") f.store.state!.published = [];
  const result = await f.fresh.run("goal:item-lookup", { id: "caller-input-not-for-discovery" });
  assert.notEqual(result.status, "completed");
  assert.equal(f.urls.length, 0, "neither contract discovery nor execution is authorized after refusal");
});

test("a changed deferred witness contract refuses before the producer is called", async () => {
  const f = await fixture(); f.changeWitness();
  const result = await f.fresh.run("goal:item-lookup", { id: "b" });
  assert.notEqual(result.status, "completed");
  assert.notEqual(result.verification.status, "verified");
  assert.ok(!f.observed.includes(`${producer}/item/b`), "a changed saved witness must fail before the producer effect");
});

test("public re-learning cannot replace a witness while the restored goal is running", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.gateProducer(async () => { entered(); await wait; });
  const invocation = f.fresh.run("goal:item-lookup", { id: "b" });
  await ready;
  f.changeWitness();
  await assert.rejects(f.fresh.learn({ source: `${witness}/openapi.json` }), /blocked while a saved goal is executing/);
  release();
  const result = await invocation;
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.verification.status, "verified");
  assert.ok(f.observed.includes(`${witness}/check`));
});

test("the restore lease excludes concurrent public learning and cooperative revocation", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.gateContract(async () => { entered(); await wait; });
  const invocation = f.fresh.run("goal:item-lookup", { id: "b" });
  await ready;
  await assert.rejects(f.fresh.learn({ source: `${witness}/openapi.json` }), /blocked while a saved goal is executing/);
  const changed = await f.store.load(); assert.ok(changed); changed.published = [];
  await assert.rejects(f.store.save(changed), /state conflict/);
  release();
  const result = await invocation;
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.verification.status, "verified");
});
