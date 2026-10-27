import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type RuntimeOptions, type PersistedState } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";
import { signature } from "../src/core/graph.ts";
import { dispatch } from "../src/interface/tools.ts";
import { decodeState, PUBLICATION_SNAPSHOT_REQUIREMENT } from "../src/core/state-format.ts";

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

const composition = {
  have: { document: { type: "text", value: "prepared" } }, want: "text", run: true,
  through: ["openapi:worker:pack", "openapi:source:finish"],
  verify: [{ op: "equals", value: "stored:abc" }],
  origins: ["https://worker.test", "https://source.test"],
};

test("context_compose retains its complete selected plan, checks and publication across restart", async () => {
  const store = new MemoryStore(); const first = await world(store);
  const initial: any = await dispatch(first.rc, "context_compose", { ...composition, publish: "Stored package" });
  assert.equal(initial.executed?.status, "pending");
  assert.equal(initial.executed.pending.reason, "workflow-pending");
  assert.ok(initial.executed.pending.resumeId);
  assert.equal(first.rc.graph.get("goal:stored-package"), undefined);
  assert.equal(first.rc.graph.list().some(c => c.id.startsWith("execution:composition:")), false);
  await first.rc.flush();
  assert.ok(store.state!.requirements!.includes(PUBLICATION_SNAPSHOT_REQUIREMENT));
  const unsafe = structuredClone(store.state!);
  unsafe.requirements = unsafe.requirements!.filter(r => r !== PUBLICATION_SNAPSHOT_REQUIREMENT);
  assert.throws(() => decodeState(unsafe), /missing the publication snapshot requirement/);
  const fresh = await world(store);
  const done: any = await dispatch(fresh.rc, "context_run", { id: initial.executed.pending.resumeId });
  assert.equal(done.status, "completed", done.error);
  assert.equal(done.output, "stored:abc");
  assert.equal(done.verification.status, "checked");
  assert.equal(done.composition?.published?.slug, "stored-package");
  assert.equal("executed" in done.composition, false, "completion metadata must not duplicate unbounded output behind the tool's output view");
  assert.ok(done.composition?.crystallized?.id);
  const saved = fresh.rc.graph.get(done.composition.crystallized.id)!;
  assert.equal(saved.invoke.kind, "composite");
  if (saved.invoke.kind === "composite") assert.deepEqual(saved.invoke.origins, composition.origins);
  assert.ok(fresh.rc.graph.get("goal:stored-package"));
  assert.deepEqual(first.calls, ["POST /pack", "GET /tasks/t1"]);
  assert.deepEqual(fresh.calls, ["GET /results/t1", "POST /finish"]);
  await fresh.rc.flush();
});

test("a resumed composition does not replace a goal published while it was pending", async () => {
  const store = new MemoryStore();
  const first = await world(store);
  const pending: any = await dispatch(first.rc, "context_compose", { ...composition, publish: "Stored package" });
  assert.equal(pending.executed.status, "pending");
  await first.rc.flush();
  const fresh = await world(store);
  const concurrent = await fresh.rc.compose({ have: {}, want: "text", run: true,
    through: ["openapi:source:prepare"], publish: "Stored package" });
  assert.ok(concurrent.published, JSON.stringify(concurrent));
  const revision = fresh.rc.published.get("stored-package")!.revision;
  const done: any = await dispatch(fresh.rc, "context_run", { id: pending.executed.pending.resumeId });
  assert.equal(done.status, "completed", done.error);
  assert.match(done.composition?.publishRefused ?? "", /changed since execution began/);
  assert.equal(fresh.rc.published.get("stored-package")!.revision, revision);
});

test("composition recovery preserves input-word obligations and refuses lossy stored checks", async () => {
  const store = new MemoryStore(); const first = await world(store);
  for (const id of composition.through) first.rc.graph.get(id)!.tags.push("preserves-input-words");
  const pending: any = await dispatch(first.rc, "context_compose", { ...composition, publish: "Lossy result" });
  assert.equal(pending.executed.status, "pending"); await first.rc.flush();
  const fresh = await world(store);
  const result = await fresh.rc.run(pending.executed.pending.resumeId);
  assert.equal(result.status, "failed");
  assert.equal(result.verification.status, "refuted");
  assert.equal(result.output, null);
  assert.match(result.error ?? "", /preservation/);
  assert.equal(fresh.rc.graph.get("goal:lossy-result"), undefined);
  await fresh.rc.flush();
  for (const verify of [[{ op: "equals", value: { absent: undefined } }], [{ op: "equals", value: { token: "not-for-storage" } }]]) {
    const refused = await world(new MemoryStore());
    const r: any = await dispatch(refused.rc, "context_compose", { ...composition, verify });
    assert.equal(r.executed.status, "failed");
    assert.deepEqual(refused.calls, []);
    await refused.rc.flush();
  }
});

test("repeated composition does not grow the graph or retain per-execution reliability entries", async () => {
  const store = new MemoryStore(); const { rc } = await world(store, { httpContinuation: { maxRequests: 4 } });
  const size = rc.graph.list().length;
  for (let i = 0; i < 12; i++) {
    const result = await rc.compose({ ...composition, verify: [{ op: "equals", value: "stored:abc" }], crystallize: false });
    assert.equal(result.executed?.status, "completed");
  }
  await rc.flush();
  assert.equal(rc.graph.list().length, size);
  assert.deepEqual(store.state!.workflowContinuations, []);
  assert.equal(Object.keys(store.state!.ledger).some(id => id.startsWith("execution:composition:")), false);
  assert.equal((await rc.verifyReceipts()).intact, true);
});

test("crystallized reuse retains observed preservation checks for a different input", async () => {
  const store = new MemoryStore();
  const fetch: NonNullable<RuntimeOptions["fetch"]> = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/pack") return Response.json({ checksum: "prepared verified" });
    assert.equal(path, "/finish");
    return Response.json({ receipt: "prepared verified" });
  };
  const first = await world(store, { fetch });
  for (const id of composition.through) first.rc.graph.get(id)!.tags.push("preserves-input-words");
  const made = await first.rc.compose({ ...composition, verify: [{ op: "contains", value: "verified" }] });
  assert.equal(made.executed?.status, "completed"); assert.ok(made.crystallized);
  await first.rc.flush();
  const fresh = await world(store, { fetch });
  const refused = await fresh.rc.run(made.crystallized!.id, { document: "different words" });
  assert.equal(refused.status, "failed");
  assert.match(refused.error ?? "", /preservation/);
  assert.equal(refused.verification.status, "refuted");
  await fresh.rc.flush();
});

test("composition recovery retains failed predicates and current publication restrictions", async () => {
  for (const mode of ["predicate", "publication", "tampered", "contract"] as const) {
    const store = new MemoryStore(); const first = await world(store);
    const initial: any = await dispatch(first.rc, "context_compose", {
      ...composition, publish: "Stored package", ...(mode === "predicate" ? { verify: [{ op: "equals", value: "wrong" }] } : {}),
    });
    await first.rc.flush();
    if (mode === "tampered") store.state!.workflowContinuations![0].composition!.options.verify = [];
    const fresh = await world(store, mode === "publication" ? { authority: { publish: "verified" } } : {});
    if (mode === "contract") (fresh.rc.graph.get("openapi:source:finish")!.invoke as any).url += "/changed";
    const done = await fresh.rc.run(initial.executed.pending.resumeId);
    assert.equal(done.status, mode === "publication" ? "completed" : mode === "predicate" ? "failed" : "pending");
    assert.equal(done.verification.status, mode === "publication" ? "checked" : mode === "predicate" ? "refuted" : "unverified");
    assert.equal(fresh.rc.graph.get("goal:stored-package"), undefined);
    if (mode === "publication") assert.match(done.composition?.publishRefused ?? "", /only verified/);
    if (mode === "tampered" || mode === "contract") assert.deepEqual(fresh.calls, []);
    await fresh.rc.flush();
  }
});

test("composition recovery preserves scoped egress and pinned independent witness checks", async () => {
  for (const mode of ["success", "egress", "changed", "refuted", "denied"] as const) {
    const store = new MemoryStore(); const first = await world(store);
    first.rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Auditor" },
      servers: [{ url: "https://auditor.test" }], paths: { "/inspect": {
        get: { operationId: "inspect", responses: response({ receipt: { type: "string" } }) },
      } } }, "https://auditor.test/spec"));
    const initial: any = await dispatch(first.rc, "context_compose", {
      ...composition, publish: "Checked package",
      origins: mode === "egress" ? composition.origins : [...composition.origins, "https://auditor.test"],
      witnesses: [{ capability: "openapi:auditor:inspect", args: {},
        verify: [{ op: "equals", path: "receipt", value: "stored:abc" }] }],
    });
    assert.equal(initial.executed.status, "pending"); await first.rc.flush();
    let audits = 0;
    const fresh = await world(store, { fetch: async (input, init) => {
      const u = new URL(String(input));
      if (u.host === "auditor.test") {
        audits++;
        return mode === "denied" ? new Response(null, { status: 403 }) :
          Response.json({ receipt: mode === "refuted" ? "wrong" : "stored:abc" });
      }
      if (u.pathname === "/results/t1") return Response.json({ checksum: "abc" });
      assert.equal(u.pathname, "/finish");
      assert.equal(JSON.parse(String(init?.body)).checksum, "abc");
      return Response.json({ receipt: "stored:abc" });
    } });
    if (mode === "changed") (fresh.rc.graph.get("openapi:auditor:inspect")!.invoke as any).url += "/different";
    const done = await fresh.rc.run(initial.executed.pending.resumeId);
    assert.equal(done.status, mode === "success" ? "completed" : "failed", done.error);
    assert.equal(done.verification.status, mode === "success" ? "verified" : mode === "denied" ? "unverified" : "refuted");
    assert.equal(audits, mode === "egress" || mode === "changed" ? 0 : 1);
    assert.equal(!!fresh.rc.graph.get("goal:checked-package"), mode === "success");
    await fresh.rc.flush();
  }
});

test("saved-goal recovery binds its full definition, current authority and caller checks", async () => {
  for (const mode of ["success", "definition", "denied", "extra-check", "generated"] as const) {
    const store = new MemoryStore(); const seed = await world(store, { httpContinuation: { maxRequests: 4 } });
    const published = await seed.rc.compose({ ...composition, verify: [{ op: "equals", value: "stored:abc" }],
      publish: "Stored package" });
    assert.equal(published.executed?.status, "completed"); await seed.rc.flush();
    const first = await world(store);
    const initial: any = mode === "generated" ? await first.rc.callPublished("stored-package", { document: "prepared" }) :
      await first.rc.run("goal:stored-package", { document: "prepared" }, mode === "extra-check" ? { verify: [{ op: "equals", value: "wrong" }] } : {});
    assert.equal(initial.status, "pending", initial.error);
    assert.equal(initial.pending.reason, "workflow-pending");
    await first.rc.flush();
    if (mode === "definition") store.state!.published![0].verify = [];
    const fresh = await world(store, mode === "denied" ? { authority: { execution: { deniedCapabilities: ["goal:stored-package"] } } } : {});
    const done = await fresh.rc.run(initial.pending.resumeId);
    assert.equal(done.status, mode === "definition" || mode === "denied" ? "pending" : mode === "extra-check" ? "failed" : "completed", done.error);
    if (mode === "definition" || mode === "denied") assert.deepEqual(fresh.calls, []);
    else assert.deepEqual(fresh.calls, ["GET /results/t1", "POST /finish"]);
    if (mode !== "generated") assert.equal((fresh.rc.runStatus({ runId: initial.runId }) as any).status, done.status);
    await fresh.rc.flush();
    const after = await world(store);
    if (mode !== "generated") assert.equal((after.rc.runStatus({ runId: initial.runId }) as any).status, done.status);
    await after.rc.flush();
  }
});

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
  // A retained witness must carry the same contract pin that publication
  // installs; this fixture still tests its independence from prior producers.
  cap.invoke.witnesses = await (first.rc as any).pinWitnesses([{ capability: "openapi:source:prepare", args: {},
    verify: [{ op: "equals", path: "document", value: "prepared" }] }]);
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
