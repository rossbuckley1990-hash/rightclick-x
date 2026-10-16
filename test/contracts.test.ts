// Real-world contract quirks, reproduced with synthetic services: content
// negotiation that fails on a multi-type Accept, OpenAPI 3 contracts that leave
// their server unstated while living below a path prefix, and GraphQL types
// wider than the reflector's default selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch } from "../demo/services.ts";
import { reflectGraphQL } from "../src/reflectors/graphql.ts";
import { RightClick } from "../src/runtime.ts";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const html = (status: number) => new Response("<!doctype html><html><body>error</body></html>", { status, headers: { "content-type": "text/html" } });

test("a server that fails content negotiation on a multi-type Accept is retried with the first type, for safe methods only", async () => {
  const seen: string[] = [];
  const spec = {
    openapi: "3.0.1",
    info: { title: "Picky", version: "1" },
    servers: [{ url: "https://picky.test" }],
    paths: {
      "/things/{id}": { get: { operationId: "getThing", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/things": { post: { operationId: "makeThing", requestBody: { content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" } } } } } }, responses: { 200: { description: "ok" } } } },
    },
  };
  const picky = async (r: Request) => {
    const accept = r.headers.get("accept") ?? "";
    seen.push(`${r.method} ${new URL(r.url).pathname} [${accept}]`);
    if (accept.includes(",")) return html(500); // the quirk: any list of media types breaks it
    if (new URL(r.url).pathname === "/openapi.json") return json(spec);
    if (r.method === "GET") return json({ id: new URL(r.url).pathname.split("/").pop(), label: "a thing" });
    return json({ created: true });
  };
  const rc = await RightClick.create({ fetch: routerFetch({ "https://picky.test": picky }), directories: [] });
  const learned = await rc.learn({ source: "https://picky.test/openapi.json" });
  assert.equal(learned.totalNewCapabilities, 2, "the contract is learned despite the quirk");
  const got = await rc.run("openapi:picky:getthing", { id: "X1" });
  assert.equal(got.status, "completed");
  assert.equal((got.output as any).id, "X1");
  // POST is never retried: a 500 on a write may have had effects.
  const before = seen.filter((s) => s.startsWith("POST")).length;
  const made = await rc.run("openapi:picky:makething", { label: "x" });
  assert.equal(made.status, "failed", "the quirk is not worked around for writes");
  assert.equal(seen.filter((s) => s.startsWith("POST")).length - before, 1, "exactly one POST: never retried");
});

test("OpenAPI 3 without servers: the base is settled by probing, origin first, then the contract's own directory", async () => {
  const contract = (title: string) => ({
    openapi: "3.0.1",
    info: { title, version: "1" },
    paths: {
      "/status": { get: { operationId: "status", responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } },
      "/records/{accession}": { get: { operationId: "getRecord", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } },
    },
  });
  // Served below a prefix and meant relative to it; the origin answers with an HTML 404.
  const prefixed = async (r: Request) => {
    const p = new URL(r.url).pathname;
    if (p === "/svc/api/openapi.json") return json(contract("Prefixed"));
    if (p === "/svc/api/status") return json({ up: true });
    if (p.startsWith("/svc/api/records/")) return json({ accession: p.split("/").pop() });
    return html(404);
  };
  // Served below a prefix but meant relative to the origin, as the standard says.
  const rooted = async (r: Request) => {
    const p = new URL(r.url).pathname;
    if (p === "/docs/openapi.json") return json(contract("Rooted"));
    if (p === "/status") return json({ up: true });
    if (p.startsWith("/records/")) return json({ accession: p.split("/").pop() });
    return html(404);
  };
  const rc = await RightClick.create({ fetch: routerFetch({ "https://prefixed.test": prefixed, "https://rooted.test": rooted }), directories: [] });
  await rc.learn({ sources: ["https://prefixed.test/svc/api/openapi.json", "https://rooted.test/docs/openapi.json"] });

  const p = rc.graph.get("openapi:prefixed:getrecord")!;
  assert.equal(p.invoke.kind === "http" && p.invoke.url, "https://prefixed.test/svc/api/records/{accession}");
  assert.equal((rc.graph.providers.get("openapi:prefixed")!.meta as any).baseResolution.chosen, "https://prefixed.test/svc/api");
  const r1 = await rc.run(p.id, { accession: "Q1" });
  assert.equal(r1.status, "completed");
  assert.equal((r1.output as any).accession, "Q1");

  const o = rc.graph.get("openapi:rooted:getrecord")!;
  assert.equal(o.invoke.kind === "http" && o.invoke.url, "https://rooted.test/records/{accession}", "the standard's default is kept when it answers");
  assert.equal((await rc.run(o.id, { accession: "Q2" })).status, "completed");
});

test("GraphQL: the default selection is bounded but never silent; a caller-supplied selection reaches fields beyond it", async () => {
  const S = (name: string) => ({ name, description: null, args: [], type: { kind: "SCALAR", name: "String", ofType: null } });
  const wide = Array.from({ length: 27 }, (_, i) => S(`f${String(i).padStart(2, "0")}`));
  const types = [
    { kind: "OBJECT", name: "Query", fields: [{ name: "record", description: "A record", args: [{ name: "record_id", description: null, defaultValue: null, type: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "String", ofType: null } } }], type: { kind: "OBJECT", name: "Record", ofType: null } }] },
    { kind: "OBJECT", name: "Record", fields: [...wide, { name: "measurement", description: null, args: [], type: { kind: "OBJECT", name: "Measurement", ofType: null } }] },
    { kind: "OBJECT", name: "Measurement", fields: [S("method"), { name: "resolution", description: null, args: [], type: { kind: "SCALAR", name: "Float", ofType: null } }] },
    { kind: "SCALAR", name: "String", fields: null },
    { kind: "SCALAR", name: "Float", fields: null },
  ];
  const reflection = reflectGraphQL({ data: { __schema: { queryType: { name: "Query" }, mutationType: null, types } } }, "https://wide.test/graphql");
  const cap = reflection.capabilities[0];
  assert.ok(cap.invoke.kind === "graphql" && !cap.invoke.selection.includes("measurement"), "beyond the default selection");
  const port = cap.inputs.find((p) => p.name === "selection")!;
  assert.ok(port && !port.required, "an optional selection input");
  assert.match(port.description!, /Default selects 25 of 28 fields/);
  assert.match(port.description!, /measurement \{ method resolution \}/, "omitted fields are listed with their subfields");

  const queries: string[] = [];
  const rc = await RightClick.create({
    directories: [],
    fetch: routerFetch({
      "https://wide.test": async (r) => {
        const { query, variables } = await r.json();
        queries.push(query);
        return json({ data: { record: { f00: "x", measurement: { method: "X-RAY", resolution: 1.74 } } }, echo: variables });
      },
    }),
  });
  await rc.learn({ spec: reflection });
  const out = await rc.run(cap.id, { record_id: "R1", selection: "{ measurement { method resolution } }" });
  assert.equal(out.status, "completed");
  assert.match(queries.at(-1)!, /record\(record_id: \$record_id\) \{ measurement \{ method resolution \} \}/);
  assert.ok(!/\$selection/.test(queries.at(-1)!), "the selection is not sent as a GraphQL variable");
  assert.equal((out.output as any).measurement.resolution, 1.74);
  // Without a selection, the default is used unchanged.
  await rc.run(cap.id, { record_id: "R1" });
  assert.match(queries.at(-1)!, /\{ f00 f01/);
  // A selection cannot smuggle in arguments, variables or operations.
  const bad = await rc.run(cap.id, { record_id: "R1", selection: "{ f00 } mutation { drop(all: true) }" });
  assert.equal(bad.status, "failed");
  assert.match(String(bad.error), /selection must be a GraphQL selection set/);
});
