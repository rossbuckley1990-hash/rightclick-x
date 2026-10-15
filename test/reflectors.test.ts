import { test } from "node:test";
import assert from "node:assert/strict";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { reflectWeb } from "../src/reflectors/web.ts";
import { buildDocument } from "../src/reflectors/graphql.ts";
import { URLS, world, peerHandler } from "./helpers.ts";
import { RightClick } from "../src/runtime.ts";
import { routerFetch, SERVICES } from "../demo/services.ts";

test("discovery detects OpenAPI, GraphQL, MCP and web forms from bare URLs", async () => {
  const { rc } = await world();
  const r = await rc.learn({ sources: Object.values(URLS) });
  const kinds = r.results.flatMap((x) => x.probes.filter((p) => p.ok).map((p) => p.kind)).sort();
  assert.deepEqual(kinds, ["graphql", "mcp", "openapi", "web"]);
  const sources = new Set(rc.graph.list().map((c) => c.source));
  for (const s of ["openapi", "graphql", "mcp", "web", "builtin"]) assert.ok(sources.has(s as any), s);
  assert.ok(r.totalNewPowers > r.totalNewCapabilities * 5, "powers grow faster than capabilities");
});

test("OpenAPI: $ref bodies, typed ports, server resolution", async () => {
  const spec = await (await SERVICES.polyglot(new Request("https://p.test/openapi.json"))).json();
  const r = reflectOpenAPI(spec as any, "https://p.test/openapi.json");
  const tr = r.capabilities.find((c) => c.id.endsWith("translatetext"))!;
  assert.equal(tr.invoke.kind === "http" && tr.invoke.url, "https://p.test/translate");
  assert.deepEqual(tr.inputs.map((p) => [p.name, p.type, p.required]), [["text", "text", true], ["target", "language", true]]);
  assert.ok(tr.outputs.some((o) => o.name === "translatedText" && o.type === "text"));
  assert.ok(tr.outputs.some((o) => o.name === "detectedLanguage" && o.type === "language"));
  assert.equal(tr.risk, "write");
});

test("Swagger 2.0 specs reflect too", () => {
  const r = reflectOpenAPI(
    {
      swagger: "2.0",
      info: { title: "Legacy", version: "1" },
      host: "legacy.test",
      basePath: "/v1",
      schemes: ["https"],
      paths: {
        "/users/{userId}": {
          get: {
            operationId: "getUser",
            parameters: [{ name: "userId", in: "path", required: true, type: "string" }],
            responses: { 200: { description: "ok", schema: { type: "object", properties: { email: { type: "string" }, homepage: { type: "string" } } } } },
          },
        },
      },
    },
    "https://legacy.test/swagger.json",
  );
  const c = r.capabilities[0];
  assert.equal(c.invoke.kind === "http" && c.invoke.url, "https://legacy.test/v1/users/{userId}");
  assert.deepEqual(c.inputs[0], { name: "userId", type: "id.user", required: true, description: undefined, wire: "string" });
  assert.deepEqual(c.outputs.slice(1).map((o) => o.type), ["email", "url"]);
});

test("GraphQL: introspected fields become capabilities with generated documents", async () => {
  const { rc } = await world();
  await rc.learn({ source: URLS.atlas });
  const geo = rc.graph.list().find((c) => c.id.endsWith("query:geocode"))!;
  assert.deepEqual(geo.inputs.map((p) => [p.name, p.type]), [["place", "place"]]);
  assert.deepEqual(
    geo.outputs.filter((o) => o.name).map((o) => [o.name, o.type]),
    [["name", "text"], ["latitude", "geo.lat"], ["longitude", "geo.lon"], ["countryCode", "country"]],
  );
  assert.equal(
    buildDocument(geo.invoke as any, ["place"]),
    "query RightClick($place: String!) { geocode(place: $place) { name latitude longitude countryCode } }",
  );
  const run = await rc.run(geo.id, { place: "Tokyo" });
  assert.equal(run.status, "completed");
  assert.equal((run.output as any).countryCode, "JP");
});

test("MCP: tools with output schemas become typed capabilities and run", async () => {
  const { rc } = await world();
  await rc.learn({ source: URLS.skycast });
  const f = rc.graph.list().find((c) => c.id === "mcp:skycast:forecast")!;
  assert.deepEqual(f.inputs.map((p) => [p.name, p.type, p.required]), [["latitude", "geo.lat", true], ["longitude", "geo.lon", true], ["days", "number", false]]);
  assert.equal(f.risk, "read");
  const r = await rc.run(f.id, { latitude: "38.7", longitude: "-9.1" });
  assert.equal(r.status, "completed");
  assert.match((r.output as any).summary, /°C/);
});

test("web: forms become capabilities, hidden fields become constants", async () => {
  const html = `<html><head><title>Shop</title><link rel="service-desc" href="/api/openapi.json"></head><body>
    <form action="/find" method="get"><input name="q" required><input type="hidden" name="ref" value="home"></form>
    <form method="post" action="/subscribe" name="newsletter"><input type="email" name="email"><input type="password" name="pw"></form></body></html>`;
  const r = reflectWeb(html, "https://shop.test/");
  assert.equal(r.capabilities.length, 2);
  const [find, sub] = r.capabilities;
  assert.equal(find.invoke.kind === "http" && find.invoke.constants?.ref, "home");
  assert.equal(sub.inputs[0].type, "email");
  assert.equal(sub.inputs.length, 1, "password fields are never reflected");
  assert.deepEqual(r.provider.meta?.hints, ["https://shop.test/api/openapi.json"]);
  const { rc } = await world();
  await rc.learn({ source: URLS.newsroom });
  const search = rc.graph.list().find((c) => c.source === "web")!;
  const out = await rc.run(search.id, { q: "Lisbon" });
  assert.match(String(out.output), /Results for Lisbon/);
});

test("federation: a peer's graph is absorbed and runs remotely", async () => {
  const peer = await RightClick.create({ name: "eu", region: "eu-west", fetch: routerFetch({ "https://skycast.test": SERVICES.skycast }), directories: [] });
  await peer.learn({ source: "https://skycast.test/mcp" });
  const { rc } = await world({ "https://peer.test": peerHandler(peer) });
  const r = await rc.learn({ source: "https://peer.test/" });
  assert.ok(r.results[0].probes.some((p) => p.ok && p.kind === "peer"));
  assert.deepEqual([...new Set(r.results[0].learned.map((l) => l.provider.split(":")[0]))], ["peer"], "a peer is federated, not re-learned as plain OpenAPI");
  const fed = rc.graph.list().filter((c) => c.source === "peer");
  assert.deepEqual(fed.map((c) => c.id).sort(), ["peer:peer-test:mcp:skycast:air-quality", "peer:peer-test:mcp:skycast:forecast"]);
  const out = await rc.run("peer:peer-test:mcp:skycast:forecast", { latitude: 0, longitude: 0 });
  assert.equal(out.status, "completed");
  assert.equal(peer.runs.size, 1, "the run happened on the peer");
});

test("credentials are origin-pinned", async () => {
  const seen: Array<[string, string | null]> = [];
  const capture = async (req: Request) => {
    seen.push([new URL(req.url).origin, req.headers.get("authorization")]);
    return new Response("{}", { headers: { "content-type": "application/json" } });
  };
  const { rc } = await world({ "https://a.test": capture, "https://b.test": capture });
  rc.net.auth.set("https://a.test", { Authorization: "Bearer secret-a" });
  await rc.learn({ sources: ["https://a.test/x", "https://b.test/x"] });
  assert.ok(seen.some(([o, a]) => o === "https://a.test" && a === "Bearer secret-a"));
  assert.ok(seen.filter(([o]) => o === "https://b.test").every(([, a]) => a === null));
});
