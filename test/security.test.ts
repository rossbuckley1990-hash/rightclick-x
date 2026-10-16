import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/interface/http.ts";
import { checkUrl, isPrivateAddress } from "../src/reflectors/net.ts";
import { RightClick } from "../src/runtime.ts";

test("private, loopback and metadata addresses are recognized", () => {
  for (const h of ["169.254.169.254", "metadata.google.internal", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "localhost", "foo.internal", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) {
    assert.equal(isPrivateAddress(h), true, h);
  }
  for (const h of ["8.8.8.8", "api.github.com", "172.32.0.1", "2606:4700::1"]) assert.equal(isPrivateAddress(h), false, h);
});

test("network policy blocks SSRF targets, including via redirects, and honors the allowlist", async () => {
  const policy = { blockPrivate: true, allow: ["localhost:9000"] };
  await assert.rejects(checkUrl(policy, "http://169.254.169.254/latest/meta-data/"), /blocked by network policy/);
  await assert.rejects(checkUrl(policy, "file:///etc/passwd"), /blocked by network policy/);
  await checkUrl(policy, "http://localhost:9000/openapi.json");
  await checkUrl(undefined, "http://127.0.0.1:1/");

  const redirecting = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://public.test")) return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
    return new Response("secret");
  }) as typeof fetch;
  const rc = await RightClick.create({ fetch: redirecting, directories: [], network: { blockPrivate: true } });
  const r = await rc.run("builtin:web.fetch", { url: "https://public.test/x" });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /blocked by network policy/);
});

test("HTTP: rate limiting and body size limits", async () => {
  const rc = await RightClick.create({ directories: [] });
  const h = createHandler(rc, { open: true, ratePerMinute: 3, maxBodyBytes: 100 });
  const call = () => h(new Request("https://h.test/api/runtime", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 429);
  const h2 = createHandler(rc, { open: true });
  const big = await h2(new Request("https://h.test/mcp", { method: "POST", body: "x".repeat(2 * 1024 * 1024), headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }));
  assert.equal(big.status, 413);
});

test("credentials stay pinned across multi-hop redirects (A -> B -> C)", async () => {
  const seen: Array<[string, string | null, string | null]> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const h = new Headers(init?.headers);
    seen.push([new URL(url).origin, h.get("authorization"), h.get("x-key")]);
    if (url.startsWith("https://a.test")) return new Response(null, { status: 302, headers: { location: "https://b.test/next" } });
    if (url.startsWith("https://b.test")) return new Response(null, { status: 302, headers: { location: "https://c.test/final" } });
    return new Response("ok");
  }) as typeof fetch;
  const { Authority, request } = await import("../src/reflectors/net.ts");
  const auth = new Authority();
  auth.set("https://a.test", { Authorization: "Bearer secret-a" });
  auth.set("https://b.test", { "X-Key": "key-b" });
  const res = await request({ fetch: f, auth, timeoutMs: 5000 }, "https://a.test/start");
  assert.equal(await res.text(), "ok");
  assert.deepEqual(seen, [
    ["https://a.test", "Bearer secret-a", null],
    ["https://b.test", null, "key-b"],
    ["https://c.test", null, null],
  ]);
});
