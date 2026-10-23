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

test("a caller's value in a port it does not fit is a generic join (Q07/Q08g on lifesci-satisfy-1)", async () => {
  const calls: string[] = [];
  const SPEC = { openapi: "3.0.0", info: { title: "Coords" }, servers: [{ url: "https://coords.test" }], paths: { "/coordinates/{accession}": { get: { operationId: "byAccession", summary: "Get genomic coordinates for an accession", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { chromosome: { type: "string" } } }) } } } };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(u.pathname);
    return u.pathname === "/openapi.json" ? json(SPEC) : json({ chromosome: "17" });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs6", fetch: f, directories: [] });
  await rc.learn({ source: "https://coords.test/openapi.json" });
  const before = calls.length;
  // A gene symbol is not an accession: binding it there is plumbing, not the caller's join.
  const bad = await rc.compose({ have: { gene: "BRCA1" }, want: "json", intent: "genomic coordinates", run: true, require: ["chromosome"] });
  assert.notEqual(bad.outcome?.status, "established", JSON.stringify(bad.outcome));
  assert.equal(calls.length, before, "nothing ran");
  // The same name is the caller's own join.
  const good = await rc.compose({ have: { accession: "P38398" }, want: "json", intent: "genomic coordinates", run: true, require: ["chromosome"] });
  assert.equal(good.outcome?.status, "established", JSON.stringify(good.outcome));
});

test("a step whose bound input came back empty blames the producer, not itself (Q03 on lifesci-satisfy-2)", async () => {
  const P = { openapi: "3.0.0", info: { title: "Seq" }, servers: [{ url: "https://seq.test" }], paths: { "/seq/{accession}": { get: { operationId: "longest", summary: "Get longest sequence for entries", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { entry_id: { type: "string", description: "Structure entry identifier" } } }) } } } };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return json(u.host === "seq.test" ? P : STRUCTURES());
    if (u.host === "seq.test") return json({ other: "no entry here" });
    return json({ entry_id: "1ABC", refine: [{ resolution: 2.4 }] });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs7", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://seq.test/openapi.json", "https://structures.test/openapi.json"] });
  const r = await rc.compose({ have: { accession: "P41159" }, want: "json", intent: "structure entries resolution", run: true, require: ["resolution"], maxSteps: 3 });
  const a = r.executed?.attempts?.[0];
  assert.ok(a, JSON.stringify(r.outcome));
  assert.match(a!.failed, /seq/, `blamed ${a!.failed}`);
  assert.match(a!.error, /has no value at entry_id/);
});

test("identifier evidence two array levels deep links records-of-lists to a lookup (H1 shape)", async () => {
  const HA = { openapi: "3.0.0", info: { title: "Advisories" }, servers: [{ url: "https://adv.test" }], paths: { "/lookup": { get: { operationId: "lookupAdvisories", summary: "Lookup advisories for a package URL", parameters: [{ name: "purl", in: "query", required: true, schema: { type: "string" } }], responses: ok({ type: "array", items: { type: "object", properties: { uuid: { type: "string" }, identifiers: { type: "array", items: { type: "string" } } } } }) } } } };
  const HB = { openapi: "3.0.0", info: { title: "Vulns" }, servers: [{ url: "https://vuln.test" }], paths: { "/vulns/{id}": { get: { operationId: "getVuln", summary: "Return a vulnerability for a given ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { id: { type: "string" }, summary: { type: "string" }, aliases: { type: "array", items: { type: "string" } } } }) } } } };
  const V: Record<string, any> = { "GHSA-aaaa-1111-xxxx": { id: "GHSA-aaaa-1111-xxxx", summary: "Prototype pollution", aliases: ["CVE-2020-0001"] }, "GHSA-bbbb-2222-yyyy": { id: "GHSA-bbbb-2222-yyyy", summary: "Command injection", aliases: [] }, "GHSA-cccc-3333-zzzz": { id: "GHSA-cccc-3333-zzzz", summary: "Seed advisory", aliases: [] } };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return json(u.host === "adv.test" ? HA : HB);
    if (u.pathname === "/lookup") return json(u.searchParams.get("purl") === "pkg:npm/seed@1" ? [{ uuid: "u0", identifiers: ["GHSA-cccc-3333-zzzz"] }] : [{ uuid: "u1", identifiers: ["GHSA-aaaa-1111-xxxx", "CVE-2020-0001"] }, { uuid: "u2", identifiers: ["GHSA-bbbb-2222-yyyy"] }]);
    const m = /^\/vulns\/(.+)$/.exec(u.pathname);
    if (m) return V[decodeURIComponent(m[1])] ? json(V[decodeURIComponent(m[1])]) : json({ code: 5, message: "not found" }, 404);
    return json({}, 404);
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs8", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://adv.test/openapi.json", "https://vuln.test/openapi.json"] });
  const lookup = rc.graph.list().find((c) => c.title.startsWith("Lookup advisories"))!;
  const vuln = rc.graph.list().find((c) => c.title.startsWith("Return a vulnerability"))!;
  const before = await rc.compose({ have: { purl: "pkg:npm/lodash@4.17.20" }, want: "json", intent: "vulnerability summary", require: ["summary"] });
  assert.notEqual(before.outcome?.status, "established", "without evidence the link is generic");
  // Seeding on different inputs: the lookup's identifiers are then accepted by the vulnerability lookup.
  const seed = await rc.run(lookup.id, { purl: "pkg:npm/seed@1" });
  await rc.run(vuln.id, { id: (seed.output as any)[0].identifiers[0] });
  const r = await rc.compose({ have: { purl: "pkg:npm/lodash@4.17.20" }, want: "json", intent: "vulnerability summary", run: true, require: ["summary"] });
  assert.equal(r.outcome?.status, "established", JSON.stringify(r.outcome) + JSON.stringify(r.plans.slice(0, 3).map((p) => [p.summary, p.satisfaction?.joins])));
  const out = JSON.stringify(r.executed?.output);
  assert.match(out, /Prototype pollution/);
  assert.match(out, /Command injection/);
});

test("an optional filter parameter does not block identifier evidence (H1 on lifesci-satisfy-3: purl is optional)", async () => {
  const HA = { openapi: "3.0.0", info: { title: "Advisories" }, servers: [{ url: "https://adv2.test" }], paths: { "/lookup": { get: { operationId: "lookupAdvisories", summary: "Lookup advisories", parameters: [{ name: "purl", in: "query", required: false, schema: { type: "string" } }, { name: "repository_url", in: "query", required: false, schema: { type: "string" } }], responses: ok({ type: "array", items: { type: "object", properties: { identifiers: { type: "array", items: { type: "string" } } } } }) } } } };
  const HB = { openapi: "3.0.0", info: { title: "Vulns" }, servers: [{ url: "https://vuln2.test" }], paths: { "/vulns/{id}": { get: { operationId: "getVuln", summary: "Return a vulnerability for a given ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: ok({ type: "object", properties: { id: { type: "string" }, summary: { type: "string" } } }) } } } };
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/openapi.json") return json(u.host === "adv2.test" ? HA : HB);
    if (u.pathname === "/lookup") return json([{ identifiers: [u.searchParams.get("purl") === "pkg:npm/seed@1" ? "GHSA-cccc-3333-zzzz" : "GHSA-aaaa-1111-xxxx"] }]);
    const m = /^\/vulns\/(.+)$/.exec(u.pathname);
    return m ? json({ id: decodeURIComponent(m[1]), summary: `summary of ${decodeURIComponent(m[1])}` }) : json({}, 404);
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "gs9", fetch: f, directories: [] });
  await rc.learn({ sources: ["https://adv2.test/openapi.json", "https://vuln2.test/openapi.json"] });
  const lookup = rc.graph.list().find((c) => c.title === "Lookup advisories")!;
  const vuln = rc.graph.list().find((c) => c.title.startsWith("Return a vulnerability"))!;
  const seed = await rc.run(lookup.id, { purl: "pkg:npm/seed@1" });
  await rc.run(vuln.id, { id: (seed.output as any)[0].identifiers[0] });
  const r = await rc.compose({ have: { purl: "pkg:npm/lodash@4.17.20" }, want: "json", intent: "vulnerability summary", run: true, require: ["summary"] });
  assert.equal(r.outcome?.status, "established", JSON.stringify(r.outcome));
  assert.match(JSON.stringify(r.executed?.output), /summary of GHSA-aaaa-1111-xxxx/);
});
