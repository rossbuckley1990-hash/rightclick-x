import { test } from "node:test";
import assert from "node:assert/strict";
import { ReceiptChain } from "../src/core/ledger.ts";
import { RightClick } from "../src/runtime.ts";
import type { Directory } from "../src/reflectors/directories.ts";
import { learnAll, MemoryStore, URLS, world } from "./helpers.ts";
import { routerFetch, SERVICES } from "../demo/services.ts";

const GOAL = { have: { place: "Lisbon", language: "es" }, want: "text", intent: "weather translated" };

test("compose finds a 3-protocol pipeline nobody wrote, runs it, verifies it", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const r = await rc.compose({ ...GOAL, run: true, verify: [{ op: "contains", value: "°C" }] });
  assert.deepEqual(r.plans[0].titles, ["Geocode", "Weather forecast", "Translate text"]);
  assert.equal(r.plans[0].providers.length, 3);
  assert.equal(r.executed?.status, "completed");
  assert.equal(r.executed?.verification.status, "verified");
  assert.match(String(r.executed?.output), /^Se esperan .* °?\d+°C/);
  assert.equal(r.executed?.runs.length, 3);
});

test("optional ports are never filled from unrelated steps", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const r = await rc.compose({ ...GOAL });
  for (const p of r.plans) {
    for (const s of p.steps) {
      const cap = rc.graph.get(s.capability)!;
      for (const b of s.bindings) {
        const port = cap.inputs.find((x) => x.name === b.port)!;
        if (!port.required) assert.equal(b.from, `$in.${port.name}`);
      }
    }
  }
});

test("crystallization: a proven pipeline becomes one capability and is preferred next time", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const before = rc.graph.powers().total;
  const first = await rc.compose({ ...GOAL, run: true });
  assert.ok(first.crystallized);
  assert.ok(first.crystallized!.newPowers > 0);
  assert.ok(rc.graph.powers().total > before);
  const cap = rc.graph.get(first.crystallized!.id)!;
  assert.equal(cap.source, "composite");
  assert.deepEqual(cap.inputs.map((p) => p.name).sort(), ["language", "place"]);
  const second = await rc.compose({ ...GOAL, have: { place: "Tokyo", language: "fr" }, run: true });
  assert.equal(second.executed?.titles.length, 1, "uses the crystallized capability");
  assert.match(String(second.executed?.output), /maximale/);
  // the composite run itself produced per-step receipts too
  const run = [...rc.runs.values()].find((x) => x.capability === cap.id)!;
  assert.equal(run.steps?.length, 3);
});

test("self-healing: a dead provider is routed around by re-planning", async () => {
  const peer = await RightClick.create({ fetch: routerFetch({ "https://sky2.test": SERVICES.skycast }), directories: [] });
  await peer.learn({ source: "https://sky2.test/mcp" });
  const { createHandler } = await import("../src/interface/http.ts");
  let skyUp = true;
  const { rc } = await world({
    "https://skycast.test": (req) => (skyUp ? SERVICES.skycast(req) : Promise.reject(new Error("connection refused"))),
    "https://peer.test": createHandler(peer, { open: true }),
  });
  await learnAll(rc);
  await rc.compose({ ...GOAL, run: true }); // crystallize the local route
  await rc.learn({ source: "https://peer.test/" });
  skyUp = false;
  const r = await rc.compose({ ...GOAL, have: { place: "Nairobi", language: "es" }, run: true });
  assert.equal(r.executed?.status, "completed");
  assert.ok(r.executed!.attempts.length >= 1);
  assert.equal(r.executed!.attempts[0].failed, "mcp:skycast:forecast");
  const providers = r.executed!.runs.map((id) => rc.runs.get(id)!.provider);
  assert.ok(providers.includes("peer:peer-test"), `healed through the peer: ${providers}`);
  assert.ok(rc.ledger.reliability("mcp:skycast:forecast") < rc.ledger.reliability("peer:peer-test:mcp:skycast:forecast"));
});

test("receipts form a verifiable hash chain; tampering is detected", async () => {
  const { rc } = await world();
  await rc.run("builtin:text.sha256", { text: "a" });
  await rc.run("builtin:url.domain", { url: "https://x.test/p" });
  await rc.run("builtin:text.stats", { text: "one two" });
  assert.deepEqual(await rc.verifyReceipts(), { count: 3, intact: true, brokenAt: null, head: rc.chain.headHash });
  const forged = rc.chain.receipts.map((r) => ({ ...r }));
  forged[1].status = "failed";
  assert.equal(await ReceiptChain.verify(forged), 2);
});

test("verification: refuted predicates fail the run honestly", async () => {
  const { rc } = await world();
  const ok = await rc.run("builtin:url.domain", { url: "https://x.test/p" }, { verify: [{ op: "equals", value: "x.test" }] });
  assert.equal(ok.verification.status, "verified");
  const bad = await rc.run("builtin:url.domain", { url: "https://x.test/p" }, { verify: [{ op: "equals", value: "y.test" }] });
  assert.equal(bad.verification.status, "refuted");
  const none = await rc.run("builtin:url.domain", { url: "https://x.test/p" });
  assert.equal(none.verification.status, "unverified");
  assert.equal(rc.ledger.get("builtin:url.domain")?.failed, 1);
});

test("no approval gates: write and destructive capabilities run directly", async () => {
  const deleted: string[] = [];
  const api = async (req: Request) => {
    const u = new URL(req.url);
    if (u.pathname === "/openapi.json")
      return Response.json({
        openapi: "3.0.0",
        info: { title: "Notes" },
        paths: { "/notes/{noteId}": { delete: { operationId: "deleteNote", parameters: [{ name: "noteId", in: "path", required: true, schema: { type: "string" } }], responses: { 204: { description: "gone" } } } } },
      });
    deleted.push(u.pathname);
    return new Response(null, { status: 204 });
  };
  const { rc } = await world({ "https://notes.test": api });
  await rc.learn({ source: "https://notes.test/openapi.json" });
  const cap = rc.graph.list().find((c) => c.id.endsWith("deletenote"))!;
  assert.equal(cap.risk, "destructive");
  const r = await rc.run(cap.id, { noteId: "42" });
  assert.equal(r.status, "completed");
  assert.deepEqual(deleted, ["/notes/42"]);
});

test("research: environment survey, gaps, directory search and auto-learn", async () => {
  const dir: Directory = {
    id: "fake",
    title: "Fake directory",
    url: "https://dir.test",
    async search(_net, topic) {
      return topic.includes("weather") ? [{ directory: "fake", name: "sky", title: "Skycast", description: "weather", source: URLS.skycast, kind: "mcp", score: 1 }] : [];
    },
  };
  const broken: Directory = { id: "down", title: "Down", url: "https://down.test", search: async () => Promise.reject(new Error("offline")) };
  const { rc } = await world({}, { directories: [dir, broken] });
  await rc.learn({ source: URLS.polyglot });
  const env = await rc.research();
  assert.equal(env.environment.runtime.name, "node");
  assert.ok(env.types.length > 5);
  const r = await rc.research({ topic: "weather", learn: 1 });
  assert.equal(r.directories[0].candidates[0].title, "Skycast");
  assert.equal(r.directories[1].reachable, false);
  assert.equal(r.learned?.totalNewCapabilities, 2);
  assert.ok(rc.graph.get("mcp:skycast:forecast"));
});

test("actions: direct capabilities plus everything reachable through pipelines", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const a = rc.actions({ value: "https://news.test/article" });
  assert.equal(a.inspected.type, "url");
  assert.ok(a.actions.some((x) => x.id === "builtin:web.fetch"));
  const reach = a.reachableTypes.map((t) => t.type);
  for (const t of ["html", "text", "domain", "language", "hash"]) assert.ok(reach.includes(t), t);
  const article = await rc.compose({ have: { url: "https://news.test/article" }, want: "text", intent: "summary", run: true });
  assert.deepEqual(article.executed?.titles, ["Fetch web page", "Extract readable text", "Summarize text"]);
  assert.match(String(article.executed?.output), /RightClick X/);
});

test("watch: long-poll wakes on graph changes", async () => {
  const { rc } = await world();
  const cursor = rc.graph.cursor;
  const pending = rc.watch({ since: cursor, waitMs: 5000 });
  setTimeout(() => void rc.learn({ source: URLS.polyglot }), 20);
  const w = await pending;
  assert.ok(w.events.some((e) => e.kind === "provider.learned"));
  assert.ok(w.cursor > cursor);
});

test("persistence: learned graph, ledger and receipts survive a restart without re-fetching", async () => {
  const store = new MemoryStore();
  const { rc } = await world({}, { store });
  await learnAll(rc);
  await rc.compose({ ...GOAL, run: true });
  await rc.flush();
  const powers = rc.graph.powers().total;
  const fresh = await RightClick.create({ store, fetch: () => Promise.reject(new Error("offline")), directories: [] });
  assert.equal(fresh.graph.powers().total, powers);
  assert.equal(fresh.chain.receipts.length, rc.chain.receipts.length);
  assert.equal((await fresh.verifyReceipts()).intact, true);
  assert.ok(fresh.ledger.get("mcp:skycast:forecast"));
});

test("platform reflector finds workspace files and edge-style bindings", async () => {
  const kv = new Map<string, string>();
  const KV = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), list: async () => ({ keys: [] }) };
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/rcx-`);
  const rc = await RightClick.create({ bindings: { NOTES: KV }, workspace: dir, directories: [] });
  const ids = rc.graph.list().filter((c) => c.source === "platform").map((c) => c.id);
  assert.ok(ids.includes("platform:node:kv.NOTES.put"));
  assert.ok(ids.includes("platform:node:fs.write"));
  await rc.run("platform:node:kv.NOTES.put", { key: "a", value: "hello" });
  assert.equal((await rc.run("platform:node:kv.NOTES.get", { key: "a" })).output, "hello");
  await rc.run("platform:node:fs.write", { path: "out/x.txt", content: "hi" });
  assert.equal((await rc.run("platform:node:fs.read", { path: "out/x.txt" })).output, "hi");
  const escape = await rc.run("platform:node:fs.read", { path: "../../etc/hosts" });
  assert.equal(escape.status, "failed");
  assert.match(escape.error!, /escapes workspace/);
});
