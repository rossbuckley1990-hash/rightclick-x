import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";

const ORIGIN = "https://catalog.test";
const SOURCE = `${ORIGIN}/openapi.json`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const op = (operationId: string, param: string) => ({
  get: {
    operationId,
    parameters: [{ name: param, in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
  },
});
const contract = (servers: string, paths: Record<string, unknown>) => ({ openapi: "3.0.0", info: { title: "Catalog", version: "1" }, servers: [{ url: servers }], paths });

/**
 * A catalog API whose provider changes it between releases. `routes` maps a
 * path to its handler; anything else is a 404, as when an old version is shut down.
 */
function catalog(initial: { spec: unknown; routes: Record<string, () => Response> }) {
  let current = initial;
  const calls: string[] = [];
  const contract = { reads: 0 };
  const handler = async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/openapi.json") {
      contract.reads++;
      return json(current.spec);
    }
    calls.push(pathname);
    for (const [pattern, fn] of Object.entries(current.routes)) {
      if (new RegExp(`^${pattern.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(pathname)) return fn();
    }
    return json({ error: "not found" }, 404);
  };
  return { handler, calls, contract, release: (next: typeof initial) => (current = next) };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const idOf = (rc: RightClick, operationId: string) => rc.graph.list().find((c) => c.provider.startsWith("openapi:") && norm(c.id.split(":").pop()!) === norm(operationId))!.id;

test("a plain run of a moved operation re-learns its contract, reports the drift and retries the same operation", async () => {
  const svc = catalog({ spec: contract("/svc/v1", { "/items/{item}/parts": op("listParts", "item") }), routes: { "/svc/v1/items/{item}/parts": () => json(["bolt"]) } });
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "listParts");
  assert.equal((await rc.run(id, { item: "a1" })).status, "completed");

  // v1 is shut down; the same operation now lives under /svc/v2.
  svc.release({ spec: contract("/svc/v2", { "/items/{item}/parts": op("listParts", "item") }), routes: { "/svc/v2/items/{item}/parts": () => json(["bolt", "nut"]) } });
  const r = await rc.run(id, { item: "a1" });
  assert.equal(r.status, "completed", r.error);
  assert.deepEqual(r.output, ["bolt", "nut"]);
  assert.match(r.healing!.error, /404/);
  assert.match(r.healing!.note, /API drift at https:\/\/catalog\.test\/openapi\.json: \+0 −0 ~1/);
  assert.deepEqual(r.healing!.drift!.modified, [id]);
  assert.deepEqual(r.healing!.drift!.changedMeaning, [], "a moved base is not a change of meaning");
  assert.equal(r.healing!.retried, id);
  assert.equal(r.changedMeaning, undefined);

  // The graph now describes v2: the next call needs no repair.
  const again = await rc.run(id, { item: "a1" });
  assert.equal(again.status, "completed");
  assert.equal(again.healing, undefined);
  assert.equal((await rc.verifyReceipts()).intact, true);
});

test("a failed plain run with no contract change fails with the re-reflection note", async () => {
  let up = true;
  const svc = catalog({ spec: contract("/svc/v1", { "/items/{item}/parts": op("listParts", "item") }), routes: { "/svc/v1/items/{item}/parts": () => (up ? json(["bolt"]) : json({ error: "busy" }, 503)) } });
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  up = false;
  const r = await rc.run(idOf(rc, "listParts"), { item: "a1" });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /503.*re-reflected https:\/\/catalog\.test\/openapi\.json: no contract change/);
  assert.equal(r.healing!.drift!.changed, false);
  assert.equal(r.healing!.retried, undefined);
});

test("an operation id reassigned to a different operation is refused until acknowledged, and names its successor", async () => {
  const classes = () => json(["child-a", "child-b"]);
  const individuals = () => json([]);
  const svc = catalog({ spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: { "/api/classes/{term}/children": classes } });
  const store = new MemoryStore();
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [], store });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "getChildren");
  assert.deepEqual((await rc.run(id, { term: "T1" })).output, ["child-a", "child-b"]);

  // The next release reuses the operationId for a different endpoint; the old one gets a suffix.
  svc.release({
    spec: contract("/api", { "/individuals/{term}/children": op("getChildren", "term"), "/classes/{term}/children": op("getChildren_1", "term") }),
    routes: { "/api/classes/{term}/children": classes, "/api/individuals/{term}/children": individuals },
  });
  const learned = await rc.learn({ source: SOURCE });
  const successor = idOf(rc, "getChildren_1");
  assert.deepEqual(learned.results[0].drift!.changedMeaning, [id]);

  const before = svc.calls.length;
  const runsBefore = rc.ledger.get(id)!.runs;
  const refused = await rc.run(id, { term: "T1" });
  assert.equal(refused.status, "failed");
  assert.equal(svc.calls.length, before, "the new operation was not called");
  assert.match(refused.error!, /changed meaning.*GET \/classes\/\{\}\/children.*GET \/individuals\/\{\}\/children.*Not run/);
  assert.deepEqual({ ...refused.changedMeaning, at: undefined }, { id, source: SOURCE, at: undefined, before: "GET /classes/{}/children", after: "GET /individuals/{}/children", successor });
  assert.equal(rc.ledger.get(id)!.runs, runsBefore, "a refusal is not evidence about the operation");
  assert.deepEqual((await rc.run(successor, { term: "T1" })).output, ["child-a", "child-b"]);

  // The refusal survives a restart.
  await rc.flush();
  const restarted = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [], store });
  assert.match((await restarted.run(id, { term: "T1" })).error ?? "", /changed meaning/);

  // Having seen the change, the caller may run the new operation; after that the id is ordinary again.
  const acknowledged = await restarted.run(id, { term: "T1" }, { acknowledgeChange: true });
  assert.equal(acknowledged.status, "completed");
  assert.deepEqual(acknowledged.output, []);
  assert.equal(acknowledged.changedMeaning?.after, "GET /individuals/{}/children");
  const plain = await restarted.run(id, { term: "T1" });
  assert.equal(plain.status, "completed");
  assert.equal(plain.changedMeaning, undefined);
});

test("re-learning an id back to the operation callers last saw clears its refusal", async () => {
  const v1 = { spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: { "/api/classes/{term}/children": () => json(["child-a"]) } };
  const svc = catalog(v1);
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "getChildren");
  svc.release({ spec: contract("/api", { "/individuals/{term}/children": op("getChildren", "term") }), routes: {} });
  await rc.learn({ source: SOURCE });
  assert.ok(rc.meaningChanges.has(id));
  svc.release(v1);
  await rc.learn({ source: SOURCE });
  assert.equal(rc.meaningChanges.has(id), false);
  assert.deepEqual((await rc.run(id, { term: "T1" })).output, ["child-a"]);
});

test("when a failed id now names a different operation, repair retries the operation it used to name, never the new one", async () => {
  const svc = catalog({ spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: { "/api/classes/{term}/children": () => json(["child-a"]) } });
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "getChildren");

  // Class children move to /api/v2 under a suffixed id; the old id now names individuals.
  svc.release({
    spec: contract("/api", { "/individuals/{term}/children": op("getChildren", "term"), "/v2/classes/{term}/children": op("getChildren_1", "term") }),
    routes: { "/api/v2/classes/{term}/children": () => json(["child-a"]), "/api/individuals/{term}/children": () => json([]) },
  });
  const r = await rc.run(id, { term: "T1" });
  assert.equal(r.status, "failed", "a different path is a different operation: no equivalent exists");
  assert.match(r.error!, /now calls GET \/individuals\/\{\}\/children.*no equivalent of GET \/classes\/\{\}\/children/);
  assert.ok(!svc.calls.some((p) => p.startsWith("/api/individuals")), "the new operation was not called");

  // With an exact successor, repair follows the operation, not the id.
  const svc2 = catalog({ spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: {} });
  const rc2 = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc2.handler }), directories: [] });
  await rc2.learn({ source: SOURCE });
  svc2.release({
    spec: contract("/api/v2", { "/individuals/{term}/children": op("getChildren", "term"), "/classes/{term}/children": op("getChildren_1", "term") }),
    routes: { "/api/v2/classes/{term}/children": () => json(["child-a"]), "/api/v2/individuals/{term}/children": () => json([]) },
  });
  const healed = await rc2.run(id, { term: "T1" });
  assert.equal(healed.status, "completed", healed.error);
  assert.deepEqual(healed.output, ["child-a"]);
  assert.equal(healed.healing!.retried, idOf(rc2, "getChildren_1"));
  assert.ok(healed.healing!.note.endsWith(`retried its operation, now ${idOf(rc2, "getChildren_1")}`), healed.healing!.note);
  assert.ok(!svc2.calls.some((p) => p.includes("/individuals/")));
  assert.match((await rc2.run(id, { term: "T1" })).error ?? "", /changed meaning/, "the id itself stays refused");
});

test("plan steps are chosen by their current contract: compose is not refused by a changed id", async () => {
  const svc = catalog({ spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: { "/api/classes/{term}/children": () => json(["child-a"]) } });
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "getChildren");
  svc.release({ spec: contract("/api", { "/individuals/{term}/children": op("getChildren", "term") }), routes: { "/api/individuals/{term}/children": () => json(["ind-1"]) } });
  await rc.learn({ source: SOURCE });
  assert.ok(rc.meaningChanges.has(id));
  const r = await rc.compose({ have: { term: "T1" }, want: "json", through: [id], run: true, crystallize: false });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.executed?.attempts));
  assert.ok(rc.meaningChanges.has(id), "a plan step does not acknowledge the change for id-addressed callers");
});

test("repeated failures re-read the contract once, not on every call", async () => {
  const svc = catalog({ spec: contract("/svc/v1", { "/items/{item}/parts": op("listParts", "item") }), routes: { "/svc/v1/items/{item}/parts": () => json({ error: "busy" }, 503) } });
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: SOURCE });
  const id = idOf(rc, "listParts");
  const reads = svc.contract.reads;
  const first = await rc.run(id, { item: "a1" });
  const second = await rc.run(id, { item: "a1" });
  assert.equal(svc.contract.reads, reads + 1);
  assert.match(first.healing!.note, /no contract change/);
  assert.match(second.healing!.note, /re-read \d+s ago for an earlier failure; not re-read again yet/);
  assert.match(second.error!, /503/);
});

test("a saved goal anchored on an id follows the operation it was built on when the id is reassigned", async () => {
  const classes = () => json(["child-a", "child-b"]);
  const v1 = { spec: contract("/api", { "/classes/{term}/children": op("getChildren", "term") }), routes: { "/api/classes/{term}/children": classes } };
  for (const successor of [true, false]) {
    const svc = catalog(v1);
    const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
    await rc.learn({ source: SOURCE });
    const id = idOf(rc, "getChildren");
    const published = await rc.compose({ have: { term: "T1" }, want: "json", through: [id], run: true, publish: "Term children" });
    assert.equal(published.executed?.status, "completed");
    assert.equal(rc.published.get("term-children")!.anchors![0].operation, "GET /classes/{}/children");

    // Same id, same title, same input types: only the operation tells them apart.
    svc.release({
      spec: contract("/api", { "/individuals/{term}/children": op("getChildren", "term"), ...(successor ? { "/classes/{term}/children": op("getChildren_1", "term") } : {}) }),
      routes: { "/api/classes/{term}/children": classes, "/api/individuals/{term}/children": () => json([]) },
    });
    await rc.learn({ source: SOURCE });
    const r = await rc.run("goal:term-children", { term: "T1" });
    assert.ok(!svc.calls.some((p) => p.startsWith("/api/individuals")), "the reassigned id's new operation is never called");
    if (successor) {
      assert.equal(r.status, "completed", r.error);
      assert.deepEqual(r.output, ["child-a", "child-b"]);
      assert.ok(r.steps!.some((s) => rc.runs.get(s)?.capability === idOf(rc, "getChildren_1")));
    } else {
      assert.equal(r.status, "failed");
      assert.match(r.error!, /required anchor contract changed meaning: .*getchildren \(it called GET \/classes\/\{\}\/children, it now calls GET \/individuals\/\{\}\/children\)/);
    }
  }
});
