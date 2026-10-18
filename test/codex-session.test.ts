import { test } from "node:test";
import assert from "node:assert/strict";
import { codexEvents, codexSummary, toml } from "../experiments/north-star/codex-session.ts";

test("Codex accounting includes cached input once and never substitutes missing usage", () => {
  const events = [
    { type: "item.completed", item: { type: "agent_message", text: "ANSWER: value" } },
    { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 7 } },
  ];
  assert.equal(codexSummary(events).tokens, 107);
  assert.equal(codexSummary(events).reply, "ANSWER: value");
  assert.equal(codexSummary([]).tokens, undefined);
  assert.equal(codexSummary([{ type: "turn.completed", usage: {} }]).tokens, undefined);
  assert.equal(codexSummary([{ type: "turn.completed", usage: { input_tokens: -1, output_tokens: 1 } }]).tokens, undefined);
  assert.equal(codexSummary([{ type: "turn.failed", error: { message: "quota" } }]).errors.length, 1);
  assert.throws(() => codexEvents('{"type":"turn.completed"}\nmalformed'));
});

test("Codex MCP configuration preserves literal paths and structured environment values", () => {
  assert.equal(toml({ command: "/a b/node", args: ["/x/y.ts"], env: { INPUT: "line\n\"quote\"\\backslash" } }), '{"command"="/a b/node","args"=["/x/y.ts"],"env"={"INPUT"="line\\n\\\"quote\\\"\\\\backslash"}}');
  assert.throws(() => toml({ bad: undefined }));
});
