import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonRepresentationError, parseJsonValue } from "../src/core/json.ts";
import { inspectValue } from "../src/core/semantics.ts";
import { CONFINED_POLICY } from "../src/core/sandbox.ts";

test("JSON values must survive serialization without numeric changes", () => {
  for (const value of ['{"id":9007199254740993}', '{"fraction":0.10000000000000001}', '[1e309]', '[1e-9999]', '[-0]', '[-0.0e99]']) assert.throws(() => parseJsonValue(value), JsonRepresentationError, value);
  for (const value of ['{"id":9007199254740992}', '[0.1,1000,1e3,1000.00,1.23e-100]', '{"value":"9007199254740993"}', '[0,0.000e-123]']) assert.deepEqual(parseJsonValue(value), JSON.parse(value));
});

test("duplicate JSON keys, including escaped keys and nested objects, are refused", () => {
  for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":1}', '[{"x":{},"x":[]}]', '{"outer":{"x":1,"x":2}}']) assert.throws(() => parseJsonValue(value), /duplicate object key/);
  for (const value of ['{"a":{"x":1},"b":{"x":2}}', '[{"x":1},{"x":2}]', '{"a":["x","x"],"b":"a"}', '{"quoted\\\"key":1}']) assert.deepEqual(parseJsonValue(value), JSON.parse(value));
  assert.throws(() => parseJsonValue('{"a":'), SyntaxError);
});

test("inspecting JSON that needs a text representation never exposes rounded values", () => {
  const text = ' {"id":9007199254740993} \n';
  const inspected = inspectValue(text);
  assert.equal(inspected.type, "text");
  assert.equal(inspected.value, text);
  assert.equal(inspected.meta.representation, "json-text");
});

test("CLI wire content and literal arguments preserve supplied text; typed loss never retries", async () => {
  const { RightClick } = await import("../src/runtime.ts");
  const { createHash } = await import("node:crypto");
  const { mkdtempSync, writeFileSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-json-wire-`));
  const program = `${dir}/fixture`, bytes = "#!/bin/sh\nexit 0\n";
  writeFileSync(program, bytes, { mode: 0o755 });
  const calls: any[] = [];
  let stdout = "accepted\n";
  const rc = await RightClick.create({ directories: [], authority: { investigate: [program] }, sandbox: { kind: "macos-sandbox-exec", policy: CONFINED_POLICY, enforces: [], async run(bin, argv, options) { calls.push({ bin, argv, options }); return { code: 0, stdout, stderr: "", timedOut: false, truncated: false, durationMs: 0, created: [], workDir: dir }; } } });
  const cap: any = { id: "cli:fixture:default", provider: "cli:fixture", title: "Synthetic wire fixture", description: "Unit test transport only", source: "cli", inputs: [{ name: "input", type: "json", required: true }, { name: "literal", type: "number", required: true }, { name: "files", type: "json", required: false }], outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [], invoke: { kind: "cli", bin: program, args: [{ input: "literal", literal: true }], stdin: "input", filesPort: "files", okExit: [0], output: "text", sha256: createHash("sha256").update(bytes).digest("hex") } };
  rc.graph.add({ provider: { id: cap.provider, title: "Synthetic", source: "cli", learnedAt: new Date().toISOString(), capabilityIds: [cap.id], origin: program }, capabilities: [cap] });
  const input = ' {"id":9007199254740993,"id":2} \n';
  const run = await rc.run(cap.id, { input, literal: "0007", files: '{"input.json":" { \\"n\\": 4 } \\n"}' });
  assert.equal(run.status, "completed", run.error);
  assert.equal(calls[0].options.stdin, input);
  assert.equal(calls[0].argv[0], "0007");
  assert.equal(calls[0].options.files["input.json"], ' { "n": 4 } \n');
  stdout = '{"id":9007199254740993}\n';
  cap.invoke.output = "json";
  const refused = await rc.run(cap.id, { input, literal: "7" });
  assert.equal(refused.status, "failed");
  assert.equal(refused.verification.status, "refuted");
  assert.match(refused.error!, /cannot be represented/);
  assert.equal(calls.length, 2, "representation loss cannot trigger retry or investigation");
  assert.equal(refused.healing, undefined);
});

test("numeric inspection preserves unrepresentable values and zero-padded identifiers", () => {
  for (const text of ["9007199254740993", "0007", "-0", "0.10000000000000001"]) {
    assert.equal(inspectValue(text).type, "text");
    assert.equal(inspectValue(text).value, text);
  }
  assert.equal(inspectValue("12.5").value, 12.5);
  assert.throws(() => parseJsonValue('1e-' + '9'.repeat(10000)), JsonRepresentationError);
});
