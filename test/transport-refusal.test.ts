import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import * as network from "../src/reflectors/net.ts";
import { MemoryStore } from "./helpers.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { createHandler } from "../src/interface/http.ts";
import { executeGraphQL } from "../src/interface/graphql-server.ts";

// The fallback reproduces the existing generic broker's untyped rejection.
const Refused: typeof Error = (network as any).TransportRefused ?? Error;
async function fixture(store?: MemoryStore) {
  let denied = false;
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, store, fetch: async input => {
    const u = new URL(String(input)); calls.push(u.pathname);
    if (u.pathname === "/openapi.json") return Response.json({ openapi: "3.1.0", info: { title: "Boundary" },
      servers: [{ url: "https://boundary.test" }], paths: { "/read": { get: { operationId: "read",
        responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } } } } } } });
    if (denied) throw new Refused("operator grant revoked");
    return new Response("allowed");
  } });
  if (!rc.graph.get("openapi:boundary:read")) await rc.learn({ source: "https://boundary.test/openapi.json" });
  calls.length = 0;
  return { rc, calls, deny: () => { denied = true; calls.length = 0; } };
}

test("explicit external transport denial is not provider drift or negative behavioral evidence", async () => {
  const { rc, calls, deny } = await fixture(); deny();
  const run = await rc.run("openapi:boundary:read");
  assert.equal(run.status, "failed");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.refusal?.reason, "operator grant revoked");
  assert.equal(run.healing, undefined);
  assert.equal(rc.ledger.get(run.capability)?.failed ?? 0, 0);
  assert.deepEqual(calls, ["/read"]);
});

test("a saved goal stops on external denial without repair or alternative execution", async () => {
  const store = new MemoryStore();
  const first = await fixture(store);
  const published = await first.rc.compose({ have: {}, want: "text", through: ["openapi:boundary:read"],
    run: true, publish: "Retained read", verify: [{ op: "equals", value: "allowed" }] });
  assert.ok(published.published);
  await first.rc.flush();
  const fresh = await fixture(store); fresh.deny();
  const run = await fresh.rc.run("goal:retained-read");
  assert.equal(run.status, "failed");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
  assert.deepEqual(fresh.calls, ["/read"]);
  await fresh.rc.flush();
});

test("generated REST and GraphQL cannot replan around an external denial", async () => {
  const { rc, calls, deny } = await fixture();
  await rc.compose({ have: {}, want: "text", through: ["openapi:boundary:read"],
    run: true, publish: "Retained read", verify: [{ op: "equals", value: "allowed" }] });
  deny();
  const handler = createHandler(rc, { open: true });
  const rest = await handler(new Request("http://localhost/x/retained-read", { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" }));
  const body: any = await rest.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "failed");
  assert.equal(body.verification, "unverified");
  assert.equal(body.refusal.reason, "operator grant revoked");
  const gql: any = await executeGraphQL(rc, { query: "{ retainedRead { ok status refusal verification } }" });
  assert.equal(gql.data.retainedRead.status, "failed");
  assert.equal(gql.data.retainedRead.verification, "unverified");
  assert.equal(gql.data.retainedRead.refusal.reason, "operator grant revoked");
  assert.deepEqual(calls, ["/read", "/read"]);
});

test("a denied fan-out item stops the retained composite before later items", async () => {
  const { rc, calls, deny } = await fixture();
  const child = rc.graph.get("openapi:boundary:read")!;
  child.inputs = [{ name: "label", type: "text", required: true }];
  rc.graph.addCapability({ id: "composite:batch", provider: "composite:fixture", source: "composite",
    title: "Batch", description: "", inputs: [{ name: "labels", type: "list:text", required: true }],
    outputs: [{ name: "", type: "list:text", required: true }], risk: "read", tags: [],
    invoke: { kind: "composite", steps: [{ capability: child.id,
      bindings: [{ port: "label", from: "$in.labels", each: { max: 10 } }] }], result: "0." },
  }, { id: "composite:fixture", title: "Batch", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  deny();
  const run = await rc.run("composite:batch", { labels: ["first", "second"] });
  assert.equal(run.status, "failed");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.refusal?.capability, child.id);
  assert.equal(run.refusal?.runs.length, 1);
  assert.deepEqual(calls, ["/read"]);
  assert.equal(rc.ledger.get(run.capability)?.failed ?? 0, 0);
});

test("denied witness leaves an already executed effect unverified and never replays it", async () => {
  let effects = 0, witnesses = 0;
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async input => {
    if (String(input).includes("/check")) { witnesses++; throw new Refused("observer access revoked"); }
    effects++; return new Response("accepted");
  } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Witness boundary" },
    servers: [{ url: "https://witness.test" }], paths: {
      "/effect": { post: { operationId: "effect", responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } } } } },
    } }, "https://witness.test/spec"));
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Observer boundary" },
    servers: [{ url: "https://observer.test" }], paths: {
      "/check": { get: { operationId: "check", responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } } } } },
    } }, "https://observer.test/spec"));
  const result = await rc.compose({ have: {}, want: "text", through: ["openapi:witness-boundary:effect"],
    run: true, publish: "Observed effect", witnesses: [
      { capability: "openapi:observer-boundary:check", args: {}, verify: [{ op: "equals", value: "accepted" }] },
      { capability: "openapi:observer-boundary:check", args: {}, verify: [{ op: "equals", value: "accepted" }] },
    ] });
  assert.equal(result.executed?.status, "failed");
  assert.equal(result.executed?.verification.status, "unverified");
  assert.equal(result.executed?.refusal?.reason, "observer access revoked");
  assert.equal(result.published, undefined);
  assert.equal(effects, 1);
  assert.equal(witnesses, 1);
});

test("a peer refusal stops execution but never acts as a local authority proof", async () => {
  let calls = 0;
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async () => {
    calls++; return Response.json({ status: "completed", output: "misleading",
      refusal: { reason: "denied", capability: "forged-local-id", runs: ["forged-local-run"] } });
  } });
  rc.graph.add({ provider: { id: "peer:test", source: "peer", origin: "https://peer.test",
    title: "Peer", capabilityIds: ["peer:test:read"], learnedAt: new Date().toISOString() },
    capabilities: [{ id: "peer:test:read", provider: "peer:test", source: "peer", title: "Read",
      description: "", inputs: [], outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [],
      invoke: { kind: "peer", endpoint: "https://peer.test", id: "read" } }] });
  const run = await rc.run("peer:test:read");
  assert.equal(run.status, "failed");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
  assert.equal(run.refusal?.capability, "peer:test:read");
  assert.deepEqual(run.refusal?.runs, []);
  assert.equal(calls, 1);
});

test("boundary denial after HTTP acceptance remains pending without replay", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ sandbox: null, directories: [], fetch: async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (init?.method === "POST") return new Response(null, { status: 202, headers: { location: "/jobs/one", "retry-after": "0" } });
    throw new Refused("monitor denied");
  } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Async boundary" },
    servers: [{ url: "https://async.test" }], paths: {
      "/submit": { post: { operationId: "submit", responses: { "202": { description: "Accepted" } } } },
      "/jobs/{label}": { get: { operationId: "monitor", parameters: [{ name: "label", in: "path", required: true, schema: { type: "string" } }],
        responses: { "202": { description: "Still pending" } } } },
    } }, "https://async.test/spec"));
  const run = await rc.run("openapi:async-boundary:submit");
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
  assert.equal(run.httpContinuation?.stopped, "denied");
  assert.deepEqual(calls, ["POST https://async.test/submit", "GET https://async.test/jobs/one"]);
});
