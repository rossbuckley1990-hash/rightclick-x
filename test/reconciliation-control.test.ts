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
