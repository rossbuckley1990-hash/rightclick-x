import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { completeTypeReferences } from "../src/reflectors/graphql.ts";

const endpoint = "https://samples.test/graphql";
const scalar = { kind: "SCALAR", name: "String" };
const full = { kind: "NON_NULL", name: null, ofType: { kind: "LIST", name: null,
  ofType: { kind: "NON_NULL", name: null, ofType: { kind: "OBJECT", name: "Sample" } } } };
function partial() {
  const type = structuredClone(full) as any; delete type.ofType.ofType.ofType;
  return { data: { __schema: { queryType: { name: "Query" }, mutationType: null, types: [
    { kind: "OBJECT", name: "Query", fields: [{ name: "samples", args: [], type }] },
    { kind: "OBJECT", name: "Sample", fields: [{ name: "code", args: [], type: scalar }, { name: "label", args: [], type: scalar }] }, scalar,
  ] } } };
}

test("bounded type-reference discovery makes a depth-truncated list operation executable", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
    const query = JSON.parse(String(init?.body)).query; calls.push(query);
    if (query.includes("__schema")) return Response.json(partial());
    if (query.includes("__type(")) return Response.json({ data: { t0: { name: "Query", fields: [{ name: "samples", type: full }] } } });
    return Response.json({ data: { samples: [{ code: "s1", label: "new" }] } });
  } });
  const learned = await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
  const cap = rc.graph.get("graphql:samples-test-graphql:query:samples")!;
  assert.equal(cap?.invoke.kind, "graphql");
  assert.ok(cap.inputs.some(p => p.name === "selection"));
  assert.ok(learned.results[0].probes.some(p => p.kind === "graphql-type-references" && p.ok));
  const result = await rc.run(cap.id, { selection: "{ code label }" });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, [{ code: "s1", label: "new" }]);
  assert.equal(calls.length, 3);
});

test("conflicting or still-truncated references never become executable root operations", async () => {
  for (const type of [scalar, (partial().data.__schema.types[0] as any).fields[0].type]) {
    let calls = 0;
    const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
      calls++; const query = JSON.parse(String(init?.body)).query;
      return Response.json(query.includes("__schema") ? partial() : { data: { t0: { name: "Query", fields: [{ name: "samples", type }] } } });
    } });
    await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
    assert.equal(rc.graph.get("graphql:samples-test-graphql:query:samples"), undefined);
    assert.ok(rc.graph.providers.get("graphql:samples-test-graphql")?.meta?.graphqlIncomplete);
    assert.equal(calls, 2);
  }
});

test("a denied type-reference read stops discovery rather than guessing the missing type", async () => {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
    calls++; const query = JSON.parse(String(init?.body)).query;
    return query.includes("__schema") ? Response.json(partial()) : new Response("denied", { status: 403 });
  } });
  const result = await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
  assert.equal(rc.graph.get("graphql:samples-test-graphql:query:samples"), undefined);
  assert.equal(calls, 2);
  assert.ok(result.results[0].probes.some(p => !p.ok));
});

test("targeted argument references preserve wrappers and are executable without model reconstruction", async () => {
  const doc = partial();
  const root = (doc.data.__schema.types[0] as any).fields[0];
  root.type = full;
  const argument = structuredClone(full) as any;
  argument.ofType.ofType.ofType = scalar;
  const truncated = structuredClone(argument); delete truncated.ofType.ofType.ofType;
  root.args = [{ name: "codes", type: truncated }];
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body.query);
    if (body.query.includes("__schema")) return Response.json(doc);
    if (body.query.includes("__type(")) return Response.json({ data: { t0: { name: "Query", fields: [
      { name: "samples", args: [{ name: "codes", type: argument }] },
    ] } } });
    assert.match(body.query, /\$codes: \[String!\]!/);
    assert.deepEqual(body.variables, { codes: ["s1"] });
    return Response.json({ data: { samples: [{ code: "s1" }] } });
  } });
  await rc.learn({ source: endpoint, kinds: { [endpoint]: "graphql" } });
  const result = await rc.run("graphql:samples-test-graphql:query:samples", { codes: ["s1"], selection: "{ code }" });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, [{ code: "s1" }]);
  assert.equal(calls.length, 3);
});

test("reference completion is bounded, prioritises observed roots and preserves failed evidence", async () => {
  const missing = { kind: "NON_NULL", name: null };
  const types = Array.from({ length: 20 }, (_, i) => ({ kind: "OBJECT", name: `Type${i}`, fields: [
    { name: "values", type: missing, args: [{ name: "codes", type: missing }] },
  ] }));
  const doc = { data: { __schema: { queryType: { name: "Type19" }, types } } };
  const before = structuredClone(doc);
  const queries: string[] = [], observations: boolean[] = [];
  await completeTypeReferences(doc, async query => { queries.push(query); return { errors: [{ message: "depth" }] }; },
    ok => observations.push(ok));
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal((query.match(/__type\(/g) ?? []).length, 16);
    assert.match(query, /t0: __type\(name: "Type19"\)/);
  }
  assert.deepEqual(observations, [false, false]);
  assert.deepEqual(doc, before);
});
