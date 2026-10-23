import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";
import { reflectGraphQL } from "../src/reflectors/graphql.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";

const response = (properties: object) => ({ "200": { content: { "application/json": { schema: { type: "object", properties } } } } });
const source = { openapi: "3.1.0", info: { title: "Orders" }, servers: [{ url: "https://orders.test" }], paths: {
  "/orders/{request_id}": { get: { operationId: "lookup", summary: "Find order invoice", parameters: [
    { name: "request_id", in: "path", required: true, schema: { type: "string" } }],
    responses: response({ invoice_id: { type: "string" } }) } },
} };
const sink = { openapi: "3.1.0", info: { title: "Invoices" }, servers: [{ url: "https://invoices.test" }], paths: {
  "/invoices/{invoice_id}": { get: { operationId: "summary", summary: "Read invoice summary", parameters: [
    { name: "invoice_id", in: "path", required: true, schema: { type: "string" } }],
    responses: response({ summary: { type: "string" } }) } },
} };
async function fixture(store?: MemoryStore) {
  let value: unknown = { invoice_id: "i1" };
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, store, fetch: async input => {
    const url = new URL(String(input)); calls.push(url.href);
    if (url.pathname === "/spec") return Response.json(url.hostname === "orders.test" ? source : sink);
    return Response.json(url.hostname === "orders.test" ? value : { summary: "invoice summary" });
  } });
  if (!rc.graph.get("openapi:orders:lookup")) await rc.learn({ sources: ["https://orders.test/spec", "https://invoices.test/spec"] });
  calls.length = 0;
  return { rc, calls, set: (next: unknown) => { value = next; } };
}
const goal = { have: { request_id: { type: "id.request", value: "r1" } }, want: "text", intent: "order invoice summary",
  through: ["openapi:orders:lookup", "openapi:invoices:summary"], maxSteps: 2, run: true,
  verify: [{ op: "equals" as const, value: "invoice summary" }] };

test("missing upstream values stop composition without contract discovery or consumer dispatch", async () => {
  for (const value of [null, {}, { invoice_id: null }, { invoice_id: "" }, { invoice_id: [] }]) {
    const { rc, calls, set } = await fixture();
    set(value);
    const before = rc.graph.capabilities.size;
    const run = await rc.compose({ ...goal, publish: "Invoice summary" });
    assert.equal(run.executed?.status, "failed");
    assert.deepEqual(calls, ["https://orders.test/orders/r1"]);
    assert.match(run.executed?.error ?? "", /has no value/);
    assert.equal(run.published, undefined);
    assert.equal(run.crystallized, undefined);
    assert.equal(rc.graph.capabilities.size, before);
    assert.equal(run.executed?.runs.length, 1, "keep the completed producer's evidence");
    set({ invoice_id: "i1" }); calls.length = 0;
    const valid = await rc.compose(goal);
    assert.equal(valid.executed?.status, "completed", "absent data did not retire the capability");
    assert.deepEqual(calls, ["https://orders.test/orders/r1", "https://invoices.test/invoices/i1"]);
  }
});

test("a retained goal propagates missing-data refusal through nested composites", async () => {
  const store = new MemoryStore();
  const first = await fixture(store);
  assert.ok((await first.rc.compose({ ...goal, publish: "Invoice summary" })).published);
  await first.rc.flush();
  const { rc, calls, set } = await fixture(store); set(null);
  const saved = await rc.run("goal:invoice-summary", { request_id: "r2" });
  assert.equal(saved.status, "failed");
  assert.deepEqual(calls, ["https://orders.test/orders/r2"]);
  const child = rc.graph.list().find(c => c.invoke.kind === "composite")!;
  assert.ok(child);
  rc.graph.addCapability({ id: "composite:outer", provider: "composite:outer", source: "composite", title: "Outer", description: "",
    inputs: child.inputs, outputs: child.outputs, risk: "read", tags: [],
    invoke: { kind: "composite", steps: [{ capability: child.id, bindings: child.inputs.map(p => ({ port: p.name, from: "$in." + p.name })) }], result: "0" } },
    { id: "composite:outer", source: "composite", title: "Outer", origin: "local", learnedAt: new Date().toISOString() });
  calls.length = 0;
  const nested: any = await rc.compose({ have: { request_id: { type: "id.request", value: "r3" } }, want: "text",
    through: ["composite:outer"], run: true });
  assert.equal(nested.executed?.status, "failed");
  assert.deepEqual(calls, ["https://orders.test/orders/r3"]);
  assert.equal(nested.executed?.dataUnavailable?.producer, "openapi:orders:lookup");
  await rc.flush();
});

test("nullable GraphQL relationships stop the same generic dataflow while valid queries remain reusable", async () => {
  const calls: string[] = [];
  const scalar = { kind: "SCALAR", name: "String", ofType: null };
  const intro = { data: { __schema: { queryType: { name: "Query" }, types: [
    { kind: "OBJECT", name: "Query", fields: [{ name: "reservation", args: [{ name: "request_id", type: scalar }],
      type: { kind: "OBJECT", name: "Reservation" } }] },
    { kind: "OBJECT", name: "Reservation", fields: [{ name: "invoice_id", args: [], type: scalar }] },
    { kind: "SCALAR", name: "String" },
  ] } } };
  let missing = true;
  const other = await RightClick.create({ directories: [], sandbox: null, fetch: async input => {
    calls.push(String(input));
    return Response.json(String(input).startsWith("https://reservations.test/")
      ? { data: { reservation: missing ? null : { invoice_id: "i2" } } } : { summary: "invoice summary" });
  } });
  const reflected = reflectGraphQL(intro, "https://reservations.test/graphql");
  reflected.provider.meta = { ...reflected.provider.meta, source: "https://reservations.test/graphql" };
  other.graph.add(reflected);
  other.graph.add(reflectOpenAPI(sink, "https://invoices.test/spec"));
  const run = await other.compose({ ...goal, through: ["graphql:reservations-test-graphql:query:reservation", "openapi:invoices:summary"] });
  assert.equal(run.executed?.status, "failed");
  assert.deepEqual(calls, ["https://reservations.test/graphql"]);
  assert.equal(run.executed?.verification.status, "refuted");
  missing = false; calls.length = 0;
  const valid = await other.compose({ ...goal, through: ["graphql:reservations-test-graphql:query:reservation", "openapi:invoices:summary"] });
  assert.equal(valid.executed?.status, "completed");
  assert.deepEqual(calls, ["https://reservations.test/graphql", "https://invoices.test/invoices/i2"]);
});
