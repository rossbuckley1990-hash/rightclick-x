import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";

// Shapes of a real, independently operated API's genuine v1 -> v2 redesign (Frankfurter):
// v1 GET /v1/latest?base=  -> { amount, base, date, rates: { <currency>: number } }
// v2 GET /v2/rate/{base}/{quote} -> { base, quote, rate }
// The operator's root JSON lists both contracts. A second provider on another origin also
// quotes rates; the customer's egress policy does not allow it.
const RATE: Record<string, number> = { USD: 0.89, JPY: 0.0057, GBP: 1.15 };
const CURRENCIES = ["EUR", "USD", "JPY", "GBP"];
const v1 = {
  openapi: "3.1.0", info: { title: "FX", version: "1" }, servers: [{ url: "https://fx.test/v1" }],
  paths: { "/latest": { get: { operationId: "get-latest", summary: "Get the latest rates",
    parameters: [{ name: "base", in: "query", description: "Base currency to convert from", schema: { type: "string", enum: CURRENCIES } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: {
      amount: { type: "number", description: "The amount to convert" }, base: { type: "string", enum: CURRENCIES }, date: { type: "string", format: "date" },
      rates: { type: "object", description: "Exchange rates keyed by currency code", propertyNames: { type: "string", enum: CURRENCIES }, additionalProperties: { type: "number" } } } } } } } } } } },
};
const v2 = {
  openapi: "3.1.0", info: { title: "FX", version: "2" }, servers: [{ url: "https://fx.test/v2" }],
  paths: { "/rate/{base}/{quote}": { get: { operationId: "getRate", summary: "Get a single exchange rate pair", parameters: [
    { name: "base", in: "path", required: true, schema: { type: "string", example: "EUR" } },
    { name: "quote", in: "path", required: true, schema: { type: "string", example: "USD" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { base: { type: "string" }, quote: { type: "string" }, rate: { type: "number" } } } } } } } } } },
};
const other = {
  openapi: "3.0.0", info: { title: "Other FX" }, servers: [{ url: "https://other.test" }],
  paths: { "/convert/{from}/{to}": { get: { summary: "Exchange rate between two currencies", parameters: [
    { name: "from", in: "path", required: true, description: "Source currency code", schema: { type: "string" } },
    { name: "to", in: "path", required: true, description: "Target currency code", schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { rate: { type: "number" } } } } } } } } } },
};

function world() {
  const state = { v1Retired: false, calls: [] as string[] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchMock = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    state.calls.push(`${u.host}${u.pathname}`);
    if (u.host === "fx.test") {
      if (u.pathname === "/") return json({ name: "FX", versions: { v1: { openapi: "/v1/openapi.json", status: state.v1Retired ? "retired" : "frozen" }, v2: { openapi: "/v2/openapi.json", status: "current" } } });
      if (u.pathname.startsWith("/v1/") && state.v1Retired) return json({ error: "v1 has been retired; see /v2" }, 410);
      if (u.pathname === "/v1/openapi.json") return json(v1);
      if (u.pathname === "/v2/openapi.json") return json(v2);
      if (u.pathname === "/v1/latest") {
        const base = u.searchParams.get("base") ?? "EUR";
        return json({ amount: 1, base, date: "2026-10-16", rates: Object.fromEntries(CURRENCIES.filter((c) => c !== base).map((c) => [c, c === "EUR" ? RATE[base] : 1])) });
      }
      const m = /^\/v2\/rate\/(\w+)\/(\w+)$/.exec(u.pathname);
      if (m && m[2] === "EUR") return json({ base: m[1], quote: "EUR", rate: RATE[m[1]] });
    }
    if (u.host === "other.test") {
      if (u.pathname === "/openapi.json") return json(other);
      const m = /^\/convert\/(\w+)\/(\w+)$/.exec(u.pathname);
      if (m) return json({ rate: RATE[m[1]] });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { state, fetchMock };
}

const requirement = (extra: Record<string, unknown> = {}) => ({
  have: { base: "USD", quote: { value: "EUR", fixed: true } },
  want: "number",
  intent: "exchange rate from base currency to quote currency",
  verify: [{ op: "gt", value: 0 }, { op: "lt", value: 1000 }] as any,
  risks: ["read"] as any,
  run: true,
  publish: "Euro rate",
  ...extra,
});

test("keyed maps: v1's rates map answers one currency, and two ports never share one value when another fits", async () => {
  const { fetchMock } = world();
  const rc = await RightClick.create({ name: "v1", fetch: fetchMock, directories: [] });
  await rc.learn({ source: "https://fx.test/v1/openapi.json" });
  const r = await rc.compose({ ...requirement(), publish: undefined });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.executed?.attempts));
  assert.equal(r.executed?.output, RATE.USD, "rates[EUR] for base USD, not v1's amount (1) and not rates[USD]");
});

test("genuine-change shape: v1 retired -> the published goal keeps working via v2 from the same origin, no intervention", async () => {
  const { state, fetchMock } = world();
  const rc = await RightClick.create({ name: "customer", fetch: fetchMock, directories: [] });
  await rc.learn({ source: "https://fx.test/v1/openapi.json" });
  const built = await rc.compose(requirement({ origins: ["https://fx.test"] }));
  assert.equal(built.executed?.output, RATE.USD);

  state.v1Retired = true; // the operator retires v1; the customer does nothing
  const after = await rc.callPublished("euro-rate", { base: "JPY" });
  assert.equal(after.ok, true, after.error);
  assert.equal(after.result, RATE.JPY);
  assert.ok(after.pipeline.some((t) => /single exchange rate pair/i.test(t)), `served by v2: ${after.pipeline}`);
  assert.ok(!state.calls.some((c) => c.startsWith("other.test")), "never left the approved origin");
});

test("same-call repair keeps its lease while concurrent witness relearning is refused", { timeout: 5000 }, async () => {
  const { state, fetchMock } = world();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let gateRoot = false;
  const observer = { openapi: "3.0.0", info: { title: "Repair observer" }, servers: [{ url: "https://observer.test" }], paths: {
    "/check": { get: { operationId: "check", summary: "Check rate", parameters: ["base", "rate"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
      responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } },
  } };
  const fetcher: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === "fx.test" && url.pathname === "/" && gateRoot) { entered(); await gate; }
    if (url.host === "observer.test") {
      if (url.pathname === "/openapi.json") return Response.json(observer);
      if (url.pathname === "/check") return Response.json({ valid: Number(url.searchParams.get("rate")) === RATE[url.searchParams.get("base") ?? ""] });
    }
    return fetchMock(input);
  };
  const rc = await RightClick.create({ name: "repair-lease", fetch: fetcher, directories: [] });
  await rc.learn({ sources: ["https://fx.test/v1/openapi.json", "https://observer.test/openapi.json"] });
  const built = await rc.compose(requirement({ origins: ["https://fx.test", "https://observer.test"], witnesses: [{
    capability: "openapi:repair-observer:check", args: { base: { input: "base" }, rate: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }],
  }] }));
  assert.equal(built.executed?.verification.status, "verified", JSON.stringify(built.executed));
  state.v1Retired = true; gateRoot = true;
  const invocation = rc.callPublished("euro-rate", { base: "JPY" });
  try {
    await ready;
    await assert.rejects(rc.learn({ source: "https://observer.test/openapi.json" }), /blocked while a saved goal is executing/);
  } finally { release(); }
  const result = await invocation;
  assert.equal(result.ok, true, result.error);
  assert.equal(result.verification, "verified");
  assert.equal(result.result, RATE.JPY);
});

test("same-call repair rejects a changed witness before any replacement producer call", async () => {
  const { state, fetchMock } = world();
  const observer = { openapi: "3.0.0", info: { title: "Repair observer" }, servers: [{ url: "https://observer.test" }], paths: {
    "/check": { get: { operationId: "check", summary: "Check rate", parameters: ["base", "rate"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
      responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } },
  } };
  const replacement = { ...structuredClone(observer), paths: { "/replacement": observer.paths["/check"] } };
  let rc!: RightClick, replace = false;
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(`${url.host}${url.pathname}`);
    if (url.host === "observer.test") {
      if (url.pathname === "/openapi.json") return Response.json(observer);
      if (url.pathname === "/check") return Response.json({ valid: Number(url.searchParams.get("rate")) === RATE[url.searchParams.get("base") ?? ""] });
    }
    return fetchMock(input);
  };
  rc = await RightClick.create({ name: "repair-witness-change", fetch: fetcher, directories: [] });
  await rc.learn({ sources: ["https://fx.test/v1/openapi.json", "https://observer.test/openapi.json"] });
  const built = await rc.compose(requirement({ origins: ["https://fx.test", "https://observer.test"], witnesses: [{
    capability: "openapi:repair-observer:check", args: { base: { input: "base" }, rate: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }],
  }] }));
  assert.equal(built.executed?.verification.status, "verified", JSON.stringify(built.executed));
  // Interleave a changed checker into the owner's permitted learn before it
  // returns, modelling a reflection that changes more than the producer.
  const internal = rc as any;
  const originalLearn = internal.learnSources.bind(rc);
  internal.learnSources = async (options: unknown, retained: unknown, permit: unknown) => {
    const result = await originalLearn(options, retained, permit);
    if (replace && permit) {
      replace = false;
      await originalLearn({ spec: reflectOpenAPI(replacement, "https://observer.test/openapi.json") }, undefined, permit);
    }
    return result;
  };
  state.v1Retired = true; replace = true; calls.length = 0;
  await assert.rejects(rc.callPublished("euro-rate", { base: "JPY" }), /witness contract changed|witness must be an available/);
  assert.ok(!calls.some(call => call.startsWith("fx.test/v2/rate/")), `replacement producer was called: ${calls}`);
  assert.ok(!calls.includes("observer.test/replacement"), "the changed witness was not executed");
});

test("egress policy: a repair never routes the customer's data to an origin they did not approve; it fails closed", async () => {
  const { state, fetchMock } = world();
  const rc = await RightClick.create({ name: "strict", fetch: fetchMock, directories: [] });
  await rc.learn({ sources: ["https://fx.test/v1/openapi.json", "https://other.test/openapi.json"] });
  const built = await rc.compose(requirement({ origins: ["https://fx.test"], publish: "Strict euro rate" }));
  assert.equal(built.executed?.output, RATE.USD);
  assert.equal(rc.published.get("strict-euro-rate")?.origins?.[0], "https://fx.test");

  state.v1Retired = true;
  // The successor (v2) is at the approved origin, so it is found and used; other.test is never called.
  const healed = await rc.callPublished("strict-euro-rate", { base: "GBP" });
  assert.equal(healed.result, RATE.GBP);
  assert.ok(!state.calls.some((c) => c.startsWith("other.test/convert")));

  // Policy that allows neither: no route; other.test is still never used.
  const none = await rc.compose(requirement({ origins: ["https://nowhere.test"], publish: undefined }));
  assert.equal(none.executed?.status ?? "failed", "failed");
  assert.ok(!state.calls.some((c) => c.startsWith("other.test/convert")));
});

test("egress policy covers repair traffic too: a contract mirrored elsewhere is not re-read; the successor is found at the API's own origin (OW8b attempt 1)", async () => {
  const { state, fetchMock } = world();
  // The customer built from a third-party mirror of the operator's v1 contract.
  const mirrored = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.host === "mirror.test") {
      state.calls.push(`${u.host}${u.pathname}`);
      return new Response(JSON.stringify(v1), { headers: { "content-type": "application/json" } });
    }
    return fetchMock(input, init);
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "mirror", fetch: mirrored, directories: [] });
  await rc.learn({ source: "https://mirror.test/specs/fx/1/openapi.json" });
  const built = await rc.compose(requirement({ origins: ["https://fx.test"] }));
  assert.equal(built.executed?.output, RATE.USD);

  state.v1Retired = true;
  const before = state.calls.length;
  const after = await rc.callPublished("euro-rate", { base: "GBP" });
  const during = state.calls.slice(before);
  assert.ok(!during.some((c) => c.startsWith("mirror.test")), `repair stayed inside the policy: ${during.join(", ")}`);
  assert.equal(after.ok, true, after.error);
  assert.equal(after.result, RATE.GBP);
});

test("egress policy holds across redirects: an approved origin cannot hand the call to an unapproved one (OW8b attempt 2)", async () => {
  const { state, fetchMock } = world();
  // The approved API origin redirects its root to a marketing site on another origin.
  const redirecting = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.host === "fx.test" && u.pathname === "/") {
      state.calls.push(`${u.host}${u.pathname}`);
      return new Response(null, { status: 301, headers: { location: "https://www.fx-marketing.test/" } });
    }
    if (u.host === "www.fx-marketing.test") {
      state.calls.push(`${u.host}${u.pathname}`);
      return new Response("<html>FX</html>", { headers: { "content-type": "text/html" } });
    }
    return fetchMock(input, init);
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "redirect", fetch: redirecting, directories: [] });
  await rc.learn({ source: "https://fx.test/v1/openapi.json" });
  const built = await rc.compose(requirement({ origins: ["https://fx.test"] }));
  assert.equal(built.executed?.output, RATE.USD);
  state.v1Retired = true;
  const after = await rc.callPublished("euro-rate", { base: "JPY" });
  assert.ok(!state.calls.some((c) => c.startsWith("www.fx-marketing.test")), "the redirect to an unapproved origin was not followed");
  assert.equal(after.ok, false, "with no reachable successor inside the policy, it fails closed");
});
