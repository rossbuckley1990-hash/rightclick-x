// Negative control for M2 (issue #38): this file uses only interfaces that exist on the
// previous proposal (createHandler + world), so it runs against both implementations.
// The previous proposal derived the rate-limit key from the Authorization header BEFORE
// verifying the credential: every distinct invalid bearer string was a fresh bucket.
// On that implementation these assertions FAIL (no 429 ever fires); on the corrected
// implementation they pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/interface/http.ts";
import { world } from "./helpers.ts";

test("negative control: rotating invented bearer tokens cannot buy fresh buckets", async () => {
  const { rc } = await world();
  const http = createHandler(rc, { token: "sekrit", ratePerMinute: 3 });
  const hit = (bearer: string) =>
    http(new Request("http://h.test/api/run", { method: "POST", headers: { authorization: bearer, "content-type": "application/json" }, body: "{}" }))
      .then((r) => r.status);
  // Ten distinct invented credentials. All must draw from one bounded pre-authentication
  // bucket: after the budget, 429 regardless of what new token is invented.
  const seen = new Set<number>();
  for (let i = 0; i < 10; i++) seen.add(await hit(`Bearer invented-credential-${i}`));
  assert.ok(seen.has(429), `rotating invalid credentials was never limited (statuses: ${[...seen].join(",")})`);
});
