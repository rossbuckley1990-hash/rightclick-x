import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { dispatch } from "../src/interface/tools.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { learnAll, world } from "./helpers.ts";

test("execution disclosure preserves contracts, authority and evidence with full detail available", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const goal = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "disclosure weather", verify: [{ op: "exists" }] });
  assert.equal(goal.executed?.status, "completed");
  const before = JSON.stringify(rc.exportGraph());
  for (const cap of rc.graph.list()) {
    const full = rc.explain(cap.id);
    const brief: any = await dispatch(rc, "context_explain", { id: cap.id });
    assert.deepEqual(brief.details, { tool: "context_explain", args: { id: cap.id, detail: "full" } });
    assert.deepEqual(brief.capability.inputs, cap.inputs);
    assert.deepEqual(brief.capability.outputs, cap.outputs);
    assert.equal(brief.capability.risk, cap.risk);
    assert.deepEqual(brief.capability.tags, cap.tags);
    assert.deepEqual(brief.execution, full.execution);
    assert.deepEqual(brief.contract.authority, full.card.authority);
    assert.deepEqual(brief.contract.executionPlan, full.card.executionPlan);
    assert.deepEqual(brief.contract.sideEffects, full.card.sideEffects);
    assert.deepEqual(brief.contract.reproduction, full.card.contract.reproduction);
    assert.deepEqual(brief.contract.verificationObligations, full.card.contract.verificationObligations);
    assert.deepEqual(brief.contract.verification, full.card.verification);
    assert.deepEqual(brief.contract.preconditions, full.card.contract.preconditions);
    assert.deepEqual(brief.contract.invalidatedWhen, full.card.contract.invalidatedWhen);
    assert.deepEqual(brief.contract.limitations, full.card.limitations);
    assert.deepEqual(brief.evidence.claims, full.card.contract.behaviouralEvidence);
    assert.deepEqual(brief.evidence.provenance, full.card.provenance);
    assert.deepEqual(await dispatch(rc, "context_explain", { id: cap.id, detail: "full" }), full);
  }
  assert.equal(JSON.stringify(rc.exportGraph()), before, "disclosure must not mutate learned contracts");
  await assert.rejects(() => dispatch(rc, "context_explain", { id: "goal:disclosure-weather", detail: "invalid" }), /detail/);
});

test("execution disclosure reports denial without granting or executing a capability", async () => {
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedRisks: [] } } });
  const cap = rc.graph.list()[0];
  const change = { id: cap.id, source: "fixture:changed-contract", at: new Date().toISOString(), before: "old action", after: "changed action" };
  rc.meaningChanges.set(cap.id, change);
  const brief: any = await dispatch(rc, "context_explain", { id: cap.id });
  assert.equal(brief.execution.allowed, false);
  assert.deepEqual(brief.meaningChange, change);
  assert.deepEqual(rc.meaningChanges.get(cap.id), change, "explaining must not acknowledge a changed action");
  assert.equal(rc.runs.size, 0);
  const denied = await rc.run(cap.id, {});
  assert.equal(denied.status, "failed");
  assert.match(denied.error!, /execution policy/);
});

test("MCP text stays lossless JSON while avoiding presentation whitespace", async () => {
  const { rc } = await world();
  const cap = rc.graph.list()[0];
  cap.description = 'line one\n"quoted" α';
  for (const [name, args] of [["context_runtime", {}], ["context_explain", { id: cap.id }], ["context_graph", { op: "search", query: "text" }]] as const) {
    const response: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const text = response.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.equal(text, JSON.stringify(parsed));
    assert.deepEqual(JSON.parse(JSON.stringify(response.result.structuredContent)), Array.isArray(parsed) ? { result: parsed } : parsed);
    if (name === "context_explain") assert.equal(parsed.capability.description, cap.description);
  }
});

test("startup disclosure keeps complete retained IDs in a bounded index", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const saved = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "weather" });
  assert.equal(saved.executed?.status, "completed");
  const template = rc.published.get("weather")!;
  // Seed an index fixture; this test measures disclosure, not 25 repeated planners.
  for (let i = 0; i < 25; i++) {
    rc.published.set(`weather-${i}`, { ...template, slug: `weather-${i}` });
  }
  assert.ok(rc.published.size > 0);
  const init: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(init.result.instructions.length < 1600, String(init.result.instructions.length));
  assert.match(init.result.instructions, /context_explain/);
  assert.match(init.result.instructions, /authority/);
  assert.match(init.result.instructions, /goal:weather-/);
  assert.match(init.result.instructions, /context_graph/);
  assert.ok(!init.result.instructions.includes('inputs typed'), "full contract belongs in an explicit detail response");
});
