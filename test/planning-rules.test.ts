// Regression tests for typing and planning rules. Each test names the failure it guards against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGraph } from "../src/core/graph.ts";
import { Ledger } from "../src/core/ledger.ts";
import { plan } from "../src/core/planner.ts";
import { accepts, inferType } from "../src/core/semantics.ts";
import type { Capability, Port } from "../src/core/types.ts";

function cap(id: string, inputs: Port[], outputs: Port[], title = id, extra: Partial<Capability> = {}): Capability {
  return { id, title, description: "", provider: `p:${id}`, source: "builtin", inputs, outputs, risk: "read", tags: [], invoke: { kind: "builtin", fn: id }, ...extra };
}
const port = (name: string, type: string, required = true, more: Partial<Port> = {}): Port => ({ name, type, required, ...more });
function graph(...caps: Capability[]) {
  const g = new CapabilityGraph();
  for (const c of caps) g.add({ provider: { id: c.provider, title: c.id, source: "builtin", origin: "t", learnedAt: "", capabilityIds: [] }, capabilities: [c] });
  return g;
}
const steps = (p: { steps: Array<{ capability: string }> }) => p.steps.map((s) => s.capability);

test("identifiers of different entities never mix", () => {
  assert.equal(inferType("invoice_id", { type: "integer" }), "id.invoice");
  assert.equal(inferType("order_number", { type: "integer" }), "id.order");
  assert.equal(accepts("order_id", "id.order", "id.invoice"), false);
  const g = graph(
    cap("invoice", [port("customer", "text")], [port("invoice_id", "id.invoice")]),
    cap("order", [port("order_id", "id.order")], [port("total", "number")]),
  );
  assert.equal(plan(g, new Ledger(), { have: { c: "text" }, want: "number" }).length, 0, "an invoice id must not be used as an order id");
});

test("resource names described as 'name of the X' are identifiers", () => {
  assert.equal(inferType("name", { type: "string" }, "name of the Warehouse"), "id.warehouse");
  assert.equal(accepts("name", "id.warehouse", "country"), false);
});

test("a bare repository name and an owner/repo full name are different types", () => {
  assert.equal(inferType("repo", { type: "string" }), "repo");
  assert.equal(inferType("full_name", { type: "string" }), "repo.full");
  assert.equal(accepts("repoName", "repo.full", "repo"), false);
  assert.equal(accepts("repo", "repo", "repo.full"), false);
});

test("enum ports are filled only by the caller, never by another step's output", () => {
  const g = graph(
    cap("profile", [port("customer_id", "id.customer")], [port("note", "text")]),
    cap("stat", [port("metric", "text", true, { enum: ["revenue", "orders"] }), port("customer_id", "id.customer")], [port("value", "number")]),
  );
  const fromStep = plan(g, new Ledger(), { have: { customer_id: "id.customer" }, want: "number" });
  assert.equal(fromStep.length, 0, "the profile note must not be fed into an enum port");
  const fromCaller = plan(g, new Ledger(), { have: { customer_id: "id.customer", metric: "text" }, want: "number" });
  assert.deepEqual(steps(fromCaller[0]), ["stat"]);
});

test("optional ports are only filled by caller inputs of the same name", () => {
  const g = graph(cap("a", [port("x", "id.x")], [port("days", "number")]), cap("b", [port("x", "id.x"), port("days", "number", false)], [port("out", "text")]));
  for (const p of plan(g, new Ledger(), { have: { x: "id.x" }, want: "text" })) {
    for (const s of p.steps) for (const b of s.bindings) if (b.port === "days") assert.equal(b.from, "$in.days");
  }
});

test("read-only constraint: plans never include write or destructive capabilities", () => {
  const g = graph(
    cap("lookup", [port("order_id", "id.order")], [port("status", "text")], "Lookup order"),
    cap("cancel", [port("order_id", "id.order")], [port("status", "text")], "Cancel order", { risk: "destructive" }),
    cap("update", [port("order_id", "id.order")], [port("status", "text")], "Update order", { risk: "write" }),
  );
  const all = plan(g, new Ledger(), { have: { order_id: "id.order" }, want: "text", limit: 10 }).flatMap(steps);
  assert.ok(all.includes("cancel") && all.includes("update"), "without the constraint they are candidates");
  const readOnly = plan(g, new Ledger(), { have: { order_id: "id.order" }, want: "text", risks: ["read"], limit: 10 }).flatMap(steps);
  assert.deepEqual([...new Set(readOnly)], ["lookup"]);
});

test("markup is not the text a caller asked for", () => {
  const g = graph(cap("fetch", [port("url", "url")], [port("", "html")]), cap("strip", [port("html", "html")], [port("", "text")]));
  const p = plan(g, new Ledger(), { have: { url: "url" }, want: "text" });
  assert.deepEqual(steps(p[0]), ["fetch", "strip"]);
});

test("a caller's identity value beats one derived through a detour", () => {
  const g = graph(
    cap("account", [port("owner", "account")], [port("owner", "account")], "Account lookup"),
    cap("repos", [port("owner", "account")], [port("count", "number")], "Count repositories"),
  );
  const p = plan(g, new Ledger(), { have: { owner: "account" }, want: "number", intent: "count repositories" });
  assert.deepEqual(steps(p[0]), ["repos"]);
});

test("json goals prefer the complete result over a fragment", () => {
  const g = graph(cap("province", [port("province_id", "id.province")], [port("", "json"), port("next", "json")]));
  const p = plan(g, new Ledger(), { have: { province: "text" }, want: "json" });
  assert.equal(p[0].result.endsWith("."), true, `got ${p[0].result}`);
});

test("parallel branches in a different order are the same plan", () => {
  const g = graph(
    cap("left", [port("k", "id.k")], [port("a", "text")]),
    cap("right", [port("k", "id.k")], [port("b", "repo.full")]),
    cap("join", [port("b", "repo.full"), port("a", "text")], [port("out", "text")]),
  );
  const p = plan(g, new Ledger(), { have: { k: "id.k" }, want: "text", intent: "join", through: ["left", "right", "join"] });
  assert.equal(p.filter((x) => x.steps.length === 3).length, 1);
});
