import test from "node:test";
import assert from "node:assert/strict";
import { parseControlEvents } from "../experiments/reconciliation/codex-control.ts";
const start = { type: "turn.started" };
const answer = { type: "item.completed", item: { type: "agent_message", text: '{"field":"current"}' } };
const done = { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } };
const parse = (...events: unknown[]) => parseControlEvents(events.map(e => JSON.stringify(e)).join("\n"));
test("a precise pre-turn CLI warning is not a tool call or a failed model turn", () => {
  const warning = { type: "item.completed", item: { type: "error", message: "Under-development features enabled: skip_host_skill_discovery. Details." } };
  const r = parse(warning, start, answer, done);
  assert.equal(r.valid, true); assert.equal(r.toolEventCount, 0); assert.equal(r.nonfatalWarningCount, 1);
  assert.equal(parse(start, warning, answer, done).valid, false, "the same message during a turn is not silently ignored");
});
test("actual tool calls, unknown items, fatal errors, missing or inconsistent usage remain unadmitted", () => {
  for (const item of [{ type: "command_execution" }, { type: "mcp_tool_call" }, { type: "unknown" }, { type: "error", message: "model unavailable" }])
    assert.equal(parse(start, { type: "item.completed", item }, answer, done).valid, false);
  assert.equal(parse(start, answer).valid, false);
  assert.equal(parse(start, answer, { ...done, usage: { ...done.usage, cached_input_tokens: 101 } }).valid, false);
});

test("source identity covers untracked code and ignores large generated historical evidence", async () => {
  const { sourceIdentity } = await import("../experiments/reconciliation/source-identity.ts");
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "rcx-source-id-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    await mkdir(join(dir, "src")); await mkdir(join(dir, "proof"));
    await writeFile(join(dir, "src/operation.ts"), "export const value = 1;\n");
    const first = await sourceIdentity(dir);
    await writeFile(join(dir, "proof/generated.json"), "x".repeat(2_000_000));
    assert.equal((await sourceIdentity(dir)).digest, first.digest);
    await writeFile(join(dir, "src/operation.ts"), "export const value = 2;\n");
    assert.notEqual((await sourceIdentity(dir)).digest, first.digest);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
