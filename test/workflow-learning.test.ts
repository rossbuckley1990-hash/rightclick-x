import test from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectGraphQL } from "../src/reflectors/graphql.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { httpContractDigest } from "../src/reflectors/http-continuation.ts";
import { MemoryStore } from "./helpers.ts";
import type { Capability } from "../src/core/types.ts";

const response = (properties: object) => ({ "200": { content: { "application/json": { schema: { type: "object", properties } } } } });
const properties = { request_id: { type: "string" }, invoice_id: { type: "string" } };
const scalar = { kind: "SCALAR", name: "String", ofType: null };
const intro = { data: { __schema: { queryType: { name: "Query" }, types: [
  { kind: "OBJECT", name: "Query", fields: [{ name: "reservation", args: [{ name: "request_id", type: scalar }],
    type: { kind: "OBJECT", name: "Reservation" } }] },
  { kind: "OBJECT", name: "Reservation", fields: Object.keys(properties).map(name => ({ name, args: [], type: scalar })) },
  { kind: "SCALAR", name: "String" },
] } } };
const producer = { openapi: "3.1.0", info: { title: "Reservations" }, servers: [{ url: "https://reservations.test" }], paths: {
  "/reservations/{request_id}": { get: { operationId: "reservation", parameters: [
    { name: "request_id", in: "path", required: true, schema: { type: "string" } }], responses: response(properties) } },
} };
const consumer = { openapi: "3.1.0", info: { title: "Invoices" }, servers: [{ url: "https://invoices.test" }], paths: {
  "/invoices/{invoice_id}": { post: { operationId: "record", parameters: [
    { name: "invoice_id", in: "path", required: true, schema: { type: "string" } }], responses: response({ receipt: { type: "string" } }) } },
} };
const goal = { have: { request_id: { type: "id.request", value: "REQ123" } }, want: "text", run: true,
  maxSteps: 2, verify: [{ op: "equals" as const, value: "recorded" }] };

async function world(kind: "graphql" | "openapi", alter?: (c: Capability) => void) {
  const store = new MemoryStore(), calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, store, workflowRecovery: true,
    fetch: async input => {
      const url = String(input); calls.push(url);
      if (url.startsWith("https://reservations.test/")) {
        alter?.(rc.graph.get("openapi:invoices:record")!);
        const data = { request_id: "REQ123", invoice_id: "INV456" };
        return Response.json(kind === "graphql" ? { data: { reservation: data } } : data);
      }
      return Response.json({ receipt: "recorded" });
    } });
  rc.graph.add(kind === "graphql" ? reflectGraphQL(intro, "https://reservations.test/graphql")
    : reflectOpenAPI(producer, "https://reservations.test/spec"));
  rc.graph.add(reflectOpenAPI(consumer, "https://invoices.test/spec"));
  const first = kind === "graphql" ? "graphql:reservations-test-graphql:query:reservation" : "openapi:reservations:reservation";
  return { rc, calls, store, through: [first, "openapi:invoices:record"] };
}

for (const kind of ["graphql", "openapi"] as const) test(`${kind} identity learning preserves an exact retained workflow`, async () => {
  const { rc, calls, store, through } = await world(kind);
  const before = await httpContractDigest(rc.graph.get(through[0])!);
  const result = await rc.compose({ ...goal, through, publish: "Recorded invoice" });
  assert.equal(result.executed?.status, "completed", JSON.stringify(result.executed?.pending));
  assert.equal(result.executed?.verification.status, "checked");
  assert.equal(result.executed?.output, "recorded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "https://invoices.test/invoices/INV456");
  assert.ok(rc.graph.get(through[0])!.inputs.some(p => p.schemes?.length), "actual evidence was learned");
  assert.equal(await httpContractDigest(rc.graph.get(through[0])!), before);
  await rc.flush();
  assert.deepEqual(store.state!.workflowContinuations, []);
  const fresh = await RightClick.create({ directories: [], sandbox: null, store, workflowRecovery: true,
    fetch: async input => { calls.push(String(input)); return Response.json(String(input).startsWith("https://reservations.test/")
      ? (kind === "graphql" ? { data: { reservation: { request_id: "REQ234", invoice_id: "INV567" } } }
        : { request_id: "REQ234", invoice_id: "INV567" }) : { receipt: "recorded" }); } });
  const reused = await fresh.run("goal:recorded-invoice", { request_id: "REQ234" });
  assert.equal(reused.status, "completed", reused.error);
  assert.equal(calls.length, 4, "reuse never rediscovers or replays the old producer");
  assert.equal(calls[3], "https://invoices.test/invoices/INV567");
  await fresh.flush();
});

test("learning never permits changed declared contracts, effects or execution targets", async () => {
  const mutations: Array<(c: Capability) => void> = [
    c => { if (c.invoke.kind === "http") c.invoke.url = "https://elsewhere.test/invoices/{invoice_id}"; },
    c => { if (c.invoke.kind === "http") c.invoke.method = "DELETE"; },
    c => { c.inputs[0].type = "id.unrelated"; },
    c => { c.inputs[0].required = false; },
    c => { c.inputs[0].enum = ["INV999"]; },
    c => { c.outputs[1].type = "id.unrelated"; },
    c => { c.risk = "destructive"; },
    c => { c.provider = "unrelated:provider"; },
  ];
  for (const mutate of mutations) {
    const { rc, calls, through, store } = await world("graphql", mutate);
    const result = await rc.compose({ ...goal, through });
    assert.equal(result.executed?.status, "pending");
    assert.match(result.executed?.pending?.detail ?? "", /contract changed/);
    assert.deepEqual(calls, ["https://reservations.test/graphql"], "no changed effect or alternative dispatch");
    await rc.flush();
    assert.equal(store.state!.workflowContinuations?.[0].next, 1);
    store.state!.requirements = store.state!.requirements!.filter(r => r !== "declared-continuation-contracts@1");
    const before = structuredClone(store.state);
    await assert.rejects(RightClick.create({ directories: [], sandbox: null, store, workflowRecovery: true }),
      /unsupported retained workflow contract digest/);
    assert.deepEqual(store.state, before, "old pending work is preserved, never reinterpreted or replayed");
  }
});
