import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, inferType, inspectValue, strongly } from "../src/core/semantics.ts";
import { stem, tokenize } from "../src/core/graph.ts";

test("inferType reads meaning from names, formats and descriptions", () => {
  assert.equal(inferType("latitude", { type: "number" }), "geo.lat");
  assert.equal(inferType("lng", { type: "number" }), "geo.lon");
  assert.equal(inferType("targetLanguage", { type: "string" }), "language");
  assert.equal(inferType("target", { type: "string" }), "language");
  assert.equal(inferType("homepage", { type: "string" }), "url");
  assert.equal(inferType("x", { type: "string", format: "uri" }), "url");
  assert.equal(inferType("avatar", { type: "string", format: "uri" }), "image.url");
  assert.equal(inferType("contactEmail", { type: "string" }), "email");
  assert.equal(inferType("countryCode", { type: "string" }), "country");
  assert.equal(inferType("code", { type: "string" }, "ISO 3166 country code"), "country");
  assert.equal(inferType("city", { type: "string" }), "place");
  assert.equal(inferType("tags", { type: "array", items: { type: "string" } }), "list:text");
  assert.equal(inferType("links", { type: "array", items: { type: "string", format: "uri" } }), "list:url");
  assert.equal(inferType("count", { type: "integer" }), "number");
  assert.equal(inferType("page", { type: "integer" }), "number");
  assert.equal(inferType("body", { type: "object" }), "json");
  assert.equal(inferType("message", { type: "string" }), "text");
  assert.equal(inferType("full_name", { type: "string" }), "repo.full");
  assert.equal(inferType("repoName", { type: "string" }, "GitHub repository in owner/repo format"), "repo.full");
  assert.equal(inferType("repo", { type: "string" }), "repo");
});

test("cryptic names: identity and meaning come from descriptions", () => {
  assert.equal(inferType("acctno", { type: "string" }, "Account reference"), "id.account");
  assert.equal(inferType("hldr", { type: "string" }, "Customer reference of the account holder"), "id.customer");
  assert.equal(inferType("a_ref", { type: "string" }, "Order ID"), "id.order");
  assert.equal(inferType("ctry", { type: "string" }, "ISO 3166 country code"), "country");
  assert.equal(inferType("ph", { type: "string" }, "Phone number"), "text", "a phone number is not an identity");
  assert.equal(inferType("x", { type: "string" }, "A unique identifier"), "text", "filler words do not name an entity");
  assert.equal(inferType("refs", { type: "array", items: { type: "string" } }, "Customer reference list"), "list:id.customer");
});

test("type lattice: exact, widening, and incompatible", () => {
  assert.equal(distance("url", "url"), 0);
  assert.equal(distance("url", "image.url"), 1);
  assert.equal(distance("text", "image.url"), 2);
  assert.equal(distance("json", "geo.lat"), 2);
  assert.equal(distance("url", "text"), -1);
  assert.equal(distance("list:url", "list:image.url"), 1);
  assert.equal(strongly("url", "image.url"), true);
  assert.equal(strongly("text", "url"), false, "a bare text port must not swallow every string type");
  assert.equal(strongly("json", "text"), false);
  assert.equal(strongly("number", "geo.lat"), true);
});

test("inspectValue classifies values", () => {
  assert.equal(inspectValue("https://example.com/a").type, "url");
  assert.equal(inspectValue("https://example.com/a.png").type, "image.url");
  assert.equal(inspectValue("ada@example.com").type, "email");
  assert.equal(inspectValue("42").type, "number");
  assert.equal(inspectValue("2026-10-15T10:00:00Z").type, "datetime");
  assert.equal(inspectValue("example.com").type, "domain");
  assert.equal(inspectValue('{"a":1}').type, "json");
  assert.equal(inspectValue("<html><body>x</body></html>").type, "html");
  assert.equal(inspectValue("# Title\n**bold**").type, "markdown");
  assert.equal(inspectValue(["https://a.com"]).type, "list:url");
  assert.equal(inspectValue("just some words").type, "text");
});

test("identifiers with runs of capitals split into words", () => {
  assert.ok(tokenize("lookupShippingRateForACity").includes(stem("city")));
  assert.ok(tokenize("parseXMLDocument").includes(stem("document")));
  assert.ok(tokenize("getV2Rates").includes(stem("rates")));
});

test("stemming joins word families", () => {
  assert.equal(stem("translate"), stem("translated"));
  assert.equal(stem("translation"), stem("translate"));
  assert.equal(stem("weather"), stem("weathers"));
  assert.deepEqual(tokenize("Translate the weatherForecast"), [stem("translate"), stem("weather"), stem("forecast")]);
});
