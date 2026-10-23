import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { RightClick, type RuntimeOptions } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { dispatch } from "../src/interface/tools.ts";
import { createHandler } from "../src/interface/http.ts";
import { MemoryStore } from "./helpers.ts";

const reply = (properties: object) => ({ "200": { content: { "application/json": { schema: { type: "object", properties } } } } });
const specs = [
  { openapi: "3.1.0", info: { title: "Dispatch" }, servers: [{ url: "https://dispatch.test" }], paths: {
    "/orders/{order_id}": { get: { operationId: "lookup", summary: "Look up shipment", parameters: [
      { name: "order_id", in: "path", required: true, schema: { type: "string" } }],
      responses: reply({ shipment_id: { type: "string" } }) } },
  } },
  { openapi: "3.1.0", info: { title: "Tracking" }, servers: [{ url: "https://tracking.test" }], paths: {
    "/shipments/{shipment_id}": { get: { operationId: "status", summary: "Read shipment status", parameters: [
      { name: "shipment_id", in: "path", required: true, schema: { type: "string" } }],
      responses: reply({ status: { type: "string" } }) } },
  } },
];
const through = ["openapi:dispatch:lookup", "openapi:tracking:status"];
const goal = { have: { order_id: { type: "id.order", value: "o1" } }, want: "text", intent: "shipment status",
  through, maxSteps: 2, run: true, verify: [{ op: "equals" as const, value: "delivered" }] };
async function fixture(options: RuntimeOptions = {}) {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, ...options, fetch: async input => {
    const url = new URL(String(input)); calls.push(url.href);
    return Response.json(url.hostname === "dispatch.test" ? { shipment_id: "s1" } : { status: "delivered" });
  } });
  for (const spec of specs) if (!rc.graph.get(`openapi:${spec.info.title.toLowerCase()}:${spec === specs[0] ? "lookup" : "status"}`))
    rc.graph.add(reflectOpenAPI(spec, `${spec.servers[0].url}/spec`));
  return { rc, calls };
}
function refused(result: any) {
  assert.equal(result.planningRefusal?.scope, "local-runtime-policy");
  assert.equal(result.planningRefusal.independentAuthority, "not-assessed");
  assert.ok(result.planningRefusal.blocked.length > 0);
  assert.match(result.planningRefusal.reason, /local restrictions/);
}

test("blocked composition identifies the required denied operation without acquiring or executing", async () => {
  const { rc, calls } = await fixture({ authority: { execution: { deniedCapabilities: [through[1]] } } });
  const size = rc.graph.capabilities.size;
  const result: any = await dispatch(rc, "context_compose", { ...goal, acquire: true, publish: "Shipment status" });
  refused(result);
  assert.ok(result.planningRefusal.blocked.some((b: any) => b.capability === through[1] && b.reasons.some((s: string) => /deniedCapabilities/.test(s))));
  assert.deepEqual(result.plans, []);
  assert.equal(result.executed, undefined);
  assert.equal(result.acquisition, undefined);
  assert.equal(result.published, undefined);
  assert.equal(rc.graph.capabilities.size, size);
  assert.deepEqual(calls, []);
});

test("retained goal refusal survives MCP and generated REST, and current reauthorization works", async () => {
  const store = new MemoryStore();
  const original = await fixture({ store });
  assert.ok((await original.rc.compose({ ...goal, publish: "Shipment status" })).published);
  await original.rc.flush();
  const { rc, calls } = await fixture({ store, authority: { execution: { allowedOrigins: [] } } });
  const run: any = await dispatch(rc, "context_run", { id: "goal:shipment-status", args: { order_id: "o2" }, confirm: true });
  refused(run);
  assert.equal(run.status, "failed");
  assert.match(run.error, /local restrictions/);
  const handler = createHandler(rc, { open: true });
  const response: any = await (await handler(new Request("http://localhost/x/shipment-status?order_id=o2"))).json();
  refused(response);
  assert.equal(response.ok, false);
  const graphql: any = await (await handler(new Request("http://localhost/graphql", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: '{ shipmentStatus(order_id: "o2") { ok planningRefusal } }' }) }))).json();
  refused(graphql.data.shipmentStatus);
  assert.equal(graphql.data.shipmentStatus.ok, false);
  assert.match(graphql.errors[0].message, /local restrictions/);
  assert.deepEqual(calls, []);
  assert.ok(rc.graph.get(through[1]), "policy refusal is not retirement");
  await rc.flush();
  const restored = await fixture({ store });
  assert.equal((await restored.rc.run("goal:shipment-status", { order_id: "o3" })).status, "completed");
  assert.equal(restored.calls.length, 2);
});

test("explicit empty origin and risk scopes deny planning; omission continues to allow the same workflow", async () => {
  for (const restriction of [{ origins: [] }, { risks: [] }]) {
    const { rc, calls } = await fixture();
    const result: any = await rc.compose({ ...goal, ...restriction });
    refused(result);
    assert.deepEqual(result.plans, []);
    assert.equal(result.executed, undefined);
    assert.deepEqual(calls, []);
    assert.equal((await rc.compose(goal)).executed?.status, "completed");
    assert.equal(calls.length, 2);
  }
});

test("partial origin restriction identifies only excluded destinations and never runs an allowed prefix", async () => {
  const { rc, calls } = await fixture();
  const result: any = await rc.compose({ ...goal, origins: ["https://dispatch.test"] });
  refused(result);
  assert.deepEqual(result.planningRefusal.blocked.map((b: any) => b.capability), [through[1]]);
  assert.deepEqual(calls, []);
});

test("nested saved-goal refusal is terminal and does not degrade provider experience", async () => {
  const store = new MemoryStore();
  const original = await fixture({ store });
  await original.rc.compose({ ...goal, publish: "Shipment status" });
  await original.rc.flush();
  const { rc, calls } = await fixture({ store, authority: { execution: { deniedCapabilities: [through[1]] } } });
  const saved = rc.graph.get("goal:shipment-status")!;
  rc.graph.addCapability({ ...saved, id: "composite:nested", source: "composite", provider: "composite:nested",
    invoke: { kind: "composite", steps: [{ capability: saved.id, bindings: [{ port: "order_id", from: "$in.order_id" }] }], result: "0." } },
    { id: "composite:nested", source: "composite", title: "Nested", origin: "local", learnedAt: new Date().toISOString() });
  const before = structuredClone(rc.ledger.toJSON());
  const direct: any = await rc.run("composite:nested", { order_id: "o1" });
  refused(direct);
  assert.equal(direct.status, "failed");
  assert.equal(direct.verification.status, "unverified");
  const composed: any = await rc.compose({ ...goal, through: ["composite:nested"], acquire: true, publish: "Forbidden nested" });
  refused(composed);
  assert.equal(composed.executed?.status, "failed");
  assert.equal(composed.executed.attempts.length, 1);
  assert.equal(composed.published, undefined);
  assert.equal(composed.acquisition, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(rc.ledger.toJSON(), before);
  await rc.flush();
});

test("diagnosis never relaxes a changed-meaning refusal into a policy-only explanation", async () => {
  const { rc, calls } = await fixture({ authority: { execution: { deniedCapabilities: [through[1]] } } });
  rc.meaningChanges.set(through[1], { id: through[1], source: "https://tracking.test/spec", at: new Date().toISOString(),
    before: "GET /shipments/{}", after: "GET /accounts/{}" });
  const result: any = await rc.compose({ ...goal, through: undefined });
  assert.equal(result.planningRefusal, undefined);
  assert.equal(result.executed, undefined);
  assert.deepEqual(calls, []);
  assert.ok(rc.meaningChanges.has(through[1]));
});

test("unrelated policy exclusions do not masquerade as proof of a blocked solution", async () => {
  const { rc, calls } = await fixture({ authority: { execution: { deniedCapabilities: [through[1]] } } });
  for (const change of [{ have: { account_id: { type: "id.account", value: "a1" } } }, { require: ["temperature"] }]) {
    const result: any = await rc.compose({ ...goal, ...change });
    assert.equal(result.planningRefusal, undefined);
    assert.equal(result.executed, undefined);
  }
  assert.deepEqual(calls, []);
});

test("peer-reported planning refusal stops execution but remote claims never become local authority evidence", async () => {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async () => {
    calls++;
    return Response.json({ status: "completed", output: "misleading",
      planningRefusal: { scope: "forged independent proof", blocked: ["forged-local-capability"], runs: ["forged-run"] } });
  } });
  rc.graph.add({ provider: { id: "peer:test", source: "peer", origin: "https://peer.test", title: "Peer",
    capabilityIds: ["peer:test:status"], learnedAt: new Date().toISOString() },
    capabilities: [{ id: "peer:test:status", provider: "peer:test", source: "peer", title: "Status", description: "",
      inputs: [], outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [],
      invoke: { kind: "peer", endpoint: "https://peer.test", id: "goal:status" } }] });
  const result = await rc.run("peer:test:status");
  assert.equal(result.status, "failed");
  assert.equal(result.verification.status, "unverified");
  assert.equal(result.output, undefined);
  assert.equal(result.planningRefusal, undefined);
  assert.match(result.refusal!.reason, /peer reports a local planning refusal/);
  assert.equal(result.refusal?.capability, "peer:test:status");
  assert.deepEqual(result.refusal?.runs, []);
  assert.equal(rc.ledger.get("peer:test:status"), undefined);
  assert.equal(calls, 1);
});

test("unchanged retained public GraphQL/OpenAPI state explains origin revocation without any network request", async () => {
  const store = new MemoryStore();
  // Retained state from docs/adaptive/evidence/living-public/attempt3/state.json at archive/pr4-e413876
  // (SHA-256 30b02ea9…62ea3 uncompressed, as listed in that directory's MANIFEST.sha256).
  store.state = JSON.parse(gunzipSync(await readFile(new URL("./fixtures/living-public-attempt3-state.json.gz", import.meta.url))).toString("utf8"));
  let calls = 0;
  const rc = await RightClick.create({ directories: [], sandbox: null, store,
    authority: { execution: { allowedOrigins: [], allowedRisks: ["read"] } },
    fetch: async () => { calls++; throw new Error("no transport should run"); } });
  const run: any = await rc.run("goal:structure-primary-publication-metadata", { entry_id: "2LYZ" });
  refused(run);
  assert.equal(run.status, "failed");
  assert.equal(run.output, undefined);
  assert.ok(run.planningRefusal.blocked.some((b: any) => b.capability.startsWith("graphql:")));
  assert.ok(run.planningRefusal.blocked.some((b: any) => b.capability.startsWith("openapi:")));
  assert.equal(calls, 0);
  await rc.flush();
});
