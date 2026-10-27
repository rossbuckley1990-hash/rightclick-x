// Agreement witnesses: independent verification by recomputation. Real software rarely offers an
// endpoint that judges a candidate result, but often has a second, independent implementation of
// the same outcome. Such a witness recomputes the outcome from the invocation's inputs alone, is
// never shown the candidate, and must agree with it: on the first run, on every reuse after a
// restart, and with every step of a pipeline witness independent of the producing providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type ComposeResult } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { dispatch } from "../src/interface/tools.ts";
import { MemoryStore } from "./helpers.ts";

const parameter = (name: string, type = "string") => ({ name, in: "query", required: true, schema: { type } });
function spec(title: string, host: string, operationId: string, summary: string, parameters: object[], properties: object, method = "get") {
  return { openapi: "3.1.0", info: { title }, servers: [{ url: `https://${host}` }], paths: {
    "/run": { [method]: { operationId, summary, parameters, responses: { "200": { content: { "application/json": { schema: { type: "object", properties } } } } } } },
  } };
}

/** Two independent order registries and two independent rate tables, plus a write-only ledger. */
function world() {
  const truth = { countries: { "A-1": "DE", "A-2": "FR" } as Record<string, string>, rates: { DE: 19, FR: 20 } as Record<string, number> };
  const state = { orders: { ...truth.countries }, rates: { ...truth.rates }, fx: 1.0842, fxAudit: 1.0845, calls: [] as string[] };
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input)), q = url.searchParams;
    state.calls.push(url.hostname);
    switch (url.hostname) {
      case "orders.test": return Response.json({ country: state.orders[q.get("order_id")!] });
      case "rates.test": return Response.json({ tax_rate: state.rates[q.get("country")!] });
      case "registry.test": return Response.json({ country: truth.countries[q.get("order_id")!] });
      case "tariffs.test": return Response.json({ percent: truth.rates[q.get("country")!] });
      case "fx.test": return Response.json({ rate: state.fx });
      case "fx-audit.test": return Response.json({ rate: state.fxAudit });
      case "ledger.test": return Response.json({ ok: true });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const store = new MemoryStore();
  const options = { store, fetch, directories: [] };
  const contracts = [
    spec("Orders", "orders.test", "getOrder", "Get the country an order ships to", [parameter("order_id")], { country: { type: "string" } }),
    spec("Rates", "rates.test", "taxRate", "Sales tax rate for a country", [parameter("country")], { tax_rate: { type: "number" } }),
    spec("Registry", "registry.test", "lookupShipment", "Shipment destination country for an order", [parameter("order_id")], { country: { type: "string" } }),
    spec("Tariffs", "tariffs.test", "vatPercent", "VAT percent for a country", [parameter("country")], { percent: { type: "number" } }),
    spec("FX", "fx.test", "eurUsd", "EUR to USD exchange rate", [], { rate: { type: "number" } }),
    spec("FX audit", "fx-audit.test", "referenceRate", "Reference EUR to USD rate", [], { rate: { type: "number" } }),
    spec("Ledger", "ledger.test", "postEntry", "Post a ledger entry for an order", [parameter("order_id")], { ok: { type: "boolean" } }, "post"),
  ];
  const create = async () => {
    const rc = await RightClick.create(options);
    for (const c of contracts) rc.graph.add(reflectOpenAPI(c, `${c.servers[0].url}/openapi.json`));
    return rc;
  };
  return { state, create };
}

const PRODUCER = ["openapi:orders:getorder", "openapi:rates:taxrate"];
const compose = (rc: RightClick, extra: Record<string, unknown>) => dispatch(rc, "context_compose", {
  have: { order_id: "A-1" }, want: "number", intent: "sales tax rate for an order", run: true, through: PRODUCER, ...extra,
}) as Promise<ComposeResult>;
/** The independent implementation of the same outcome, saved as a pipeline. */
async function independentPipeline(rc: RightClick) {
  const built = await dispatch(rc, "context_compose", { have: { order_id: "A-1" }, want: "number", intent: "vat percent for a shipment", run: true,
    through: ["openapi:registry:lookupshipment", "openapi:tariffs:vatpercent"] }) as ComposeResult;
  assert.equal(built.executed?.output, 19, JSON.stringify(built).slice(0, 400));
  assert.ok(built.crystallized?.id);
  return built.crystallized!.id;
}

test("an independent pipeline that recomputes the outcome verifies it, and keeps verifying after a restart", async () => {
  const { state, create } = world();
  const rc = await create();
  const witness = await independentPipeline(rc);
  const first = await compose(rc, { publish: "order tax", witnesses: [{ capability: witness, args: { order_id: { input: "order_id" } }, agree: { mode: "number" } }] });
  assert.equal(first.executed?.status, "completed", JSON.stringify(first.executed).slice(0, 500));
  assert.equal(first.executed?.output, 19);
  assert.equal(first.executed?.verification.status, "verified");
  assert.deepEqual(first.executed?.witnesses?.[0].agreement, { mode: "number", ok: true, witness: 19, candidate: 19 });
  assert.equal(first.published?.trust, "verified");
  await rc.flush();
  const fresh = await create();
  const before = state.calls.length;
  const reused = await fresh.run("goal:order-tax", { order_id: "A-2" });
  assert.equal(reused.status, "completed", reused.error);
  assert.equal(reused.output, 20);
  assert.equal(reused.verification.status, "verified");
  assert.deepEqual(state.calls.slice(before).filter((h) => h === "registry.test" || h === "tariffs.test"), ["registry.test", "tariffs.test"], "the independent implementation recomputes on every reuse");
});

test("when the producing provider drifts, the independent recomputation refutes the result instead of verifying it", async () => {
  const { state, create } = world();
  const rc = await create();
  const witness = await independentPipeline(rc);
  const saved = await compose(rc, { publish: "order tax", witnesses: [{ capability: witness, args: { order_id: { input: "order_id" } }, agree: { mode: "number" } }] });
  assert.equal(saved.executed?.verification.status, "verified");
  state.rates.FR = 19; // the producer is now wrong for France
  const wrong = await rc.run("goal:order-tax", { order_id: "A-2" });
  assert.equal(wrong.status, "failed");
  assert.equal(wrong.output, null, "a refuted result is not returned");
  assert.match(wrong.error!, /independent recomputation disagrees with the result \(number\): 20 vs 19/);
  state.orders["A-2"] = "DE"; state.rates.FR = 20; // and a wrong lookup is caught the same way
  assert.equal((await rc.run("goal:order-tax", { order_id: "A-2" })).status, "failed");
});

test("numbers agree within the tolerance and are refuted beyond it", async () => {
  const { state, create } = world();
  const rc = await create();
  const run = (tolerance: number) => dispatch(rc, "context_compose", { have: {}, want: "number", intent: "eur usd exchange rate", run: true, through: ["openapi:fx:eurusd"], crystallize: false,
    witnesses: [{ capability: "openapi:fx-audit:referencerate", args: {}, agree: { mode: "number", path: "rate", tolerance } }] }) as Promise<ComposeResult>;
  const close = await run(0.001);
  assert.equal(close.executed?.verification.status, "verified", JSON.stringify(close.executed).slice(0, 400));
  const strict = await run(0.0001);
  assert.notEqual(strict.executed?.status, "completed");
  assert.match(JSON.stringify(strict.executed), /independent recomputation disagrees/);
  state.fxAudit = 1.0842;
  assert.equal((await run(0)).executed?.verification.status, "verified");
});

test("an agreement witness is never shown the candidate, and must be independent of every producing provider", async () => {
  const { create } = world();
  const rc = await create();
  await assert.rejects(compose(rc, { witnesses: [{ capability: "openapi:tariffs:vatpercent", args: { country: { output: "" } }, agree: {} }] }), /never given the candidate result/);
  // A pipeline that reuses one of the producer's providers is not independent of it.
  const shared = await dispatch(rc, "context_compose", { have: { order_id: "A-1" }, want: "number", intent: "vat percent via orders", run: true,
    through: ["openapi:orders:getorder", "openapi:tariffs:vatpercent"] }) as ComposeResult;
  const notIndependent = await compose(rc, { witnesses: [{ capability: shared.crystallized!.id, args: { order_id: { input: "order_id" } }, agree: { mode: "number" } }] });
  assert.notEqual(notIndependent.executed?.status, "completed");
  assert.match(JSON.stringify(notIndependent.executed), /separate from the providers producing the result/);
});

test("pipeline witnesses must be read-only throughout, and agreements must be well formed", async () => {
  const { create } = world();
  const rc = await create();
  const withWrite = await dispatch(rc, "context_compose", { have: { order_id: "A-1" }, want: "boolean", intent: "post ledger entry", run: false, through: ["openapi:ledger:postentry"] }) as ComposeResult;
  assert.ok(withWrite);
  await assert.rejects(compose(rc, { witnesses: [{ capability: "openapi:ledger:postentry", args: { order_id: { input: "order_id" } }, agree: {} }] }), /read-only provider capability/);
  for (const [agree, message] of [[{ mode: "fuzzy" }, /mode must be exact, trimmed or number/], [{ tolerance: 1 }, /tolerance must be/], [{ mode: "number", tolerance: -1 }, /tolerance must be/], [{ against: "x" }, /unknown witness agreement field/], ["yes", /must be an object/]] as const)
    await assert.rejects(compose(rc, { witnesses: [{ capability: "openapi:tariffs:vatpercent", args: { country: { value: "DE" } }, agree }] }), message as RegExp);
  await assert.rejects(compose(rc, { witnesses: [{ capability: "openapi:tariffs:vatpercent", args: { country: { value: "DE" } }, verify: [] }] }), /nonempty verification predicates or an agreement/);
});

test("trimmed agreement ignores only surrounding whitespace", async () => {
  const { agreement } = await import("../src/core/verify.ts");
  assert.equal(agreement({ mode: "trimmed" }, "abc  -\n", "abc  -").ok, true);
  assert.equal(agreement({ mode: "trimmed" }, "abc -", "abc  -").ok, false, "inner whitespace still counts");
  assert.equal(agreement({}, "abc\n", "abc").ok, false, "exact is the default");
  assert.equal(agreement({}, { b: 1, a: [1, 2] }, { a: [1, 2], b: 1 }).ok, true, "key order does not matter");
  assert.equal(agreement({ mode: "number" }, "19", 19).ok, true);
  assert.equal(agreement({ mode: "number" }, "", 0).ok, false, "an empty result is not zero");
  assert.equal(agreement({ path: "missing" }, { x: 1 }, 1).ok, false, "a missing value never agrees");
});
