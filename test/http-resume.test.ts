import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type RuntimeOptions, type PersistedState } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";
import { dispatch } from "../src/interface/tools.ts";

function spec() {
  const response = { "200": { content: { "application/json": { schema: {
    type: "object", properties: { checksum: { type: "string" } },
  } } } } };
  return { openapi: "3.1.0", info: { title: "Packager" }, servers: [{ url: "https://pack.test" }], paths: {
    "/pack": { post: { operationId: "pack", requestBody: { content: { "application/json": { schema: {
      type: "object", properties: { document: { type: "string" } },
    } } } }, responses: { ...response, "202": { description: "Pending" } } } },
    "/tasks/{key}": { get: { operationId: "task", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { "303": { description: "Result" } } } },
    "/results/{key}": { get: { operationId: "result", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: response } },
  } };
}
async function world(store: MemoryStore, opts: RuntimeOptions = {}) {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, store,
    httpContinuation: { maxRequests: 1 }, ...opts, fetch: opts.fetch ?? (async (input, init) => {
      const url = new URL(String(input)); calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/pack") return new Response(null, { status: 202, headers: { location: "/tasks/t1", "retry-after": "0" } });
      if (url.pathname === "/tasks/t1") return new Response(null, { status: 303, headers: { location: "/results/t1", "retry-after": "0" } });
      return Response.json({ checksum: "abc" });
    }) });
  if (!rc.graph.get("openapi:packager:pack")) rc.graph.add(reflectOpenAPI(spec(), "https://pack.test/spec"));
  return { rc, calls };
}

test("pending HTTP result resumes after restart through the same compact tool without resubmitting", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack", {}, { verify: [{ op: "equals", path: "checksum", value: "abc" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.pending?.resumeId, `resume:${run.runId}`);
  await first.rc.flush();
  const fresh = await world(store);
  assert.deepEqual(fresh.calls, []);
  const pending: any = await dispatch(fresh.rc, "context_run_status", { runId: run.runId });
  assert.equal(pending.status, "pending");
  const resumed: any = await dispatch(fresh.rc, "context_run", { id: `resume:${run.runId}` });
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.verification.status, "checked");
  assert.deepEqual(resumed.output, { checksum: "abc" });
  assert.equal(resumed.resumes, run.runId);
  assert.deepEqual(fresh.calls, ["GET /results/t1"]);
  await fresh.rc.flush();
  const again = await world(store);
  const finished: any = await dispatch(again.rc, "context_run_status", { runId: run.runId });
  assert.equal(finished.status, "completed");
  assert.equal(finished.resumedBy, resumed.runId);
  assert.equal(finished.outputUnavailable, true);
  await assert.rejects(dispatch(again.rc, "context_run", { id: `resume:${run.runId}` }), /no resumable/);
  assert.deepEqual(again.calls, []);
});

test("resume cannot change inputs, checks or identity, and still applies the original predicate", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack", {}, { verify: [{ op: "equals", path: "checksum", value: "different" }] });
  await first.rc.flush();
  const fresh = await world(store);
  for (const patch of [{ args: { document: "replacement" } }, { verify: [] }, { id: "resume:unknown" }, { confirm: true }, { resumeRunId: "" }]) {
    await assert.rejects(dispatch(fresh.rc, "context_run", { id: `resume:${run.runId}`, ...patch }), /resume|no resumable/);
  }
  assert.deepEqual(fresh.calls, []);
  const resumed = await fresh.rc.run(`resume:${run.runId}`);
  assert.equal(resumed.status, "failed");
  assert.equal(resumed.verification.status, "refuted");
  assert.deepEqual(fresh.calls, ["GET /results/t1"]);
  await fresh.rc.flush();
});

test("retained state excludes original bodies and authority headers", async () => {
  const store = new MemoryStore(); const first = await world(store);
  first.rc.net.auth.set("https://pack.test", { Authorization: "Bearer private-credential-control" });
  const run = await first.rc.run("openapi:packager:pack", { document: "private-original-body-control" });
  await first.rc.flush();
  assert.equal(run.status, "pending");
  const saved = JSON.stringify(store.state);
  assert.ok(!saved.includes("private-credential-control"));
  assert.ok(!saved.includes("private-original-body-control"));
  const cursor = store.state!.httpContinuations![0].cursor;
  assert.equal(cursor.url, "https://pack.test/results/t1");
  assert.equal(cursor.used, 1);
  assert.equal(Object.hasOwn(cursor, "headers"), false);
});

test("Retry-After survives restart and cannot be reset by requesting resume", async () => {
  const store = new MemoryStore(); const first = await world(store, { fetch: async (input, init) => new Response(null, {
    status: init?.method === "POST" ? 202 : 303, headers: {
      location: init?.method === "POST" ? "/tasks/t1" : "/results/t1", "retry-after": init?.method === "POST" ? "0" : "120",
    },
  }) });
  const run = await first.rc.run("openapi:packager:pack"); await first.rc.flush();
  const notBefore = store.state!.httpContinuations![0].cursor.notBefore;
  const fresh = await world(store);
  const resumed = await fresh.rc.run(`resume:${run.runId}`);
  assert.equal(resumed.status, "pending");
  assert.equal(resumed.httpContinuation?.stopped, "budget");
  assert.deepEqual(fresh.calls, []);
  await fresh.rc.flush();
  assert.ok(store.state!.httpContinuations![0].cursor.notBefore >= notBefore);
});

test("a failed checkpoint prevents the first poll after acceptance", async () => {
  class FailingStore extends MemoryStore {
    fail = true;
    override async save(state: PersistedState) {
      if (this.fail && state.httpContinuations?.length) { this.fail = false; throw new Error("disk unavailable"); }
      await super.save(state);
    }
  }
  const store = new FailingStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack");
  assert.equal(run.status, "pending");
  assert.equal(run.httpContinuation?.stopped, "checkpoint-unavailable");
  assert.equal(run.pending?.resumeId, undefined);
  assert.deepEqual(first.calls, ["POST /pack"]);
  await first.rc.flush();
});

test("persistent storage failure remains visible and cannot trigger background execution", async () => {
  class BrokenStore extends MemoryStore {
    broken = true;
    override async save(state: PersistedState) {
      if (this.broken) throw new Error("persistent storage failure");
      await super.save(state);
    }
  }
  const store = new BrokenStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack");
  assert.equal(run.status, "pending");
  assert.equal(run.httpContinuation?.stopped, "checkpoint-unavailable");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(first.calls, ["POST /pack"]);
  assert.equal((first.rc.runtime() as any).storage.status, "failed");
  await assert.rejects(first.rc.flush(), /persistent storage failure/);
  store.broken = false;
  await first.rc.flush();
  assert.equal((first.rc.runtime() as any).storage.status, "saved");
});

test("lifetime budget, expiry, incompatible profile and withdrawn source cannot dispatch", async () => {
  for (const mode of ["budget", "expiry", "profile", "withdrawn"] as const) {
    const store = new MemoryStore(); const first = await world(store);
    const run = await first.rc.run("openapi:packager:pack"); await first.rc.flush();
    const checkpoint = store.state!.httpContinuations![0];
    if (mode === "budget") checkpoint.cursor.used = 32;
    if (mode === "expiry") { checkpoint.createdAt = Date.now() - 3_600_000; checkpoint.expiresAt = Date.now() - 1; }
    if (mode === "profile") {
      (checkpoint.cursor as any).version = 2;
      const before = structuredClone(store.state);
      await assert.rejects(world(store), /unsupported retained HTTP checkpoint/);
      assert.deepEqual(store.state, before, "an unknown profile remains available to a compatible runtime");
      continue;
    }
    const fresh = await world(store);
    if (mode === "withdrawn") fresh.rc.forget("openapi:packager");
    if (mode === "withdrawn") {
      await assert.rejects(fresh.rc.run(`resume:${run.runId}`), /no resumable|unknown capability/);
    } else {
      const resumed = await fresh.rc.run(`resume:${run.runId}`);
      assert.equal(resumed.status, "pending");
      assert.equal(resumed.httpContinuation?.stopped, "budget");
    }
    assert.deepEqual(fresh.calls, []);
    await fresh.rc.flush();
  }
});

test("overlapping resume requests cannot run the same retained read concurrently", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack"); await first.rc.flush();
  let release!: () => void, entered!: () => void;
  const observed = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  const fresh = await world(store, { fetch: async () => { calls++; entered(); await gate; return Response.json({ checksum: "abc" }); } });
  const active = fresh.rc.run(`resume:${run.runId}`);
  await observed;
  await assert.rejects(fresh.rc.run(`resume:${run.runId}`), /already active/);
  release();
  assert.equal((await active).status, "completed");
  assert.equal(calls, 1);
  await fresh.rc.flush();
});

test("persistence yielding cannot bypass a changed follow-up contract", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const run = await first.rc.run("openapi:packager:pack"); await first.rc.flush();
  const fresh = await world(store);
  const save = store.save.bind(store);
  store.save = async state => {
    await save(state);
    fresh.rc.graph.get("openapi:packager:result")!.risk = "write";
  };
  const resumed = await fresh.rc.run(`resume:${run.runId}`);
  assert.equal(resumed.status, "pending");
  assert.equal(resumed.httpContinuation?.stopped, "changed-contract");
  assert.deepEqual(fresh.calls, []);
  await fresh.rc.flush();
});

test("live checkpoint capacity fails closed while expired entries retire without requests", async () => {
  const store = new MemoryStore(); const first = await world(store);
  await first.rc.run("openapi:packager:pack"); await first.rc.flush();
  const sample = store.state!.httpContinuations![0];
  store.state!.httpContinuations = Array.from({ length: 64 }, (_, i) => ({ ...structuredClone(sample), runId: `run_slot_${i}` }));
  const full = await world(store);
  const blocked = await full.rc.run("openapi:packager:pack");
  assert.equal(blocked.httpContinuation?.stopped, "checkpoint-unavailable");
  assert.deepEqual(full.calls, ["POST /pack"]);
  await full.rc.flush();
  for (const c of store.state!.httpContinuations!) { c.createdAt = Date.now() - 3_600_000; c.expiresAt = Date.now() - 1; }
  const fresh = await world(store);
  assert.deepEqual(fresh.calls, []);
  const accepted = await fresh.rc.run("openapi:packager:pack");
  assert.equal(accepted.status, "pending");
  assert.equal(accepted.pending?.resumeId, `resume:${accepted.runId}`);
  await fresh.rc.flush();
  assert.equal(store.state!.httpContinuations!.length, 1);
});

test("restart does not renew authority or permit changed result contracts", async () => {
  for (const mode of ["denied", "changed"] as const) {
    const store = new MemoryStore(); const first = await world(store);
    const run = await first.rc.run("openapi:packager:pack");
    await first.rc.flush();
    const fresh = await world(store, mode === "denied" ? {
      authority: { execution: { deniedCapabilities: ["openapi:packager:result"] } },
    } : {});
    if (mode === "changed") (fresh.rc.graph.get("openapi:packager:result")!.invoke as any).url = "https://pack.test/moved/{key}";
    const resumed: any = await dispatch(fresh.rc, "context_run", { id: `resume:${run.runId}` });
    assert.equal(resumed.status, "pending");
    assert.equal(resumed.verification.status, "unverified");
    assert.deepEqual(fresh.calls, []);
    await fresh.rc.flush();
  }
});
