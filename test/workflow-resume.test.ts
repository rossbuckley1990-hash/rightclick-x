import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type RuntimeOptions, type PersistedState } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";
import { signature } from "../src/core/graph.ts";

const response = (properties: object) => ({ "200": { content: { "application/json": { schema: { type: "object", properties } } } } });
async function world(store: MemoryStore, options: RuntimeOptions = {}) {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, store, workflowRecovery: true,
    httpContinuation: { maxRequests: 1 }, ...options,
    fetch: options.fetch ?? (async (input, init) => {
      const u = new URL(String(input)); calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname === "/prepare") return Response.json({ document: "prepared" });
      if (u.pathname === "/pack") return new Response(null, { status: 202, headers: { location: "/tasks/t1", "retry-after": "0" } });
      if (u.pathname === "/tasks/t1") return new Response(null, { status: 303, headers: { location: "/results/t1", "retry-after": "0" } });
      if (u.pathname === "/results/t1") return Response.json({ checksum: "abc" });
      return Response.json({ receipt: "stored:" + JSON.parse(String(init?.body)).checksum });
    }) } as RuntimeOptions);
  if (!rc.graph.get("composite:retained")) {
    rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Source" }, servers: [{ url: "https://source.test" }], paths: {
      "/prepare": { get: { operationId: "prepare", responses: response({ document: { type: "string" } }) } },
      "/finish": { post: { operationId: "finish", requestBody: { content: { "application/json": { schema: {
        type: "object", properties: { checksum: { type: "string" } }, required: ["checksum"],
      } } } }, responses: response({ receipt: { type: "string" } }) } },
    } }, "https://source.test/spec"));
    rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Worker" }, servers: [{ url: "https://worker.test" }], paths: {
      "/pack": { post: { operationId: "pack", requestBody: { content: { "application/json": { schema: {
        type: "object", properties: { document: { type: "string" } }, required: ["document"],
      } } } }, responses: { ...response({ checksum: { type: "string" } }), "202": { description: "Pending" } } } },
      "/tasks/{key}": { get: { operationId: "task", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { "303": { description: "Result" } } } },
      "/results/{key}": { get: { operationId: "result", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: response({ checksum: { type: "string" } }) } },
    } }, "https://worker.test/spec"));
    rc.graph.addCapability({ id: "composite:retained", provider: "composite:fixture", source: "composite", title: "Retained workflow",
      description: "", inputs: [], outputs: [{ name: "", type: "text", required: true }], risk: "write", tags: [],
      invoke: { kind: "composite", steps: [
        { capability: "openapi:source:prepare", bindings: [] },
        { capability: "openapi:worker:pack", bindings: [{ port: "document", from: "0.document" }] },
        { capability: "openapi:source:finish", bindings: [{ port: "checksum", from: "1.checksum" }] },
      ], result: "2.receipt", verify: [{ op: "equals", value: "stored:abc" }] },
    }, { id: "composite:fixture", title: "Fixture", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  }
  return { rc, calls };
}

test("a retained sequential workflow resumes the pending step and remaining effects without replay", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const initial = await first.rc.run("composite:retained");
  assert.equal(initial.status, "pending");
  assert.equal(initial.pending?.resumeId, `resume:${initial.runId}`);
  await first.rc.flush();
  const fresh = await world(store);
  assert.deepEqual(fresh.calls, []);
  const done = await fresh.rc.run(`resume:${initial.runId}`);
  assert.equal(done.status, "completed", done.error);
  assert.equal(done.output, "stored:abc");
  assert.equal(done.verification.status, "checked");
  assert.equal(done.resumes, initial.runId);
  assert.deepEqual(first.calls, ["GET /prepare", "POST /pack", "GET /tasks/t1"]);
  assert.deepEqual(fresh.calls, ["GET /results/t1", "POST /finish"]);
  await fresh.rc.flush();
  const again = await world(store);
  await assert.rejects(again.rc.run(`resume:${initial.runId}`), /no resumable/);
  assert.equal((again.rc.runStatus({ runId: initial.runId }) as any).status, "completed");
  assert.deepEqual(again.calls, []);
});

test("a persisted workflow refuses changed remaining contracts before resuming any read", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const initial = await first.rc.run("composite:retained");
  await first.rc.flush();
  const fresh = await world(store);
  const finish = fresh.rc.graph.get("openapi:source:finish")!;
  if (finish.invoke.kind === "http") finish.invoke.url += "/different";
  const denied = await fresh.rc.run(`resume:${initial.runId}`);
  assert.equal(denied.status, "pending");
  assert.equal(denied.verification.status, "unverified");
  assert.deepEqual(fresh.calls, []);
  await fresh.rc.flush();
});

test("workflow recovery retains host opt-in, policy, expiry, inputs and child ownership boundaries", async () => {
  for (const mode of ["disabled", "denied", "expired", "owner", "inputs"] as const) {
    const store = new MemoryStore(); const first = await world(store);
    const initial = await first.rc.run("composite:retained"); await first.rc.flush();
    if (mode === "expired") {
      const w = store.state!.workflowContinuations![0]; w.createdAt = Date.now() - 3_600_000; w.expiresAt = Date.now() - 1;
    }
    const fresh = await world(store, mode === "disabled" ? { workflowRecovery: false } : mode === "denied" ? {
      authority: { execution: { deniedCapabilities: ["openapi:source:finish"] } },
    } : {});
    if (mode === "owner") {
      const child = store.state!.workflowContinuations![0].childRunId;
      await assert.rejects(fresh.rc.run(`resume:${child}`), /owning workflow/);
    } else if (mode === "inputs") {
      await assert.rejects(fresh.rc.run(`resume:${initial.runId}`, { document: "different" }), /cannot change/);
      await assert.rejects(fresh.rc.run(`resume:${initial.runId}`, {}, { verify: [] }), /cannot change/);
    } else {
      const run = await fresh.rc.run(`resume:${initial.runId}`);
      assert.equal(run.status, "pending");
      assert.equal(run.verification.status, "unverified");
    }
    assert.deepEqual(fresh.calls, [], mode);
    await fresh.rc.flush();
  }
});

test("a workflow dispatch with no retained outcome stays unresolved after restore", async () => {
  class CaptureStore extends MemoryStore {
    dispatched?: PersistedState;
    override async save(s: PersistedState) {
      if (s.workflowContinuations?.[0]?.phase === "dispatching" && s.workflowContinuations[0].next === 1) this.dispatched = structuredClone(s);
      await super.save(s);
    }
  }
  const store = new CaptureStore(); const first = await world(store);
  const initial = await first.rc.run("composite:retained"); await first.rc.flush();
  assert.ok(store.dispatched);
  // Exact durable state from before the accepted write, with no fabricated
  // non-execution evidence. The first process is no longer used.
  const recovered = new MemoryStore(); recovered.state = store.dispatched;
  const fresh = await world(recovered);
  const run = await fresh.rc.run(`resume:${initial.runId}`);
  assert.equal(run.status, "pending");
  assert.match(run.pending?.detail ?? "", /no retained final result/);
  assert.equal(run.pending?.resumeId, undefined);
  assert.deepEqual(fresh.calls, []);
  await fresh.rc.flush();
});

test("failure to persist a completed step prevents every subsequent effect", async () => {
  class FailingStore extends MemoryStore {
    override async save(s: PersistedState) {
      if (s.workflowContinuations?.[0]?.phase === "ready" && s.workflowContinuations[0].next === 1) throw new Error("step journal unavailable");
      await super.save(s);
    }
  }
  const store = new FailingStore(); const first = await world(store);
  const run = await first.rc.run("composite:retained");
  assert.equal(run.status, "pending");
  assert.deepEqual(first.calls, ["GET /prepare"]);
  assert.equal(run.pending?.resumeId, undefined);
  await first.rc.flush();
  const fresh = await world(store);
  const stopped = await fresh.rc.run(`resume:${run.runId}`);
  assert.equal(stopped.status, "pending");
  assert.deepEqual(fresh.calls, []);
  await fresh.rc.flush();
});

test("oversized or credential-named workflow state is refused before dispatch, not silently redacted", async () => {
  for (const args of [{ token: "sensitive-control" }, { nested: { password: "sensitive-control" } }, { document: "x".repeat(70_000) }]) {
    const store = new MemoryStore(); const { rc, calls } = await world(store);
    const run = await rc.run("composite:retained", args);
    assert.equal(run.status, "failed");
    assert.deepEqual(calls, []);
    await rc.flush();
    assert.equal(store.state!.workflowContinuations!.length, 0);
    assert.ok(!JSON.stringify(store.state!.workflowContinuations).includes("sensitive-control"));
  }
});

test("a contract changed during checkpoint persistence refuses before the reserved dispatch", async () => {
  class YieldStore extends MemoryStore {
    change?: () => void;
    override async save(s: PersistedState) {
      await super.save(s);
      if (s.workflowContinuations?.[0]?.phase === "dispatching") { this.change?.(); this.change = undefined; }
    }
  }
  const store = new YieldStore(); const { rc, calls } = await world(store);
  store.change = () => { (rc.graph.get("openapi:source:prepare")!.invoke as any).url += "/changed"; };
  const run = await rc.run("composite:retained");
  assert.equal(run.status, "pending");
  assert.deepEqual(calls, []);
  await rc.flush();
});

test("successive pending steps advance the same retained workflow without replaying either write", async () => {
  const store = new MemoryStore(); let ticket = 0; const calls: string[] = [];
  const fetch: NonNullable<RuntimeOptions["fetch"]> = async (input, init) => {
    const path = new URL(String(input)).pathname; calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/prepare") return Response.json({ document: "prepared" });
    if (path === "/pack") return new Response(null, { status: 202, headers: { location: `/tasks/t${++ticket}`, "retry-after": "0" } });
    if (path.startsWith("/tasks/")) return new Response(null, { status: 303, headers: { location: path.replace("/tasks/", "/results/"), "retry-after": "0" } });
    if (path.startsWith("/results/")) return Response.json({ checksum: "abc" });
    return Response.json({ receipt: "stored:abc" });
  };
  const first = await world(store, { fetch });
  const cap = first.rc.graph.get("composite:retained")!;
  if (cap.invoke.kind !== "composite") throw new Error("fixture");
  cap.invoke.steps.splice(2, 0, structuredClone(cap.invoke.steps[1]));
  cap.invoke.steps[3].bindings[0].from = "2.checksum";
  cap.invoke.result = "3.receipt";
  const initial = await first.rc.run(cap.id); await first.rc.flush();
  const second = await world(store, { fetch });
  const pending = await second.rc.run(`resume:${initial.runId}`);
  assert.equal(pending.status, "pending");
  assert.equal(pending.pending?.resumeId, `resume:${initial.runId}`);
  await second.rc.flush();
  const third = await world(store, { fetch });
  const done = await third.rc.run(`resume:${initial.runId}`);
  assert.equal(done.status, "completed", done.error);
  assert.deepEqual(calls, ["GET /prepare", "POST /pack", "GET /tasks/t1", "GET /results/t1",
    "POST /pack", "GET /tasks/t2", "GET /results/t2", "POST /finish"]);
  await third.rc.flush();
});

test("stored predicates cannot be dropped on workflow resume", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const initial = await first.rc.run("composite:retained", {}, { verify: [{ op: "equals", value: "different" }] });
  await first.rc.flush();
  const fresh = await world(store);
  const result = await fresh.rc.run(`resume:${initial.runId}`);
  assert.equal(result.status, "failed");
  assert.equal(result.verification.status, "refuted");
  assert.deepEqual(fresh.calls, ["GET /results/t1", "POST /finish"]);
  await fresh.rc.flush();
  const again = await world(store);
  await assert.rejects(again.rc.run(`resume:${initial.runId}`), /no resumable/);
  assert.equal((again.rc.runStatus({ runId: initial.runId }) as any).status, "failed");
  assert.deepEqual(again.calls, []);
  await again.rc.flush();
});

test("witness independence includes pre-restart producers after their receipt buffer is gone", async () => {
  const store = new MemoryStore(); const first = await world(store);
  first.rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Destination" }, servers: [{ url: "https://destination.test" }], paths: {
    "/finish": { post: { operationId: "finish", requestBody: { content: { "application/json": { schema: {
      type: "object", properties: { checksum: { type: "string" } }, required: ["checksum"],
    } } } }, responses: response({ receipt: { type: "string" } }) } },
  } }, "https://destination.test/spec"));
  const cap = first.rc.graph.get("composite:retained")!;
  if (cap.invoke.kind !== "composite") throw new Error("fixture");
  cap.invoke.steps[2].capability = "openapi:destination:finish";
  cap.invoke.witnesses = [{ capability: "openapi:source:prepare", args: {},
    verify: [{ op: "equals", path: "document", value: "prepared" }] }];
  const run = await first.rc.run(cap.id); await first.rc.flush();
  store.state!.receipts = []; // Simulate eviction from the bounded historical receipt buffer.
  const fresh = await world(store);
  const result = await fresh.rc.run(`resume:${run.runId}`);
  assert.equal(result.status, "failed", JSON.stringify(result.pending ?? result.error));
  assert.equal(result.verification.status, "refuted");
  assert.match(result.error ?? "", /witness must be separate/);
  assert.deepEqual(fresh.calls, ["GET /results/t1", "POST /finish"]);
  await fresh.rc.flush();
});

test("two simultaneous resumes cannot dispatch the remaining workflow twice", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const initial = await first.rc.run("composite:retained"); await first.rc.flush();
  let release!: () => void, observed!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { observed = resolve; });
  const calls: string[] = [];
  const fresh = await world(store, { fetch: async (input, init) => {
    const path = new URL(String(input)).pathname; calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("/results/")) { observed(); await wait; return Response.json({ checksum: "abc" }); }
    return Response.json({ receipt: "stored:abc" });
  } });
  const done = fresh.rc.run(`resume:${initial.runId}`);
  await started;
  await assert.rejects(fresh.rc.run(`resume:${initial.runId}`), /already active/);
  release();
  assert.equal((await done).status, "completed");
  assert.deepEqual(calls, ["GET /results/t1", "POST /finish"]);
  await fresh.rc.flush();
});

test("snapshot restore is order-independent but still retires broken nested contracts", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const inner = first.rc.graph.get("composite:retained")!;
  if (inner.invoke.kind !== "composite") throw new Error("fixture");
  inner.invoke.signatures = inner.invoke.steps.map(s => signature(first.rc.graph.get(s.capability)!));
  first.rc.graph.addCapability({ ...structuredClone(inner), id: "composite:outer",
    invoke: { kind: "composite", steps: [{ capability: inner.id, bindings: [] }], result: "0.", signatures: [signature(inner)] },
  }, { id: "composite:fixture", title: "Fixture", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  await first.rc.flush();
  store.state!.reflections.reverse();
  store.state!.reflections.find(r => r.provider.id === "composite:fixture")!.capabilities.reverse();
  const fresh = await RightClick.create({ store, directories: [], sandbox: null });
  assert.ok(fresh.graph.get(inner.id));
  assert.ok(fresh.graph.get("composite:outer"));
  await fresh.flush();
  const source = store.state!.reflections.flatMap(r => r.capabilities).find(c => c.id === "openapi:source:prepare")!;
  if (source.invoke.kind === "http") source.invoke.url += "/changed";
  const changed = await RightClick.create({ store, directories: [], sandbox: null });
  assert.equal(changed.graph.get(inner.id), undefined);
  assert.equal(changed.graph.get("composite:outer"), undefined);
  await changed.flush();
});
