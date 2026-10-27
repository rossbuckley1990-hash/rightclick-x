import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { dispatch, TOOLS } from "../src/interface/tools.ts";
import { MemoryStore } from "./helpers.ts";
import { environmentOptions } from "../src/reflectors/environment.ts";

const catalog = "https://environment.test/.well-known/api-catalog";
const a = "https://forecast.test", b = "https://translation.test";
const environment = { catalogs: [catalog], origins: [a, b] };
const json = (schema: unknown) => ({ "200": { description: "ok", content: { "application/json": { schema } } } });
const spec = (origin: string, version = 1) => ({
  openapi: "3.0.0", info: { title: origin === a ? "Forecast" : "Translation", version: String(version) },
  servers: [{ url: origin }],
  paths: origin === a ? {
    [version === 3 ? "/unrelated" : "/forecast"]: { get: { operationId: "forecast", summary: "Local forecast", parameters: [{ name: "place", in: "query", required: true, schema: { type: "string" } },
      ...(version === 2 ? [{ name: "units", in: "query", required: false, schema: { type: "string" } }] : [])],
      responses: json({ type: "string" }) } },
    "/erase": { delete: { operationId: "erase", responses: json({ type: "string" }) } },
  } : {
    "/translate": { get: { operationId: "translate", summary: "Translate text", parameters: [
      { name: "text", in: "query", required: true, schema: { type: "string" } },
      { name: "language", in: "query", required: true, schema: { type: "string" } },
    ], responses: json({ type: "string" }) } },
  },
});
function fixture() {
  const state = { links: [] as any[], catalogStatus: 200, invalid: false, missing: false, version: 1, calls: [] as Request[] };
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init); state.calls.push(req);
    const url = new URL(req.url);
    if (req.url === catalog) return Response.json(state.invalid ? { wrong: [] } : {
      linkset: [{ anchor: catalog, "service-desc": state.links }],
    }, { status: state.catalogStatus });
    if (url.pathname === "/spec") return state.missing ? new Response(null, { status: 404 }) : Response.json(spec(url.origin, state.version));
    if (url.pathname === "/forecast") return Response.json(`Forecast for ${url.searchParams.get("place")}`);
    if (url.pathname === "/translate") return Response.json(`${url.searchParams.get("language")}: ${url.searchParams.get("text")}`);
    return new Response(null, { status: 404 });
  };
  const create = (store?: MemoryStore, extra: any = {}) => RightClick.create({
    fetch: fetcher, sandbox: null, directories: [], store, environment,
    authority: { execution: { allowedRisks: ["read"], allowedOrigins: [new URL(catalog).origin, a, b] }, publish: "checked" },
    ...extra,
  } as any);
  return { state, create, fetcher };
}

test("environment advertisements enter the same graph, compose, retain and run after restart without discovery", async () => {
  const { state, create } = fixture(); const store = new MemoryStore(); const rc = await create(store);
  assert.equal(state.calls.length, 0, "constructing a runtime never scans the network");
  const empty: any = await dispatch(rc, "context_research", {});
  assert.deepEqual(empty.environment.discovery.sources, []);
  state.links = [{ href: a + "/spec" }, { href: b + "/spec", type: "application/vnd.oai.openapi+json" }];
  const found: any = await dispatch(rc, "context_research", {});
  assert.equal(found.environment.discovery.sources.filter((s: any) => s.status === "learned").length, 2);
  assert.equal(found.environment.discovery.sources[0].authority, "not-assessed");
  assert.equal(found.environment.discovery.sources[0].authenticated, "unknown");
  assert.ok(found.environment.discovery.sources.every((s: any) => s.advertisementDigest && s.observedAt && s.catalog === catalog));
  assert.ok(state.calls.every(r => r.method === "GET"), "catalog discovery never executes a business mutation or a speculative POST");
  const forecast = rc.graph.list().find(c => c.title === "Local forecast")!;
  const translate = rc.graph.list().find(c => c.title === "Translate text")!;
  const built = await rc.compose({ have: { place: { type: "place", value: "Lima" }, language: { type: "language", value: "es" } },
    want: "text", through: [forecast.id, translate.id], run: true, publish: "Local briefing",
    verify: [{ op: "equals", value: "es: Forecast for Lima" }] });
  assert.equal(built.executed?.status, "completed", JSON.stringify(built));
  assert.equal(built.executed?.output, "es: Forecast for Lima");
  await rc.flush();
  const before = state.calls.length; const fresh = await create(store);
  const run = await fresh.run("goal:local-briefing", { place: "Lima", language: "es" });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, "es: Forecast for Lima");
  assert.equal(state.calls.slice(before).filter(r => r.url === catalog || r.url.endsWith("/spec")).length, 0);
  const erased = fresh.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "DELETE")!;
  const effectsBefore = state.calls.length;
  const denied = await fresh.run(erased.id, {}).catch(error => ({ status: "failed", error: String(error) }));
  assert.equal(denied.status, "failed");
  assert.equal(state.calls.length, effectsBefore, "discovery never authorizes the new destructive operation");
  assert.equal(TOOLS.length, 13);
  await fresh.flush();
});

test("valid removal withdraws only catalog-owned sources, including after restart", async () => {
  const { state, create } = fixture(); const store = new MemoryStore(); const rc = await create(store);
  await rc.learn({ source: b + "/spec", kinds: { [b + "/spec"]: "openapi" } });
  state.links = [{ href: a + "/spec" }, { href: b + "/spec" }]; await rc.research(); await rc.flush();
  const fresh = await create(store); state.links = [];
  const report: any = await fresh.research();
  assert.equal(report.environment.discovery.sources.filter((s: any) => s.status === "removed").length, 2);
  assert.equal(fresh.graph.list().filter(c => c.provider.includes("forecast")).length, 0);
  assert.ok(fresh.graph.list().some(c => c.provider.includes("translation")), "explicitly learned source is not owned by the catalog");
  assert.ok(fresh.activity.snapshot().entries.some(e => e.kind === "environment.source" && e.status === "removed"));
  await fresh.flush();
});

test("outages, authentication failures and malformed catalogs do not assert removal", async () => {
  const { state, create } = fixture(); const rc = await create();
  state.links = [{ href: a + "/spec" }]; await rc.research();
  for (const [status, expected] of [[503, "unavailable"], [401, "authentication-required"], [403, "forbidden"], [429, "rate-limited"]] as const) {
    state.catalogStatus = status;
    const r: any = await rc.research();
    assert.equal(r.environment.discovery.catalogs[0].status, expected);
    assert.ok(rc.graph.list().some(c => c.title === "Local forecast"));
    assert.equal(r.environment.discovery.sources[0].status, "stale");
  }
  state.catalogStatus = 200; state.invalid = true;
  const r: any = await rc.research();
  assert.equal(r.environment.discovery.catalogs[0].status, "invalid");
  assert.ok(rc.graph.list().some(c => c.title === "Local forecast"));
});

test("advertisements cannot widen egress, carry credentials, or trigger unsupported protocols", async () => {
  const { state, create } = fixture(); const rc = await create();
  state.links = [{ href: "https://outside.test/spec" }, { href: "http://169.254.169.254/spec" },
    { href: a + "/spec", type: "application/grpc" }, { href: "https://secret:password@forecast.test/spec" }];
  const r: any = await rc.research();
  assert.equal(state.calls.length, 1, "only the approved catalog was fetched");
  assert.ok(r.environment.discovery.sources.some((s: any) => s.status === "blocked"));
  assert.ok(r.environment.discovery.sources.some((s: any) => s.status === "unsupported"));
  assert.ok(!JSON.stringify(r.environment.discovery).includes("password"), "unsafe URL is never persisted in evidence");
});

test("catalog and contract redirects remain within approved environment origins", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ environment, sandbox: null, directories: [], fetch: async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    return new Response(null, { status: 302, headers: { location: "https://outside.test/collect" } });
  } } as any);
  const r: any = await rc.research();
  assert.equal(calls.length, 1);
  assert.equal(r.environment.discovery.catalogs[0].status, "blocked");
});

test("environment configuration is explicit, bounded and credential-free", () => {
  assert.equal(environmentOptions(undefined), undefined);
  assert.deepEqual(environmentOptions(JSON.stringify(environment)), environment);
  for (const raw of [{ catalogs: ["file:///etc/passwd"] }, { catalogs: [catalog + "?token=secret"] },
    { catalogs: [catalog], origins: [a + "/private"] }, { catalogs: Array(9).fill(catalog) }])
    assert.throws(() => environmentOptions(raw));
});

test("overlapping advertisements retain a source until all successful catalogs remove it", async () => {
  const { state, create, fetcher } = fixture(); const second = "https://environment.test/second";
  state.links = [{ href: a + "/spec" }];
  let secondLinks: any[] = [{ href: a + "/spec" }];
  const rc = await create(undefined, { environment: { ...environment, catalogs: [catalog, second] },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => String(input) === second
      ? Response.json({ linkset: [{ "service-desc": secondLinks }] }) : fetcher(input, init) });
  await rc.research();
  state.links = [];
  await rc.research();
  assert.ok(rc.graph.list().some(c => c.title === "Local forecast"));
  secondLinks = [];
  await rc.research();
  assert.ok(!rc.graph.list().some(c => c.title === "Local forecast"));
});

test("environment refresh keeps compatible goals and refuses changed operation meaning", async () => {
  const { state, create } = fixture(); const rc = await create();
  state.links = [{ href: a + "/spec" }]; await rc.research();
  const original = rc.graph.list().find(c => c.title === "Local forecast")!;
  const result = await rc.compose({ have: { place: { type: "place", value: "Lima" } }, want: "text",
    through: [original.id], run: true, publish: "Forecast outcome", verify: [{ op: "contains", value: "Forecast for" }] });
  assert.equal(result.executed?.status, "completed");
  state.version = 2; await rc.research();
  const reuse = await rc.run("goal:forecast-outcome", { place: "Oslo" });
  assert.equal(reuse.status, "completed", reuse.error);
  assert.equal(reuse.output, "Forecast for Oslo");
  state.version = 3; await rc.research();
  const before = state.calls.length;
  const changed = await rc.run("goal:forecast-outcome", { place: "Oslo" }).catch(error => ({ status: "failed", error: String(error) }));
  assert.equal(changed.status, "failed");
  assert.equal(state.calls.length, before, "a changed action is not executed to test its meaning");
  state.links = []; await rc.research();
  const missing = await rc.run(original.id, {}).catch(error => ({ status: "failed", error: String(error) }));
  assert.equal(missing.status, "failed");
});

test("oversized catalogs do not silently turn omitted sources into removals", async () => {
  const { state, create } = fixture(); const rc = await create();
  state.links = [{ href: a + "/spec" }]; await rc.research();
  state.links = Array.from({ length: 65 }, (_, n) => ({ href: a + "/spec-" + n }));
  const r: any = await rc.research();
  assert.equal(r.environment.discovery.catalogs[0].status, "invalid");
  assert.ok(rc.graph.list().some(c => c.title === "Local forecast"));
});

test("environment discovery coalesces concurrent refreshes and respects existing policy", async () => {
  const { state, create } = fixture();
  const rc = await create(undefined, { network: { blockPrivate: false, origins: [new URL(catalog).origin] } });
  state.links = [{ href: a + "/spec" }];
  const [first, second]: any[] = await Promise.all([rc.research(), rc.research()]);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(first.environment.discovery, second.environment.discovery);
  assert.equal(first.environment.discovery.sources[0].status, "blocked");
});

test("new catalog members compose an unrelated order outcome and repeat independent checks after restart", async () => {
  const store = new MemoryStore();
  const origins = ["https://fulfilment.test", "https://levy.test", "https://inspection.test"];
  const countries: Record<string, string> = { "A-1": "DE", "A-2": "FR" };
  const rates: Record<string, number> = { DE: 19, FR: 20 };
  const truth: Record<string, number> = { "A-1": 19, "A-2": 20 };
  const calls: string[] = [];
  let advertised = false;
  const parameter = (name: string, type = "string") => ({ name, in: "query", required: true, schema: { type } });
  const operation = (title: string, origin: string, id: string, inputs: object[], properties: object) => ({
    openapi: "3.1.0", info: { title }, servers: [{ url: origin }], paths: {
      "/run": { get: { operationId: id, parameters: inputs, responses: json({ type: "object", properties }) } },
    },
  });
  const contracts = [
    operation("Fulfilment", origins[0], "lookup", [parameter("order_id")], { country: { type: "string" } }),
    operation("Levy", origins[1], "calculate", [parameter("country")], { tax_rate: { type: "number" } }),
    operation("Inspection", origins[2], "validate", [parameter("order_id"), parameter("candidate", "number")], { valid: { type: "boolean" } }),
  ];
  const options = { store, directories: [], environment: { catalogs: [catalog], origins },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init); calls.push(req.url);
      assert.equal(req.method, "GET");
      const url = new URL(req.url);
      if (req.url === catalog) return Response.json({ linkset: [{ anchor: catalog, "service-desc": advertised ? origins.map(o => ({ href: o + "/contract" })) : [] }] });
      if (url.pathname === "/contract") return Response.json(contracts[origins.indexOf(url.origin)]);
      if (url.origin === origins[0]) return Response.json({ country: countries[url.searchParams.get("order_id")!] });
      if (url.origin === origins[1]) return Response.json({ tax_rate: rates[url.searchParams.get("country")!] });
      if (url.origin === origins[2]) return Response.json({ valid: Number(url.searchParams.get("candidate")) === truth[url.searchParams.get("order_id")!] });
      throw new Error("unconfigured test route");
    },
  };
  const rc = await RightClick.create(options);
  await dispatch(rc, "context_research", {});
  assert.equal(rc.graph.list().filter(c => c.source === "openapi").length, 0);
  advertised = true;
  await dispatch(rc, "context_research", {});
  assert.equal(rc.graph.list().filter(c => c.source === "openapi").length, 3);
  const checker = rc.graph.list().find(c => c.title.toLowerCase().includes("validate"))!;
  assert.ok(checker);
  const first: any = await dispatch(rc, "context_compose", {
    have: { order_id: "A-1" }, want: "number", intent: "tax rate order country", run: true, publish: "Order levy",
    witnesses: [{ capability: checker.id, args: { order_id: { input: "order_id" }, candidate: { output: "" } },
      verify: [{ op: "equals", path: "valid", value: true }] }],
  });
  assert.equal(first.executed?.status, "completed", JSON.stringify(first));
  assert.equal(first.executed?.output, 19);
  assert.equal(first.executed?.verification.status, "verified");
  assert.equal(first.executed?.witnesses?.[0].status, "completed");
  await rc.flush();
  const count = calls.length;
  const fresh = await RightClick.create(options);
  const second = await fresh.run("goal:order-levy", { order_id: "A-2" });
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.output, 20);
  assert.equal(second.witnesses?.[0].status, "completed");
  assert.ok(!calls.slice(count).some(url => url === catalog || url.endsWith("/contract")), "reuse needs no discovery");
  rates.FR = 19;
  const incorrect = await fresh.run("goal:order-levy", { order_id: "A-2" });
  assert.equal(incorrect.status, "failed");
  assert.equal(incorrect.verification.status, "refuted");
  await fresh.flush();
});

test("discovery configuration is not restored from state and a narrowed host policy still refuses execution", async () => {
  const { state, create } = fixture(); const store = new MemoryStore();
  state.links = [{ href: a + "/spec" }];
  const rc = await create(store); await rc.research(); await rc.flush();
  const capability = rc.graph.list().find(c => c.title === "Local forecast")!;
  const fresh = await create(store, { environment: undefined, network: { blockPrivate: false, origins: [] } });
  const before = state.calls.length;
  const report = await fresh.research();
  assert.equal(report.environment.discovery, undefined);
  const denied = await fresh.run(capability.id, { place: "Oslo" });
  assert.equal(denied.status, "failed");
  assert.equal(state.calls.length, before, "stored observations cannot restore host network authority");
  await fresh.flush();
});
