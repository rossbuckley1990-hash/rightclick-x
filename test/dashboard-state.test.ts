import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardMetrics } from "../src/interface/dashboard-state.ts";
import { DASHBOARD_HTML } from "../src/interface/dashboard.ts";
import { createHandler } from "../src/interface/http.ts";
import { RightClick } from "../src/runtime.ts";
import { world, learnAll } from "./helpers.ts";

test("dashboard metrics distinguish measured topology from unestablished authority and outcomes", async () => {
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedRisks: [] } } });
  const before = JSON.stringify(rc.exportGraph()), cursor = rc.graph.cursor;
  const metrics = dashboardMetrics(rc), powers = rc.graph.powers();
  assert.equal(metrics.providers.value, rc.graph.providers.size);
  assert.equal(metrics.discovered.value, rc.graph.capabilities.size);
  assert.equal(metrics.potentialPaths.value, powers.edges + powers.chains3);
  assert.notEqual(metrics.potentialPaths.value, powers.total, "single descriptors are not typed paths");
  assert.equal(metrics.authorised.value, null);
  assert.equal(metrics.authorised.status, "unknown");
  assert.equal(metrics.independentlyVerified.value, null);
  assert.equal(metrics.independentlyVerified.status, "not-assessed");
  assert.equal(metrics.reusable.value, 0, "absence of saved goals is measured, unlike authority");
  for (const value of Object.values(metrics)) assert.ok(value.source && value.limitation);
  assert.equal(rc.runs.size, 0);
  assert.equal(rc.graph.cursor, cursor);
  assert.equal(JSON.stringify(rc.exportGraph()), before);
});

test("dashboard retained counts require actual callable descriptors and do not promote predicates or trust labels", async () => {
  const { rc } = await world();
  await learnAll(rc);
  const result = await rc.compose({ have: { place: "Lima", language: "es" }, want: "text", intent: "weather translated", run: true, publish: "retained weather", verify: [{ op: "exists" }] });
  assert.equal(result.published?.trust, "checked");
  assert.equal(dashboardMetrics(rc).reusable.value, 1);
  assert.equal(dashboardMetrics(rc).independentlyVerified.value, null);
  assert.ok(rc.chain.receipts.length, "receipt hashes exist without independent attestation");
  const saved = rc.published.get("retained-weather")!;
  // A stored/imported claim alone is not present independent verification evidence.
  saved.trust = "verified";
  assert.equal(dashboardMetrics(rc).independentlyVerified.value, null);
  rc.published.set("missing", { ...saved, slug: "missing" });
  assert.equal(dashboardMetrics(rc).reusable.value, 1, "unregistered records are not callable goals");
  rc.graph.capabilities.delete("goal:retained-weather");
  assert.equal(dashboardMetrics(rc).reusable.value, 0, "withdrawn descriptors are excluded");
});

test("dashboard facts retain API authentication and the thirteen-tool interface", async () => {
  const rc = await RightClick.create({ directories: [] });
  const handle = createHandler(rc, { token: "fixture-only" });
  assert.equal((await handle(new Request("https://runtime.test/api/viz"))).status, 401);
  const request = (path: string) => new Request(`https://runtime.test${path}`, { headers: { authorization: "Bearer fixture-only" } });
  const viz = await (await handle(request("/api/viz"))).json() as any;
  assert.deepEqual(viz.metrics, dashboardMetrics(rc));
  assert.deepEqual(viz.powers, rc.graph.powers(), "legacy topology API stays compatible");
  assert.equal((await (await handle(request("/api/tools"))).json() as unknown[]).length, 13);
  assert.equal(rc.runs.size, 0);
});

test("dashboard labels potential paths honestly and gives keyboard-accessible metric sources", () => {
  assert.match(DASHBOARD_HTML, /discovered operations/);
  assert.match(DASHBOARD_HTML, /potential typed paths/);
  assert.match(DASHBOARD_HTML, /NOT ASSESSED/);
  assert.match(DASHBOARD_HTML, /UNKNOWN/);
  assert.match(DASHBOARD_HTML, /aria-controls="metric-sources"/);
  assert.match(DASHBOARD_HTML, /document.createElement\('p'\)/);
  assert.doesNotMatch(DASHBOARD_HTML, /composite powers|d\.newPowers|function bump/);
  assert.doesNotMatch(DASHBOARD_HTML, /innerHTML|requestAnimationFrame|Math\.random|prompt\(/, "untrusted titles render as text, bounded views need no force simulation or recursive token prompt");
  for (const view of ["environment", "intelligence", "abilities", "authority", "evidence"]) assert.ok(DASHBOARD_HTML.includes(`data-panel="${view}"`));
  assert.match(DASHBOARD_HTML, /prefers-reduced-motion/);
  assert.match(DASHBOARD_HTML, /Displayed observations may be stale/);
});
