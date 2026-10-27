// The capability lifecycle end to end, through the AI-facing tools:
//   learn -> persist -> disconnect -> upgrade -> provider unavailable -> defer -> restart ->
//   restore -> execute -> independently verify,
// with three separate agent sessions sharing one saved capability. What the first agent saved
// (its identity, pipeline, stored checks, independent witness and egress policy) must reach the
// third agent unchanged; in between it must stay discoverable and never become executable early.
//
// Fixtures are disposable local HTTP services owned by the test: a notes API and a separate,
// read-only observer that independently checks a note's text.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { dispatch } from "../src/interface/tools.ts";
import { decodeState } from "../src/core/state-format.ts";

const NOTES: Record<string, string> = { n1: "hello note", n2: "second note" };

interface Service { origin: string; source: string; port: number; requests: () => number; close: () => Promise<void> }

async function serve(kind: "notes" | "observer", port = 0): Promise<Service> {
  let requests = 0;
  const server = http.createServer((q, s) => {
    requests++;
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const url = new URL(q.url!, origin);
    s.setHeader("content-type", "application/json");
    if (url.pathname === "/openapi.json") {
      const op = kind === "notes"
        ? { "/notes/{id}": { get: { operationId: "getNote", summary: "Get a note", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } } } } } }
        : { "/check": { get: { operationId: "checkNote", summary: "Check a note's text independently", parameters: ["id", "text"].map((name) => ({ name, in: "query", required: true, schema: { type: "string" } })),
            responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } } };
      return s.end(JSON.stringify({ openapi: "3.0.0", info: { title: kind === "notes" ? "Notes" : "Observer", version: "1" }, servers: [{ url: origin }], paths: op }));
    }
    if (kind === "notes") return s.end(JSON.stringify({ text: NOTES[url.pathname.split("/").pop()!] ?? "" }));
    s.end(JSON.stringify({ valid: NOTES[url.searchParams.get("id") ?? ""] === url.searchParams.get("text") }));
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const actual = (server.address() as any).port as number;
  const origin = `http://127.0.0.1:${actual}`;
  return { origin, source: `${origin}/openapi.json`, port: actual, requests: () => requests,
    close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }) };
}

/** The parts of a saved goal that define it, as opposed to its usage counters. */
const definition = (g: any) => ({ slug: g.slug, have: g.have, want: g.want, verify: g.verify, witnesses: g.witnesses, origins: g.origins, anchors: g.anchors, through: g.through, trust: g.trust });
const savedGoal = (file: string) => decodeState(JSON.parse(readFileSync(file, "utf8"))).published!.find((g) => g.slug === "note-lookup")!;

async function firstAgent(file: string) {
  const notes = await serve("notes"), observer = await serve("observer");
  const a = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file) });
  await dispatch(a, "context_learn", { sources: [notes.source, observer.source] });
  const get = a.graph.list().find((c) => c.title.toLowerCase().includes("get a note"))!.id;
  const check = a.graph.list().find((c) => c.title.toLowerCase().includes("check a note"))!.id;
  const r = await a.compose({ have: { id: { type: "text", value: "n1" } }, want: "json", through: [get], run: true, publish: "Note lookup",
    verify: [{ op: "matches", path: "text", pattern: "note$" }], origins: [notes.origin, observer.origin],
    witnesses: [{ capability: check, args: { id: { input: "id" }, text: { output: "text" } }, verify: [{ op: "equals", path: "valid", value: true }] }] });
  assert.equal(r.executed?.verification.status, "verified", JSON.stringify(r.executed?.error ?? r));
  assert.equal(r.published?.durable, true);
  // Drain the first runtime's scheduled state save before simulating a
  // disconnected process and editing the persisted version on disk.
  await a.flush();
  const goal = definition(savedGoal(file));
  // Disconnect, then upgrade: the next process runs a newer inference version.
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  envelope.state.semantics = 26;
  writeFileSync(file, JSON.stringify(envelope));
  await notes.close(); await observer.close();
  return { get, check, goal, notesPort: notes.port, observerPort: observer.port };
}

test("a saved capability survives disconnect, upgrade, outage and restart, and another agent re-uses and verifies it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-lifecycle-"));
  const file = join(dir, "state.json");
  try {
    const f = await firstAgent(file);

    // Agent B, while both services are down: knowledge is discoverable, nothing is executable.
    const b = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file) });
    const providers = await dispatch(b, "context_providers") as any[];
    for (const title of ["Notes", "Observer"]) {
      const p = providers.find((x) => x.title === title);
      assert.ok(p?.deferred && p.executable === false, `${title} is not listed as deferred knowledge: ${JSON.stringify(p)}`);
      assert.match(p.restore, /first use|context_learn/);
    }
    const explained = await dispatch(b, "context_explain", { id: f.get }) as any;
    assert.equal(explained.deferred, true);
    assert.equal(explained.executable, false);
    assert.ok(b.graph.get("goal:note-lookup"), "the saved goal is not discoverable");
    const down = await dispatch(b, "context_run", { id: "goal:note-lookup", args: { id: "n2" } }) as any;
    assert.notEqual(down.status, "completed", "a goal ran while its providers were unavailable");
    await b.flush();
    assert.deepEqual(definition(savedGoal(file)), f.goal, "the saved goal's definition changed while deferred");

    // Restart: the services return; agent C starts without contacting them, then re-uses the goal.
    const notes = await serve("notes", f.notesPort), observer = await serve("observer", f.observerPort);
    try {
      const c = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file) });
      assert.equal(notes.requests() + observer.requests(), 0, "startup contacted a provider");
      const run = await dispatch(c, "context_run", { id: "goal:note-lookup", args: { id: "n2" }, view: { full: true } }) as any;
      assert.equal(run.status, "completed", JSON.stringify(run));
      assert.deepEqual(run.output, { text: "second note" });
      assert.equal(run.verification.status, "verified", "the independent witness did not verify the restored goal");
      assert.ok(observer.requests() > 0, "the observer was not consulted");
      assert.ok(c.graph.get(f.get) && c.graph.get(f.check), "a capability came back under a different identity");
      await c.flush();
      assert.deepEqual(definition(savedGoal(file)), f.goal, "the saved goal's definition changed through restore");
      assert.equal(decodeState(JSON.parse(readFileSync(file, "utf8"))).deferredInference, undefined);
    } finally { await notes.close(); await observer.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after restore the operator's egress policy still binds: a witness outside it cannot verify", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-lifecycle-"));
  const file = join(dir, "state.json");
  try {
    const f = await firstAgent(file);
    const notes = await serve("notes", f.notesPort), observer = await serve("observer", f.observerPort);
    try {
      // This deployment allows only the notes origin, so the observer must not be reached.
      const c = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file), network: { blockPrivate: false, origins: [notes.origin] } });
      const run = await dispatch(c, "context_run", { id: "goal:note-lookup", args: { id: "n2" }, view: { full: true } }) as any;
      assert.notEqual(run.verification?.status, "verified", "verification succeeded through an origin the operator did not allow");
      assert.equal(observer.requests(), 0, "a disallowed origin was contacted");
    } finally { await notes.close(); await observer.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
