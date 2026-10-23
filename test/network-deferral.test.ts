// A provider that cannot be reached while the runtime upgrades its inference must not lose what
// was learned from it. Reproduced 2026-10-23 (#12): state from an older build with one OpenAPI
// provider, loaded while its service was down, was re-learned during startup, treated as gone,
// withdrawn and persisted: 1 provider became 0, and the composite built on it was deleted.
//
// Startup never contacts the network (#12 part 2): network providers from an older inference stay
// deferred until a call that needs one, or context_learn, re-derives it under that call's policy.
//
// The four cases are kept apart:
// - unreachable when needed: kept as deferred knowledge, never executable, re-derived when reachable;
// - contract genuinely changed: re-derived through the existing drift path, not deferred;
// - authority revoked (origin outside the egress policy): deferred, and never contacted;
// - removed by the operator (context_forget): gone, including any deferred copy.
//
// Every fixture is a disposable local HTTP service owned by the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { decodeState } from "../src/core/state-format.ts";

interface Service { port: number; source: string; requests: () => number; close: () => Promise<void> }

/** A notes API. "v2" renames its only operation, which is a genuine contract change. */
async function notes(port = 0, variant: "v1" | "v2" = "v1"): Promise<Service> {
  let requests = 0;
  const op = variant === "v1"
    ? { path: "/notes/{id}", operationId: "getNoteText", summary: "Get the text of a note" }
    : { path: "/v2/notes/{id}/body", operationId: "fetchNoteBody", summary: "Fetch the body of a note" };
  const server = http.createServer((q, s) => {
    requests++;
    if (q.url === "/openapi.json") {
      s.setHeader("content-type", "application/json");
      return s.end(JSON.stringify({ openapi: "3.0.0", info: { title: "Notes", version: variant }, servers: [{ url: `http://127.0.0.1:${(server.address() as any).port}` }],
        paths: { [op.path]: { get: { operationId: op.operationId, summary: op.summary,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } } } } } }));
    }
    s.setHeader("content-type", "text/plain");
    s.end("hello note");
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const actual = (server.address() as any).port as number;
  return {
    port: actual,
    source: `http://127.0.0.1:${actual}/openapi.json`,
    requests: () => requests,
    close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }),
  };
}

/** State an older inference build left: the provider, a crystallized pipeline and a saved goal. */
async function upgradeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "rcx-netdefer-"));
  const file = join(dir, "state.json");
  const service = await notes();
  const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file) });
  await rc.learn({ source: service.source });
  const capability = rc.graph.list().find((c) => c.invoke.kind === "http")!.id;
  const composed = await rc.compose({ have: { id: { type: "text", value: "n1" } }, want: "hash", through: [capability, "builtin:text.sha256"], run: true, publish: "Note digest" });
  assert.equal(composed.executed?.status, "completed");
  const composites = rc.graph.list().filter((c) => c.invoke.kind === "composite").map((c) => c.id);
  assert.ok(composites.length, "fixture produced no composite pipeline");
  await rc.flush();
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  envelope.state.semantics = 26; // as an earlier build wrote it
  writeFileSync(file, JSON.stringify(envelope));
  await service.close();
  return { dir, file, port: service.port, capability, provider: rc.graph.get(capability)!.provider, composites, expected: composed.executed!.output };
}

const saved = (file: string) => decodeState(JSON.parse(readFileSync(file, "utf8")));
const deferredIds = (file: string) => (saved(file).deferredInference ?? []).flatMap((d) => d.reflection.capabilities.map((c) => c.id));

test("an upgrade while a provider is unreachable keeps its capabilities, pipeline and goal, and restores them later", async () => {
  const f = await upgradeFixture();
  try {
    const down = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    assert.equal(down.graph.get(f.capability), undefined, "a stale capability stayed executable");
    for (const id of f.composites) assert.equal(down.graph.get(id), undefined);
    await down.flush();
    assert.equal(saved(f.file).reflections.some((r) => r.provider.id === f.provider), false);
    const kept = deferredIds(f.file);
    assert.ok(kept.includes(f.capability), `the provider's capability was lost: deferred=${JSON.stringify(kept)}`);
    for (const id of f.composites) assert.ok(kept.includes(id), `the pipeline ${id} was lost`);
    assert.ok(saved(f.file).published?.some((g) => g.slug === "note-digest"), "the saved goal's definition was lost");
    assert.equal((await down.run("goal:note-digest", { id: "n2" })).status, "failed", "a goal ran through a deferred provider");

    // Still down across further restarts: nothing is lost and no further backup is made.
    const again = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    await again.flush();
    assert.ok(deferredIds(f.file).includes(f.capability));
    assert.equal(readdirSync(f.dir).filter((n) => n.includes("-backup-")).length, 1);

    // Reachable again: startup still contacts nothing; the goal's first use re-derives the
    // provider with the same identity, the pipeline returns and the goal runs.
    const service = await notes(f.port);
    try {
      const up = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
      assert.equal(service.requests(), 0, "startup contacted a network source");
      assert.equal(up.graph.get(f.capability), undefined);
      const run = await up.run("goal:note-digest", { id: "n1" });
      assert.ok(up.graph.get(f.capability), "the capability was not re-derived on use");
      for (const id of f.composites) assert.ok(up.graph.get(id), `the pipeline ${id} did not return`);
      assert.equal(run.status, "completed", JSON.stringify(run.error ?? run));
      assert.deepEqual(run.output, f.expected);
      await up.flush();
      assert.equal(saved(f.file).deferredInference, undefined);
    } finally { await service.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("a provider whose contract genuinely changed is re-derived through drift, not deferred", async () => {
  const f = await upgradeFixture();
  const service = await notes(f.port, "v2");
  try {
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    const learned = await rc.learn({ source: service.source });
    assert.ok(learned.results[0].drift?.removed.includes(f.capability), "the change was not reported as drift against what was known");
    await rc.flush();
    assert.equal(saved(f.file).deferredInference, undefined, "a reachable, changed provider stayed deferred");
    assert.ok(rc.graph.list().some((c) => c.invoke.kind === "http" && /fetch the body of a note/i.test(c.title)), "the changed contract was not learned");
    // A pipeline is a proof about the old contract: it retires, as before, rather than returning.
    for (const id of f.composites) assert.equal(rc.graph.get(id), undefined);
    assert.ok(saved(f.file).published?.some((g) => g.slug === "note-digest"));
  } finally { await service.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("a provider whose origin is no longer authorised is deferred and never contacted", async () => {
  const f = await upgradeFixture();
  const service = await notes(f.port);
  try {
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file), network: { blockPrivate: true } });
    assert.equal(service.requests(), 0, "startup contacted a network source");
    assert.equal(rc.graph.get(f.capability), undefined);
    assert.equal((await rc.run("goal:note-digest", { id: "n1" })).status, "failed");
    assert.equal(service.requests(), 0, "a revoked origin was contacted by a saved goal");
    await rc.flush();
    const record = saved(f.file).deferredInference?.find((d) => d.reflection.provider.id === f.provider);
    assert.ok(record, "the provider was lost when its authority was revoked");
    assert.match(record!.reason ?? "", /policy/);
  } finally { await service.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("an operator removal of a deferred provider is permanent", async () => {
  const f = await upgradeFixture();
  try {
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    assert.equal(rc.forget(f.provider).forgotten, true, "a deferred provider could not be removed");
    await rc.flush();
    assert.equal(deferredIds(f.file).includes(f.capability), false);
    const service = await notes(f.port);
    try {
      const later = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
      assert.equal(later.graph.get(f.capability), undefined, "a removed provider came back");
      assert.equal(service.requests(), 0, "a removed provider's source was contacted");
    } finally { await service.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

const sandboxed = (await (await import("../src/core/sandbox.ts")).hostSandbox()) ? false : "no host sandbox on this platform";

test("a pipeline over a program deferred for want of authority survives and returns with it", { skip: sandboxed }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-netdefer-"));
  const file = join(dir, "state.json");
  try {
    const authority = { investigate: ["/usr/bin/sort"] };
    const seed = await RightClick.create({ directories: [], store: new FileStore(file), authority });
    await seed.learn({ source: "cli:/usr/bin/sort" });
    const r = await seed.compose({ have: { text: { type: "text", value: "b\na\n" } }, want: "hash", through: ["cli:sort:default", "builtin:text.sha256"], run: true, publish: "Sorted digest" });
    assert.equal(r.executed?.status, "completed");
    const pipelines = seed.graph.list().filter((c) => c.invoke.kind === "composite").map((c) => c.id);
    await seed.flush();
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    envelope.state.semantics = 26;
    writeFileSync(file, JSON.stringify(envelope));

    const without = await RightClick.create({ directories: [], store: new FileStore(file) });
    for (const id of pipelines) assert.equal(without.graph.get(id), undefined, "a pipeline over a deferred program stayed executable");
    await without.flush();
    for (const id of pipelines) assert.ok(deferredIds(file).includes(id), `the pipeline ${id} was lost`);

    const withAuthority = await RightClick.create({ directories: [], store: new FileStore(file), authority });
    for (const id of pipelines) assert.ok(withAuthority.graph.get(id), `the pipeline ${id} did not return`);
    assert.equal((await withAuthority.run("goal:sorted-digest", { text: "d\nc\n" })).status, "completed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("learning a deferred source again during a session resolves its deferral", async () => {
  const f = await upgradeFixture();
  try {
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    assert.equal(rc.graph.get(f.capability), undefined);
    const service = await notes(f.port);
    try {
      await rc.learn({ source: service.source });
      assert.ok(rc.graph.get(f.capability), "learning the source did not restore its capability");
      await rc.flush();
      assert.equal(saved(f.file).deferredInference, undefined, "a stale deferred copy outlived a successful learn");
    } finally { await service.close(); }
    // Unreachable again on the next start: the state is current, so there is no migration. The
    // newer copy stays as it is and the stale one does not come back over it.
    const next = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    assert.ok(next.graph.get(f.capability));
    for (const id of f.composites) assert.ok(next.graph.get(id), `the pipeline ${id} did not return with its provider`);
    await next.flush();
    assert.equal(saved(f.file).deferredInference, undefined);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("startup contacts no network source, so a source that never answers cannot delay it", async () => {
  const f = await upgradeFixture();
  let connections = 0;
  const { createServer } = await import("node:net");
  const silent = createServer(() => { connections++; }); // accepts and never answers
  await new Promise<void>((done) => silent.listen(f.port, "127.0.0.1", done));
  try {
    const t0 = performance.now();
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    const elapsed = performance.now() - t0;
    assert.equal(connections, 0, "startup connected to a network source");
    assert.ok(elapsed < 5000, `startup waited ${Math.round(elapsed)} ms`);
    const deferred = (rc.runtime() as any).deferred as Array<{ provider: string; source: string; reason?: string }>;
    assert.ok(deferred.some((d) => d.provider === f.provider && /context_learn/.test(d.reason ?? "")), "context_runtime does not say what is deferred or how to restore it");
  } finally { await new Promise((done) => silent.close(done)); rmSync(f.dir, { recursive: true, force: true }); }
});

test("a capability's first direct use re-derives its deferred provider", async () => {
  const f = await upgradeFixture();
  const service = await notes(f.port);
  try {
    const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(f.file) });
    assert.equal(service.requests(), 0);
    const run = await rc.run(f.capability, { id: "n1" });
    assert.equal(run.status, "completed", JSON.stringify(run.error ?? run));
    assert.equal(run.output, "hello note");
  } finally { await service.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
