import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";
import { decodeState, CONTRACT_LINK_REQUIREMENT } from "../src/core/state-format.ts";
import { signature } from "../src/core/graph.ts";
import { pointerValue } from "../src/core/links.ts";

const catalog = "https://environment.test/catalog", origin = "https://records.test";
const response = (schema: unknown) => ({ description: "OK", content: { "application/json": { schema } } });
function contract(title = "Records", escaped = false): any {
  const key = escaped ? "access/key~value" : "handle";
  return { openapi: "3.1.0", info: { title, version: "1" }, servers: [{ url: origin }], paths: {
    "/find": { get: { operationId: "find", parameters: [{ name: "query", in: "query", required: true, schema: { type: "string" } }],
      responses: { "200": { ...response({ type: "object", properties: { envelope: { type: "object", properties: {
        nested: { type: "object", properties: { [key]: { type: "string" } } },
      } } } }), links: { detail: { operationId: "detail", parameters: { "path.artifact_id": `$response.body#/envelope/nested/${escaped ? "access~1key~0value" : key}` } } } } } } },
    "/objects/{artifact_id}": { get: { operationId: "detail", parameters: [{ name: "artifact_id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": response({ type: "object", properties: { digest: { type: "string" } } }) } } },
  } };
}
function fixture(escaped = false) {
  const state = { spec: contract(escaped ? "Archive" : "Records", escaped), key: escaped ? "access/key~value" : "handle", advertised: true, status: 200, missing: false, wrongType: false, asynchronous: false, monitor200: false,
    calls: [] as string[], records: new Map<string, string>() };
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url); state.calls.push(`${req.method} ${req.url}`);
    if (req.url === catalog) return Response.json({ linkset: [{ "service-desc": state.advertised ? [{ href: origin + "/spec" }] : [] }] });
    if (url.pathname === "/spec") return Response.json(state.spec);
    if (url.pathname === "/find") {
      const query = url.searchParams.get("query")!;
      const handle = `record-${state.records.size + 1}`; state.records.set(handle, query);
      return Response.json({ envelope: { nested: state.missing ? {} : { [state.key]: state.wrongType ? 123 : handle, revision: "v1" } } }, { status: state.status });
    }
    if (url.pathname.startsWith("/objects/")) {
      if (state.asynchronous) return new Response(null, { status: 202, headers: { location: `/jobs/${url.pathname.slice(9)}`, "retry-after": "0" } });
      const value = state.records.get(decodeURIComponent(url.pathname.slice(9)));
      assert.notEqual(value, undefined, "consumer must receive the exact provider-issued identifier");
      return Response.json({ digest: createHash("sha256").update(value!).digest("hex") });
    }
    if (url.pathname.startsWith("/jobs/")) return state.monitor200 ? Response.json({ status: "complete" }) :
      new Response(null, { status: 303, headers: { location: `/results/${url.pathname.slice(6)}` } });
    if (url.pathname.startsWith("/results/")) return Response.json({ digest: createHash("sha256").update(state.records.get(url.pathname.slice(9))!).digest("hex") });
    return new Response(null, { status: 404 });
  };
  const create = (store?: MemoryStore, extra: any = {}) => RightClick.create({ fetch: fetcher, store, sandbox: null, directories: [],
    environment: { catalogs: [catalog], origins: [origin] },
    authority: { execution: { allowedRisks: ["read"], allowedOrigins: [origin, new URL(catalog).origin] } }, ...extra });
  return { state, create, fetcher };
}

test("environment discovery retains explicit operation relationships without changing nominal types", async () => {
  const { create } = fixture(); const rc = await create(); await rc.research();
  const source = rc.graph.get("openapi:records:find")!;
  assert.equal((source as any).links?.[0]?.target, "openapi:records:detail");
  assert.ok(rc.graph.neighbors(source.id).downstream.includes("openapi:records:detail"));
  assert.ok(!source.outputs.some(p => p.type === "id.artifact"), "a directed relationship does not assert a global identifier equivalence");
});

for (const escaped of [false, true]) test(`declared nested link closes a cold dataflow gap and survives reuse (escaped=${escaped})`, async () => {
  const { create, state } = fixture(escaped); const store = new MemoryStore(); const rc = await create(store);
  await rc.research(); const before = state.calls.length;
  const built = await rc.compose({ have: { query: { type: "text", value: "alpha" } }, want: "json", require: ["digest"],
    run: true, publish: "Resolve record", verify: [{ op: "type", path: "digest", value: "string" }] });
  assert.equal(built.executed?.status, "completed", JSON.stringify(built));
  assert.deepEqual(built.executed?.output, { digest: createHash("sha256").update("alpha").digest("hex") });
  assert.equal(state.calls.length - before, 2);
  assert.equal(built.executed?.verification.status, "checked", "a declared link is not independent business verification");
  await rc.flush(); const fresh = await create(store); const count = state.calls.length;
  const run = await fresh.run("goal:resolve-record", { query: "different input" });
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(run.output, { digest: createHash("sha256").update("different input").digest("hex") });
  assert.equal(state.calls.length - count, 2, "no rediscovery or supplied intermediate identifier on reuse");
  await fresh.flush();
});

test("missing, mistyped or differently scoped responses never dispatch the linked consumer or trigger repair", async () => {
  for (const change of [{ missing: true }, { wrongType: true }, { status: 201 }, { status: 202 }]) {
    const { create, state } = fixture(); const rc = await create(); await rc.research(); Object.assign(state, change);
    const before = state.calls.length;
    const result = await rc.compose({ have: { query: { type: "text", value: "control" } }, want: "json", require: ["digest"], run: true });
    assert.notEqual(result.executed?.status, "completed");
    assert.equal(state.calls.length - before, 1, JSON.stringify(result));
    assert.ok(!result.published && !result.crystallized);
  }
});

test("unsupported, ambiguous and cross-document mappings are not partially reflected", () => {
  for (const change of [
    (s: any, l: any) => { l.operationRef = "https://elsewhere.test/spec#/paths/~1objects/get"; delete l.operationId; },
    (_s: any, l: any) => { l.server = { url: "https://elsewhere.test" }; },
    (_s: any, l: any) => { l.parameters["path.artifact_id"] = "$response.header.Location"; },
    (_s: any, l: any) => { l.parameters["path.artifact_id"] = "$response.body#/envelope/nested/absent"; },
    (_s: any, l: any) => { l.parameters["query.unknown"] = "$response.body#/envelope/nested/handle"; },
    (s: any) => { s.paths["/duplicate"] = structuredClone(s.paths["/objects/{artifact_id}"]); },
    (s: any) => { s.paths["/objects/{artifact_id}"].get.parameters[0].schema.type = "integer"; },
    (_s: any, l: any) => { l.requestBody = "constant"; },
    (s: any) => { s.paths["/objects/{artifact_id}"].get.servers = [{ url: "https://elsewhere.test" }]; },
    (s: any) => { s.paths["/objects/{artifact_id}"].get.parameters[0].schema.oneOf = [{ const: "restricted" }]; },
  ]) {
    const spec = contract(); change(spec, spec.paths["/find"].get.responses["200"].links.detail);
    const source = reflectOpenAPI(spec, origin + "/spec").capabilities.find(c => c.id.endsWith(":find"))!;
    assert.equal(source.links, undefined);
  }
});

test("a saved goal replans when a renewed contract explicitly moves its linked identifier", async () => {
  const { create, state } = fixture(); const store = new MemoryStore(); const rc = await create(store); await rc.research();
  const first = await rc.compose({ have: { query: { type: "text", value: "first" } }, want: "json", require: ["digest"], run: true, publish: "Moved lookup" });
  assert.equal(first.executed?.status, "completed");
  const nested = state.spec.paths["/find"].get.responses["200"].content["application/json"].schema.properties.envelope.properties.nested;
  nested.properties = { moved: { type: "string" } }; state.key = "moved";
  state.spec.paths["/find"].get.responses["200"].links.detail.parameters["path.artifact_id"] = "$response.body#/envelope/nested/moved";
  await rc.research(); assert.equal(rc.graph.get(first.crystallized!.id), undefined);
  await rc.flush(); const fresh = await create(store), before = state.calls.length;
  const again = await fresh.run("goal:moved-lookup", { query: "second" });
  assert.equal(again.status, "completed", again.error);
  assert.deepEqual(again.output, { digest: createHash("sha256").update("second").digest("hex") });
  assert.equal(state.calls.length - before, 2); await fresh.flush();
});

test("a relationship binds all of its parameters together and rejects partial retained mappings", async () => {
  const { create, state } = fixture();
  state.spec.paths["/objects/{artifact_id}"].get.parameters.push({ name: "echo", in: "query", required: true, schema: { type: "string" } });
  state.spec.paths["/find"].get.responses["200"].content["application/json"].schema.properties.envelope.properties.nested.properties.revision = { type: "string" };
  state.spec.paths["/find"].get.responses["200"].links.detail.parameters["query.echo"] = "$response.body#/envelope/nested/revision";
  const rc = await create(); await rc.research();
  const r = await rc.compose({ have: { query: { type: "text", value: "first" } }, want: "json", require: ["digest"], run: true });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r));
  assert.match(state.calls.at(-1)!, /\/objects\/record-1\?echo=v1$/);
  const saved = rc.graph.get(r.crystallized!.id)!; assert.equal(saved.invoke.kind, "composite");
  if (saved.invoke.kind !== "composite") return;
  saved.invoke.steps[1].bindings = saved.invoke.steps[1].bindings.filter(b => b.port !== "echo");
  const before = state.calls.length;
  assert.equal((await rc.run(saved.id, { query: "second" })).status, "failed"); assert.equal(state.calls.length, before);
});

test("a declared relationship does not bypass the distinct-input invariant", async () => {
  const { create, state } = fixture();
  state.spec.paths["/objects/{artifact_id}"].get.parameters.push({ name: "echo", in: "query", required: true, schema: { type: "string" } });
  state.spec.paths["/find"].get.responses["200"].links.detail.parameters["query.echo"] = "$response.body#/envelope/nested/handle";
  const rc = await create(); await rc.research(); const before = state.calls.length;
  const r = await rc.compose({ have: { query: { type: "text", value: "first" } }, want: "json", require: ["digest"], run: true });
  assert.equal(r.executed, undefined); assert.match(r.outcome?.reason ?? "", /distinct inputs/); assert.equal(state.calls.length, before);
});

test("two declared alternatives are refused instead of mixed or selected arbitrarily", async () => {
  const { create, state } = fixture();
  const links = state.spec.paths["/find"].get.responses["200"].links;
  links.alternative = structuredClone(links.detail);
  const rc = await create(); await rc.research(); const before = state.calls.length;
  const result = await rc.compose({ have: { query: { type: "text", value: "alpha" } }, want: "json", require: ["digest"], run: true });
  assert.equal(result.executed, undefined); assert.equal(state.calls.length, before);
});

test("changed relationship invalidates the saved pipeline; absent or withdrawn evidence cannot be reused", async () => {
  const { create, state } = fixture(); const rc = await create(); await rc.research();
  const result = await rc.compose({ have: { query: { type: "text", value: "alpha" } }, want: "json", require: ["digest"], run: true, publish: "Retained lookup" });
  assert.equal(result.executed?.status, "completed"); assert.ok(result.crystallized);
  const source = rc.graph.get("openapi:records:find")!, old = signature(source);
  delete state.spec.paths["/find"].get.responses["200"].links;
  await rc.research();
  assert.notEqual(signature(rc.graph.get(source.id)!), old);
  assert.equal(rc.graph.get(result.crystallized!.id), undefined);
  let before = state.calls.length;
  assert.equal((await rc.run("goal:retained-lookup", { query: "beta" })).status, "failed");
  assert.equal(state.calls.length, before);
  state.advertised = false; await rc.research(); before = state.calls.length;
  assert.equal(rc.graph.get(source.id), undefined);
  assert.equal((await rc.run("goal:retained-lookup", { query: "beta" })).status, "failed");
  assert.equal(state.calls.length, before);
});

test("discovered links do not widen operator risk restrictions", async () => {
  const { create, state } = fixture();
  state.spec.paths["/objects/{artifact_id}"].delete = state.spec.paths["/objects/{artifact_id}"].get;
  delete state.spec.paths["/objects/{artifact_id}"].get;
  const rc = await create(); await rc.research(); const before = state.calls.length;
  assert.equal(rc.graph.get("openapi:records:find")!.links?.length, 1);
  const r = await rc.compose({ have: { query: { type: "text", value: "alpha" } }, want: "json", require: ["digest"], run: true });
  assert.equal(r.executed, undefined); assert.equal(state.calls.length, before);
});

test("state carrying executable relationships requires a compatible reader", async () => {
  const { create } = fixture(); const store = new MemoryStore(); const rc = await create(store); await rc.research(); await rc.flush();
  assert.ok(store.state!.requirements?.includes(CONTRACT_LINK_REQUIREMENT));
  const altered = structuredClone(store.state!); altered.requirements = altered.requirements!.filter(x => x !== CONTRACT_LINK_REQUIREMENT);
  assert.throws(() => decodeState(altered), /contract link requirement/);
  assert.equal(pointerValue(Object.create({ inherited: "wrong" }), "/inherited"), undefined);
  assert.equal(pointerValue({ a: ["first", "second"] }, "/a/1"), "second");
  assert.equal(pointerValue({ a: ["first"] }, "/a/01"), undefined);
  assert.equal(pointerValue({ a: {} }, "/a/__proto__"), undefined);
});

test("a URL is not silently transformed into the UUID required by a linked operation", async () => {
  const { create, state } = fixture();
  state.spec.paths["/find"].get.responses["200"].content["application/json"].schema.properties.envelope.properties.nested.properties.handle.format = "uri";
  state.spec.paths["/objects/{artifact_id}"].get.parameters[0].schema.format = "uuid";
  const rc = await create(); await rc.research();
  assert.equal(rc.graph.get("openapi:records:find")!.links, undefined);
  const before = state.calls.length;
  const r = await rc.compose({ have: { query: { type: "text", value: "export" } }, want: "json", require: ["digest"], run: true });
  assert.equal(r.executed, undefined); assert.equal(state.calls.length, before);
});

test("declared UUID shape is checked without coercing or reparsing the returned identifier", async () => {
  const { create, state } = fixture();
  state.spec.paths["/objects/{artifact_id}"].get.parameters[0].schema.format = "uuid";
  const rc = await create(); await rc.research(); assert.equal(rc.graph.get("openapi:records:find")!.links?.length, 1);
  const before = state.calls.length;
  const r = await rc.compose({ have: { query: { type: "text", value: "export" } }, want: "json", require: ["digest"], run: true });
  assert.equal(r.executed?.status, "failed"); assert.equal(state.calls.length - before, 1);
});

test("an altered retained binding refuses before any provider call", async () => {
  const { create, state } = fixture(); const rc = await create(); await rc.research();
  const r = await rc.compose({ have: { query: { type: "text", value: "alpha" } }, want: "json", require: ["digest"], run: true });
  const saved = rc.graph.get(r.crystallized!.id)!; assert.equal(saved.invoke.kind, "composite");
  if (saved.invoke.kind !== "composite") return;
  saved.invoke.steps[1].bindings[0].link!.pointer = "/other";
  const before = state.calls.length;
  const result = await rc.run(saved.id, { query: "beta" });
  assert.equal(result.status, "failed"); assert.equal(state.calls.length, before);
});

test("export-shaped async composition follows a declared handle and generic 202/303 states, never a pending object", async () => {
  for (const monitor200 of [false, true]) {
    const { create, state } = fixture(); state.asynchronous = true; state.monitor200 = monitor200;
    for (const path of ["/jobs/{artifact_id}", "/results/{artifact_id}"]) state.spec.paths[path] = { get: {
      parameters: [{ name: "artifact_id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": response(path.startsWith("/results") ? { type: "object", properties: { digest: { type: "string" } } } : { type: "object" }) },
    } };
    const rc = await create(); await rc.research(); const before = state.calls.length;
    const r = await rc.compose({ have: { query: { type: "text", value: "software inventory" } }, want: "json", require: ["digest"], run: true, publish: "Export digest" });
    assert.equal(r.executed?.status, monitor200 ? "pending" : "completed", JSON.stringify(r));
    assert.equal(state.calls.length - before, monitor200 ? 3 : 4);
    if (monitor200) { assert.ok(!r.published && !r.crystallized); assert.notEqual(r.executed?.verification.status, "verified"); }
    else assert.deepEqual(r.executed?.output, { digest: createHash("sha256").update("software inventory").digest("hex") });
  }
});

test("a separate outcome witness is repeated on saved linked execution", async () => {
  const { create, fetcher, state } = fixture(); const observer = "https://observer.test";
  const spec = { openapi: "3.1.0", info: { title: "Observer", version: "1" }, servers: [{ url: observer }], paths: {
    "/verify": { get: { operationId: "verify", parameters: ["query", "digest"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
      responses: { "200": response({ type: "object", properties: { valid: { type: "boolean" } } }) } } },
  } };
  let checks = 0;
  const store = new MemoryStore();
  const options = { environment: { catalogs: [catalog], origins: [origin, observer] }, authority: { execution: { allowedRisks: ["read"], allowedOrigins: [origin, observer, new URL(catalog).origin] } },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init), url = new URL(req.url);
      if (req.url === catalog) return Response.json({ linkset: [{ "service-desc": [{ href: origin + "/spec" }, { href: observer + "/spec" }] }] });
      if (req.url === observer + "/spec") return Response.json(spec);
      if (url.origin === observer) { checks++; return Response.json({ valid: createHash("sha256").update(url.searchParams.get("query")!).digest("hex") === url.searchParams.get("digest") }); }
      return fetcher(input, init);
    } };
  const rc = await create(store, options); await rc.research();
  const r = await rc.compose({ have: { query: { type: "text", value: "first" } }, want: "json", require: ["digest"], run: true, publish: "Witnessed lookup",
    witnesses: [{ capability: "openapi:observer:verify", args: { query: { input: "query" }, digest: { output: "digest" } }, verify: [{ op: "equals", path: "valid", value: true }] }] });
  assert.equal(r.executed?.verification.status, "verified", JSON.stringify(r)); assert.equal(checks, 1);
  await rc.flush(); const fresh = await create(store, options), before = state.calls.length;
  const again = await fresh.run("goal:witnessed-lookup", { query: "second" });
  assert.equal(again.verification.status, "verified", again.error); assert.equal(checks, 2); assert.equal(state.calls.length - before, 2);
  await fresh.flush();
});

test("a different interface family uses local operationRef, integer parameters and explicit collection indexing", async () => {
  const spec: any = { openapi: "3.1.0", info: { title: "Warehouse", version: "1" }, servers: [{ url: origin }], paths: {
    "/allocate": { get: { operationId: "allocate", parameters: [{ name: "query", in: "query", required: true, schema: { type: "string" } }], responses: {
      "200": { ...response({ type: "object", properties: { slots: { type: "array", items: { type: "object", properties: { position: { type: "integer" } } } } } }),
        links: { inventory: { operationRef: "#/paths/~1inventory/get", parameters: { "query.bin": "$response.body#/slots/0/position" } } } },
    } } },
    "/inventory": { get: { parameters: [{ name: "bin", in: "query", required: true, schema: { type: "integer" } }], responses: { "200": response({ type: "object", properties: { quantity: { type: "integer" } } }) } } },
  } };
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, environment: { catalogs: [catalog], origins: [origin] }, fetch: async (input, init) => {
    const req = new Request(input, init); calls.push(req.url); const url = new URL(req.url);
    if (req.url === catalog) return Response.json({ linkset: [{ "service-desc": [{ href: origin + "/spec" }] }] });
    if (url.pathname === "/spec") return Response.json(spec);
    if (url.pathname === "/allocate") return Response.json({ slots: [{ position: 17 }, { position: 99 }] });
    assert.equal(url.searchParams.get("bin"), "17"); return Response.json({ quantity: 8 });
  } });
  await rc.research(); const before = calls.length;
  const result = await rc.compose({ have: { query: { type: "text", value: "bolts" } }, want: "json", require: ["quantity"], run: true });
  assert.equal(result.executed?.status, "completed", JSON.stringify(result)); assert.deepEqual(result.executed?.output, { quantity: 8 });
  assert.equal(calls.length - before, 2);
});
