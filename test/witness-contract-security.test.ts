import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RightClick } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { signature } from "../src/core/graph.ts";
import { MemoryStore } from "./helpers.ts";

// These two actual reflected operation contracts collide under the old 32-bit
// FNV signature. They invoke different paths and must never share a proof pin.
function observer(path: string) {
  const spec = { openapi: "3.0.0", info: { title: "Observer", version: "1" },
    servers: [{ url: "https://fixture.test" }], paths: { [`/${path}`]: { get: {
      operationId: "check", summary: "Independently compute a digest",
      parameters: [{ name: "text", in: "query", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "ok", content: { "application/json": { schema: {
        type: "object", properties: { hash: { type: "string" } },
      } } } } },
    } } } };
  return reflectOpenAPI(spec, "https://fixture.test/openapi.json");
}

test("a colliding agreement witness contract cannot replace a retained witness", async () => {
  const one = observer("msneet"), two = observer("xmil02");
  assert.equal(one.capabilities[0].id, two.capabilities[0].id);
  assert.equal(signature(one.capabilities[0]), "a80b7c22");
  assert.equal(signature(one.capabilities[0]), signature(two.capabilities[0]));
  assert.notDeepEqual(one.capabilities[0].invoke, two.capabilities[0].invoke);
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url.pathname);
    return Response.json({ hash: createHash("sha256").update(url.searchParams.get("text") ?? "").digest("hex") });
  };
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, fetch: fetcher });
  rc.graph.add(one);
  const made = await rc.compose({ have: { text: "alpha" }, want: "hash", through: ["builtin:text.sha256"], run: true,
    publish: "test agreement", witnesses: [{ capability: "openapi:observer:check", args: { text: { input: "text" } },
      verify: [], agree: { path: "hash" } }] });
  assert.equal(made.executed?.verification.status, "verified");
  const pin = rc.published.get("test-agreement")?.witnesses?.[0].contract;
  assert.match(pin ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.ok(store.state?.requirements?.includes("witness-contract-sha256@1"));
  rc.graph.add(two);
  calls.length = 0;
  const reused = await rc.run("goal:test-agreement", { text: "beta" });
  assert.notEqual(reused.status, "completed");
  assert.notEqual(reused.verification.status, "verified");
  assert.ok(!calls.includes("/xmil02"), "the substituted witness is refused before execution");
});

test("a persisted legacy FNV witness pin fails closed on fresh reuse", async () => {
  const one = observer("msneet");
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    return Response.json({ hash: createHash("sha256").update(url.searchParams.get("text") ?? "").digest("hex") });
  };
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, fetch: fetcher });
  rc.graph.add(one);
  const made = await rc.compose({ have: { text: "alpha" }, want: "hash", through: ["builtin:text.sha256"], run: true,
    publish: "legacy witness", witnesses: [{ capability: "openapi:observer:check", args: { text: { input: "text" } },
      verify: [], agree: { path: "hash" } }] });
  assert.equal(made.executed?.verification.status, "verified");
  await rc.flush();
  store.state!.published![0].witnesses![0].contract = "a80b7c22";
  const fresh = await RightClick.create({ directories: [], store, fetch: fetcher });
  fresh.graph.add(one);
  const reused = await fresh.run("goal:legacy-witness", { text: "beta" });
  assert.notEqual(reused.status, "completed");
  assert.notEqual(reused.verification.status, "verified");
  assert.match(JSON.stringify(reused), /legacy pin|witness contract changed/);
});
