import test from "node:test";
import assert from "node:assert/strict";
import { publicReadTransport, type Observation } from "../experiments/living/public-read-transport.ts";

const sources = [{ url: "https://example.test/query", kind: "graphql" as const }, { url: "https://other.test/spec", kind: "openapi" as const }];
test("public evaluation transport refuses out-of-scope actions before dispatch", async () => {
  let calls = 0;
  const net = publicReadTransport(sources, () => {}, { spacingMs: 0, fetch: async () => { calls++; return new Response("{}"); } });
  for (const [url, init] of [
    ["https://elsewhere.test/a", {}], ["http://example.test/query", {}], ["https://user:pass@example.test/query", {}],
    ["https://example.test/query", { headers: { authorization: "fake-test-only" } }],
    ["https://example.test/query", { headers: { cookie: "fake-test-only" } }],
    ["https://other.test/spec", { method: "POST", body: "{}" }],
    ["https://example.test/query", { method: "POST", body: '{"query":"mutation { change }"}' }],
    ["https://example.test/query", { method: "POST", body: '{"query":"query { x } mutation { change }"}' }],
    ["https://example.test/query", { method: "POST", body: "invalid JSON" }],
  ] as [string, RequestInit][]) await assert.rejects(net(url, init), /evaluation/);
  assert.equal(calls, 0);
});
test("public evaluation transport records actual reads and leaves redirects to runtime policy", async () => {
  const rows: Observation[] = [];
  const net = publicReadTransport(sources, row => rows.push(row), { spacingMs: 0, fetch: async input => {
    const req = new Request(input);
    assert.equal(req.redirect, "manual"); assert.equal(req.credentials, "omit");
    return new Response("{}", { status: 302, headers: { location: "https://elsewhere.test" } });
  } });
  const r = await net("https://example.test/query", { method: "POST", body: '{"query":"query { value }"}' });
  assert.equal(r.status, 302); assert.equal(await r.text(), "{}");
  await net("https://other.test/spec");
  assert.deepEqual(rows.map(r => r.discovery), [false, true]);
  assert.deepEqual(rows.map(r => r.bytes), [2, 2]);
});
test("public evaluation transport bounds aggregate and per-response bytes", async () => {
  let cancelled = 0;
  const rows: Observation[] = [];
  const net = publicReadTransport(sources, row => rows.push(row), { spacingMs: 0, bodyLimit: 3, totalLimit: 5,
    fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); }, cancel() { cancelled++; } })) });
  await assert.rejects(net("https://other.test/item"), /byte budget/);
  await assert.rejects(net("https://other.test/item"), /byte budget/);
  await assert.rejects(net("https://other.test/item"), /response budget/);
  assert.equal(cancelled, 2); assert.equal(rows.length, 3); assert.ok(rows.every(r => r.error));
});
test("public evaluation transport charges concurrent requests against one budget", async () => {
  let calls = 0;
  const net = publicReadTransport(sources, () => {}, { spacingMs: 0, requestLimit: 2,
    fetch: async () => { calls++; return new Response(null, { status: 204 }); } });
  const results = await Promise.allSettled([net("https://other.test/a"), net("https://other.test/b"), net("https://other.test/c")]);
  assert.equal(calls, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
});
