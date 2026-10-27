import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("a witness cannot change between its pinned check and execution during a leased goal", () => {
  const script = fileURLToPath(new URL("../experiments/inheritance-offline/witness-race-repro.ts", import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.disposition, "SUBSTITUTION_NOT_VERIFIED");
  assert.equal(observed.changed, false);
  assert.notEqual(observed.verification, "verified");
  assert.ok(!observed.calls.includes("/xmil02"));
});
