import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { handle } from "../src/interface/mcp-server.ts";
import { createHandler } from "../src/interface/http.ts";
import type { Capability } from "../src/core/types.ts";
import { MemoryStore } from "./helpers.ts";

const origin = "https://meaning.test";
const source = `${origin}/openapi.json`;
const responses = { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } };

async function fixture(deny = false) {
  let path = "/old";
  let operationId = "readValue";
  const calls: string[] = [];
  const store = new MemoryStore();
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/openapi.json") return Response.json({ openapi: "3.0.0", info: { title: "Meaning fixture", version: "1" }, servers: [{ url: origin }], paths: {
      [path]: { get: { operationId, summary: "Read value", responses } },
      "/before": { post: { operationId: "writeBefore", responses } },
    } });
    calls.push(`${request.method} ${url.pathname}`);
    return new Response(url.pathname, { headers: { "content-type": "text/plain" } });
  };
  const rc = await RightClick.create({ directories: [], fetch, store, authority: deny ? { execution: { allowedRisks: [] } } : undefined });
  await rc.learn({ source });
  const cap = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "GET")!;
  const write = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST")!;
  const change = async () => { path = "/changed"; await rc.learn({ source }); assert.ok(rc.meaningChanges.has(cap.id)); };
  const release = async (next: string, id = "readValue") => { path = next; operationId = id; return rc.learn({ source }); };
  return { rc, cap, write, calls, store, fetch, change, release };
}

for (const route of ["acknowledged", "planned", "mcp", "http", "compose", "composite"] as const) {
  test(`changed meaning cannot be self-authorised through ${route}`, async () => {
    const { rc, cap, write, calls, change } = await fixture();
    await change();
    if (route === "acknowledged" || route === "planned") {
      const result = await rc.run(cap.id, {}, route === "acknowledged" ? { acknowledgeChange: true } : { planned: true });
      assert.equal(result.status, "failed");
      assert.match(result.error!, /changed meaning/);
    } else if (route === "mcp") {
      const result: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_run", arguments: { id: cap.id, acknowledgeChange: true } } });
      assert.ok(result.result.isError || result.result.structuredContent.status === "failed");
    } else if (route === "http") {
      const handler = createHandler(rc, { open: true });
      await handler(new Request("http://localhost/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cap.id, acknowledgeChange: true }) }));
    } else if (route === "compose") {
      const result = await rc.compose({ have: {}, want: "text", through: [cap.id], run: true, crystallize: false });
      assert.notEqual(result.executed?.status, "completed");
    } else {
      const composite: Capability = { ...cap, id: "fixture:changed-composite", provider: "fixture", source: "composite",
        invoke: { kind: "composite", steps: [{ capability: write.id, bindings: [] }, { capability: cap.id, bindings: [] }], result: "1." } };
      rc.graph.addCapability(composite, { id: "fixture", title: "Fixture", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
      const result = await rc.run(composite.id);
      assert.equal(result.status, "failed");
    }
    assert.deepEqual(calls, [], "neither the changed operation nor an earlier composite effect may dispatch");
    assert.ok(rc.meaningChanges.has(cap.id), "caller input must not clear the retained warning");
  });
}

test("policy-denied acknowledgement cannot erase the warning before persistence", async () => {
  const { rc, cap, calls, change, store, fetch } = await fixture(true);
  await change();
  const before = structuredClone(rc.meaningChanges.get(cap.id));
  assert.equal((await rc.run(cap.id, {}, { acknowledgeChange: true })).status, "failed");
  assert.deepEqual(rc.meaningChanges.get(cap.id), before);
  await rc.flush();
  const restarted = await RightClick.create({ directories: [], fetch, store });
  assert.deepEqual(restarted.meaningChanges.get(cap.id), before);
  assert.equal((await restarted.run(cap.id)).status, "failed");
  assert.deepEqual(calls, []);
});

test("a changed leaf is disclosed as unavailable without changing operator policy", async () => {
  const { rc, cap, change } = await fixture();
  await change();
  const full = rc.explain(cap.id);
  assert.equal(full.execution.allowed, false);
  assert.match(full.execution.reasons.join("; "), /changed meaning/);
  assert.deepEqual(rc.auditExecution().policy, {});
});

test("a newly discovered operation has a stable separate identity and no inherited execution experience", async () => {
  const { rc, cap, calls, change, store, fetch, release } = await fixture();
  assert.equal((await rc.run(cap.id)).status, "completed");
  await change();
  const current = rc.meaningChanges.get(cap.id)!.current!;
  assert.ok(current && current !== cap.id);
  assert.equal(rc.ledger.get(current), undefined);
  assert.equal(rc.explain(current).execution.allowed, true, "this fixture has no authority restriction; discovery is not proof of authority");
  assert.equal((await rc.run(current)).output, "/changed");
  await rc.flush();
  const restarted = await RightClick.create({ directories: [], fetch, store });
  await restarted.learn({ source });
  assert.equal(restarted.meaningChanges.get(cap.id)?.current, current);
  assert.equal((await restarted.run(cap.id, {}, { acknowledgeChange: true })).status, "failed");
  assert.equal((await restarted.run(current)).output, "/changed");
  assert.deepEqual(calls, ["GET /old", "GET /changed", "GET /changed"]);
  // A further incompatible release must not reuse either prior operation identity.
  await release("/third");
  assert.notEqual(rc.meaningChanges.get(cap.id)?.current, current);
  assert.equal(rc.graph.get(current), undefined);
});

test("new operation identities still obey operator execution restrictions", async () => {
  const { rc, cap, calls, change } = await fixture(true);
  await change();
  const current = rc.meaningChanges.get(cap.id)!.current!;
  assert.ok(current);
  assert.equal((await rc.run(current)).status, "failed");
  assert.deepEqual(calls, []);
});

test("an exact capability allowlist does not transfer to its newly discovered replacement", async () => {
  const { rc, cap, calls, change, store, fetch } = await fixture();
  await change();
  await rc.flush();
  const current = rc.meaningChanges.get(cap.id)!.current!;
  const oldApproval = await RightClick.create({ directories: [], fetch, store, authority: { execution: { allowedCapabilities: [cap.id] } } });
  assert.equal((await oldApproval.run(current)).status, "failed");
  assert.deepEqual(calls, []);
  const freshApproval = await RightClick.create({ directories: [], fetch, store, authority: { execution: { allowedCapabilities: [current] } } });
  assert.equal((await freshApproval.run(current)).status, "completed");
  assert.equal((await freshApproval.run(cap.id, {}, { acknowledgeChange: true })).status, "failed");
  assert.deepEqual(calls, ["GET /changed"]);
});

test("unchanged rereads keep a new operation's proven composition available", async () => {
  const { rc, cap, change, store, fetch } = await fixture();
  await change();
  const current = rc.meaningChanges.get(cap.id)!.current!;
  const composed = await rc.compose({ have: {}, want: "hash", through: [current, "builtin:text.sha256"], run: true, publish: "Current fingerprint" });
  assert.ok(composed.crystallized);
  assert.ok(composed.published);
  await rc.learn({ source });
  assert.ok(rc.graph.get(composed.crystallized.id), "unchanged revalidation does not retire its existing composition");
  await rc.flush();
  const restarted = await RightClick.create({ directories: [], fetch, store });
  await restarted.learn({ source });
  const result = await restarted.run(composed.published.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.output, composed.executed?.output);
});

test("missing saved ids cannot fall back to the same title and ports after their operation changes", async () => {
  const { rc, cap, calls, release } = await fixture();
  const composed = await rc.compose({ have: {}, want: "text", through: [cap.id], run: true, publish: "Retained read" });
  assert.ok(composed.published);
  await release("/old", "renamedValue");
  assert.equal(rc.graph.get(cap.id), undefined);
  assert.equal((await rc.run(composed.published.id)).output, "/old", "a renamed equivalent operation still works");
  const before = [...calls];
  await release("/changed", "renamedValue");
  const refused = await rc.run(composed.published.id);
  assert.equal(refused.status, "failed");
  assert.match(refused.error!, /required anchor contract changed meaning/);
  assert.deepEqual(calls, before, "no request is sent to the same-title different operation");
});
