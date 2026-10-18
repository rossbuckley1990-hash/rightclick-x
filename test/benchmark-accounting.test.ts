import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaBlock } from "../experiments/north-star/quota.ts";

test("provider weekly/session limits are blocked, not task failures", () => {
  for (const interval of ["weekly ", "daily ", "monthly ", "session ", "usage ", ""]) {
    assert.ok(quotaBlock(`You've hit your ${interval}limit · resets Oct 22 at 11pm (Europe/London)`));
  }
});

test("task results or quoted provider errors do not become quota exclusions", () => {
  for (const reply of ["BEGIN\nrate limit\nEND", "UNABLE: the task hit a rate limit in its data", "The input says You've hit your weekly limit", "", "The maximum size limit was exceeded"]) assert.equal(quotaBlock(reply), undefined);
});
