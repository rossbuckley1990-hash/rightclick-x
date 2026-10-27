// Expected to fail on PR31 b2feaea. A deterministic local barrier forces an
// otherwise ordinary public learn() between witness pinning and invocation.
// No network, model, customer system, or real credentials are used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RightClick } from "../../src/runtime.ts";
import { MemoryStore } from "../../test/helpers.ts";

function spec(path: string) {
  return { openapi: "3.0.0", info: { title: "Observer", version: "1" },
    servers: [{ url: "https://fixture.test" }], paths: { [`/${path}`]: { get: {
      operationId: "check", summary: "Independently compute a digest",
      parameters: [{ name: "text", in: "query", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "ok", content: { "application/json": { schema: {
        type: "object", properties: { hash: { type: "string" } },
      } } } } },
    } } } };
}

const calls: string[] = [];
let changed = false, newer = false;
const fetcher: typeof fetch = async input => {
  const u = new URL(String(input));
  calls.push(u.pathname);
  if (u.pathname === "/openapi.json") return Response.json(spec(newer ? "xmil02" : "msneet"));
  return Response.json({ hash: createHash("sha256").update(u.searchParams.get("text") ?? "").digest("hex") });
};
const rc = await RightClick.create({ directories: [], store: new MemoryStore(), fetch: fetcher });
await rc.learn({ source: "https://fixture.test/openapi.json" });
const witness = rc.graph.list().find(x => x.title === "Independently compute a digest")?.id;
assert.ok(witness, "the original fixture witness must be present");
const made = await rc.compose({ have: { text: "alpha" }, want: "hash", through: ["builtin:text.sha256"], run: true,
  publish: "race", witnesses: [{ capability: witness, args: { text: { input: "text" } }, verify: [], agree: { path: "hash" } }] });
assert.equal(made.executed?.verification.status, "verified");

// Instrument a precise scheduling point; the mutation itself is the public
// learn() method, not a direct mutation of private graph internals.
const runtime = rc as any;
let armed = true;
const originalPreflight = runtime.preflightCli.bind(rc);
runtime.preflightCli = async (cap: unknown, isWitness: boolean) => {
  const result = await originalPreflight(cap, isWitness);
  if (armed && isWitness && new Error().stack?.includes("checkWitnesses")) {
    armed = false;
    newer = true;
    await rc.learn({ source: "https://fixture.test/openapi.json" });
    changed = true;
  }
  return result;
};
calls.length = 0;
let status = "", verification = "", error = "";
try {
  const result = await rc.run("goal:race", { text: "beta" });
  status = result.status;
  verification = result.verification.status;
  error = result.error ?? "";
} catch (e) { status = "refused"; error = String((e as Error).message); }
const bypass = changed && calls.includes("/xmil02") && status === "completed" && verification === "verified";
console.log(JSON.stringify({ changed, status, verification, calls, error,
  disposition: bypass ? "FAIL_SUBSTITUTED_WITNESS_VERIFIED" : "SUBSTITUTION_NOT_VERIFIED" }));
if (bypass) process.exitCode = 1;
