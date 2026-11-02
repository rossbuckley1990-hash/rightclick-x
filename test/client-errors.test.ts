// H2 (issue #38): the client error boundary. Clients — MCP peers and HTTP callers — are
// untrusted, and raw exception text can carry provider response bodies, filesystem paths,
// environment values or implementation details. Only reviewed codes and messages cross;
// everything else is a stable `internal` code with an opaque reference, and the raw text
// goes to the audit channel under that reference.
//
// Negative control: every "must not appear" assertion below fails against main @ 1fcc25a,
// where the boundary returned String(e.message) verbatim. Run this file against that
// commit to see the leaks it closes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { GraphQLFailure } from "../src/reflectors/graphql.ts";
import { ClientFacingError, toClientError } from "../src/interface/client-error.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { createHandler } from "../src/interface/http.ts";


const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const op = (operationId: string, param: string) => ({
  get: {
    operationId,
    parameters: [{ name: param, in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
  },
});
const contract = (servers: string, paths: Record<string, unknown>) => ({ openapi: "3.0.0", info: { title: "Leak", version: "1" }, servers: [{ url: servers }], paths });

/** Server material that must never reach a client: an unknown-format credential (no
 *  recognizable key name or scheme), an absolute path and an environment value. */
const INTERNALS = {
  credential: "qqq-www-eee-master-material-9931",
  path: "/home/rcx/production/state.json",
  env: "RCX_DEPLOY_KEY=zz-77-internal-only",
};
const leakyBody = () => json({ ops_note: `master material ${INTERNALS.credential}`, state_file: INTERNALS.path, bootstrap: INTERNALS.env }, 500);

const ORIGIN = "https://leak.test";
async function leakyWorld() {
  let up = true;
  const handler = async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/openapi.json") return json(contract(ORIGIN, { "/items/{item}/parts": op("listParts", "item") }));
    if (!up) return leakyBody();
    return json(["bolt"]);
  };
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: handler }), directories: [] });
  await rc.learn({ source: `${ORIGIN}/openapi.json` });
  const id = rc.graph.list().find((c) => c.provider.startsWith("openapi:"))!.id;
  const port = rc.graph.get(id)!.inputs[0].name;
  return { rc, id, port, breakIt: () => (up = false) };
}

const mcpCall = (rc: RightClick, args: Record<string, unknown>) =>
  handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_run", arguments: args } }) as Promise<any>;

test("unit: an unknown credential format, a path and an env value never cross; the ref correlates", () => {
  const view = toClientError(new Error(`boom at ${INTERNALS.path} with ${INTERNALS.credential} (${INTERNALS.env})`));
  assert.equal(view.code, "internal");
  assert.match(view.message, /internal error \(ref /);
  assert.ok(!view.message.includes(INTERNALS.credential), "unknown-format credential leaked");
  assert.ok(!view.message.includes(INTERNALS.path), "filesystem path leaked");
  assert.ok(!view.message.includes(INTERNALS.env), "environment value leaked");
  assert.ok(view.detail.includes(INTERNALS.path), "the diagnostic channel keeps the detail");
});

test("unit: unexpected exceptions (TypeError) and nested objects are internal, not echoed", () => {
  const view = toClientError(new TypeError("Cannot read properties of undefined (reading 'headers')"));
  assert.equal(view.code, "internal");
  assert.ok(!view.message.includes("Cannot read"), "implementation detail leaked");
  const nested = toClientError(new Error(`provider said ${JSON.stringify({ credentials: { token: INTERNALS.credential } })}`));
  assert.equal(nested.code, "internal");
  assert.ok(!nested.message.includes(INTERNALS.credential), "nested credential leaked");
});

test("unit: reviewed errors keep their text and carry their stable code", () => {
  const e = new ClientFacingError("unknown_capability", "unknown capability: goal:nope");
  const view = toClientError(e);
  assert.equal(view.code, "unknown_capability");
  assert.equal(view.message, "unknown capability: goal:nope");
  const graphql = toClientError(new GraphQLFailure({ kind: "execution-errors", reason: "GraphQL execution errors; partial or null data is not a completed outcome: {\"errors\":[{\"message\":\"resolver failed\"}]}", runs: [] }, "GraphQL execution errors; partial or null data is not a completed outcome; the provider's error detail is recorded server-side"));
  assert.equal(graphql.code, "graphql_error");
  assert.ok(!graphql.message.includes("resolver failed"), "the provider's error body leaked through a reviewed class");
});

test("MCP: a provider 500 body never reaches the client, but status and origin do", async () => {
  const { rc, id, port, breakIt } = await leakyWorld();
  breakIt();
  const reply = await mcpCall(rc, { id, args: { [port]: "a1" } });
  // A failed run is reported as a record (isError false): the record's error and healing
  // text are the client-visible surface, and both must be free of provider-body material.
  assert.equal(reply.result.isError, false);
  const rec = reply.result.structuredContent;
  assert.equal(rec.status, "failed");
  const surface = `${rec.error} ${JSON.stringify(rec.healing)}`;
  assert.match(rec.error, /HTTP 500 from https:\/\/leak\.test/);
  for (const [name, value] of Object.entries(INTERNALS)) assert.ok(!surface.includes(value), `${name} leaked to the MCP client`);
});

test("MCP: a thrown validation failure crosses with its stable code and safe text", async () => {
  const { rc } = await leakyWorld();
  const reply = await mcpCall(rc, { id: "goal:nope", args: {} });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /\[rcx:unknown_capability\] unknown capability: goal:nope/);
  const refused = await mcpCall(rc, { id: "goal:nope", args: {}, acknowledgeChange: true });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /\[rcx:invalid_argument\] acknowledgeChange is no longer supported/);
});

test("MCP: the audit channel receives the full detail for a thrown failure", async () => {
  const { rc } = await leakyWorld();
  const audits: any[] = [];
  rc.toolCallSink = (e: unknown) => audits.push(e);
  await mcpCall(rc, { id: `Bearer ${INTERNALS.credential}`, args: {} });
  const failure = audits.find((a) => !a.ok);
  assert.ok(failure, "the failure was audited");
  assert.ok(!String(failure.error).includes(INTERNALS.credential), "the audit redacts the smuggled credential");
  assert.match(String(failure.error), /unknown capability/, "the audit keeps the safe diagnostic");
});

test("MCP: credentials smuggled into caller input are scrubbed from the echoed message", async () => {
  const { rc } = await leakyWorld();
  const bearer = await mcpCall(rc, { id: `Bearer ${INTERNALS.credential}`, args: {} });
  assert.equal(bearer.result.isError, true);
  assert.ok(!bearer.result.content[0].text.includes(INTERNALS.credential), "bearer value leaked");
  assert.match(bearer.result.content[0].text, /\[rcx:unknown_capability\]/);
  const query = await mcpCall(rc, { id: `goal:team?api_key=${INTERNALS.credential}`, args: {} });
  assert.ok(!query.result.content[0].text.includes(INTERNALS.credential), "query credential leaked");
});

test("HTTP: /api/run and /api/<tool> keep records and thrown errors free of provider bodies", async () => {
  const { rc, id, port, breakIt } = await leakyWorld();
  const http = createHandler(rc, { open: true });
  breakIt();
  // A failed run is a 200 with the record; the record's error text is the surface.
  const run = await http(new Request("http://h.test/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, args: { [port]: "a1" } }) }));
  assert.equal(run.status, 200);
  const runBody = await run.json() as { error: string; healing?: { error?: string } };
  const surface = `${runBody.error} ${runBody.healing?.error ?? ""}`;
  assert.match(runBody.error, /HTTP 500 from https:\/\/leak\.test/);
  for (const [name, value] of Object.entries(INTERNALS)) assert.ok(!surface.includes(value), `${name} leaked over HTTP /api/run`);

  // A thrown failure is a 400 with the stable code and safe message.
  const tool = await http(new Request("http://h.test/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "goal:missing" }) }));
  assert.equal(tool.status, 400);
  const toolBody = await tool.json() as { error: string };
  assert.match(toolBody.error, /\[rcx:unknown_capability\] unknown capability: goal:missing/);

  const x = await http(new Request("http://h.test/x/missing-goal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(x.status, 400);
  assert.match(((await x.json()) as { error: string }).error, /\[rcx:unknown_capability\] no published goal: missing-goal/);
});

test("HTTP: a malformed JSON body is a stable invalid_argument, not a parser dump", async () => {
  const { rc } = await leakyWorld();
  const http = createHandler(rc, { open: true });
  const res = await http(new Request("http://h.test/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{\"id\": nope" }));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /\[rcx:invalid_argument\] request body must be valid JSON/);
});

test("known, safe validation failures keep their useful text on both interfaces", async () => {
  const { rc, id, port } = await leakyWorld();
  const overMcp = await mcpCall(rc, { id: "goal:nope", args: {} });
  assert.match(overMcp.result.content[0].text, /\[rcx:unknown_capability\] unknown capability: goal:nope/);
  const http = createHandler(rc, { open: true });
  const overHttp = await http(new Request("http://h.test/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, args: { [`${port}-typo`]: "a1" } }) }));
  const body = await overHttp.json() as { error: string };
  // A missing required input is reported in the failed run record: useful text, no raw dump.
  assert.match(body.error, new RegExp(`missing required input\\(s\\): ${port}`), body.error);
});

test("successful responses are unchanged by the boundary", async () => {
  const { rc, id, port } = await leakyWorld();
  const reply = await mcpCall(rc, { id, args: { [port]: "a1" } });
  assert.equal(reply.result.isError, false);
  assert.deepEqual(reply.result.structuredContent.output, ["bolt"]);
  const http = createHandler(rc, { open: true });
  const res = await http(new Request("http://h.test/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, args: { [port]: "a1" } }) }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).output, ["bolt"]);
});
