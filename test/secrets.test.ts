// Direct coverage for core/secrets.ts (previously none). The fail-open regression: redaction
// used to return values unread once nesting passed the depth cap (finding H1, issue #38).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveName, redact, redactText, scrub, sensitiveValues, REDACTED, MAX_REDACTION_DEPTH } from "../src/core/secrets.ts";

test("credential names are recognised, ordinary names are not", () => {
  for (const name of [
    "authorization", "Authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api_key", "apiKey",
    "access-key", "accessKey", "client_secret", "refresh_token", "password", "passwd", "passphrase", "credential",
    "session_id", "session-token", "private_key", "bearer", "x-signature",
  ]) {
    assert.ok(isSensitiveName(name), `expected sensitive: ${name}`);
  }
  for (const name of ["tolerance", "passenger", "catalog", "results", "history"]) {
    assert.ok(!isSensitiveName(name), `expected ordinary: ${name}`);
  }
});

test("redact replaces credential-named values and keeps ordinary ones", () => {
  const out = redact({
    authorization: "Bearer abc",
    nested: { password: "hunter2", keep: "value" },
    "x-api-key": "k1",
    list: [{ token: "t0" }, { note: "n0" }],
  });
  assert.deepEqual(out, {
    authorization: REDACTED,
    nested: { password: REDACTED, keep: "value" },
    "x-api-key": REDACTED,
    list: [{ token: REDACTED }, { note: "n0" }],
  });
});

test("redact returns a copy; the input keeps its credentials", () => {
  const input = { password: "hunter2", inner: { session_id: "s-1" } };
  const out = redact(input);
  assert.equal(input.password, "hunter2");
  assert.equal(input.inner.session_id, "s-1");
  assert.equal((out as typeof input).password, REDACTED);
  assert.equal((out as typeof input).inner.session_id, REDACTED);
});

test("a credential-named key with an object value fails closed: its contents are redacted too", () => {
  const out = redact({ authorization: { scheme: "Bearer", value: "abc.def" } }) as { authorization: Record<string, string> };
  assert.equal(out.authorization.scheme, REDACTED);
  assert.equal(out.authorization.value, REDACTED);
});

test("beyond the inspection depth nothing passes through unread (H1 fail-open regression)", () => {
  // A credential buried far deeper than the cap must never survive into logs, records or exports.
  let deep: unknown = { api_key: "bottom-secret-99" };
  for (let i = 0; i < MAX_REDACTION_DEPTH + 8; i++) deep = { level: i, child: deep };
  const before = JSON.stringify(deep);
  const out = redact(deep) as any;
  const after = JSON.stringify(out);
  assert.ok(before.includes("bottom-secret-99"), "fixture sanity: the credential is really in there");
  assert.ok(!after.includes("bottom-secret-99"), "the deep credential leaked through redaction");
  assert.ok(after.includes(REDACTED));
  // The object at the cap keeps its shape, with every value redacted.
  let node = out;
  for (let i = 0; i < MAX_REDACTION_DEPTH; i++) node = node.child;
  assert.ok("child" in node && "level" in node, "shape preserved at the cap");
  assert.equal(node.child, REDACTED);
  assert.equal(node.level, REDACTED);
});

test("deeply nested arrays fail closed too", () => {
  let deep: unknown = { secret_token: "array-secret-42" };
  for (let i = 0; i < MAX_REDACTION_DEPTH + 3; i++) deep = [deep];
  const after = JSON.stringify(redact(deep));
  assert.ok(!after.includes("array-secret-42"));
  assert.ok(after.includes(REDACTED));
});

test("depth exactly at the cap still inspects its own level normally", () => {
  let value: unknown = { token: "at-cap-secret" };
  for (let i = 0; i < MAX_REDACTION_DEPTH - 1; i++) value = { child: value };
  const out = redact(value) as any;
  let node = out;
  for (let i = 0; i < MAX_REDACTION_DEPTH - 1; i++) node = node.child;
  assert.equal(node.token, REDACTED, "the level just inside the cap is redacted by name, not wholesale");
});

test("redactText removes credential query parameters and bearer/basic schemes from free text", () => {
  const text = "fetch https://api.test/v1/search?access_token=abc123&q=keep failed; header Authorization: Bearer eyJhbGciOi.abc.def rejected";
  const out = redactText(text);
  assert.ok(!out.includes("abc123"), "query credential survived");
  assert.ok(!out.includes("eyJhbGciOi"), "bearer token survived");
  assert.ok(out.includes("q=keep"), "an ordinary parameter was removed");
  assert.ok(out.includes(REDACTED));
});

test("sensitiveValues lists string credentials under credential names, ignoring short, empty or non-string ones", () => {
  assert.deepEqual(sensitiveValues({ token: "tok1234", note: "keep", password: "pw12", count: 3 }), ["tok1234", "pw12"]);
  assert.deepEqual(sensitiveValues({ token: "abc" }), [], "under four characters is not a secret worth scrubbing");
  assert.deepEqual(sensitiveValues(undefined), []);
});

test("scrub removes the exact credentials that were sent plus standard patterns", () => {
  const out = scrub("provider rejected key sk-live-9f3fab (Authorization: Bearer abc.def.ghi)", ["sk-live-9f3fab"]);
  assert.ok(!out.includes("sk-live-9f3fab"));
  assert.ok(!out.includes("abc.def.ghi"));
  assert.ok(out.includes(REDACTED));
});
