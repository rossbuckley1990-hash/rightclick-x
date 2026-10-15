import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch, SERVICES } from "../demo/services.ts";
import { createHandler } from "../src/interface/http.ts";
import { RightClick } from "../src/runtime.ts";

test("API synthesis: a published goal becomes an OpenAPI endpoint that another instance learns, chains and republishes", async () => {
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    "https://polyglot.test": SERVICES.polyglot,
    "https://atlas.test": SERVICES.atlas,
    "https://skycast.test": SERVICES.skycast,
  };
  const f = routerFetch(routes);

  // Generation A: learns three services in three protocols and publishes a goal.
  const a = await RightClick.create({ name: "instance-a", fetch: f, directories: [] });
  await a.learn({ sources: ["https://polyglot.test/openapi.json", "https://atlas.test/graphql", "https://skycast.test/mcp"] });
  const pub = await a.compose({ have: { place: "Lisbon" }, want: "text", intent: "weather forecast", run: true, publish: "Weather for a place" });
  assert.deepEqual(pub.published, { slug: "weather-for-a-place", path: "/x/weather-for-a-place" });
  routes["https://a.test"] = createHandler(a, { open: true });

  const spec = a.openApi("https://a.test") as any;
  const op = spec.paths["/x/weather-for-a-place"].get;
  assert.equal(op.parameters[0].schema["x-rightclick-type"], "place");
  assert.equal(op.responses["200"].content["application/json"].schema.properties.result["x-rightclick-type"], "text");

  // Generation B: learns A's synthesized API as plain OpenAPI, with A's semantic types intact.
  const b = await RightClick.create({ name: "instance-b", fetch: f, directories: [] });
  await b.learn({ sources: ["https://a.test/openapi.json", "https://polyglot.test/openapi.json"] });
  const remote = b.graph.list().find((c) => c.id.endsWith("weatherforaplace"))!;
  assert.deepEqual(remote.inputs.map((p) => [p.name, p.type]), [["place", "place"]]);
  assert.ok(remote.outputs.some((o) => o.name === "result" && o.type === "text"));
  // ...chains it with another provider into a new goal, and publishes that.
  const chained = await b.compose({ have: { place: "Tokyo", language: "fr" }, want: "text", intent: "weather place translated", run: true, publish: "Weather for a place in a language" });
  assert.equal(chained.executed?.status, "completed", JSON.stringify(chained.executed?.attempts));
  assert.match(String(chained.executed?.output), /maximale/);
  assert.ok(chained.executed!.titles.includes("Weather for a place"), chained.executed!.titles.join(" > "));
  routes["https://b.test"] = createHandler(b, { open: true });

  // Generation C: consumes B's API, which consumes A's, which consumes three protocols.
  const c = await RightClick.create({ name: "instance-c", fetch: f, directories: [] });
  await c.learn({ source: "https://b.test/openapi.json" });
  const id = c.graph.list().find((x) => x.id.endsWith("weatherforaplaceinalanguage"))!.id;
  const out = await c.run(id, { place: "Nairobi", language: "es" }, { verify: [{ op: "contains", path: "result", value: "°C" }] });
  assert.equal(out.status, "completed");
  assert.equal(out.verification.status, "verified");
  assert.equal(a.published.get("weather-for-a-place")!.calls, 2, "A served B's chained call and C's call through B");
});
