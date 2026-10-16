import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";

// Shapes of the real services in OW7: a country lookup, and an exchange-rate pair
// endpoint whose parameters carry only examples. The requirement is a one-parameter
// API ("given a country, its currency's value in euros"), so EUR must be pinned.
const RATES: Record<string, number> = { JPY: 0.0061, BRL: 0.16, USD: 0.86 };
const COUNTRIES: Record<string, string> = { JP: "JPY", BR: "BRL", US: "USD" };
const country = {
  openapi: "3.0.0", info: { title: "Countries" }, servers: [{ url: "https://countries.test" }],
  paths: { "/countries/{country_code}": { get: { summary: "Get a country", parameters: [{ name: "country_code", in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, currency: { type: "string" } } } } } } } } } },
};
const fx = {
  openapi: "3.0.0", info: { title: "FX" }, servers: [{ url: "https://fx.test" }],
  paths: { "/rate/{base}/{quote}": { get: { summary: "Get a single exchange rate pair", parameters: [
    { name: "base", in: "path", required: true, schema: { type: "string", example: "EUR" } },
    { name: "quote", in: "path", required: true, schema: { type: "string", example: "USD" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { base: { type: "string" }, quote: { type: "string" }, rate: { type: "number" } } } } } } } } } },
};
const fetchMock = (async (input: any) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (u.host === "countries.test" && u.pathname === "/openapi.json") return json(country);
  if (u.host === "fx.test" && u.pathname === "/openapi.json") return json(fx);
  let m = /^\/countries\/(\w+)$/.exec(u.pathname);
  if (u.host === "countries.test" && m) return COUNTRIES[m[1]] ? json({ name: m[1], currency: COUNTRIES[m[1]] }) : json({ error: "no" }, 404);
  m = /^\/rate\/(\w+)\/(\w+)$/.exec(u.pathname);
  if (u.host === "fx.test" && m && m[2] === "EUR" && RATES[m[1]]) return json({ base: m[1], quote: "EUR", rate: RATES[m[1]] });
  if (u.host === "fx.test" && m) return json({ error: "unsupported pair" }, 422);
  return json({ error: "not found" }, 404);
}) as typeof fetch;

test("fixed inputs: a published goal pins a value instead of exposing it as an API parameter (OW7 attempt 1)", async () => {
  const rc = await RightClick.create({ name: "fixed", fetch: fetchMock, directories: [] });
  await rc.learn({ sources: ["https://countries.test/openapi.json", "https://fx.test/openapi.json"] });
  const r = await rc.compose({ have: { country: "JP", quote: { value: "EUR", fixed: true } }, want: "number", intent: "euro value of a country currency exchange rate", run: true, publish: "Euro value" });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.executed?.attempts ?? r.plans));
  assert.equal(r.executed?.output, RATES.JPY);

  const spec = rc.openApi("https://fixed.test") as any;
  const params = spec.paths["/x/euro-value"].get.parameters.map((p: any) => p.name);
  assert.deepEqual(params, ["country"], "the pinned currency is not a parameter of the published API");
  const goal = rc.graph.get("goal:euro-value")!;
  assert.deepEqual(goal.inputs.map((p) => p.name), ["country"]);

  const br = await rc.callPublished("euro-value", { country: "BR" });
  assert.equal(br.ok, true);
  assert.equal(br.result, RATES.BRL);
  // A caller cannot override a pinned input.
  const us = await rc.callPublished("euro-value", { country: "US", quote: "JPY" });
  assert.equal(us.result, RATES.USD);
});
