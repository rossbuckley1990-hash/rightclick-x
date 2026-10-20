import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const cli = resolve("bin/rcx.ts");
function fixture() {
  const dir = mkdtempSync(`${tmpdir()}/rcx-command-input-`);
  const state = `${dir}/state.json`;
  let server: Server | undefined;
  const received: unknown[] = [];
  const call = async (args: string[], stdin?: string, policy?: object, recovery?: string) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: dir, env: { PATH: process.env.PATH, HOME: dir, RCX_STATE_FILE: state, RCX_WORKSPACE: dir,
        ...(policy ? { RCX_EXECUTION_POLICY: JSON.stringify(policy) } : {}),
        ...(recovery !== undefined ? { RCX_WORKFLOW_RECOVERY: recovery } : {}) },
      timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += bytes; });
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.stdin.end(stdin);
    const [status, signal] = await once(child, "close");
    assert.equal(signal, null, `CLI timed out: ${stderr}`);
    return { status, stdout, stderr };
  };
  const learn = async () => {
    server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/openapi.json") return void response.end(JSON.stringify({ openapi: "3.0.0", info: { title: "Command fixture", version: "1" }, paths: {
        "/echo": { post: { operationId: "echo", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["value"], properties: { value: { type: "object" } } } } } }, responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } },
      } }));
      let body = "";
      for await (const bytes of request) body += bytes;
      received.push(JSON.parse(body));
      response.end(body);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await call(["learn", `http://127.0.0.1:${address.port}/openapi.json`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).results[0].error, undefined);
  };
  const close = async () => {
    if (server) { server.close(); await once(server, "close"); }
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, state, call, received, learn, close };
}

test("CLI workflow recovery requires explicit host opt-in and rejects misspelled settings before state access", async () => {
  const f = fixture();
  try {
    const invalid = await f.call(["runtime"], undefined, undefined, "yes");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /RCX_WORKFLOW_RECOVERY must be 0 or 1/);
    assert.equal(existsSync(f.state), false);
    for (const value of [undefined, "0", "1"]) {
      const result = await f.call(["runtime"], undefined, undefined, value);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).storage.workflowRecovery, value === "1");
    }
  } finally { await f.close(); }
});

test("CLI structured arguments preserve arrays, nested values, Unicode and literal strings", async () => {
  const f = fixture();
  try {
    const value = { items: [1, false, null, { text: "雪\n`$HOME`\"" }], empty: {}, exact: "9007199254740993" };
    await f.learn();
    const input = JSON.stringify({ value });
    const result = await f.call(["run", "openapi:command-fixture:echo", "--args", input]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).output, { value });
    assert.deepEqual(f.received, [{ value }], "actual provider receives the complete typed request");
  } finally { await f.close(); }
});

test("CLI accepts a JSON file and piped JSON in fresh processes", async () => {
  const f = fixture();
  try {
    const path = `${f.dir}/input with spaces.json`;
    await f.learn();
    const args = { value: { files: { "a b.txt": "data\n", ["__proto__"]: "literal" }, operands: [], options: ["-e", "print"] } };
    writeFileSync(path, JSON.stringify(args));
    for (const [flags, stdin] of [[["--args-file", path], undefined], [["--args-file", "-"], JSON.stringify(args)]] as const) {
      const result = await f.call(["run", "openapi:command-fixture:echo", ...flags], stdin);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).output, args);
    }
    assert.deepEqual(f.received, [args, args]);
  } finally { await f.close(); }
});

test("CLI compose accepts typed structured inputs and retains scalar argument spelling", async () => {
  const f = fixture();
  try {
    const result = await f.call(["compose", "--args", JSON.stringify({ value: { type: "text", value: "literal\ntext" } }), "--want", "hash", "--run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).executed.status, "completed");
    const scalar = await f.call(["run", "builtin:text.sha256", "text=00123"]);
    assert.equal(scalar.status, 0, scalar.stderr);
    assert.equal(JSON.parse(scalar.stdout).output, createHash("sha256").update("00123").digest("hex"));
  } finally { await f.close(); }
});

test("ambiguous or lossy CLI arguments refuse before creating runtime state", async () => {
  const invalid = [
    ["--args", "[]"], ["--args", "null"], ["--args", "{broken"], ["--args"],
    ["--args", '{"value":9007199254740993}'], ["--args", '{"value":1,"value":2}'],
    ["--args", "{}", "value=second"], ["--args", "{}", "--args", "{}"],
    ["--args", "{}", "--args-file", "-"], ["--args-file"],
    ["--unknown", "x"], ["value=one", "value=two"], ["not-an-assignment"],
  ];
  for (const args of invalid) {
    const f = fixture();
    try {
      const result = await f.call(["run", "builtin:text.sha256", ...args], "{}");
      assert.notEqual(result.status, 0, JSON.stringify(args));
      assert.equal(result.stdout, "");
      assert.equal(existsSync(f.state), false, "bad input must not load, migrate or save runtime state");
    } finally { await f.close(); }
  }
});

test("invalid file encoding and missing input files refuse before runtime state", async () => {
  const f = fixture();
  try {
    const invalid = `${f.dir}/invalid.json`;
    writeFileSync(invalid, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
    for (const path of [invalid, `${f.dir}/missing.json`]) {
      const result = await f.call(["run", "builtin:text.sha256", "--args-file", path]);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.state), false);
    }
  } finally { await f.close(); }
});

test("CLI execution restrictions remain effective and failed runs exit unsuccessfully", async () => {
  const f = fixture();
  try {
    const result = await f.call(["run", "builtin:text.sha256", "--args", '{"text":"x","authority":"allow"}'], undefined, { allowedRisks: [] });
    assert.notEqual(result.status, 0);
    const run = JSON.parse(result.stdout);
    assert.equal(run.status, "failed");
    assert.match(run.error, /execution policy/);
    assert.equal(run.output, undefined);
    assert.ok(JSON.parse(readFileSync(f.state, "utf8")).receipts.length);
  } finally { await f.close(); }
});

test("oversized structured files refuse before creating state", async () => {
  const f = fixture();
  try {
    const path = `${f.dir}/large.json`;
    writeFileSync(path, Buffer.alloc(16 * 1024 * 1024 + 1, " "));
    const result = await f.call(["run", "builtin:text.sha256", "--args-file", path]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exceeds 16 MiB/);
    assert.equal(existsSync(f.state), false);
  } finally { await f.close(); }
});

test("failed CLI composition and refuted checks do not report shell success", async () => {
  const f = fixture();
  try {
    const compose = await f.call(["compose", "--args={}", "--want", "fixture:unavailable-output", "--run"]);
    assert.notEqual(compose.status, 0);
    assert.equal(JSON.parse(compose.stdout).plans.length, 0);
    const run = await f.call(["run", "builtin:text.sha256", "text=data", "--verify", '[{"op":"equals","value":"wrong"}]']);
    assert.notEqual(run.status, 0);
    assert.equal(JSON.parse(run.stdout).verification.status, "refuted");
    assert.equal(JSON.parse(run.stdout).status, "failed");
  } finally { await f.close(); }
});
