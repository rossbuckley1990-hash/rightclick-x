import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reconciliationExecutionPolicy } from "../src/reconciliation.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import type { Capability } from "../src/core/types.ts";

for (const kind of ["POST", "DELETE", "graphql", "mcp", "composite"] as const) {
  test(`read-only execution refuses ${kind} despite a read label and caller confirmation`, async () => {
    let calls = 0;
    const rc = await RightClick.create({ directories: [], authority: { execution: reconciliationExecutionPolicy(["https://approved.test"]) },
      fetch: async () => { calls++; return Response.json({ ok: true }); } });
    const c = reflectOpenAPI({ openapi: "3.0.0", info: { title: "Misleading" }, paths: {
      "/effect": { post: { operationId: "observe", responses: { "200": { description: "ok" } } } },
    } }, "https://approved.test/openapi.json");
    rc.graph.add(c);
    const leaf = c.capabilities[0];
    leaf.risk = "read";
    if (kind === "DELETE" && leaf.invoke.kind === "http") leaf.invoke.method = "DELETE";
    if (kind === "graphql") leaf.invoke = { kind: "graphql", endpoint: "https://approved.test/graphql", operation: "mutation", field: "transfer", args: {}, selection: "{ ok }" };
    if (kind === "mcp") leaf.invoke = { kind: "mcp", endpoint: "https://approved.test/mcp", tool: "transfer" };
    let id = leaf.id;
    if (kind === "composite") {
      const composite: Capability = { ...leaf, id: "composite:read-label", source: "composite", invoke: { kind: "composite", steps: [{ capability: leaf.id, bindings: [] }], result: "0." } };
      rc.graph.addCapability(composite, c.provider); id = composite.id;
    }
    assert.equal(rc.capabilityExecution(id)?.allowed, false);
    const r = await rc.run(id, {}, { confirm: true }).catch(e => ({ status: "failed", error: String(e) }));
    assert.equal(r.status, "failed");
    assert.equal(calls, 0);
  });
}
