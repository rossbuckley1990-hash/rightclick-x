import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { serve } from "../src/entry/node-host.ts";
import { SCENARIOS_50 } from "../experiments/workflow-survival/scenarios-50.ts";
import { createBillingService50, createFreightService50, createDirectoryService50 } from "../experiments/workflow-survival/services-50.ts";

// Original services, inputs and business answers are untouched. These cases
// previously claimed completion with incompatible quantities (4b3d3e2).
const factories = { billing: createBillingService50, freight: createFreightService50, directory: createDirectoryService50 };
for (const id of ["SEM-02", "SEM-04", "SEM-07", "SEM-08", "SEM-09"]) {
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
