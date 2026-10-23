import assert from "node:assert/strict";
import test from "node:test";
import { includedModelAvailable } from "./session-models.ts";

test("model execution requires explicit included allowance, zero credits and an available model", () => {
  const fixture = { passed: true, responses: {
    "account/read": { type: "chatgpt" },
    "account/rateLimits/read": { ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: {
      planType: "prolite", credits: { hasCredits: false, unlimited: false, balance: "0" },
      primary: { usedPercent: 62 },
    } } },
    "model/list": [{ model: "test-model" }],
  } };
  assert.equal(includedModelAvailable(fixture, "test-model"), true);
  for (const change of [
    (p: any) => { p.passed = false; },
    (p: any) => { p.responses["account/read"].type = "api"; },
    (p: any) => { p.responses["account/rateLimits/read"].ordinaryUsageAllowed = false; },
    (p: any) => { p.responses["account/rateLimits/read"].rateLimitsByLimitId.codex.credits.hasCredits = true; },
    (p: any) => { p.responses["account/rateLimits/read"].rateLimitsByLimitId.codex.credits.unlimited = true; },
    (p: any) => { p.responses["account/rateLimits/read"].rateLimitsByLimitId.codex.credits.balance = "1"; },
    (p: any) => { p.responses["account/rateLimits/read"].rateLimitsByLimitId.codex.primary.usedPercent = 90; },
    (p: any) => { delete p.responses["account/rateLimits/read"].rateLimitsByLimitId; },
    (p: any) => { p.responses["model/list"] = []; },
  ]) {
    const value = structuredClone(fixture); change(value);
    assert.equal(includedModelAvailable(value, "test-model"), false);
  }
  assert.equal(includedModelAvailable(undefined, "test-model"), false);
});
