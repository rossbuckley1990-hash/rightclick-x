// Negative control for H2 (issue #38): this file uses ONLY the interfaces that exist on
// main @ 1fcc25a (no client-error imports), so it runs against both implementations.
// On the vulnerable implementation the provider's 500 body — which carries an
// unknown-format credential, a filesystem path and an environment value — is returned
// verbatim to the client, and these assertions FAIL. On the corrected implementation
// they pass. Evidence is preserved in the PR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";
import { handle } from "../src/interface/mcp-server.ts";


const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const op = (operationId: string, param: string) => ({
  get: {
    operationId,
    parameters: [{ name: param, in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
  },
});
const INTERNALS = {
  credential: "qqq-www-eee-master-material-9931",
  path: "/home/rcx/production/state.json",
  env: "RCX_DEPLOY_KEY=zz-77-internal-only",
};
const ORIGIN = "https://leak.test";

async function leakyWorld() {
  let up = true;
  const handler = async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/openapi.json") return json({ openapi: "3.0.0", info: { title: "Leak", version: "1" }, servers: [{ url: ORIGIN }], paths: { "/items/{item}/parts": op("listParts", "item") } });
    if (!up) return json({ ops_note: `master material ${INTERNALS.credential}`, state_file: INTERNALS.path, bootstrap: INTERNALS.env }, 500);
    return json(["bolt"]);
  };
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: handler }), directories: [] });
  await rc.learn({ source: `${ORIGIN}/openapi.json` });
  const id = rc.graph.list().find((c) => c.provider.startsWith("openapi:"))!.id;
  const port = rc.graph.get(id)!.inputs[0].name;
  return { rc, id, port, breakIt: () => (up = false) };
}

test("negative control: a provider 500 body never reaches the client record", async () => {
  const { rc, id, port, breakIt } = await leakyWorld();
  breakIt();
  const reply: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_run", arguments: { id, args: { [port]: "a1" } } } });
  const rec = reply.result.structuredContent;
  const surface = `${rec.error} ${JSON.stringify(rec.healing)}`;
  for (const [name, value] of Object.entries(INTERNALS)) assert.ok(!surface.includes(value), `${name} leaked to the client`);
});

test("negative control: a smuggled bearer never comes back in an echoed error", async () => {
  const { rc } = await leakyWorld();
  const reply: any = await handle(rc, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "context_run", arguments: { id: `Bearer ${INTERNALS.credential}` } } });
  assert.ok(!String(reply.result.content[0].text).includes(INTERNALS.credential), "bearer value leaked");
});
