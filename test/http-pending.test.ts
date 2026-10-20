import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { dispatch } from "../src/interface/tools.ts";
import { createHandler } from "../src/interface/http.ts";
import { MemoryStore } from "./helpers.ts";
import { capabilityState } from "../src/interface/dashboard-state.ts";
import { executeGraphQL, introspection } from "../src/interface/graphql-server.ts";

function contract() {
  return {
    openapi: "3.1.0", info: { title: "Batch publisher", version: "1" },
    servers: [{ url: "https://jobs.test" }],
    paths: {
      "/publish": { post: { operationId: "publish", summary: "Publish document",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["document"], properties: { document: { type: "string" } },
        } } } },
        responses: { "202": { description: "Accepted; still pending", content: { "application/json": {
          schema: { type: "object", properties: { state: { type: "string" } } },
        } } } },
      } },
      "/lookup": { get: { operationId: "lookup", responses: { "202": { description: "Pending" } } } },
    },
  };
}
async function pendingWorld(empty = false) {
  const requests: string[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (input, init) => {
    requests.push(`${init?.method ?? "GET"} ${input}`);
    return empty ? new Response(null, { status: 202 }) : Response.json({ state: "pending" }, { status: 202 });
  } });
  rc.graph.add(reflectOpenAPI(contract(), "https://jobs.test/spec"));
  return { rc, requests };
}

test("HTTP 202 is pending, never checked output, and is not replayed or healed", async () => {
  const { rc, requests } = await pendingWorld();
  const run = await rc.run("openapi:batch-publisher:publish", { document: "report" }, { verify: [{ op: "type", value: "object" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
  assert.equal(run.healing, undefined);
  assert.equal(requests.length, 1);
  assert.equal(rc.ledger.get("openapi:batch-publisher:publish")?.ok ?? 0, 0);
});

test("an empty 202 read is pending and never an empty completed answer", async () => {
  const { rc, requests } = await pendingWorld(true);
  const run = await rc.run("openapi:batch-publisher:lookup");
  assert.equal(run.status, "pending");
  assert.equal(run.output, undefined);
  assert.equal(run.verification.status, "unverified");
  assert.equal(requests.length, 1);
});

test("composition cannot publish, crystallize, or replan around an accepted pending effect", async () => {
  const { rc, requests } = await pendingWorld();
  const result: any = await dispatch(rc, "context_compose", { have: { document: "report" }, want: "json",
    through: ["openapi:batch-publisher:publish"], run: true, publish: "Published report",
    verify: [{ op: "type", value: "object" }] });
  assert.equal(result.executed?.status, "pending");
  assert.equal(result.executed?.verification.status, "unverified");
  assert.equal(result.published, undefined);
  assert.equal(result.crystallized, undefined);
  assert.equal(requests.length, 1);
  assert.equal(rc.published.size, 0);
});

test("federated pending outcomes cannot be promoted to completed local results", async () => {
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async () => Response.json({
    status: "pending", output: { state: "pending" }, verification: { status: "unverified", results: [] },
  }) });
  rc.graph.add({ provider: { id: "peer:jobs", source: "peer", origin: "https://peer.test", title: "Peer", capabilityIds: ["peer:jobs:publish"], learnedAt: new Date().toISOString() },
    capabilities: [{ id: "peer:jobs:publish", provider: "peer:jobs", source: "peer", title: "Publish", description: "", inputs: [], outputs: [{ name: "", type: "json", required: true }], risk: "write", tags: [],
      invoke: { kind: "peer", endpoint: "https://peer.test", id: "publish" } }] });
  const run = await rc.run("peer:jobs:publish", {}, { verify: [{ op: "type", value: "object" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
});

test("a pending fan-out item stops the remaining effects and the retained composite", async () => {
  const { rc, requests } = await pendingWorld();
  rc.graph.addCapability({ id: "composite:batch", provider: "composite:fixture", source: "composite", title: "Batch", description: "",
    inputs: [{ name: "documents", type: "list:text", required: true }], outputs: [{ name: "", type: "list:json", required: true }], risk: "write", tags: [],
    invoke: { kind: "composite", steps: [{ capability: "openapi:batch-publisher:publish", bindings: [{ port: "document", from: "$in.documents", each: { max: 10 } }] }], result: "0." },
  }, { id: "composite:fixture", title: "Retained batch", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  const run = await rc.run("composite:batch", { documents: ["first", "second"] });
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(requests.length, 1);
  assert.ok(run.steps?.length);
  assert.equal(run.receipt.status, "pending");
  assert.equal(capabilityState(rc, "composite:batch").states.assurance.state, "last-pending");
});

test("saved goal and generated REST preserve pending state without publication or repair", async () => {
  const store = new MemoryStore(); let pending = false; let effects = 0;
  const rc = await RightClick.create({ sandbox: null, directories: [], store, fetch: async () => {
    effects++; return Response.json({ state: pending ? "pending" : "done" }, { status: pending ? 202 : 200 });
  } });
  rc.graph.add(reflectOpenAPI(contract(), "https://jobs.test/spec"));
  const initial = await rc.compose({ have: { document: "first" }, want: "json", through: ["openapi:batch-publisher:publish"],
    run: true, publish: "Document outcome", verify: [{ op: "equals", path: "state", value: "done" }] });
  assert.equal(initial.executed?.status, "completed");
  pending = true;
  const run = await rc.run("goal:document-outcome", { document: "second" });
  assert.equal(run.status, "pending");
  assert.equal(effects, 2);
  const handler = createHandler(rc, { open: true });
  const res = await handler(new Request("http://localhost/x/document-outcome", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ document: "third" }) }));
  assert.equal(res.status, 202);
  const body: any = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "pending");
  assert.equal(body.verification, "unverified");
  assert.equal(effects, 3);
  const gql: any = await executeGraphQL(rc, { query: '{ documentOutcome(document: "fourth") { ok status pending verification } }' });
  assert.equal(gql.data?.documentOutcome.status, "pending");
  assert.equal(gql.data?.documentOutcome.ok, false);
  assert.equal(gql.data?.documentOutcome.verification, "unverified");
  assert.equal(effects, 4);
  assert.ok(introspection(rc).data.__schema.types.find(t => t.name === "DocumentOutcomeResult")?.fields.some((f: any) => f.name === "pending"));
  await rc.flush();
  const fresh = await RightClick.create({ store, sandbox: null, directories: [], fetch: async () => { throw new Error("no automatic replay on restart"); } });
  assert.equal(fresh.chain.receipts.at(-1)?.status, "pending");
  assert.equal(capabilityState(fresh, "goal:document-outcome").states.assurance.state, "last-pending");
  await fresh.flush();
});

test("a pending independent witness neither verifies nor refutes the business outcome", async () => {
  let effects = 0; const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async input => {
    if (String(input).startsWith("https://audit.test")) return Response.json({ valid: true }, { status: 202 });
    effects++; return Response.json({ state: "done" });
  } });
  rc.graph.add(reflectOpenAPI(contract(), "https://jobs.test/spec"));
  const audit = { openapi: "3.0.0", info: { title: "Audit" }, servers: [{ url: "https://audit.test" }],
    paths: { "/read": { get: { operationId: "read", responses: { "200": { content: { "application/json": {
      schema: { type: "object", properties: { valid: { type: "boolean" } } },
    } } } } } } } };
  rc.graph.add(reflectOpenAPI(audit, "https://audit.test/spec"));
  const result = await rc.compose({ have: { document: "report" }, want: "json", through: ["openapi:batch-publisher:publish"],
    run: true, publish: "Observed document", witnesses: [{ capability: "openapi:audit:read", args: {}, verify: [{ op: "equals", path: "valid", value: true }] }] });
  assert.equal(result.executed?.status, "pending");
  assert.equal(result.executed?.verification.status, "unverified");
  assert.equal(result.published, undefined);
  assert.equal(effects, 1);
});

test("a moved read that repairs to HTTP 202 stays pending", async () => {
  let version = 1; const calls: string[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async input => {
    const u = new URL(String(input));
    if (u.pathname === "/openapi.json") return Response.json({ openapi: "3.0.0",
      info: { title: "Moving", version: String(version) }, servers: [{ url: `https://move.test/v${version}` }],
      paths: { "/read": { get: { operationId: "read", responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } } } } } });
    calls.push(u.pathname);
    return new Response(null, { status: u.pathname.startsWith(`/v${version}/`) ? 202 : 404 });
  } });
  await rc.learn({ source: "https://move.test/openapi.json", kinds: { "https://move.test/openapi.json": "openapi" } });
  version = 2;
  const run = await rc.run("openapi:moving:read");
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.deepEqual(calls, ["/v1/read", "/v2/read"]);
});

test("GraphQL HTTP 202 cancels a streaming response without accepting its data", async () => {
  let cancelled = false;
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async () => new Response(
    new ReadableStream({ cancel() { cancelled = true; } }), { status: 202, headers: { "content-type": "application/json" } }) });
  rc.graph.add({ provider: { id: "graphql:q", source: "graphql", title: "Q", origin: "https://q.test", capabilityIds: ["graphql:q:query"], learnedAt: new Date().toISOString() },
    capabilities: [{ id: "graphql:q:query", provider: "graphql:q", source: "graphql", title: "Query", description: "", inputs: [], outputs: [{ name: "", type: "json", required: true }], risk: "read", tags: [],
      invoke: { kind: "graphql", endpoint: "https://q.test", operation: "query", field: "query", args: {}, selection: "" } }] });
  const run = await rc.run("graphql:q:query", {}, { verify: [{ op: "type", value: "object" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.output, undefined);
  assert.equal(cancelled, true);
});
