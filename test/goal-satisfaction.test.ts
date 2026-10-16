// Goal satisfaction: plans are judged by what their result carries, not by type compatibility.
// Synthetic services shaped like the failures recorded in experiments/goal-satisfaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ok = (schema: object) => ({ "200": { description: "ok", content: { "application/json": { schema } } } });

const PROTEINS = {
  openapi: "3.0.0", info: { title: "Proteins" }, servers: [{ url: "https://proteins.test" }],
  paths: { "/proteins/{accession}": { get: { operationId: "getProtein", summary: "Get a protein record", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" }, description: "Protein accession identifier" }],
    responses: ok({ type: "object", properties: { accession: { type: "string", description: "Protein accession identifier" }, name: { type: "string" }, entry_ids: { type: "array", description: "Structure entry identifiers", items: { type: "string", description: "Structure entry identifier" } } } }) } } },
};
const STRUCTURES = (omitResolution = false) => ({
  openapi: "3.0.0", info: { title: "Structures" }, servers: [{ url: "https://structures.test" }],
  paths: { "/entries/{entry_id}": { get: { operationId: "getEntry", summary: "Get a structure entry", parameters: [{ name: "entry_id", in: "path", required: true, schema: { type: "string" }, description: "Structure entry identifier" }],
    responses: ok({ type: "object", properties: { entry_id: { type: "string", description: "Structure entry identifier" }, method: { type: "string" }, refine: { type: "array", items: { type: "object", properties: { resolution: { type: "number" } } } } } }) } } },
  "x-omit": omitResolution,
});

function world(opts: { omitResolution?: boolean } = {}) {
  const calls: string[] = [];
  const RES: Record<string, number> = { "1ABC": 2.4, "2DEF": 1.9 };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(`${u.host}${u.pathname}`);
    if (u.pathname === "/openapi.json") return json(u.host === "proteins.test" ? PROTEINS : STRUCTURES(opts.omitResolution));
    let m = /^\/proteins\/(\w+)$/.exec(u.pathname);
    if (m) return json({ accession: m[1], name: "leptin", entry_ids: ["1ABC", "2DEF"] });
    m = /^\/entries\/(\w+)$/.exec(u.pathname);
    if (m) return json(opts.omitResolution ? { entry_id: m[1], method: "X-RAY" } : { entry_id: m[1], method: "X-RAY", refine: [{ resolution: RES[m[1]] }] });
    return json({ error: "nf" }, 404);
  }) as typeof fetch;
  return { f, calls };
}

test("type compatibility is not satisfaction: the plan whose result carries the required information wins", async () => {
  const { f } = world();
  const rc = await RightClick.create({ name: "gs", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://proteins.test/openapi.json", "https://structures.test/openapi.json"] });
  const goal = { have: { accession: "P41159" }, want: "json", intent: "protein structure entries resolution", run: true, limit: 25, maxSteps: 3 };
  const r = await rc.compose({ ...goal, require: ["resolution"] });
  assert.equal(r.outcome?.status, "established", JSON.stringify(r.outcome) + JSON.stringify(r.plans.slice(0, 3).map((p) => [p.summary, p.satisfaction])));
  assert.ok(r.plans[0].steps.length >= 2, `top plan reaches the entries: ${r.plans[0].summary}`);
  const out = JSON.stringify(r.executed?.output);
  assert.match(out, /2\.4/);
  assert.match(out, /1\.9/);
  assert.equal(r.outcome?.checkedAfterRun, true);
  // The one-step record lookup is type-compatible but incomplete.
  const one = r.plans.find((p) => p.steps.length === 1);
  if (one) assert.equal(one.satisfaction?.status, "incomplete");
});

test("nothing carries it: an explicit unavailable outcome, and nothing runs", async () => {
  const { f, calls } = world();
  const rc = await RightClick.create({ name: "gs2", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://proteins.test/openapi.json", "https://structures.test/openapi.json"] });
  const before = calls.length;
  const r = await rc.compose({ have: { accession: "P41159" }, want: "json", intent: "protein melting point", run: true, require: ["melting point"] });
  assert.equal(r.outcome?.status, "unavailable");
  assert.equal(r.executed, undefined);
  assert.equal(calls.length, before, "no call was made");
});

test("a generic join is not evidence: unverified, and nothing runs", async () => {
  const calls: string[] = [];
  const A = { openapi: "3.0.0", info: { title: "Names" }, servers: [{ url: "https://names.test" }], paths: { "/things/{key}": { get: { operationId: "getThing", summary: "Get a thing", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { title: { type: "string" } } }) } } } };
  const B = { openapi: "3.0.0", info: { title: "Facts" }, servers: [{ url: "https://facts.test" }], paths: { "/facts/{q}": { get: { operationId: "getFact", summary: "Get a fact", parameters: [{ name: "q", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { gene: { type: "object", properties: { name: { type: "string" } } } } }) } } } };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(u.pathname);
    if (u.pathname === "/openapi.json") return json(u.host === "names.test" ? A : B);
    return json({ title: "x", gene: { name: "y" } });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs3", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://names.test/openapi.json", "https://facts.test/openapi.json"] });
  const before = calls.length;
  const r = await rc.compose({ have: { comp_id: { type: "id.component", value: "MK1" } }, want: "json", intent: "gene name", run: true, require: ["gene name"], maxSteps: 3 });
  assert.notEqual(r.outcome?.status, "established", JSON.stringify(r.outcome));
  assert.equal(r.executed, undefined);
  assert.equal(calls.length, before);
});

test("after running, the actual output is checked: a declared field the response omits is incomplete", async () => {
  const { f } = world({ omitResolution: true });
  const rc = await RightClick.create({ name: "gs4", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://proteins.test/openapi.json", "https://structures.test/openapi.json"] });
  const r = await rc.compose({ have: { accession: "P41159" }, want: "json", intent: "protein structure entries resolution", run: true, require: ["resolution"], limit: 25, maxSteps: 3 });
  assert.equal(r.outcome?.status, "incomplete", JSON.stringify(r.outcome));
  assert.deepEqual(r.outcome?.missing, ["resolution"]);
});

test("GraphQL: a required field declared but outside the default selection is requested automatically", async () => {
  // 30 scalar fields: the default selection takes 25; "resolution_combined" is field 28.
  const names = Array.from({ length: 30 }, (_, i) => (i === 27 ? "resolution_combined" : `f${i}`));
  const scalar = (name: string) => ({ name, kind: "SCALAR" });
  const T = (name: string, kind = "OBJECT") => ({ kind, name, ofType: null });
  const intro = { data: { __schema: { queryType: { name: "Query" }, mutationType: null, types: [
    { kind: "OBJECT", name: "Query", fields: [{ name: "entry", description: "An entry", args: [{ name: "entry_id", description: "Entry identifier", type: { kind: "NON_NULL", name: null, ofType: T("String", "SCALAR") }, defaultValue: null }], type: T("Entry") }] },
    { kind: "OBJECT", name: "Entry", fields: names.map((n) => ({ name: n, description: null, args: [], type: T(n === "resolution_combined" ? "Float" : "String", "SCALAR") })) },
    scalar("String"), scalar("Float"),
  ] } } };
  let lastQuery = "";
  const f = (async (_input: any, init?: any) => {
    const body = JSON.parse(init?.body ?? "{}");
    if (/__schema/.test(body.query)) return json(intro);
    lastQuery = body.query;
    const fields = names.filter((n) => new RegExp(`\\b${n}\\b`).test(body.query));
    return json({ data: { entry: Object.fromEntries(fields.map((n) => [n, n === "resolution_combined" ? 2.4 : "v"])) } });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs5", fetch: f, directories: [] });
  await rc.learn({ source: "https://graph.test/graphql" });
  const cap = rc.graph.list().find((c) => c.id.endsWith(":entry"))!;
  assert.ok(cap.fields?.some((x) => x.path === "resolution_combined" && x.selected === false), "declared but not selected by default");
  const r = await rc.compose({ have: { entry_id: { type: cap.inputs[0].type, value: "1ABC" } }, want: "json", intent: "entry resolution", run: true, require: ["resolution"] });
  assert.equal(r.outcome?.status, "established", JSON.stringify(r.outcome));
  assert.match(lastQuery, /resolution_combined/);
  assert.match(JSON.stringify(r.executed?.output), /2\.4/);
});
