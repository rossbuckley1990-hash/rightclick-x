// M2 (issue #38): rate-limit identities and body caps.
//
// The previous proposal derived the bucket key from the Authorization header BEFORE
// verifying the credential: rotating arbitrary invalid bearer tokens bought a fresh
// bucket each time, and cf-connecting-ip was trusted unconditionally (a direct-to-origin
// attacker sets it like any header). The tests below attack exactly those properties on
// the real handler. The negative control for the vulnerable behaviour is the token-
// rotation test: on the proposal, rotating ten distinct invalid bearers yields ten
// fresh buckets and no 429; here it must not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, normalizeAddress, RateLimiter, REMOTE_ADDRESS } from "../src/interface/http.ts";
import { serve } from "../src/entry/node-host.ts";
import { world } from "./helpers.ts";

type Handler = ReturnType<typeof createHandler>;

const post = (http: Handler, path: string, body: BodyInit, headers: Record<string, string> = {}, remote?: string) => {
  const req = new Request(`http://h.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  if (remote) (req as unknown as Record<symbol, unknown>)[REMOTE_ADDRESS] = remote;
  return http(req).then((r) => r.status);
};

test("rotating arbitrary invalid bearer tokens buys no new buckets (the identity bypass)", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 3 });
  // Ten distinct invented credentials, one shared origin: all draw from the same
  // pre-authentication bucket. On the vulnerable proposal each `Bearer junk-N` was its
  // own bucket and none of these would ever be limited.
  for (let i = 0; i < 3; i++) {
    assert.equal(await post(http, "/api/run", "{}", { authorization: `Bearer junk-${i}` }), 401, `attempt ${i}: unauthenticated`);
  }
  assert.equal(await post(http, "/api/run", "{}", { authorization: "Bearer completely-different-rotated-token" }), 429,
    "a rotated invalid credential must not buy a fresh bucket");
  assert.equal(await post(http, "/api/run", "{}", { authorization: "Basic yet-another-scheme-99" }), 429);
});

test("spoofed x-forwarded-for and cf-connecting-ip never select a bucket without trust", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2 });
  // No host-provided address: every unauthenticated request shares one global bucket,
  // whatever headers it invents.
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "3.3.3.3" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "2.2.2.2, 9.9.9.9", "cf-connecting-ip": "7.7.7.7" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "4.4.4.4", "cf-connecting-ip": "5.5.5.5" }), 429,
    "client-supplied proxy headers are not bucket keys in a direct-to-origin deployment");
});

test("behind a trusted proxy, only the proxy-appended address is the key", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2, trustProxyHeaders: true });
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "spoofed-client, 10.0.0.1" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "spoofed-client-2, 10.0.0.1" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "spoofed-client, 10.0.0.1" }), 429,
    "same real client 10.0.0.1 is out of tokens; a spoofed prefix changes nothing");
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "spoofed-client, 10.0.0.2" }), 401,
    "a different real client is unaffected");
  // cf-connecting-ip is honored behind the trusted proxy and not spoofable by an xff prefix.
  assert.equal(await post(http, "/api/run", "{}", { "cf-connecting-ip": "10.0.0.3", "x-forwarded-for": "spoofed, 10.0.0.99" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "cf-connecting-ip": "10.0.0.3" }), 401);
  assert.equal(await post(http, "/api/run", "{}", { "cf-connecting-ip": "10.0.0.3" }), 429, "cf client 10.0.0.3 exhausted");
});

test("the connection's real address is the pre-authentication key, remote from headers", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2 });
  // Same socket address, ever-changing spoofed headers: one bucket.
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "1.1.1.1" }, "203.0.113.7"), 401);
  assert.equal(await post(http, "/api/run", "{}", { "cf-connecting-ip": "2.2.2.2" }, "203.0.113.7"), 401);
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.7"), 429, "the socket address is out of budget");
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.8"), 401, "a different address is unaffected");
});

test("IPv4-mapped IPv6, bracketed forms and zones collapse to one bucket", async () => {
  assert.equal(normalizeAddress("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeAddress("203.0.113.7:443"), "203.0.113.7");
  assert.equal(normalizeAddress("[2001:DB8::1]:8787"), "2001:db8::1");
  assert.equal(normalizeAddress("FE80::1%eth0"), "fe80::1");
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2 });
  assert.equal(await post(http, "/api/run", "{}", {}, "::ffff:203.0.113.9"), 401);
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.9"), 401);
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.9:51234"), 429,
    "the mapped v6 form and the plain v4 form are the same caller");
});

test("a verified credential keeps its throughput while the failure bucket is exhausted", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2 });
  // Exhaust the shared pre-authentication bucket with garbage.
  await post(http, "/api/run", "{}", { authorization: "Bearer junk-1" }, "198.51.100.1");
  await post(http, "/api/run", "{}", { authorization: "Bearer junk-2" }, "198.51.100.1");
  assert.equal(await post(http, "/api/run", "{}", { authorization: "Bearer junk-3" }, "198.51.100.1"), 429);
  // The legitimate caller from the same address is not touched: identity is established
  // first and draws from the verified principal's own budget (2/min here).
  for (let i = 0; i < 2; i++) {
    assert.equal(await post(http, "/api/run", JSON.stringify({ id: `goal:none-${i}` }), { authorization: "Bearer sekrit" }, "198.51.100.1"), 400,
      "authenticated requests keep flowing (unknown capability is a 400, not 429)");
  }
  // The principal's own budget is real: exhausting it limits the verified caller too.
  assert.equal(await post(http, "/api/run", "{}", { authorization: "Bearer sekrit" }, "198.51.100.1"), 429,
    "the verified principal's own bucket applies");
});

test("rate-limit state stays bounded under key spray", () => {
  const limiter = new RateLimiter(600, 4096);
  for (let i = 0; i < 50_000; i++) limiter.take(`spray-${i}`);
  assert.ok(limiter.tracked() <= 4096, `bucket store grew past its bound: ${limiter.tracked()}`);
  // Usage-order eviction: the hottest key survives the spray.
  const hot = "hot-key";
  for (let i = 0; i < 10; i++) limiter.take(hot);
  for (let i = 0; i < 50_000; i++) limiter.take(`spray2-${i}`);
  assert.equal(limiter.take(hot), true, "a recently used bucket must not have been evicted");
});

test("the body cap is enforced on the actual byte stream, with or without content-length", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { open: true, maxBodyBytes: 100 });
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(300)));
      c.close();
    },
  });
  const res = await http(new Request("http://h.test/api/run", {
    method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half",
  } as RequestInit));
  assert.equal(res.status, 413);
  const honest = await post(http, "/api/run", JSON.stringify({ id: "x".repeat(200) }));
  assert.equal(honest, 413, "an honest oversized content-length is refused before the body is read");
  const within = await post(http, "/api/run", JSON.stringify({ id: "goal:within-cap" }));
  assert.equal(within, 400, "bodies within the cap still reach the route (unknown capability)");
});

test("open deployments limit on the connection's address", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { open: true, ratePerMinute: 2 });
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.20"), 400);
  assert.equal(await post(http, "/api/run", "{}", { "x-forwarded-for": "1.2.3.4" }, "203.0.113.20"), 400);
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.20"), 429, "the address bucket is exhausted");
  assert.equal(await post(http, "/api/run", "{}", {}, "203.0.113.21"), 400, "another address is unaffected");
});

test("real server: a socket-address-keyed limit and a byte-true cap through node:http", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 2, maxBodyBytes: 100 });
  const served = await serve(http, 0, "127.0.0.1");
  try {
    // Invalid bearer rotation over a real socket: one address, one bucket.
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${served.url}/api/run`, { method: "POST", headers: { authorization: `Bearer real-socket-junk-${i}`, "content-type": "application/json" }, body: "{}" });
      assert.equal(r.status, 401);
    }
    const limited = await fetch(`${served.url}/api/run`, { method: "POST", headers: { authorization: "Bearer rotated-again-different", "content-type": "application/json" }, body: "{}" });
    assert.equal(limited.status, 429, "rotating invalid credentials over a real socket buys nothing");
    // The byte-true cap over a real chunked request (no content-length).
    const chunked = await fetch(`${served.url}/api/run`, {
      method: "POST", headers: { authorization: "Bearer sekrit", "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("y".repeat(400))); c.close(); } }),
      duplex: "half",
    } as RequestInit);
    assert.equal(chunked.status, 413);
    // A legitimate request through the same server still works.
    const ok = await fetch(`${served.url}/health`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally {
    await served.close();
  }
});
