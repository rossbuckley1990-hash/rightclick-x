import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { ProcessMemoryStore } from "../src/entry/node-host.ts";
import { dispatch } from "../src/interface/tools.ts";
import type { Capability } from "../src/core/types.ts";
import { describeResult, resultDescription } from "../src/core/result-description.ts";

const id = "openapi:parcels:lookup";
function capability(): Capability {
  return { id, title: "Lookup parcel", description: "Parcel record", provider: "openapi:parcels", source: "openapi",
    inputs: [{ name: "code", type: "id.parcel", required: true }], outputs: [{ name: "", type: "json", required: true }],
    fields: [{ path: "parcel.label" }, { path: "parcel.mass" }], risk: "read", tags: ["parcel"],
    invoke: { kind: "http", method: "GET", url: "https://parcels.test/{code}", pathParams: ["code"], queryParams: [], headerParams: [], body: null, bodyParams: [] } };
}
async function lab() {
  let fail = false, calls = 0;
  const store = new ProcessMemoryStore();
  const fetch = async () => { calls++; return Response.json(fail ? { error: "offline" } : { parcel: { label: "PRIVATE-VALUE", mass: 7 } }, { status: fail ? 503 : 200 }); };
  const options = { directories: [], sandbox: null, fetch, store };
  const rc = await RightClick.create(options);
  rc.graph.addCapability(capability(), { id: "openapi:parcels", title: "Parcels", source: "openapi", origin: "https://parcels.test", learnedAt: "2026-01-01T00:00:00Z" });
  const made = await rc.compose({ have: { code: { type: "id.parcel", value: "private-input" } }, want: "json", through: [id],
    maxSteps: 1, origins: ["https://parcels.test"], risks: ["read"], run: true, publish: "parcel summary", verify: [{ op: "exists", path: "parcel.mass" }] });
  assert.equal(made.executed?.status, "completed");
  await rc.flush();
  const snapshot = await store.load();
  return { rc, options, state: () => snapshot!, calls: () => calls, fail: () => { fail = true; } };
}

test("saved goals retain bounded declared result guidance without retaining caller values or granting planning evidence", async () => {
  const { rc, state, calls } = await lab();
  const before = calls(), graph = JSON.stringify(rc.exportGraph());
  const detail: any = await dispatch(rc, "context_explain", { id: "goal:parcel-summary" });
  assert.equal(detail.reuse.id, "goal:parcel-summary");
  assert.equal(detail.reuse.storage, "store-configured");
  assert.equal(detail.reuse.invoke.tool, "context_run");
  assert.deepEqual(detail.reuse.restrictions.origins, ["https://parcels.test"]);
  assert.deepEqual(detail.reuse.restrictions.risks, ["read"]);
  assert.equal(detail.contract.outputSemantics.lastResult.status, "matches-current-result-declaration");
  assert.deepEqual(detail.contract.outputSemantics.lastResult.fields.map((f: any) => f.path), ["parcel.label", "parcel.mass"]);
  assert.deepEqual(detail.contract.outputSemantics.checkPaths, ["parcel.mass"]);
  assert.equal(rc.graph.get("goal:parcel-summary")!.fields, undefined);
  assert.equal(calls(), before);
  assert.equal(JSON.stringify(rc.exportGraph()), graph);
  assert.ok(!JSON.stringify(state().published).includes("PRIVATE-VALUE"));
  assert.ok(!JSON.stringify(state().published).includes("private-input"));
});

test("fresh readers retain guidance while declaration changes, disappearance and failed execution stay explicit", async () => {
  const { rc, options, calls, fail } = await lab();
  const fresh = await RightClick.create(options);
  const detail: any = fresh.explainForRun("goal:parcel-summary");
  assert.equal(detail.contract.outputSemantics.lastResult.status, "matches-current-result-declaration");
  assert.equal(calls(), 1);
  const stored = JSON.stringify((fresh.published.get("parcel-summary") as any).lastResult);
  fail();
  const result: any = await fresh.run("goal:parcel-summary", { code: "p2" });
  assert.equal(result.status, "failed");
  assert.equal(result.reuse.id, "goal:parcel-summary");
  assert.equal(JSON.stringify((fresh.published.get("parcel-summary") as any).lastResult), stored);
  fresh.graph.get(id)!.fields = [{ path: "other" }];
  assert.equal((fresh.explainForRun("goal:parcel-summary") as any).contract.outputSemantics.lastResult.status, "changed-result-declaration");
  fresh.graph.forget("openapi:parcels");
  assert.equal((fresh.explainForRun("goal:parcel-summary") as any).contract.outputSemantics.lastResult.status, "unavailable-result-declaration");
  assert.equal(rc.graph.get(id)!.fields![0].path, "parcel.label");
});

test("legacy goals remain unknown and disclosure cannot clear execution restrictions", async () => {
  const { options, state, calls } = await lab();
  delete state().published![0].lastResult;
  await options.store.save(state());
  const rc = await RightClick.create({ ...options, authority: { execution: { allowedRisks: [] } } });
  const before = calls();
  const detail: any = rc.explainForRun("goal:parcel-summary");
  assert.equal(detail.contract.outputSemantics.lastResult.status, "not-recorded");
  assert.equal(detail.execution.allowed, false);
  const refused = await rc.run("goal:parcel-summary", { code: "p3" });
  assert.equal(refused.status, "failed");
  assert.equal(calls(), before);
});

test("successful legacy reuse records declarations without replacing the saved definition or output", async () => {
  const { options, state } = await lab();
  delete state().published![0].lastResult;
  await options.store.save(state());
  const rc = await RightClick.create(options);
  const goal = rc.published.get("parcel-summary")!;
  const identity = await (rc as any).goalDigest(goal), created = goal.publishedAt;
  const output: any = await dispatch(rc, "context_run", { id: "goal:parcel-summary", args: { code: "p3" }, view: { fields: ["parcel.mass"] } });
  assert.deepEqual(output.output, { "parcel.mass": 7 });
  assert.equal(output.reuse.id, "goal:parcel-summary");
  assert.equal(goal.publishedAt, created);
  assert.equal(goal.calls, 1);
  assert.equal(await (rc as any).goalDigest(goal), identity, "advisory metadata is not a changed goal definition");
  assert.equal((rc.explainForRun(goal.slug) as any).contract.outputSemantics.lastResult.status, "matches-current-result-declaration");
});

test("nested composite descriptions stay relative to the chosen result and do not turn scalar leaves into objects", async () => {
  const { rc } = await lab();
  const inner: Capability = { ...capability(), id: "composite:inner", provider: "composite:fixture", fields: undefined,
    invoke: { kind: "composite", steps: [{ capability: id, bindings: [{ port: "code", from: "$const", value: "PRIVATE-CONSTANT" }] }], result: "0.parcel" } };
  rc.graph.addCapability(inner, { id: inner.provider, title: "Composite", source: "composite", origin: "fixture", learnedAt: "2026-01-01T00:00:00Z" });
  const description = describeResult(rc.graph, [{ capability: inner.id, bindings: [] }], "0", "json")!;
  assert.deepEqual(description.fields.map(f => f.path), ["label", "mass"]);
  assert.equal(description.references.length, 2);
  assert.ok(!JSON.stringify(description).includes("PRIVATE-CONSTANT"));
  assert.equal(resultDescription(rc.graph, description).status, "matches-current-result-declaration");
  const scalar = describeResult(rc.graph, [{ capability: inner.id, bindings: [] }], "0.mass", "number")!;
  assert.deepEqual(scalar.fields, []);
  rc.graph.get(id)!.fields = [{ path: "parcel.other" }];
  assert.equal(resultDescription(rc.graph, description).status, "changed-result-declaration");
});

test("wide declarations are explicitly bounded and malformed advisory metadata stays unknown", async () => {
  const { rc } = await lab();
  rc.graph.get(id)!.fields = Array.from({ length: 400 }, (_, i) => ({ path: `field${i}` }));
  const result = describeResult(rc.graph, [{ capability: id, bindings: [] }], "0", "json")!;
  assert.equal(result.fields.length, 64);
  assert.equal(result.truncated, true);
  assert.ok(JSON.stringify(result).length < 8192);
  rc.graph.get(id)!.fields![399] = { path: "changed_outside_retained_subset" };
  assert.equal(resultDescription(rc.graph, result).status, "matches-retained-result-subset");
  assert.match(resultDescription(rc.graph, result).note, /omitted fields/);
  assert.equal(resultDescription(rc.graph, { ...result, fields: null } as any).status, "not-recorded");
  assert.equal(resultDescription(rc.graph, { ...result, unexpected: "caller-value" } as any).status, "not-recorded");
});

test("unselected and observed-only fields never become assertions that the result returned them", async () => {
  const { rc } = await lab();
  rc.graph.get(id)!.fields = [{ path: "rare", selected: false }];
  rc.graph.get(id)!.outputs.push({ name: "rare", type: "text", required: false },
    { name: "secret_observed_key", type: "text", required: false, observed: true });
  const description = describeResult(rc.graph, [{ capability: id, bindings: [] }], "0", "json")!;
  assert.deepEqual(description.fields, [{ path: "rare", selected: false }]);
  assert.match(resultDescription(rc.graph, description).note, /not observed values or a future output guarantee/);
});
