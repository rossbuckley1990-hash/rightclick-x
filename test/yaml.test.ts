import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "../src/core/yaml.ts";
import { RightClick } from "../src/runtime.ts";

test("YAML: the constructs OpenAPI documents use", () => {
  const doc = parseYaml(`---
openapi: 3.0.1
info:
  title: 'Advisories: API'
  description: An open API service providing metadata for many
    open source software ecosystems.
  version: "1.0"
servers:
- url: https://api.test/v1
tags: [a, "b c"]
paths:
  "/items/{id}":
    get:
      summary: Get an item   # trailing comment
      parameters:
      - name: id
        in: path
        required: true
        schema: { type: string, example: "X-1" }
      description: |
        line one
        line two
      responses:
        '200':
          description: ok
`) as any;
  assert.equal(doc.openapi, "3.0.1");
  assert.equal(doc.info.title, "Advisories: API");
  assert.equal(doc.info.description, "An open API service providing metadata for many open source software ecosystems.");
  assert.equal(doc.info.version, "1.0");
  assert.deepEqual(doc.servers, [{ url: "https://api.test/v1" }]);
  assert.deepEqual(doc.tags, ["a", "b c"]);
  const get = doc.paths["/items/{id}"].get;
  assert.equal(get.summary, "Get an item");
  assert.deepEqual(get.parameters[0], { name: "id", in: "path", required: true, schema: { type: "string", example: "X-1" } });
  assert.equal(get.description, "line one\nline two\n");
  assert.equal(get.responses["200"].description, "ok");
  assert.throws(() => parseYaml("a: &x 1\nb: *x\n"), /anchors/);
});

test("a contract published only as YAML is learned like JSON", async () => {
  const yaml = `openapi: 3.0.0\ninfo:\n  title: Yaml API\nservers:\n- url: https://yaml.test\npaths:\n  /ping:\n    get:\n      operationId: ping\n      summary: Ping the service\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n                  pong: { type: boolean }\n`;
  const f = (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    return u.pathname === "/openapi.yaml" ? new Response(yaml, { headers: { "content-type": "application/yaml" } }) : new Response(JSON.stringify({ pong: true }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const rc = await RightClick.create({ name: "y", fetch: f, directories: [] });
  const r = await rc.learn({ source: "https://yaml.test/openapi.yaml" });
  assert.equal(r.results[0].error, undefined);
  const cap = rc.graph.list().find((c) => c.title === "Ping the service");
  assert.ok(cap);
  assert.equal((await rc.run(cap!.id, {})).output && (await rc.run(cap!.id, {})).status, "completed");
});
