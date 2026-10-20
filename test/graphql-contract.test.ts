import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectGraphQL, validateSelection } from "../src/reflectors/graphql.ts";
import { dispatch } from "../src/interface/tools.ts";
import { createHandler } from "../src/interface/http.ts";
import { MemoryStore } from "./helpers.ts";

const endpoint = "https://warehouse.test/graphql";
const ref = (name: string, kind = "OBJECT") => ({ name, kind });
const scalar = ref("String", "SCALAR");
const f = (name: string, type = scalar, args: any[] = []) => ({ name, type, args });
function schema(extra = false) {
  return { data: { __schema: { queryType: { name: "Query" }, mutationType: { name: "Mutation" }, types: [
    { name: "Query", kind: "OBJECT", fields: [f("parcel", ref("Parcel"))] },
    { name: "Mutation", kind: "OBJECT", fields: [f("reserve", ref("Parcel"))] },
    { name: "Parcel", kind: "OBJECT", fields: [f("id"), f("label"), f("owner", ref("Owner")),
      f("children", { name: null, kind: "LIST", ofType: ref("Parcel") } as any),
      f("entity", ref("Entity", "INTERFACE")), f("choice", ref("Choice", "UNION")),
      f("priced", scalar, [{ name: "currency", type: { kind: "NON_NULL", ofType: scalar }, defaultValue: null }]),
      f("defaulted", scalar, [{ name: "currency", type: { kind: "NON_NULL", ofType: scalar }, defaultValue: '"EUR"' }]),
      ...(extra ? [f("tracking")] : [])] },
    { name: "Owner", kind: "OBJECT", fields: [f("id"), f("name"), f("parcel", ref("Parcel"))] },
    { name: "Entity", kind: "INTERFACE", fields: [f("id")] },
    { name: "Choice", kind: "UNION" }, scalar,
  ] } } };
}
const id = "graphql:warehouse-test-graphql:query:parcel";
async function world(opts: { partial?: boolean; legacy?: boolean; store?: MemoryStore } = {}) {
  const calls: string[] = [];
  let extra = false;
  const rc = await RightClick.create({ directories: [], sandbox: null, store: opts.store, fetch: async (_input, init) => {
    const query = JSON.parse(String(init?.body ?? "{}")).query ?? "";
    calls.push(query);
    if (query.includes("__schema")) return Response.json(schema(extra));
    if (opts.partial) return Response.json({ data: { parcel: { id: "p1", label: null } }, errors: [{ message: "label unavailable", path: ["parcel", "label"] }] });
    if (/\{\s*unknown\s*\}|tracking/.test(query) && !extra) return Response.json({ errors: [{ message: "request validation failed" }] });
    return Response.json({ data: { parcel: { id: "p1", label: "box", tracking: "t1", defaulted: "standard" }, reserve: { id: "r1" } } });
  } });
  const reflection = reflectGraphQL(schema(), endpoint);
  reflection.provider.meta = { ...(opts.legacy ? {} : reflection.provider.meta), source: endpoint };
  if (!rc.graph.get(id)) await rc.learn({ spec: reflection });
  return { rc, calls, addField: () => { extra = true; } };
}

test("known invalid selections stop locally without rediscovery, execution or provider penalty", async () => {
  const { rc, calls } = await world();
  for (const selection of ["{ unknown }", "{ owner { label } }", "{ id { name } }", "{ owner }", "{ priced }", "{ entity { label } }", "{ choice { id } }"]) {
    const r: any = await dispatch(rc, "context_run", { id, args: { selection } });
    assert.equal(r.status, "failed", selection);
    assert.equal(r.graphqlFailure?.kind, "invalid-document", selection);
    assert.equal(r.healing, undefined);
  }
  assert.deepEqual(calls, []);
  assert.equal(rc.ledger.get(id), undefined);
});

test("aliases, recursive relationships, abstract typename and defaulted arguments stay usable", async () => {
  const { rc, calls } = await world();
  for (const selection of ["{ alias: owner { display: name } }", "{ children { owner { parcel { children { id } } } } }", "{ entity { id __typename } choice { __typename } }", "{ defaulted }"]) {
    assert.equal((await rc.run(id, { selection })).status, "completed", selection);
  }
  assert.equal(calls.length, 4);
});

test("contract validation survives restart and changes only after fresh learned evidence", async () => {
  const store = new MemoryStore();
  const first = await world({ store }); await first.rc.flush();
  const { rc, calls, addField } = await world({ store });
  assert.equal((await rc.run(id, { selection: "{ tracking }" })).status, "failed");
  assert.deepEqual(calls, []);
  addField();
  await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
  assert.equal((await rc.run(id, { selection: "{ tracking }" })).status, "completed");
  assert.equal(calls.length, 2);
});

test("missing legacy selection evidence does not invent a local rejection", async () => {
  const { rc, calls } = await world({ legacy: true });
  assert.equal((await rc.run(id, { selection: "{ label }" })).status, "completed");
  assert.equal(calls.length, 1);
});

test("partial GraphQL errors cannot become predicate-checked success or trigger repair", async () => {
  const { rc, calls } = await world({ partial: true });
  const r: any = await rc.run(id, { selection: "{ id label }" }, { verify: [{ op: "equals", path: "id", value: "p1" }] });
  assert.equal(r.status, "failed");
  assert.equal(r.verification.status, "refuted");
  assert.equal(r.graphqlFailure?.kind, "execution-errors");
  assert.equal(r.healing, undefined);
  assert.equal(calls.length, 1);
});

test("composed partial errors stop without discovery, replanning or publication", async () => {
  const { rc, calls } = await world({ partial: true });
  const r: any = await rc.compose({ have: { selection: "{ id label }" }, want: "json", through: [id], maxSteps: 1, run: true,
    publish: "parcel", verify: [{ op: "equals", path: "id", value: "p1" }] });
  assert.equal(r.executed?.status, "failed");
  assert.equal(r.executed?.graphqlFailure?.kind, "execution-errors");
  assert.equal(r.executed?.attempts.length, 1);
  assert.equal(r.published, undefined);
  assert.equal(calls.length, 1);
});

test("composed invalid selections stop locally, including the existing syntax boundary", async () => {
  const { rc, calls } = await world();
  for (const selection of ["{ owner { unknown } }", "{ id } other { id }"]) {
    const r: any = await rc.compose({ have: { selection }, want: "json", through: [id], maxSteps: 1,
      run: true, publish: "must-not-save", verify: [{ op: "exists", path: "id" }] });
    assert.equal(r.executed?.status, "failed");
    assert.equal(r.executed?.graphqlFailure?.kind, "invalid-document");
    assert.equal(r.executed?.attempts.length, 1);
    assert.equal(r.published, undefined);
  }
  assert.deepEqual(calls, []);
  assert.equal(rc.ledger.get(id), undefined);
});

test("legacy, truncated, over-budget and differently scoped evidence never proves an unknown field absent", () => {
  const inv = { endpoint, operation: "query", field: "parcel", selection: "{ owner { unobserved } }" };
  const truncated = schema();
  (truncated.data.__schema.types.find(t => t.name === "Owner") as any).fields = null;
  validateSelection(inv, reflectGraphQL(truncated, endpoint).provider.meta?.graphqlSelection);
  validateSelection(inv, undefined);
  validateSelection({ ...inv, endpoint: "https://another.test/graphql" }, reflectGraphQL(schema(), endpoint).provider.meta?.graphqlSelection);
  const large = schema();
  large.data.__schema.types.push(...Array.from({ length: 4100 }, (_, i) => ref(`Extra${i}`, "SCALAR")));
  const omitted = reflectGraphQL(large, endpoint).provider.meta?.graphqlSelection;
  assert.equal(omitted, undefined);
  validateSelection(inv, omitted);
});

test("conflicting aliases are rejected but valid aliases target the declared field", async () => {
  const { rc, calls } = await world();
  assert.equal((await rc.run(id, { selection: "{ same: id same: label }" })).status, "failed");
  assert.deepEqual(calls, []);
  assert.equal((await rc.run(id, { selection: "{ unknown: label }" })).status, "completed");
  assert.equal(calls.length, 1);
});

test("an effectful mutation with partial errors is not retried", async () => {
  const { rc, calls } = await world({ partial: true });
  const result: any = await rc.run("graphql:warehouse-test-graphql:mutation:reserve", { selection: "{ id label }" });
  assert.equal(result.status, "failed");
  assert.equal(result.graphqlFailure?.kind, "execution-errors");
  assert.equal(calls.length, 1);
  assert.equal(result.healing, undefined);
});

test("fresh saved-goal, generated REST and GraphQL calls retain the terminal execution error", async () => {
  const store = new MemoryStore();
  const original = await world({ store });
  const saved = await original.rc.compose({ have: { selection: "{ id label }" }, want: "json", through: [id],
    maxSteps: 1, run: true, publish: "parcel", verify: [{ op: "exists", path: "id" }] });
  assert.ok(saved.published);
  await original.rc.flush();
  const { rc, calls } = await world({ store, partial: true });
  const direct: any = await dispatch(rc, "context_run", { id: "goal:parcel", args: { selection: "{ id label }" } });
  assert.equal(direct.status, "failed");
  assert.equal(direct.graphqlFailure?.kind, "execution-errors");
  const handler = createHandler(rc, { open: true });
  const rest: any = await (await handler(new Request("http://localhost/x/parcel?selection=%7B%20id%20label%20%7D"))).json();
  assert.equal(rest.ok, false);
  assert.equal(rest.graphqlFailure?.kind, "execution-errors");
  const gql: any = await (await handler(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: '{ parcel(selection: "{ id label }") { ok status graphqlFailure } }' }) }))).json();
  assert.equal(gql.data.parcel.ok, false);
  assert.equal(gql.data.parcel.graphqlFailure?.kind, "execution-errors");
  assert.equal(calls.length, 3);
});

test("null execution-error data fails once; a request error can still expose genuine schema drift", async () => {
  let nullCalls = 0;
  const nullRuntime = await RightClick.create({ directories: [], sandbox: null, fetch: async () => {
    nullCalls++; return Response.json({ data: null, errors: [{ message: "resolver failed" }] });
  } });
  await nullRuntime.learn({ spec: reflectGraphQL(schema(), endpoint) });
  const failed: any = await nullRuntime.run(id, { selection: "{ id }" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.graphqlFailure.kind, "execution-errors");
  assert.equal(nullCalls, 1);

  const changed = schema();
  const parcel: any = changed.data.__schema.types.find(t => t.name === "Parcel");
  parcel.fields = parcel.fields.filter((field: any) => field.name !== "label");
  parcel.fields.push(f("description"));
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
    const query = JSON.parse(String(init?.body ?? "{}")).query ?? "";
    calls.push(query);
    if (!query) return new Response("POST required", { status: 400 });
    if (query.includes("__schema")) return Response.json(changed);
    return Response.json(query.includes("label") ? { errors: [{ message: "selection no longer supported" }] }
      : { data: { parcel: { id: "p2", description: "new" } } });
  } });
  const previous = reflectGraphQL(schema(), endpoint);
  previous.provider.meta = { ...previous.provider.meta, source: endpoint };
  await rc.learn({ spec: previous });
  const healed = await rc.run(id, {});
  assert.equal(healed.status, "completed");
  assert.equal(healed.healing?.drift?.changed, true);
  assert.equal(healed.healing?.retried, id);
  assert.equal(calls.filter(q => q.includes("__schema")).length, 1);
  assert.deepEqual(healed.output, { id: "p2", description: "new" });
});

test("a locally invalid verification query stops after the producer without retry or publication", async () => {
  const { rc, calls } = await world();
  const result: any = await rc.compose({ have: { text: "one two" }, want: "json", through: ["builtin:text.stats"], maxSteps: 1,
    run: true, publish: "counted", witnesses: [{ capability: id, args: { selection: { value: "{ unknown }" } },
      verify: [{ op: "exists", path: "id" }] }] });
  assert.equal(result.executed?.status, "failed");
  assert.equal(result.executed?.graphqlFailure?.kind, "invalid-document");
  assert.equal(result.executed?.attempts.length, 1);
  assert.equal(result.executed?.runs.length, 2, "preserve both producer and invalid witness runs");
  assert.equal(result.published, undefined);
  assert.deepEqual(calls, []);
});

test("fields whose required-looking arguments have defaults are discoverable result information", async () => {
  const { rc, calls } = await world();
  assert.ok(rc.graph.get(id)?.fields?.some(field => field.path === "defaulted"));
  const result = await rc.compose({ have: { selection: "{ defaulted }" }, want: "json", through: [id], maxSteps: 1,
    require: ["defaulted"], run: true, verify: [{ op: "equals", path: "defaulted", value: "standard" }] });
  assert.equal(result.outcome?.status, "established");
  assert.equal(result.executed?.verification.status, "checked");
  assert.equal(calls.length, 1);
});

test("omitted root arguments use provider defaults while truly required arguments still refuse locally", async () => {
  const intro = schema();
  const query: any = intro.data.__schema.types.find(t => t.name === "Query");
  query.fields[0].args = [{ name: "locale", type: { kind: "NON_NULL", ofType: scalar }, defaultValue: '"en"' }];
  const requests: any[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return Response.json(body.query.includes("$locale") && body.variables.locale === undefined
      ? { errors: [{ message: "required variable absent" }] } : { data: { parcel: { id: "p1", locale: body.variables.locale ?? "en" } } });
  } });
  await rc.learn({ spec: reflectGraphQL(intro, endpoint) });
  const implicit = await rc.run(id, {});
  assert.equal(implicit.status, "completed");
  assert.equal((implicit.output as any).locale, "en");
  assert.ok(!requests[0].query.includes("$locale"));
  const explicit = await rc.run(id, { locale: "fr" });
  assert.equal(explicit.status, "completed");
  assert.equal((explicit.output as any).locale, "fr");
  query.fields[0].args[0].defaultValue = null;
  await rc.learn({ spec: reflectGraphQL(intro, endpoint) });
  assert.equal((await rc.run(id, {})).status, "failed");
  assert.equal(requests.length, 2);
});
