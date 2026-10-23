import { test } from "node:test";
import assert from "node:assert/strict";
import { accepts, distance, inferType, strongly } from "../src/core/semantics.ts";
import { convertMoney, moneyType } from "../src/core/quantities.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { RightClick } from "../src/runtime.ts";

const minor = (currency: string) => moneyType(currency, "minor");
const major = (currency: string) => moneyType(currency, "major");

test("monetary inference preserves currency and units without guessing or reading negation as evidence", () => {
  assert.equal(inferType("amount_cents", { type: "number" }, "Price amount in USD cents"), minor("USD"));
  assert.equal(inferType("amount_dollars", { type: "number" }, "Taxable amount in US dollars, not cents"), major("USD"));
  assert.equal(inferType("amount", { type: "number", description: "Price in euro cents" }), minor("EUR"));
  assert.equal(inferType("amountGBPMinorUnits", { type: "integer" }), minor("GBP"));
  assert.equal(inferType("balance", { type: "number" }, "Balance in pounds sterling"), major("GBP"));
  assert.equal(inferType("amount_cents", { type: "number" }), minor("unknown"));
  assert.equal(inferType("amount_dollars", { type: "number" }), major("unknown"));
  assert.equal(inferType("amount", { type: "number" }, "Amount in USD"), moneyType("USD", "unknown"));
  assert.equal(inferType("amount", { type: "number" }, "Amount in USD or EUR cents"), minor("unknown"));
  assert.equal(inferType("amount", { type: "number" }, "USD amount in cents or dollars"), moneyType("USD", "unknown"));
  assert.equal(inferType("amount", { type: "number" }, "Amount in EUR euros, not USD"), major("EUR"));
  assert.equal(inferType("count", { type: "integer" }), "number");
});

test("numeric goals can receive monetary results but numeric inputs cannot silently erase units", () => {
  assert.equal(distance("number", minor("USD")), 1);
  assert.equal(strongly("number", minor("USD")), false);
  assert.equal(accepts("amount", "number", minor("USD")), false);
  assert.equal(accepts("amount", major("USD"), minor("USD")), false);
  assert.equal(accepts("amount", major("USD"), major("EUR")), false);
  assert.equal(accepts("amount", major("USD"), major("USD")), true);
  assert.equal(accepts("amount", minor("USD"), minor("unknown")), false);
  assert.equal(accepts("amount", minor("unknown"), minor("unknown")), false);
  assert.equal(accepts("amounts", "list:number", `list:${minor("USD")}`), false);
});

test("money conversions round decimal half away from zero and reject unsafe or non-finite amounts", () => {
  for (const currency of ["USD", "EUR", "GBP"]) {
    assert.equal(convertMoney(1000, currency, "minor", "major"), 10);
    assert.equal(convertMoney(123, currency, "minor", "major"), 1.23);
    assert.equal(convertMoney("1.005", currency, "major", "minor"), 101);
    assert.equal(convertMoney(1.005, currency, "major", "minor"), 101);
    assert.equal(convertMoney("-1.005", currency, "major", "minor"), -101);
    assert.equal(convertMoney("1.0049", currency, "major", "minor"), 100);
    assert.equal(convertMoney("1.005e1", currency, "major", "minor"), 1005);
    assert.equal(convertMoney("0.00000001", currency, "major", "minor"), 0);
  }
  for (const value of [NaN, Infinity, -Infinity, "NaN", "Infinity", {}, "", "1e999", "9007199254740992"]) {
    assert.throws(() => convertMoney(value, "USD", "minor", "major"));
  }
  assert.throws(() => convertMoney(1.5, "USD", "minor", "major"), /integer/);
  assert.throws(() => convertMoney(100, "unknown", "minor", "major"), /unsupported currency/);
});

function spec(title: string, url: string, path: string, operationId: string, summary: string, parameter: object, properties: object) {
  return {
    openapi: "3.1.0", info: { title }, servers: [{ url }],
    paths: { [path]: { get: { operationId, summary, parameters: [parameter], responses: {
      "200": { content: { "application/json": { schema: { type: "object", properties } } } },
    } } } },
  };
}

async function priceWorld(priceDescription = "Price amount in USD cents", taxDescription = "Taxable amount in US dollars, not cents") {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], fetch: async (input) => {
    const url = new URL(String(input));
    calls.push(url.href);
    return Response.json(url.hostname === "prices.test" ? { amount_cents: 1000 } : { tax_amount: Number(url.searchParams.get("amount_dollars")) * 0.2 });
  } });
  rc.graph.add(reflectOpenAPI(spec("Prices", "https://prices.test", "/products/{product_id}", "getPrice", "Get product price",
    { name: "product_id", in: "path", required: true, schema: { type: "string" } },
    { amount_cents: { type: "number", description: priceDescription } }), "https://prices.test/openapi.json"));
  rc.graph.add(reflectOpenAPI(spec("Tax", "https://tax.test", "/tax", "calculateTax", "Calculate product tax",
    { name: "amount_dollars", in: "query", required: true, description: taxDescription, schema: { type: "number" } },
    { tax_amount: { type: "number", description: "Tax amount in US dollars" } }), "https://tax.test/openapi.json"));
  return { rc, calls };
}

test("unanchored composition inserts a currency-preserving conversion before calculating tax", async () => {
  const { rc, calls } = await priceWorld();
  const result = await rc.compose({ have: { product_id: "P1" }, want: "number", intent: "product tax", run: true,
    verify: [{ op: "equals", value: 2 }] });
  assert.equal(result.executed?.status, "completed");
  assert.equal(result.executed?.output, 2);
  assert.equal(result.executed?.verification.status, "checked"); // stored predicates passed: checked, not independently verified (North Star Stage 2)
  assert.ok(result.plans[0].steps.some((step) => step.capability === "builtin:quantity.money.usd.minor-to-major"));
  assert.ok(calls.includes("https://tax.test/tax?amount_dollars=10"));
  assert.ok(!calls.includes("https://tax.test/tax?amount_dollars=1000"));
});

test("composition cannot invent a currency exchange or guess a currency for unqualified cents", async () => {
  for (const description of ["Price amount in EUR cents", "Price amount in cents"]) {
    const { rc, calls } = await priceWorld(description);
    const result = await rc.compose({ have: { product_id: "P1" }, want: "number", intent: "product tax", through: ["openapi:tax:calculatetax"], run: true });
    assert.equal(result.plans.length, 0);
    assert.equal(result.executed, undefined);
    assert.deepEqual(calls, []);
  }
});
