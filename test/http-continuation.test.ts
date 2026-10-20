import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick, type RuntimeOptions } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { MemoryStore } from "./helpers.ts";
import { Authority } from "../src/reflectors/net.ts";
import type { TransportContext } from "../src/core/types.ts";

const origin = "https://batch.test";
function specification(family = "Archive") {
  const result = { "200": { content: { "application/json": { schema: {
    type: "object", required: ["document"], properties: { document: { type: "string" } },
  } } } } };
  return { openapi: "3.1.0", info: { title: family }, servers: [{ url: origin }], paths: {
    "/submit": { post: { operationId: "submit", requestBody: { content: { "application/json": { schema: {
      type: "object", required: ["document"], properties: { document: { type: "string" } },
    } } } }, responses: { ...result, "202": { description: "Accepted" } } } },
    "/progress/{ticket}": { get: { operationId: "progress", parameters: [{ name: "ticket", in: "path", required: true, schema: { type: "string" } }], responses: { "202": { description: "Still working" }, "303": { description: "See result" } } } },
    "/result/{ticket}": { get: { operationId: "result", parameters: [{ name: "ticket", in: "path", required: true, schema: { type: "string" } }], responses: result } },
  } };
}

async function world(options: RuntimeOptions = {}, responder?: (url: URL, n: number, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ method: string; path: string; context?: TransportContext }> = []; let document = ""; let polls = 0;
  const rc = await RightClick.create({ sandbox: null, directories: [], ...options, fetch: async (input, init, context) => {
    const u = new URL(String(input)); calls.push({ method: init?.method ?? "GET", path: u.pathname, context });
    if (u.pathname === "/submit") {
      document = JSON.parse(String(init?.body)).document;
      return new Response(null, { status: 202, headers: { location: "/progress/t-1", "retry-after": "0" } });
    }
    if (responder) return responder(u, ++polls, init);
    if (u.pathname === "/progress/t-1") return new Response(null, { status: ++polls < 2 ? 202 : 303,
      headers: { ...(polls < 2 ? {} : { location: "/result/t-1" }), "retry-after": "0" } });
    return Response.json({ document: document.toUpperCase() });
  } });
  if (!rc.graph.get("openapi:archive:submit")) rc.graph.add(reflectOpenAPI(specification(), `${origin}/openapi.json`));
  return { rc, calls };
}

test("known GET resources carry a bounded 202 -> 202 -> 303 -> result execution", async () => {
  const { rc, calls } = await world();
  const run = await rc.run("openapi:archive:submit", { document: "alpha" }, { verify: [{ op: "equals", path: "document", value: "ALPHA" }] });
  assert.equal(run.status, "completed");
  assert.equal(run.verification.status, "checked");
  assert.deepEqual(run.output, { document: "ALPHA" });
  assert.deepEqual(calls.map(c => c.method), ["POST", "GET", "GET", "GET"]);
  assert.equal(run.httpContinuation?.stopped, "result");
  assert.equal(run.httpContinuation?.requests.length, 3);
  assert.ok(calls.every(c => c.context?.runId === run.runId && c.context?.runtimeId === rc.activity.epoch &&
    c.context.capabilityId === "openapi:archive:submit"));
  assert.equal(new Set(calls.map(c => c.context?.requestId)).size, 4);
  assert.deepEqual(run.receipt.httpContinuation, run.httpContinuation);
  assert.equal((await rc.verifyReceipts()).intact, true);
});

test("a 200 status document is unresolved, even when a weak object predicate passes", async () => {
  const { rc, calls } = await world({}, () => Response.json({ state: "working" }));
  const run = await rc.run("openapi:archive:submit", { document: "alpha" }, { verify: [{ op: "type", value: "object" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(run.output, undefined);
  assert.equal(calls.length, 2);
});

test("a retained asynchronous goal uses new inputs after restart without rediscovery", async () => {
  const store = new MemoryStore(); const first = await world({ store });
  const outcome = await first.rc.compose({ have: { document: "alpha" }, want: "json", through: ["openapi:archive:submit"],
    run: true, publish: "Archive result", verify: [{ op: "type", path: "document", value: "string" }] });
  assert.equal(outcome.executed?.status, "completed");
  assert.ok(outcome.published);
  await first.rc.flush();
  const fresh = await world({ store });
  const run = await fresh.rc.run("goal:archive-result", { document: "beta" });
  assert.equal(run.status, "completed");
  assert.deepEqual(run.output, { document: "BETA" });
  assert.equal(fresh.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await fresh.rc.verifyReceipts()).intact, true);
  await fresh.rc.flush();
});

test("denial of a monitor or result is enforced at that exact follow-up", async () => {
  for (const [id, expected] of [["progress", 1], ["result", 3]] as const) {
    const { rc, calls } = await world({ authority: { execution: { deniedCapabilities: [`openapi:archive:${id}`] } } });
    const run = await rc.run("openapi:archive:submit", { document: "alpha" });
    assert.equal(run.status, "pending");
    assert.equal(run.httpContinuation?.stopped, "denied");
    assert.equal(calls.length, expected);
    assert.equal(calls.filter(c => c.method === "POST").length, 1);
  }
});

test("unknown, credential-bearing, cross-origin, ambiguous and unsafe targets are not contacted", async () => {
  for (const location of ["/absent/t-1", "https://other.test/result/t-1", "http://169.254.169.254/latest",
    "https://user:secret@batch.test/result/t-1", "/result/t-1#fragment", "/result/t-1?token=secret",
    "/result/t-1?unknown=value", "/result/t-1%2Fother", "file:///tmp/result"]) {
    const { rc, calls } = await world({}, () => new Response(null, { status: 303, headers: { location, "retry-after": "0" } }));
    const run = await rc.run("openapi:archive:submit", { document: "alpha" });
    assert.equal(run.status, "pending", location);
    assert.equal(run.httpContinuation?.stopped, "unknown-target", location);
    assert.equal(calls.length, 2, location);
    assert.equal(JSON.stringify(run.httpContinuation).includes("secret"), false);
  }
  for (const variant of ["ambiguous", "write"] as const) {
    const { rc, calls } = await world();
    const c = rc.graph.get("openapi:archive:progress")!;
    const provider = rc.graph.providers.get(c.provider)!;
    if (variant === "ambiguous") rc.graph.addCapability({ ...c, id: `${c.id}:duplicate` }, provider);
    else rc.graph.addCapability({ ...c, risk: "write" }, provider);
    const run = await rc.run("openapi:archive:submit", { document: "alpha" });
    assert.equal(run.status, "pending");
    assert.equal(calls.length, 1);
  }
});

test("contract change during polling refuses the successor without rediscovery or write replay", async () => {
  const { rc, calls } = await world({}, () => {
    const result = rc.graph.get("openapi:archive:result")!;
    rc.graph.addCapability({ ...result, invoke: { ...result.invoke as any, url: `${origin}/changed/{ticket}` } }, rc.graph.providers.get(result.provider)!);
    return new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } });
  });
  const run = await rc.run("openapi:archive:submit", { document: "alpha" });
  assert.equal(run.status, "pending");
  assert.equal(run.httpContinuation?.stopped, "changed-contract");
  assert.equal(calls.length, 2);
});

test("request budget, Retry-After and unsupported statuses stop without replay or negotiation retry", async () => {
  const cases = [
    { response: () => new Response(null, { status: 202, headers: { "retry-after": "0" } }), reason: "budget", calls: 3 },
    { response: () => new Response(null, { status: 202, headers: { "retry-after": "3600" } }), reason: "budget", calls: 2 },
    { response: () => new Response(null, { status: 202, headers: { "retry-after": "invalid" } }), reason: "budget", calls: 2 },
    { response: () => new Response(null, { status: 202, headers: { "retry-after": "0.5" } }), reason: "budget", calls: 2 },
    { response: () => new Response(null, { status: 202, headers: { "retry-after": new Date(Date.now() + 120_000).toUTCString() } }), reason: "budget", calls: 2 },
    { response: () => new Response(null, { status: 202, headers: { "retry-after": "Sun, 06 Nov 1994 08:49:37 GMT" } }), reason: "budget", calls: 3 },
    { response: () => new Response(null, { status: 302, headers: { location: "/result/t-1" } }), reason: "unsupported-status", calls: 2 },
    { response: () => new Response(null, { status: 500 }), reason: "unavailable", calls: 2 },
    { response: () => new Response(null, { status: 403 }), reason: "denied", calls: 2 },
    { response: () => new Response(null, { status: 429 }), reason: "rate-limited", calls: 2 },
  ];
  for (const c of cases) {
    const { rc, calls } = await world({ httpContinuation: { maxRequests: 2 } }, c.response);
    const run = await rc.run("openapi:archive:submit", { document: "alpha" });
    assert.equal(run.status, "pending");
    assert.equal(run.httpContinuation?.stopped, c.reason);
    assert.equal(calls.length, c.calls);
    assert.equal(calls.filter(c => c.method === "POST").length, 1);
  }
});

test("cancellation after acceptance and a hanging terminal body remain unresolved", async () => {
  const abort = new AbortController();
  const cancelled = await world({}, () => {
    abort.abort();
    return new Response(null, { status: 202 });
  });
  const r = await cancelled.rc.run("openapi:archive:submit", { document: "alpha" }, { signal: abort.signal });
  assert.equal(r.status, "pending");
  assert.equal(r.httpContinuation?.stopped, "cancelled");
  assert.equal(cancelled.calls.length, 2);
  let disposed = false;
  const hanging = await world({ httpContinuation: { timeoutMs: 100 } }, url => url.pathname.startsWith("/progress/")
    ? new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } })
    : new Response(new ReadableStream({ cancel() { disposed = true; } }), { status: 200 }));
  const start = performance.now();
  const h = await hanging.rc.run("openapi:archive:submit", { document: "alpha" });
  assert.equal(h.status, "pending");
  assert.equal(h.httpContinuation?.stopped, "unavailable");
  assert.equal(disposed, true);
  assert.ok(performance.now() - start < 2000);
  assert.equal(hanging.calls.length, 3);
});

test("host can disable continuation and invalid budgets fail before any dispatch", async () => {
  const { rc, calls } = await world({ httpContinuation: false });
  assert.equal((await rc.run("openapi:archive:submit", { document: "alpha" })).status, "pending");
  assert.equal(calls.length, 1);
  for (const opts of [{ maxRequests: 9 }, { timeoutMs: 30_001 }, { maxRequests: 0 }, { timeoutMs: NaN }]) {
    await assert.rejects(RightClick.create({ httpContinuation: opts }), /invalid HTTP continuation budget/);
  }
});

test("risk escalation during polling and revoked network policy cannot bypass follow-up checks", async () => {
  const changed = await world({}, () => {
    const c = changed.rc.graph.get("openapi:archive:result")!;
    changed.rc.graph.addCapability({ ...c, risk: "destructive" }, changed.rc.graph.providers.get(c.provider)!);
    return new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } });
  });
  const r = await changed.rc.run("openapi:archive:submit", { document: "alpha" });
  assert.equal(r.status, "pending");
  assert.equal(r.httpContinuation?.stopped, "changed-contract");
  assert.equal(changed.calls.length, 2);

  const network = { blockPrivate: false, deny: [] as string[] };
  const revoked = await world({ network }, () => {
    network.deny.push("batch.test");
    return new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } });
  });
  const n = await revoked.rc.run("openapi:archive:submit", { document: "alpha" });
  assert.equal(n.status, "pending");
  assert.equal(n.httpContinuation?.stopped, "denied");
  assert.equal(revoked.calls.length, 2);
});

test("follow-ups use origin-pinned credentials and never the original action's headers", async () => {
  const auth = new Authority(); auth.set(origin, { Authorization: "Bearer pinned-fixture" });
  const headers: Headers[] = [];
  const { rc } = await world({ auth }, (u, n, init) => {
    headers.push(new Headers(init?.headers));
    return u.pathname.startsWith("/progress/")
      ? new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } })
      : Response.json({ document: "ALPHA" });
  });
  const cap = rc.graph.get("openapi:archive:submit")!;
  rc.graph.addCapability({ ...cap, invoke: { ...cap.invoke as any, headerParams: ["X-Caller-Key"] } }, rc.graph.providers.get(cap.provider)!);
  const run = await rc.run(cap.id, { document: "alpha", "X-Caller-Key": "fixture-caller-secret" });
  assert.equal(run.status, "completed");
  assert.equal(headers.length, 2);
  for (const h of headers) {
    assert.equal(h.get("authorization"), "Bearer pinned-fixture");
    assert.equal(h.get("x-caller-key"), null);
  }
  assert.doesNotMatch(JSON.stringify(run.httpContinuation), /fixture-caller-secret|pinned-fixture/);
});

test("an oversized result cannot exhaust the continuation body budget or produce checked output", async () => {
  let disposed = false;
  const { rc, calls } = await world({}, url => url.pathname.startsWith("/progress/")
    ? new Response(null, { status: 303, headers: { location: "/result/t-1", "retry-after": "0" } })
    : new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { disposed = true; } }), { status: 200 }));
  const run = await rc.run("openapi:archive:submit", { document: "alpha" }, { verify: [{ op: "type", value: "object" }] });
  assert.equal(run.status, "pending");
  assert.equal(run.verification.status, "unverified");
  assert.equal(disposed, true);
  assert.equal(calls.length, 3);
});

test("unrelated rendering routes and URI-encoded identifiers use the same protocol mechanism", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ directories: [], sandbox: null, fetch: async input => {
    const path = new URL(String(input)).pathname; calls.push(path);
    if (path === "/render") return new Response(null, { status: 202, headers: { location: "/queue/a%20b", "retry-after": "0" } });
    if (path === "/queue/a%20b") return new Response(null, { status: 303, headers: { location: "/artifact/a%20b", "retry-after": "0" } });
    return new Response("<svg><text>Rendered</text></svg>", { headers: { "content-type": "image/svg+xml" } });
  } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Rendering" }, servers: [{ url: "https://render.test" }], paths: {
    "/render": { post: { operationId: "render", responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } }, "202": { description: "Queued" } } } },
    "/queue/{key}": { get: { operationId: "queue", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { "303": { description: "See other" } } } },
    "/artifact/{name}": { get: { operationId: "artifact", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Artifact" } } } },
  } }, "https://render.test/openapi.json"));
  const run = await rc.run("openapi:rendering:render", {}, { verify: [{ op: "contains", value: "<svg>" }] });
  assert.equal(run.status, "completed");
  assert.equal(run.verification.status, "checked");
  assert.deepEqual(calls, ["/render", "/queue/a%20b", "/artifact/a%20b"]);
});
