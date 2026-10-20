import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSelection, buildDocument, reflectGraphQL } from "../src/reflectors/graphql.ts";
import { RightClick } from "../src/runtime.ts";
import { dispatch } from "../src/interface/tools.ts";
import { createHandler } from "../src/interface/http.ts";

test("a selection is exactly one nonempty field subtree, never another root operation", () => {
  for (const selection of ["{ id } other { id }", "{ id } { other }", "{}", "{ item {} }", "{ : id }", "{ 1bad }", "{ id ! }", "{ ... on Item { id } }", "{ item(x:1) { id } }", "{ id @skip(if:true) }"])
    assert.throws(() => checkSelection(selection), /selection/, selection);
  for (const selection of ["{ id label }", "{ alias: item { id } }", "{ id, nested { a b } }", "{ __typename }"])
    assert.equal(checkSelection(selection), selection);
});
test("selection complexity is bounded before document construction", () => {
  assert.throws(() => checkSelection("{ a ".repeat(65) + "id" + " }".repeat(65)), /selection/);
  assert.throws(() => checkSelection("{ " + "field ".repeat(5000) + "}"), /selection/);
  assert.throws(() => checkSelection("{" + " ".repeat(65536) + "id}"), /selection/);
});
test("stored contract fields, operations, argument names and types cannot escape the document", () => {
  const valid = { operation: "mutation", field: "approved", args: { id: "[ID!]!" }, selection: "{ id }" };
  assert.equal(buildDocument(valid, ["id"]), "mutation RightClick($id: [ID!]!) { approved(id: $id) { id } }");
  for (const inv of [
    { ...valid, selection: "{ id } unapproved { id }" },
    { ...valid, field: "approved { id } unapproved" },
    { ...valid, operation: "mutation Extra { other } mutation" },
    { ...valid, args: { "id) { other }": "ID!" } },
    { ...valid, args: { id: "ID!) { other } mutation X($x:ID" } },
    { ...valid, args: { id: "[[ID]" } },
  ]) assert.throws(() => buildDocument(inv, Object.keys(inv.args)), /GraphQL|selection/);
});

for (const operation of ["query", "mutation"] as const) test(`${operation}: SDK, compact tools and HTTP refuse root widening before any provider dispatch`, async () => {
  const scalar = { kind: "SCALAR", name: "String" };
  const field = (name: string) => ({ name, args: [], type: scalar });
  const reflection = reflectGraphQL({ data: { __schema: { [operation + "Type"]: { name: "Root" }, types: [
    { name: "Root", kind: "OBJECT", fields: ["approved", "unapproved"].map(name => ({ name, args: [], type: { kind: "OBJECT", name: "Item" } })) },
    { name: "Item", kind: "OBJECT", fields: [field("id"), field("label")] }, { name: "String", kind: "SCALAR" },
  ] } } }, "https://documents.test/graphql");
  const cap = reflection.capabilities.find(c => c.id.endsWith(":approved"))!;
  reflection.provider.meta = { source: "https://documents.test/graphql" };
  let calls = 0;
  const rc = await RightClick.create({ directories: [], authority: { execution: { allowedCapabilities: [cap.id] } }, fetch: async () => {
    calls++; return Response.json({ data: { approved: { id: "a", label: "test" } } });
  } });
  await rc.learn({ spec: reflection });
  const args = { selection: "{ id } unapproved { id }" };
  const sdk = await rc.run(cap.id, args); assert.equal(sdk.status, "failed");
  const mcp: any = await dispatch(rc, "context_run", { id: cap.id, args }); assert.equal(mcp.status, "failed");
  const http = createHandler(rc, { open: true });
  const response = await http(new Request("http://localhost/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cap.id, args }) }));
  assert.equal((await response.json()).status, "failed");
  assert.equal(calls, 0, "invalid local document must not execute or reread a contract");
  assert.equal(rc.ledger.get(cap.id), undefined, "invalid caller syntax is not provider failure evidence");
  assert.equal((await rc.run(cap.id, { selection: "{ id label }" })).status, "completed");
  assert.equal(calls, 1, "authorised ordinary operation still works");
});
