import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type ComposeResult } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { signature } from "../src/core/graph.ts";
import type { OutcomeWitness, Predicate } from "../src/core/verify.ts";
import { dispatch } from "../src/interface/tools.ts";
import { MemoryStore } from "./helpers.ts";
import { capabilityState } from "../src/interface/dashboard-state.ts";

const RATE = "openapi:rates:taxrate";
const AUDIT = "openapi:audit:checkoutcome";

function spec(title: string, origin: string, operationId: string, summary: string, parameters: object[], properties: object) {
  return {
    openapi: "3.1.0", info: { title }, servers: [{ url: origin }], paths: {
      "/run": { get: { operationId, summary, parameters, responses: {
        "200": { content: { "application/json": { schema: { type: "object", properties } } } },
      } } },
    },
  };
}

const parameter = (name: string, type = "string") => ({ name, in: "query", required: true, schema: { type } });

async function outcomeWorld() {
  const store = new MemoryStore();
  const countries: Record<string, string> = { "A-1": "DE", "A-2": "FR" };
  const rates: Record<string, number> = { DE: 19, FR: 20 };
  const groundTruth: Record<string, number> = { "A-1": 19, "A-2": 20 };
  const auditCalls: Array<{ order: string | null; candidate: number; mode: string | null }> = [];
  let productionCalls = 0;
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "orders.test") {
      productionCalls++;
      return Response.json({ country: countries[url.searchParams.get("order_id")!] });
    }
    if (url.hostname === "rates.test") {
      productionCalls++;
      return Response.json({ tax_rate: rates[url.searchParams.get("country")!] });
    }
    if (url.hostname === "audit.test") {
      const call = { order: url.searchParams.get("order_id"), candidate: Number(url.searchParams.get("candidate")), mode: url.searchParams.get("mode") };
      auditCalls.push(call);
      return Response.json({ valid: call.candidate === groundTruth[call.order!] && call.mode === "tax-v1" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const options = { store, fetch, directories: [] };
  const rc = await RightClick.create(options);
  const contracts = [
    spec("Orders", "https://orders.test", "getOrder", "Get order country", [parameter("order_id")], { country: { type: "string" } }),
    spec("Rates", "https://rates.test", "taxRate", "Tax rate by country", [parameter("country")], { tax_rate: { type: "number" } }),
    spec("Audit", "https://audit.test", "checkOutcome", "Check outcome", [parameter("order_id"), parameter("candidate", "number"), parameter("mode")], { valid: { type: "boolean" } }),
  ];
  for (const contract of contracts) rc.graph.add(reflectOpenAPI(contract, `${contract.servers[0].url}/openapi.json`));
  const witnesses: OutcomeWitness[] = [{
    capability: AUDIT,
    args: { order_id: { input: "order_id" }, candidate: { output: "" }, mode: { value: "tax-v1" } },
    verify: [{ op: "equals", path: "valid", value: true }],
  }];
  const compose = (extra: Record<string, unknown> = {}) => dispatch(rc, "context_compose", {
    have: { order_id: "A-1" }, want: "number", intent: "tax rate order country", run: true,
    witnesses, ...extra,
  }) as Promise<ComposeResult>;
  return { rc, store, options, rates, auditCalls, witnesses, compose, productionCalls: () => productionCalls };
}

test("MCP composition saves independent witness input/output bindings and repeats them for a second input", async () => {
  const world = await outcomeWorld();
  const first = await world.compose({ publish: "Tax for order" });
  assert.equal(first.executed?.verification.status, "verified");
  assert.equal(first.executed?.witnesses?.[0].capability, AUDIT, "dispatch must forward the caller's witnesses");
  assert.ok(first.crystallized);
  assert.ok(first.published);
  assert.deepEqual(world.auditCalls, [{ order: "A-1", candidate: 19, mode: "tax-v1" }]);

  const second = await world.rc.run(first.crystallized.id, { order_id: "A-2" });
  assert.equal(second.status, "completed");
  assert.equal(second.output, 20);
  assert.equal(second.verification.status, "verified");
  assert.deepEqual(world.auditCalls.at(-1), { order: "A-2", candidate: 20, mode: "tax-v1" });

  const savedGoal = await world.rc.run("goal:tax-for-order", { order_id: "A-2" });
  assert.equal(savedGoal.status, "completed");
  assert.equal(savedGoal.output, 20);
  assert.ok(savedGoal.witnesses?.length);
  const state = capabilityState(world.rc, "goal:tax-for-order");
  assert.equal(state.states.assurance.state, "witness-passed-on-run");
  assert.equal(state.states.authority.state, "unknown", "witness success is not an exact-action grant");
  assert.deepEqual(state.lastObservation!.witnessRuns, savedGoal.witnesses!.map(w => w.runId));
});

test("saved witness checks survive restart and reject a plausible result on another input", async () => {
  const world = await outcomeWorld();
  const first = await world.compose({ publish: "Tax for order" });
  assert.ok(first.crystallized);
  await world.rc.flush();
  const restarted = await RightClick.create(world.options);
  const good = await restarted.run("goal:tax-for-order", { order_id: "A-2" });
  assert.equal(good.status, "completed");
  assert.equal(good.output, 20);

  world.rates.FR = 19; // Still a positive number, but wrong for this order.
  const badComposite = await restarted.run(first.crystallized.id, { order_id: "A-2" }, { verify: [{ op: "type", value: "number" }, { op: "gt", value: 0 }] });
  assert.equal(badComposite.status, "failed");
  assert.equal(badComposite.verification.status, "refuted");
  assert.equal(badComposite.witnesses?.[0].status, "failed");
  assert.deepEqual(world.auditCalls.at(-1), { order: "A-2", candidate: 19, mode: "tax-v1" });

  const badGoal = await restarted.run("goal:tax-for-order", { order_id: "A-2" }, { verify: [{ op: "type", value: "number" }] });
  assert.equal(badGoal.status, "failed");
  assert.equal(badGoal.verification.status, "refuted");
  assert.equal(capabilityState(restarted, "goal:tax-for-order").states.assurance.state, "last-failed", "new failed checks displace historical successful assurance");
  await restarted.flush();
});

test("fresh caller predicates cannot override failed stored result predicates", async () => {
  const world = await outcomeWorld();
  const first = await world.compose({ verify: [{ op: "equals", value: 19 }], witnesses: [] });
  assert.ok(first.crystallized);
  const second = await world.rc.run(first.crystallized.id, { order_id: "A-2" }, { verify: [{ op: "type", value: "number" }] });
  assert.equal(second.output, 20);
  assert.equal(second.status, "failed");
  assert.equal(second.verification.status, "refuted");
  assert.match(second.error!, /stored verification refuted/);
});

test("published checks are snapshots rather than mutable aliases of the caller's request", async () => {
  const world = await outcomeWorld();
  const checks: Predicate[] = [{ op: "equals", value: 19 }];
  await world.compose({ verify: checks, witnesses: [], publish: "Fixed checked tax" });
  checks.length = 0;
  const result = await world.rc.run("goal:fixed-checked-tax", { order_id: "A-2" });
  assert.equal(result.status, "failed", "mutating the original request must not remove a published check");
  assert.equal(result.verification.status, "refuted");
});

test("a changed checker contract fails closed for saved composites and published goals", async () => {
  const world = await outcomeWorld();
  const first = await world.compose({ publish: "Tax for order" });
  assert.ok(first.crystallized);
  const audit = world.rc.graph.get(AUDIT)!;
  const provider = world.rc.graph.providers.get(audit.provider)!;
  world.rc.graph.add({ provider, capabilities: [{ ...audit, inputs: [...audit.inputs, { name: "new_policy", type: "text", required: true }] }] });
  const before = world.auditCalls.length;

  const composite = await world.rc.run(first.crystallized.id, { order_id: "A-2" });
  assert.equal(composite.status, "failed");
  assert.match(composite.witnesses?.[0].error ?? "", /witness contract changed/);
  assert.equal(world.auditCalls.length, before, "a changed checker is never silently run as the old proof");

  const goal = await world.rc.run("goal:tax-for-order", { order_id: "A-2" });
  assert.equal(goal.status, "failed");
  assert.match(goal.error!, /witness contract changed/);
  assert.equal(world.auditCalls.length, before);
});

test("a producing provider cannot witness its own result, including through a saved composite", async () => {
  const world = await outcomeWorld();
  const first = await world.compose();
  assert.ok(first.crystallized);
  const result = await world.compose({ through: [first.crystallized.id], witnesses: [{
    capability: RATE, args: { country: { value: "DE" } }, verify: [{ op: "gt", path: "tax_rate", value: 0 }],
  }] });
  assert.equal(result.executed?.status, "failed");
  assert.match(result.executed?.witnesses?.[0].error ?? "", /separate from the providers producing the result/);
});

test("unresolved witness output paths refute the outcome rather than silently skipping the check", async () => {
  const world = await outcomeWorld();
  const result = await world.compose({ witnesses: [{ ...world.witnesses[0], args: {
    ...world.witnesses[0].args, candidate: { output: "missing.path" },
  } }] });
  assert.equal(result.executed?.status, "failed");
  assert.match(result.executed?.witnesses?.[0].error ?? "", /unresolved witness argument/);
  assert.deepEqual(world.auditCalls, []);
});

test("direct run records predicate refutation as failure in both the run and receipt", async () => {
  const world = await outcomeWorld();
  const result = await world.rc.run(RATE, { country: "DE" }, { verify: [{ op: "equals", path: "tax_rate", value: 20 }] });
  assert.equal(result.status, "failed");
  assert.equal(result.verification.status, "refuted");
  assert.equal(result.receipt.status, "failed");
  assert.equal(result.receipt.verification, "refuted");
});

test("a saved goal excludes itself even through a nested saved composite", async () => {
  const world = await outcomeWorld();
  await world.compose({ publish: "Tax for order" });
  const goal = world.rc.graph.get("goal:tax-for-order")!;
  const wrap = (id: string, child: typeof goal) => ({
    ...goal, id, title: "Tax rate order country wrapper", provider: "composite:wrappers",
    invoke: { kind: "composite" as const, steps: [{ capability: child.id, bindings: [{ port: "order_id", from: "$in.order_id" }] }], result: "0.", signatures: [signature(child)] },
  });
  const provider = { id: "composite:wrappers", title: "Wrappers", source: "composite" as const, origin: "test", learnedAt: "" };
  const inner = wrap("composite:inner", goal);
  world.rc.graph.addCapability(inner, provider);
  world.rc.graph.addCapability(wrap("composite:outer", inner), provider);
  const before = world.productionCalls();
  const result = await world.rc.run(goal.id, { order_id: "A-2" });
  assert.equal(result.status, "completed");
  assert.equal(result.output, 20);
  assert.equal(world.productionCalls() - before, 2, "recursion guards must avoid re-entering the producing workflow");
  assert.ok(![...world.rc.runs.values()].some((r) => r.capability === "composite:inner" || r.capability === "composite:outer"));
});

test("saved goals preserve decimal quantity text until the explicit conversion consumes it", async () => {
  const rc = await RightClick.create({ directories: [] });
  const amount = "1.00499999999999999";
  const first = await rc.compose({ have: { amount: { type: "quantity:money:USD:major", value: amount } },
    want: "quantity:money:USD:minor", intent: "convert USD minor", maxSteps: 1, run: true,
    verify: [{ op: "equals", value: 100 }], publish: "Rounded cents" });
  assert.equal(first.executed?.output, 100);
  const saved = await rc.run("goal:rounded-cents", { amount });
  assert.equal(saved.status, "completed", "the saved goal must not first round decimal text to an IEEE number");
  assert.equal(saved.output, 100);
});

test("required anchors survive restart and rebind renamed nested REST contracts within the first call", async () => {
  const world = await outcomeWorld();
  const source = "https://rates.test/";
  const provider = world.rc.graph.providers.get("openapi:rates")!;
  provider.meta = { ...provider.meta, source };
  let version = 1;
  const originalFetch = world.options.fetch;
  const evolvingFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "rates.test" || version === 1) return originalFetch(input);
    if (url.pathname === "/openapi.json") {
      const next = spec("Rates", "https://rates.test", "assessTax", "Tax rate by country", [parameter("country_code")], {
        result: { type: "object", properties: { levy: { type: "number" } } },
      });
      const operation = next.paths["/run"];
      return Response.json({ ...next, paths: { "/v2": operation } });
    }
    if (url.pathname === "/v2") return Response.json({ result: { levy: world.rates[url.searchParams.get("country_code")!] } });
    return new Response("not found", { status: 404 });
  };
  world.options.fetch = evolvingFetch;
  world.rc.net.fetch = evolvingFetch;
  const first = await world.compose({ through: [RATE], publish: "Anchored tax" });
  assert.equal(first.executed?.status, "completed");
  assert.equal(world.rc.published.get("anchored-tax")?.anchors?.[0].source, source);
  await world.rc.flush();
  const restarted = await RightClick.create(world.options);
  version = 2;
  const result = await restarted.run("goal:anchored-tax", { order_id: "A-2" });
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.output, 20);
  assert.equal(result.verification.status, "verified");
  assert.equal(result.attempts?.length, 1, "one client invocation must repair the contract and finish");
  assert.equal(restarted.graph.get(RATE), undefined);
  assert.ok(result.steps?.some((id) => restarted.runs.get(id)?.capability === "openapi:rates:assesstax"));
  assert.equal(restarted.published.get("anchored-tax")?.anchors?.[0].id, RATE, "retain the original constraint as provenance");
  await restarted.flush();
  const again = await RightClick.create(world.options);
  const reused = await again.run("goal:anchored-tax", { order_id: "A-1" });
  assert.equal(reused.status, "completed");
  assert.equal(reused.output, 19);
  await again.flush();
});

test("an unknown exact anchor is an error and cannot silently publish an unanchored goal", async () => {
  const world = await outcomeWorld();
  await assert.rejects(world.compose({ through: ["missing:required-tax-operation"], publish: "Must not publish" }), /unresolved required anchor/);
  assert.equal(world.rc.published.size, 0);
  assert.equal(world.productionCalls(), 0);
});

test("saved anchors fail closed on disappearance, ambiguity, another source, or changed type/risk", async () => {
  for (const scenario of ["missing", "ambiguous", "wrong-source", "same-id-currency", "same-id-risk"] as const) {
    const world = await outcomeWorld();
    const original = world.rc.graph.get(RATE)!;
    const provider = world.rc.graph.providers.get(original.provider)!;
    provider.meta = { ...provider.meta, source: "https://rates.test/" };
    await world.compose({ through: [RATE], publish: "Strict anchored tax" });
    world.rc.graph.forget(provider.id);
    if (scenario !== "missing") {
      const replacement = {
        ...original,
        id: scenario.startsWith("same-id") ? RATE : "openapi:rates:replacement",
        risk: scenario === "same-id-risk" ? "write" as const : original.risk,
        outputs: scenario === "same-id-currency" ? [{ name: "tax_rate", type: "quantity:money:EUR:major", required: true }] : original.outputs,
      };
      world.rc.graph.add({
        provider: { ...provider, meta: { source: scenario === "wrong-source" ? "https://impostor.test/" : "https://rates.test/" } },
        capabilities: [replacement, ...(scenario === "ambiguous" ? [{ ...replacement, id: "openapi:rates:secondreplacement" }] : [])],
      });
    }
    const before = world.productionCalls();
    const result = await world.rc.run("goal:strict-anchored-tax", { order_id: "A-2" });
    assert.equal(result.status, "failed", scenario);
    assert.equal(result.verification.status, "refuted", scenario);
    assert.match(result.error!, scenario.startsWith("same-id") ? /anchor contract changed meaning/ : /(?:unresolved|ambiguous) required anchor/, scenario);
    assert.equal(world.productionCalls(), before, `${scenario} must fail before calling a substitute`);
  }
});
