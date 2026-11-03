import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { serve } from "../src/entry/node-host.ts";
import { SCENARIOS_50 } from "../experiments/workflow-survival/scenarios-50.ts";
import { createBillingService50, createFreightService50, createDirectoryService50, createInventoryService50 } from "../experiments/workflow-survival/services-50.ts";
import { inferType, strongly } from "../src/core/semantics.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { establishedSemantics } from "../src/core/units.ts";

// Original services, inputs and business answers are untouched. These cases
// previously claimed completion with incompatible quantities (4b3d3e2).
const factories = { billing: createBillingService50, freight: createFreightService50, directory: createDirectoryService50, inventory: createInventoryService50 };
for (const id of ["SEM-02", "SEM-04", "SEM-05", "SEM-07", "SEM-08", "SEM-09"]) {
  test(`historical ${id}: generic number does not establish a semantic business result`, async () => {
    const scenario = SCENARIOS_50.find(s => s.id === id)!;
    const provider = factories[scenario.service as keyof typeof factories]();
    provider.setVersion(scenario.version);
    const server = await serve(provider.handler, 0);
    try {
      const rc = await RightClick.create({ directories: [], authority: { retry: ["*"] }, timeoutMs: 4000 });
      await rc.learn({ source: server.url });
      const result = await rc.compose({ have: scenario.input, want: "number",
        intent: `${scenario.name}. ${scenario.description}`, run: true });
      assert.notEqual(result.executed?.status, "completed",
        JSON.stringify({ scenario: id, expected: scenario.expectedOutput, actual: result.executed?.output,
          plans: result.plans.map(p => ({ resultType: p.resultType, result: p.result, steps: p.steps })),
          verification: result.executed?.verification }));
    } finally { await server.close(); }
  });
}

test("dimensional contracts generalise across names and reject incompatible bindings", () => {
  for (const [left, right] of [["payload_kg", "payload_lbs"], ["height_m", "height_ft"],
    ["temperature_celsius", "temperature_fahrenheit"], ["period_s", "period_ms"],
    ["utilization_percent", "utilization_bps"], ["allocation_mb", "allocation_mib"],
    ["velocity_kmh", "velocity_mph"], ["reservoir_l", "reservoir_gal"]]) {
    const a = inferType(left, { type: "number" }), b = inferType(right, { type: "number" });
    assert.ok(a.startsWith("quantity:"));
    assert.ok(b.startsWith("quantity:"));
    assert.equal(strongly(a, b), false);
    assert.equal(strongly("number", b), false);
  }
  assert.equal(strongly("id.customer", "id.invoice"), false);
  assert.equal(establishedSemantics({ type: "quantity:mass:kg", provenance: "declared" }), false);
  assert.equal(establishedSemantics({ type: "quantity:mass:kg", provenance: "inferred" }), false);
  assert.equal(establishedSemantics({ type: "quantity:mass:kg", provenance: "independently-observed" }), false);
});

test("generic JSON does not launder units; a typed result preserves the provider declaration without certifying it", async () => {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], fetch: async () => { calls++; return Response.json({ measurement_kg: 7 }); } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Measurement" }, servers: [{ url: "https://fixture.test" }], paths: {
    "/measure": { get: { operationId: "measure", responses: { "200": { content: { "application/json": { schema: {
      type: "object", properties: { measurement_kg: { type: "number" } },
    } } } } } } },
  } }, "https://fixture.test/openapi.json"));
  for (const want of ["number", "json"]) {
    assert.equal((await rc.compose({ have: {}, want, intent: "measurement", run: true })).executed, undefined);
  }
  assert.equal(calls, 0);
  const typed = await rc.compose({ have: {}, want: "quantity:mass:kg", intent: "measurement", run: true });
  assert.equal(typed.executed?.output, 7);
  assert.equal(typed.plans[0].resultType, "quantity:mass:kg");
  assert.equal(typed.executed?.verification.status, "unverified", "provider text cannot establish truth");
});

test("a list of JSON records cannot erase embedded quantity fields", async () => {
  let calls = 0;
  const rc = await RightClick.create({ directories: [], fetch: async () => { calls++; return Response.json([{ measurement_kg: 7 }]); } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Measurements" }, servers: [{ url: "https://fixture.test" }], paths: {
    "/measure": { get: { operationId: "measure", responses: { "200": { content: { "application/json": { schema: {
      type: "array", items: { type: "object", properties: { measurement_kg: { type: "number" } } },
    } } } } } } },
  } }, "https://fixture.test/openapi.json"));
  const r = await rc.compose({ have: {}, want: "list:json", intent: "measurements", run: true });
  assert.equal(r.executed, undefined);
  assert.equal(calls, 0);
});
