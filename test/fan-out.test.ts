// Fan-out: a list of identifiers feeding a single-value lookup, one item at a time.
//
// The life-science experiment found that cross-database hops are one-to-many (an entry
// has several protein accessions; an accession has several structures), and the planner
// could not map a single-value lookup over a list. These synthetic providers reproduce
// that shape. Nothing in src/ knows any of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGraph } from "../src/core/graph.ts";
import { Ledger } from "../src/core/ledger.ts";
import { FANOUT_MAX, plan } from "../src/core/planner.ts";
import type { Capability, Port } from "../src/core/types.ts";
import { RightClick } from "../src/runtime.ts";

const obj = (properties: Record<string, unknown>) => ({ type: "object", properties });
const ok = (schema: unknown) => ({ "200": { description: "ok", content: { "application/json": { schema } } } });
const pathParam = (name: string, description?: string) => ({ name, in: "path", required: true, schema: { type: "string" }, ...(description ? { description } : {}) });
// A structure service whose entry lists the protein accessions of its chains, and a registry
// that looks one accession up. The registry types its key `id.stable`; the accessions sit inside
// undeclared array items. By the contracts alone the two never meet.
const structures = {
  openapi: "3.0.0", info: { title: "Structures" }, servers: [{ url: "https://structures.test" }],
  paths: {
    "/entry/{entry_id}": { get: { operationId: "entry", summary: "Structure entry", parameters: [pathParam("entry_id")],
      responses: ok(obj({ entry_id: { type: "string" }, chains: { type: "array", items: obj({ chain: { type: "string" }, reference_accession: { type: "string" } }) } })) } },
  },
};
const registry = {
  openapi: "3.0.0", info: { title: "Registry" }, servers: [{ url: "https://registry.test" }],
  paths: {
    "/entries/{accession}": { get: { operationId: "getEntry", summary: "Get an entry", parameters: [pathParam("accession", "Unique and stable identifier for each entry")],
      responses: ok(obj({ primaryAccession: { type: "string" }, geneName: { type: "string" } })) } },
  },
};
const GENES: Record<string, string> = { Q12345: "ABC1", P11111: "XYZ2" };
for (let i = 1; i <= 25; i++) GENES[`A${String(i).padStart(5, "0")}`] = `G${i}`;
const ENTRIES: Record<string, string[]> = {
  // Two chains share one accession; one cross-reference is another kind of identifier.
  "9ABC": ["Q12345", "P11111", "Q12345", "TM:0001"],
  "7DEF": ["P11111"],
  // Far more chains than one fan-out may look up.
  "8BIG": Object.keys(GENES).filter((k) => k.startsWith("A")),
};

function world() {
  const calls: string[] = [];
  const fetchMock = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(`${u.host}${u.pathname}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const spec = { "structures.test": structures, "registry.test": registry }[u.host];
    if (u.pathname === "/openapi.json" && spec) return json(spec);
    let m: RegExpExecArray | null;
    if (u.host === "structures.test" && (m = /^\/entry\/(\w+)$/.exec(u.pathname))) {
      const accs = ENTRIES[m[1]];
      return accs ? json({ entry_id: m[1], chains: accs.map((a, i) => ({ chain: String.fromCharCode(65 + (i % 26)), reference_accession: a })) }) : json({ error: "not found" }, 404);
    }
    if (u.host === "registry.test" && (m = /^\/entries\/(\w+)$/.exec(u.pathname))) {
      return GENES[m[1]] ? json({ primaryAccession: m[1], geneName: GENES[m[1]] }) : json({ error: "not found" }, 404);
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { fetchMock, calls };
}

async function learned() {
  const { fetchMock, calls } = world();
  const rc = await RightClick.create({ name: "fanout", fetch: fetchMock, directories: [] });
  await rc.learn({ sources: ["https://structures.test/openapi.json", "https://registry.test/openapi.json"] });
  const id = (op: string) => rc.graph.list().find((c) => c.id.endsWith(`:${op.toLowerCase()}`))!.id;
  return { rc, calls, entry: id("entry"), getEntry: id("getEntry") };
}

/** One entry looked up, then one of its accessions: the values link the list port to the registry's key. */
async function linked() {
  const w = await learned();
  assert.equal((await w.rc.run(w.entry, { entry_id: "7DEF" })).status, "completed");
  assert.equal((await w.rc.run(w.getEntry, { accession: "P11111" })).status, "completed");
  return w;
}

const listPort = (c: Capability) => c.outputs.find((o) => o.name === "chains.reference_accession")!;

test("fan-out: entry -> [accessions] -> one registry lookup per accession, explicit in the plan", async () => {
  const { rc, calls, entry, getEntry } = await learned();
  // The contract declares `chains` as opaque objects: the accessions inside are no port yet.
  assert.equal(listPort(rc.graph.get(entry)!), undefined);
  const goal = { have: { entry_id: "9ABC" }, want: "list:text", intent: "gene name" } as const;
  const before = await rc.compose(goal);
  assert.ok(!before.plans.some((p) => p.steps.some((s) => s.capability === getEntry)), "a text list cannot reach a stable identifier by type");

  assert.equal((await rc.run(entry, { entry_id: "7DEF" })).status, "completed");
  assert.equal((await rc.run(getEntry, { accession: "P11111" })).status, "completed");
  // Values seen flowing out of the list into the registry make the path an observed list port of the scheme.
  const list = listPort(rc.graph.get(entry)!);
  assert.equal(list?.observed, true);
  assert.equal(list.type, "list:id.stable");
  assert.deepEqual(list.schemes, ["scheme:accession"]);

  const after = await rc.compose({ ...goal, run: true });
  const p = after.plans[0];
  assert.deepEqual(p.steps.map((s) => s.capability), [entry, getEntry], JSON.stringify(after.plans.map((x) => x.summary)));
  const fan = p.steps[1].bindings.find((b) => b.port === "accession")!;
  assert.equal(fan.from, "0.chains.reference_accession");
  // Explicit in what context_compose returns: the binding says it maps, how far, and over which shapes.
  assert.deepEqual(fan.each, { max: FANOUT_MAX, shapes: ["6A"] });
  assert.match(p.summary, /Get an entry \(each\)$/);
  assert.equal(p.resultType, "list:text");
  assert.equal(p.result, "1.geneName");

  assert.equal(after.executed?.status, "completed", JSON.stringify(after.executed?.attempts));
  // Duplicates looked up once; the other kind of identifier is not handed to the registry.
  assert.deepEqual(after.executed?.output, ["ABC1", "XYZ2"]);
  assert.deepEqual(after.executed?.fanOuts, [{ step: 1, capability: getEntry, port: "accession", items: 3, ran: 2, skipped: 1, max: FANOUT_MAX }]);
  assert.equal(after.executed?.runs.length, 3, "one entry call and one call per distinct accession, in order");
  const lookups = calls.filter((c) => c.startsWith("registry.test/entries/"));
  assert.deepEqual(lookups.slice(-2), ["registry.test/entries/Q12345", "registry.test/entries/P11111"]);
  assert.ok(!calls.includes("registry.test/entries/TM:0001"));

  // The proven pipeline crystallizes with its fan-out and runs again as one capability.
  assert.ok(after.crystallized, "a verified-by-run multi-step plan crystallizes");
  const saved = rc.graph.get(after.crystallized!.id)!;
  assert.equal(saved.invoke.kind, "composite");
  const again = await rc.run(saved.id, { entry_id: "7DEF" });
  assert.equal(again.status, "completed", again.error);
  assert.deepEqual(again.output, ["XYZ2"]);
});

test("fan-out: a list longer than the cap is refused before any item call, without re-reading contracts", async () => {
  const { rc, calls, getEntry } = await linked();
  const learnedBefore = calls.filter((c) => c.endsWith("/openapi.json")).length;
  const lookupsBefore = calls.filter((c) => c.startsWith("registry.test/entries/")).length;
  const r = await rc.compose({ have: { entry_id: "8BIG" }, want: "list:text", intent: "gene name", run: true });
  assert.ok(r.plans[0].steps.some((s) => s.capability === getEntry && s.bindings.some((b) => b.each)), JSON.stringify(r.plans.map((p) => p.summary)));
  assert.equal(r.executed?.status, "failed");
  const refused = r.executed!.attempts.find((a) => a.failed === getEntry)!;
  assert.match(refused.error, new RegExp(`fan-out over 25 items of 0\\.chains\\.reference_accession exceeds the cap of ${FANOUT_MAX}; not run`));
  assert.match(refused.healing ?? "", /fan-out cap/);
  assert.equal(calls.filter((c) => c.startsWith("registry.test/entries/")).length, lookupsBefore, "no lookup ran: the cap is checked before the first item");
  assert.equal(calls.filter((c) => c.endsWith("/openapi.json")).length, learnedBefore, "a refusal is not provider drift: no contract is re-read");
  assert.equal(r.crystallized, undefined);
});

test("fan-out: a failing item fails the step; nothing is filled in", async () => {
  const { rc, getEntry } = await linked();
  ENTRIES["6BAD"] = ["Q12345", "Z99999"];
  try {
    const r = await rc.compose({ have: { entry_id: "6BAD" }, want: "list:text", intent: "gene name", run: true });
    assert.equal(r.executed?.status, "failed");
    const failed = r.executed!.attempts.find((a) => a.failed === getEntry)!;
    assert.match(failed.error, /item "Z99999", 2 of 2/);
  } finally {
    delete ENTRIES["6BAD"];
  }
});

// Plan-level rules, on hand-built capabilities.
function cap(id: string, inputs: Port[], outputs: Port[], extra: Partial<Capability> = {}): Capability {
  return { id, title: id, description: "", provider: `p:${id}`, source: "builtin", inputs, outputs, risk: "read", tags: [], invoke: { kind: "builtin", fn: id }, ...extra };
}
const port = (name: string, type: string, required = true): Port => ({ name, type, required });
function graph(...caps: Capability[]) {
  const g = new CapabilityGraph();
  for (const c of caps) g.add({ provider: { id: c.provider, title: c.id, source: "builtin", origin: "t", learnedAt: "", capabilityIds: [] }, capabilities: [c] });
  return g;
}

test("fan-out rules: specific types only, read-only steps only, one list per step, and never silently", () => {
  const search = cap("search", [port("q", "text")], [port("hits", "list:id.record"), port("labels", "list:text")]);
  const lookup = cap("lookup", [port("record_id", "id.record")], [port("size", "number")]);
  const g = graph(search, lookup,
    cap("delete", [port("record_id", "id.record")], [port("deleted", "boolean")], { risk: "destructive" }),
    cap("echo", [port("text", "text")], [port("echoed", "text")]),
    cap("pair", [port("left", "id.record"), port("right", "id.record")], [port("distance", "number")]),
  );
  const plans = plan(g, new Ledger(), { have: { q: "text" }, want: "list:number", limit: 10 });
  const fanned = plans.find((p) => p.steps.map((s) => s.capability).join() === "search,lookup");
  assert.ok(fanned, JSON.stringify(plans.map((p) => p.summary)));
  assert.deepEqual(fanned!.steps[1].bindings, [{ port: "record_id", from: "0.hits", each: { max: FANOUT_MAX } }], "a typed fan-out carries no shape filter");
  assert.equal(fanned!.resultType, "list:number");
  for (const p of plans) {
    assert.ok(!p.steps.some((s) => s.capability === "pair"), "two ports fed from one list would be a cross product nobody chose");
    for (const s of p.steps) for (const b of s.bindings) {
      // A list reaches a single-value port only through an explicit fan-out binding.
      const m = /^(\d+)\.(.*)$/.exec(b.from);
      const src = m && g.get(p.steps[Number(m[1])].capability)!.outputs.find((o) => o.name === m[2]);
      const dst = g.get(s.capability)!.inputs.find((i) => i.name === b.port)!;
      if (src?.type.startsWith("list:") && !dst.type.startsWith("list:")) assert.ok(b.each, `${p.summary}: ${b.from} -> ${b.port}`);
    }
  }
  const all = plan(g, new Ledger(), { have: { q: "text" }, want: "json", limit: 20, maxSteps: 3 });
  assert.ok(!all.some((p) => p.steps.some((s) => s.capability === "delete")), "a destructive step never maps over a list");
  assert.ok(!all.some((p) => p.steps.some((s) => s.capability === "echo" && s.bindings.some((b) => b.each))), "a list of plain text fans out by type nowhere");
  // A single value that fits is preferred over mapping a list.
  const single = plan(graph(search, lookup, cap("first", [port("q", "text")], [port("record_id", "id.record")])), new Ledger(), { have: { q: "text" }, want: "number" });
  assert.deepEqual(single[0].steps.map((s) => s.capability), ["first", "lookup"]);
  assert.ok(!single[0].steps[1].bindings[0].each);
});

test("fan-out rules: a list seen to carry a port's identifiers beats a single value that only shares its declared type", () => {
  // Found on real contracts: a registry record has a single `id` that lexical inference typed like
  // a structure id, and a cross-reference list that evidence showed to carry structure ids.
  const record = cap("record", [port("accession", "id.stable")], [port("id", "id.entry"), { ...port("xrefs.id", "list:id.entry"), schemes: ["scheme:entry_id"] }]);
  const entry = cap("entry", [{ ...port("entry_id", "id.entry"), schemes: ["scheme:entry_id"] }], [port("resolution", "number")]);
  const [best] = plan(graph(record, entry), new Ledger(), { have: { accession: "id.stable" }, want: "list:number" });
  assert.deepEqual(best?.steps[1].bindings, [{ port: "entry_id", from: "0.xrefs.id", each: { max: FANOUT_MAX } }], JSON.stringify(best));
  // Without that evidence the single typed value is still preferred over mapping the list.
  const plain = cap("entry", [port("entry_id", "id.entry")], [port("resolution", "number")]);
  const [single] = plan(graph(record, plain), new Ledger(), { have: { accession: "id.stable" }, want: "number" });
  assert.deepEqual(single?.steps[1].bindings, [{ port: "entry_id", from: "0.id" }]);
});
