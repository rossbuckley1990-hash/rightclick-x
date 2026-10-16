import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGraph, signature } from "../src/core/graph.ts";
import { identifierShaped } from "../src/core/identities.ts";
import { Ledger } from "../src/core/ledger.ts";
import { plan } from "../src/core/planner.ts";
import type { Capability, Port } from "../src/core/types.ts";
import { RightClick } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";

// Three synthetic providers that name one identifier scheme three ways, as the life-science
// experiment found in real contracts: a registry whose `accession` is a "stable identifier"
// (id.stable), a feature service whose `accession` is undescribed (text), and a structure
// service that calls it `protein_id` (id.protein). Nothing in src/ knows any of them.
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties });
const ok = (schema: unknown) => ({ "200": { description: "ok", content: { "application/json": { schema } } } });
const pathParam = (name: string, description?: string) => ({ name, in: "path", required: true, schema: { type: "string" }, ...(description ? { description } : {}) });
const registry = {
  openapi: "3.0.0", info: { title: "Registry" }, servers: [{ url: "https://registry.test" }],
  paths: {
    "/entries/{accession}": { get: { operationId: "getEntry", summary: "Get an entry", parameters: [pathParam("accession", "Unique and stable identifier for each entry"), { name: "fields", in: "query", schema: { type: "string" } }],
      responses: ok(obj({ primaryAccession: { type: "string" }, geneName: { type: "string" }, xrefs: { type: "array", items: obj({ database: { type: "string" }, id: { type: "string" } }) } })) } },
    "/search": { get: { operationId: "search", summary: "Search entries", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
      responses: ok(obj({ query: { type: "string" }, hits: { type: "number" } })) } },
  },
};
const features = {
  openapi: "3.0.0", info: { title: "Features" }, servers: [{ url: "https://features.test" }],
  paths: {
    "/features/{accession}": { get: { operationId: "features", summary: "Sequence features", parameters: [pathParam("accession")], responses: ok(obj({ accession: { type: "string" }, featureCount: { type: "number" } })) } },
    "/variation/{accession}": { get: { operationId: "variation", summary: "Variants", parameters: [pathParam("accession")], responses: ok(obj({ accession: { type: "string" }, variantCount: { type: "number" } })) } },
    "/items/{id}": { get: { operationId: "item", summary: "Item", parameters: [pathParam("id")], responses: ok(obj({ id: { type: "string" } })) } },
  },
};
const structures = {
  openapi: "3.0.0", info: { title: "Structures" }, servers: [{ url: "https://structures.test" }],
  paths: {
    "/protein/{protein_id}": { get: { operationId: "protein", summary: "Best structure resolution for a protein", parameters: [pathParam("protein_id")],
      responses: ok(obj({ container_identifiers: obj({ protein_id: { type: "string" } }), resolution: { type: "number" } })) } },
    "/entry/{entry_id}": { get: { operationId: "entry", summary: "Structure entry", parameters: [pathParam("entry_id")],
      responses: ok(obj({ rcsb_id: { type: "string" }, polymer: obj({ reference_accession: { type: "string" } }) })) } },
  },
};
const ENTRIES: Record<string, { gene: string; xrefs: Array<{ database: string; id: string }> }> = {
  Q12345: { gene: "ABC1", xrefs: [{ database: "STRUCT", id: "9ABC" }, { database: "TERM", id: "TM:0001" }] },
  P11111: { gene: "XYZ2", xrefs: [] },
};
const STRUCTS: Record<string, { protein: string; resolution: number }> = { "9ABC": { protein: "Q12345", resolution: 1.9 }, "7DEF": { protein: "P11111", resolution: 2.4 } };
const RES: Record<string, number> = { Q12345: 1.9, P11111: 2.4 };

const fetchMock = (async (input: any) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const spec = { "registry.test": registry, "features.test": features, "structures.test": structures }[u.host];
  if (u.pathname === "/openapi.json" && spec) return json(spec);
  let m: RegExpExecArray | null;
  if (u.host === "registry.test" && (m = /^\/entries\/(\w+)$/.exec(u.pathname))) {
    const e = ENTRIES[m[1]];
    if (!e) return json({ error: "not found" }, 404);
    // `fields` reshapes the record, as real APIs' field selections do.
    if (u.searchParams.get("fields")) return json({ primaryAccession: m[1], extra: { accession_ref: m[1] } });
    return json({ primaryAccession: m[1], geneName: e.gene, xrefs: e.xrefs });
  }
  if (u.host === "registry.test" && u.pathname === "/search") return json({ query: u.searchParams.get("q"), hits: 1 });
  if (u.host === "features.test" && (m = /^\/(features|variation)\/(\w+)$/.exec(u.pathname))) {
    if (m[2] === "Z99999") return json({ accession: "OTHER1", featureCount: 0 });
    return ENTRIES[m[2]] ? json({ accession: m[2], featureCount: 3, variantCount: 7 }) : json({ error: "not found" }, 404);
  }
  if (u.host === "features.test" && (m = /^\/items\/(\w+)$/.exec(u.pathname))) return json({ id: m[1] });
  if (u.host === "structures.test" && (m = /^\/protein\/(\w+)$/.exec(u.pathname))) return RES[m[1]] ? json({ container_identifiers: { protein_id: m[1] }, resolution: RES[m[1]] }) : json({ error: "not found" }, 404);
  if (u.host === "structures.test" && (m = /^\/entry\/(\w+)$/.exec(u.pathname))) return STRUCTS[m[1]] ? json({ rcsb_id: m[1], polymer: { reference_accession: STRUCTS[m[1]].protein } }) : json({ error: "not found" }, 404);
  return json({ error: "not found" }, 404);
}) as typeof fetch;

const SOURCES = ["https://registry.test/openapi.json", "https://features.test/openapi.json", "https://structures.test/openapi.json"];

async function world(store?: MemoryStore) {
  const rc = await RightClick.create({ name: "ids", fetch: fetchMock, directories: [], store });
  if (!store?.state) await rc.learn({ sources: SOURCES });
  const id = (op: string) => {
    const c = rc.graph.list().find((c) => c.id.endsWith(`:${op.toLowerCase()}`));
    if (!c) throw new Error(`no ${op} among ${rc.graph.list().filter((c) => c.source === "openapi").map((c) => c.id).join(", ")}`);
    return c.id;
  };
  return { rc, id };
}

const input = (c: Capability, name: string): Port => c.inputs.find((p) => p.name === name)!;
const downstream = (rc: RightClick, from: string) => rc.graph.neighbors(from).downstream;

test("identifier schemes: three providers' differently typed accession ports are unlinked until values link them", async () => {
  const { rc, id } = await world();
  const [getEntry, feats, variation, protein, entry] = ["getEntry", "features", "variation", "protein", "entry"].map(id);
  // What the contracts alone say: three different types for one identifier.
  assert.deepEqual([input(rc.graph.get(getEntry)!, "accession").type, input(rc.graph.get(feats)!, "accession").type, input(rc.graph.get(protein)!, "protein_id").type], ["id.stable", "text", "id.protein"]);
  assert.ok(!downstream(rc, getEntry).includes(protein), "no typed link registry -> structures before evidence");
  assert.ok(!downstream(rc, protein).includes(getEntry), "no typed link structures -> registry before evidence");
  assert.ok(downstream(rc, entry).includes(feats), "any text output fills the undescribed text `accession` before evidence");
  const before = await rc.compose({ have: { accession: "P11111" }, want: "number", intent: "structure resolution" });
  assert.ok(!before.plans.some((p) => p.steps.some((s) => s.capability === protein)), "a caller's accession cannot reach the structure service by type");

  // Three successful lookups of one value, each answered by a record naming it in a key field.
  for (const [c, args] of [[getEntry, { accession: "Q12345" }], [feats, { accession: "Q12345" }], [protein, { protein_id: "Q12345" }]] as const) {
    assert.equal((await rc.run(c, args)).status, "completed");
  }
  const schemes = rc.graph.identities.schemes(rc.graph.list());
  assert.equal(schemes.length, 1, JSON.stringify(schemes, null, 1));
  const s = schemes[0];
  assert.equal(s.id, "scheme:accession");
  for (const c of [getEntry, feats, variation]) assert.deepEqual(input(rc.graph.get(c)!, "accession").schemes, [s.id]);
  assert.deepEqual(input(rc.graph.get(protein)!, "protein_id").schemes, [s.id]);
  assert.equal(Object.values(s.via).filter((v) => v === "sibling").length, 1, "the unobserved same-named `accession` of the features contract joins as a sibling");
  // Declared types are untouched: schemes only add links.
  assert.equal(input(rc.graph.get(feats)!, "accession").type, "text");

  assert.ok(downstream(rc, getEntry).includes(protein), "registry primaryAccession now feeds the structure service");
  assert.ok(downstream(rc, protein).includes(getEntry), "structures container_identifiers.protein_id now feeds the registry");
  assert.ok(downstream(rc, protein).includes(variation), "…and the never-called sibling operation");
  // Known to take one kind of identifier, the text port no longer takes arbitrary produced text.
  assert.ok(!downstream(rc, entry).includes(feats), "an output never seen to carry these identifiers no longer feeds the scheme's text ports");
  const junk = plan(rc.graph, rc.ledger, { have: { entry_id: "id.entry" }, want: "number", intent: "sequence features" });
  assert.ok(!junk.some((p) => p.steps.some((s) => s.capability === feats)), JSON.stringify(junk.map((p) => p.summary)));

  // A caller's value named and shaped like the scheme's identifiers carries the scheme.
  const after = await rc.compose({ have: { accession: "P11111" }, want: "number", intent: "structure resolution", run: true });
  assert.equal(after.plans[0].steps[0].capability, protein, JSON.stringify(after.plans.map((p) => p.summary)));
  assert.equal(after.executed?.status, "completed");
  assert.equal(after.executed?.output, 2.4);
});

test("identifier schemes: a value flowing out of one provider and successfully into another links the output port", async () => {
  const { rc, id } = await world();
  const [entry, getEntry] = ["entry", "getEntry"].map(id);
  const chain = () => plan(rc.graph, rc.ledger, { have: { entry_id: "id.entry" }, want: "text", intent: "gene name" }).find((p) => p.steps.map((s) => s.capability).join() === [entry, getEntry].join());
  assert.equal(chain(), undefined, "polymer.reference_accession (text) cannot fill a stable identifier by type");
  await rc.run(entry, { entry_id: "9ABC" });
  await rc.run(getEntry, { accession: "Q12345" });
  const flow = rc.graph.identities.evidence().filter((l) => l.kind === "flow");
  assert.deepEqual(flow.map((l) => [l.from.split("\u0001")[2], l.to.split("\u0001")[2], l.value]), [["polymer.reference_accession", "accession", "Q12345"]]);
  const p = chain();
  assert.ok(p, "structure entry -> registry entry is now a typed chain");
  assert.deepEqual(p!.steps[1].bindings, [{ port: "accession", from: "0.polymer.reference_accession" }]);
});

test("identifier schemes: no evidence from failures, missing echoes, free-text ports, words or numbers", async () => {
  const { rc, id } = await world();
  const [getEntry, feats, search, item] = ["getEntry", "features", "search", "item"].map(id);
  assert.equal((await rc.run(getEntry, { accession: "N00000" })).status, "failed");
  assert.equal((await rc.run(feats, { accession: "N00000" })).status, "failed");
  // Success, but the answer names a different record: not evidence the value is this port's key.
  await rc.run(getEntry, { accession: "Z99999" }).catch(() => undefined);
  await rc.run(feats, { accession: "Z99999" });
  // A search box echoes whatever it was given.
  await rc.run(search, { q: "Q12345" });
  await rc.run(getEntry, { accession: "Q12345" });
  // A generic `id` that echoes a word or number.
  await rc.run(item, { id: "apoptosis" });
  await rc.run(item, { id: "9606" });
  const links = rc.graph.identities.evidence();
  assert.ok(links.every((l) => !l.from.includes(search) && !l.to.includes(search)), JSON.stringify(links));
  assert.ok(links.every((l) => !l.to.includes(item)));
  assert.ok(links.every((l) => l.kind !== "co-accept"), "only one provider ever answered for Q12345");
  assert.equal(rc.graph.identities.schemes(rc.graph.list()).filter((s) => s.members.some((m) => m.includes(feats))).length, 0);
  assert.deepEqual(["P04637", "4HHB", "GO:0006915", "TP53"].map(identifierShaped), [true, true, true, true]);
  assert.deepEqual(["apoptosis", "9606", "2026-10-16", "1.2.3", "Homo sapiens", "a"].map(identifierShaped), [false, false, false, false, false, false]);
});

test("identifier schemes: paths seen only in a reshaped response never become ports", async () => {
  const { rc, id } = await world();
  const [getEntry, feats] = ["getEntry", "features"].map(id);
  await rc.run(getEntry, { accession: "Q12345", fields: "accession" });
  await rc.run(feats, { accession: "Q12345" });
  assert.ok(!rc.graph.get(getEntry)!.outputs.some((p) => p.name === "extra.accession_ref"), "an optional `fields` changed the shape: not a port of the operation");
  assert.ok(rc.graph.get(getEntry)!.outputs.some((p) => p.name === "primaryAccession" && p.schemes?.length), "declared ports still count");
});

test("identifier schemes: evidence persists, and adds neither drift nor retirements", async () => {
  const store = new MemoryStore();
  const { rc, id } = await world(store);
  const [getEntry, feats] = ["getEntry", "features"].map(id);
  const sigs = rc.graph.list().map(signature);
  await rc.run(getEntry, { accession: "Q12345" });
  await rc.run(feats, { accession: "Q12345" });
  assert.deepEqual(rc.graph.list().map(signature), sigs, "schemes are not part of any contract signature");
  await rc.flush();
  const again = await world(store);
  assert.deepEqual(input(again.rc.graph.get(feats)!, "accession").schemes, ["scheme:accession"]);
  const relearn = await again.rc.learn({ sources: SOURCES });
  for (const r of relearn.results) for (const l of r.learned) assert.equal(l.drift?.changed, false, JSON.stringify(l.drift));
  assert.deepEqual(input(again.rc.graph.get(feats)!, "accession").schemes, ["scheme:accession"], "re-learned capabilities get the scheme again");
});

// Unit level: an output that carries identifiers of several kinds (a cross-reference list)
// feeds each scheme without merging them, and lists never fill single-value ports.
function cap(id: string, provider: string, inputs: Array<[string, string]>, outputs: Array<[string, string]>): Capability {
  return {
    id, title: id, description: "", provider, source: "openapi", risk: "read", tags: [],
    inputs: inputs.map(([name, type]) => ({ name, type, required: true })),
    outputs: outputs.map(([name, type]) => ({ name, type, required: false })),
    invoke: { kind: "builtin", fn: id },
  };
}

test("identifier schemes: a mixed cross-reference list feeds two schemes without merging them; cardinality is kept", () => {
  const g = new CapabilityGraph();
  const add = (...cs: Capability[]) => g.add({ provider: { id: cs[0].provider, title: cs[0].provider, source: "openapi", origin: "t", learnedAt: "", capabilityIds: [] }, capabilities: cs });
  const xrefs = cap("reg:get", "reg", [["accession", "id.stable"]], [["xrefs.id", "list:text"], ["primaryAccession", "text"]]);
  const struct = cap("st:entry", "st", [["entry_id", "id.entry"]], [["rcsb_id", "id.rcsb"]]);
  const structs = cap("st:entries", "st", [["entry_ids", "list:text"]], [["rcsb_id", "list:id.rcsb"]]);
  const term = cap("onto:term", "onto", [["term_id", "id.term"]], [["term_id", "id.term"]]);
  add(xrefs);
  add(struct, structs);
  add(term);
  const ids = g.identities;
  ids.observe(xrefs, { accession: "Q12345" }, { primaryAccession: "Q12345", xrefs: [{ id: "9ABC" }, { id: "TM:0001" }] });
  ids.observe(struct, { entry_id: "9ABC" }, { rcsb_id: "9ABC" });
  ids.observe(term, { term_id: "TM:0001" }, { term_id: "TM:0001" });
  ids.observe(structs, { entry_ids: ["9ABC"] }, [{ rcsb_id: "9ABC" }]);
  g.relink();
  const schemes = ids.schemes(g.list());
  const of = (c: Capability, name: string) => schemes.find((s) => s.members.some((m) => m.startsWith(`${c.id}\u0001in\u0001${name}`)))!;
  assert.notEqual(of(struct, "entry_id").id, of(term, "term_id").id, "the two kinds of identifier stay two schemes");
  assert.equal(of(struct, "entry_id").id, of(structs, "entry_ids").id, "a list of entry ids takes the same scheme");
  assert.deepEqual(xrefs.outputs.find((p) => p.name === "xrefs.id")!.schemes, [of(struct, "entry_id").id, of(term, "term_id").id].sort());
  const out = g.neighbors(xrefs.id).downstream;
  assert.ok(out.includes(structs.id), "a list of cross-references fills a list of entry ids");
  assert.ok(!out.includes(struct.id) && !out.includes(term.id), "a list never fills a single-value port: the planner has no fan-out");
  const plans = plan(g, new Ledger(), { have: { accession: "id.stable" }, want: "list:id.rcsb" });
  assert.deepEqual(plans[0]?.steps.map((s) => s.capability), [xrefs.id, structs.id]);
});
