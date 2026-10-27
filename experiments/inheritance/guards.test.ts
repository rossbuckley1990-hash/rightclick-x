import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkUrl } from "../../src/reflectors/net.ts";
import { stableStringify, type Receipt } from "../../src/core/ledger.ts";
import { refusalForTool, receiptBindsRun, sameGoalDefinition } from "./guards.ts";

test("creator only learns explicitly authorised CLI paths and cannot acquire remote providers", () => {
  const programs = ["/tmp/jq", "/tmp/sha1sum", "/tmp/json_pp", "/tmp/shasum"];
  assert.equal(refusalForTool("creator", "context_learn", { source: "cli:/tmp/jq" }, programs), "");
  for (const args of [
    {}, { source: "https://example.com/spec" }, { source: "cli:/tmp/other" },
    { source: "https://example.com/spec", sources: ["cli:/tmp/jq"] },
    { source: "cli:/tmp/jq", sources: ["https://example.com/spec"] },
    { sources: "cli:/tmp/jq" },
  ]) assert.ok(refusalForTool("creator", "context_learn", args, programs));
  assert.ok(refusalForTool("creator", "context_compose", { acquire: true }, programs));
  assert.ok(refusalForTool("creator", "context_research", {}, programs));
  assert.ok(refusalForTool("creator", "context_forget", {}, programs));
});

test("reuser cannot change or rediscover the retained graph", () => {
  for (const name of ["context_learn", "context_research", "context_compose", "context_forget"])
    assert.ok(refusalForTool("reuser", name, {}, []));
  assert.equal(refusalForTool("reuser", "context_run", {}, []), "");
});

test("empty origin allowlist refuses both public and loopback addresses", async () => {
  for (const url of ["https://example.com/", "http://127.0.0.1/", "http://169.254.169.254/"])
    await assert.rejects(checkUrl({ origins: [], blockPrivate: true }, url), /blocked by egress policy/);
});

test("saved goal definition cannot change while counters and observations may", () => {
  const before = { slug: "example", witnesses: [{ capability: "composite:a", args: { json: { input: "json" } } }], through: ["cli:a"], calls: 0 };
  assert.equal(sameGoalDefinition(before, { ...before, calls: 2, lastPipeline: ["a"], providers: ["p"] }), true);
  assert.equal(sameGoalDefinition(before, { ...before, witnesses: [] }), false);
  assert.equal(sameGoalDefinition(before, { ...before, through: ["cli:b"] }), false);
  assert.equal(sameGoalDefinition(before, undefined), false);
});

test("verified receipt must bind the same run, goal, input and output", () => {
  const digest = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex");
  const args = { json: { b: 2, a: 1 } }, run = { runId: "run-1", output: "abc  -\n" };
  const receipt = { runId: run.runId, capability: "goal:manifest", status: "completed", verification: "verified", inputDigest: digest(args), outputDigest: digest(run.output) } as Receipt;
  assert.equal(receiptBindsRun(receipt, "goal:manifest", { json: { a: 1, b: 2 } }, run), true);
  assert.equal(receiptBindsRun(receipt, "goal:other", args, run), false);
  assert.equal(receiptBindsRun(receipt, "goal:manifest", { json: { a: 9 } }, run), false);
  assert.equal(receiptBindsRun(receipt, "goal:manifest", args, { ...run, output: "wrong" }), false);
  assert.equal(receiptBindsRun({ ...receipt, verification: "checked" }, "goal:manifest", args, run), false);
  assert.equal(receiptBindsRun({ ...receipt, runId: "run-2" }, "goal:manifest", args, run), false);
});
