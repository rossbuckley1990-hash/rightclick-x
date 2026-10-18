import { test } from "node:test";
import assert from "node:assert/strict";
import { codexEvents, codexSummary, inspectCodeMode, toml } from "../experiments/north-star/codex-session.ts";

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

test("Code Mode audit distinguishes literal program arguments from JavaScript execution", () => {
  const allowed = "mcp__surface";
  assert.deepEqual(inspectCodeMode('const r = await tools.mcp__surface__run_program({args:["-e", "require HTTP::Tiny; process eval"],stdin:""}); text(r);', allowed), []);
  assert.deepEqual(inspectCodeMode('text(ALL_TOOLS.filter(t => /run_program$/.test(t.name)));', allowed), []);
  for (const code of ['await fetch("https://example.invalid")', 'require("fs")', 'await import("fs")', 'tools["mcp__surface__run_program"]({})', 'tools.exec_command({cmd:"x"})', 'const {mcp__surface__run_program} = tools;', 'text((()=>{}).constructor("return 1")())', 'text((()=>{})["constructor"]("return 1")())', 'eval("x")', 'globalThis["fetch"]("x")', 'await tools.mcp__surface__run_program({']) {
    assert.ok(inspectCodeMode(code, allowed).length > 0, code);
  }
});

test("Codex MCP configuration preserves literal paths and structured environment values", () => {
  assert.equal(toml({ command: "/a b/node", args: ["/x/y.ts"], env: { INPUT: "line\n\"quote\"\\backslash" } }), '{"command"="/a b/node","args"=["/x/y.ts"],"env"={"INPUT"="line\\n\\\"quote\\\"\\\\backslash"}}');
  assert.throws(() => toml({ bad: undefined }));
});
