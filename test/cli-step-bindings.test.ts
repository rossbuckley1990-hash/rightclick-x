import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { MemoryStore } from "./helpers.ts";
import { decodeState, encodeState, STEP_INPUT_BINDINGS_REQUIREMENT } from "../src/core/state-format.ts";

const jq = "/opt/homebrew/bin/jq", shasum = "/usr/bin/shasum";
const sandbox = await hostSandbox();
const skip = sandbox && existsSync(jq) && existsSync(shasum) ? false : "requires jq, shasum and a host sandbox";
const through = ["cli:jq:stdout", "cli:shasum:invoke"];
const inputBindings = { [through[0]]: { options: "jqOptions" }, [through[1]]: { options: "hashOptions" } };
const digest = (text: string) => `${createHash("sha1").update(text).digest("hex")} *-\n`;

test("distinct CLI step options are pinned, persist across restart and obey current authority", { skip }, async () => {
  const store = new MemoryStore();
  const create = (execute = [jq, shasum]) => RightClick.create({ directories: [], store, sandbox,
    network: { origins: [], blockPrivate: true }, authority: { investigate: [jq, shasum], execute },
    fetch: async () => { throw new Error("unexpected network"); } });
  const rc = await create();
  await rc.learn({ source: `cli:${jq}` });
  await rc.learn({ source: `cli:${shasum}` });
  const r = await rc.compose({ have: { json: { type: "json", value: { z: 2, a: 1 } },
    jqOptions: { value: ["-S", "-c", "-j"], fixed: true }, hashOptions: { value: ["-b"], fixed: true } },
    want: "text", through, inputBindings, run: true, publish: "binary manifest sha1" });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r));
  assert.equal(r.executed?.output, digest('{"a":1,"z":2}'));
  assert.ok(r.published?.durable);
  await rc.flush();
  const fresh = await create();
  const reused = await fresh.run("goal:binary-manifest-sha1", { json: { z: 9, a: 4 }, jqOptions: [], hashOptions: [] });
  assert.equal(reused.status, "completed", reused.error);
  assert.equal(reused.output, digest('{"a":4,"z":9}'));
  const denied = await create([jq]);
  const refused = await denied.run("goal:binary-manifest-sha1", { json: { z: 9, a: 4 } });
  assert.notEqual(refused.status, "completed");
});

test("invalid bindings fail closed before execution", { skip }, async () => {
  const rc = await RightClick.create({ directories: [], sandbox, network: { origins: [], blockPrivate: true }, authority: { investigate: [jq, shasum] } });
  await rc.learn({ source: `cli:${jq}` });
  await rc.learn({ source: `cli:${shasum}` });
  const base = { have: { json: {}, jqOptions: ["-S"] }, want: "text", through, run: true };
  await assert.rejects(rc.compose({ ...base, inputBindings: { [through[0]]: { options: "missing" } } }), /unknown or unsupported inputBindings input/);
  await assert.rejects(rc.compose({ ...base, inputBindings: { [through[0]]: { invalid: "jqOptions" } } }), /unknown inputBindings port/);
  await assert.rejects(rc.compose({ ...base, inputBindings: { "cli:other:default": { options: "jqOptions" } } }), /explicitly anchored/);
});

test("named step bindings reach the corresponding CLI calls and survive goal persistence", async () => {
  // A transport double captures argv; it does not assert sandbox isolation or real-program behavior.
  const { readFileSync } = await import("node:fs");
  const { CONFINED_POLICY } = await import("../src/core/sandbox.ts");
  const programs = ["/bin/cat", "/usr/bin/shasum"];
  const ids = ["cli:fixture:first", "cli:fixture:second"];
  const calls: Array<{ bin: string; argv: string[]; input?: string }> = [];
  const fake = { kind: "macos-sandbox-exec" as const, policy: CONFINED_POLICY, enforces: [], async run(bin: string, argv: string[], opts?: { stdin?: string }) {
    calls.push({ bin, argv, input: opts?.stdin });
    return { code: 0, stdout: bin === programs[0] ? `transformed:${opts?.stdin}` : `hashed:${opts?.stdin}`, stderr: "", timedOut: false, truncated: false, durationMs: 0, created: [], workDir: "/tmp" };
  } };
  const store = new MemoryStore();
  const create = async (execute = programs) => {
    const rc = await RightClick.create({ directories: [], store, sandbox: fake, authority: { investigate: programs, execute }, network: { origins: [], blockPrivate: true } });
    for (let i = 0; i < 2; i++) {
      const cap: any = { id: ids[i], title: `test command ${i}`, description: "", provider: `cli:fixture-${i}`, source: "cli", risk: "read", tags: [],
        inputs: [{ name: "input", type: "text", required: false }, { name: "options", type: "list:text", required: false }], outputs: [{ name: "", type: "text", required: true }],
        invoke: { kind: "cli", bin: programs[i], args: [], stdin: "input", options: { port: "options", allowed: [{ flags: [i ? "-b" : "-a"], arg: false }, { flags: ["-t", "--token"], arg: true }] },
          okExit: [0], output: "text", sha256: createHash("sha256").update(readFileSync(programs[i])).digest("hex") } };
      rc.graph.add({ provider: { id: cap.provider, title: cap.title, source: "cli", origin: programs[i], learnedAt: "", capabilityIds: [cap.id] }, capabilities: [cap] });
    }
    return rc;
  };
  const rc = await create();
  const inputBindings = { [ids[0]]: { options: "firstOptions" }, [ids[1]]: { options: "secondOptions" } };
  const { dispatch } = await import("../src/interface/tools.ts");
  const result: any = await dispatch(rc, "context_compose", { have: { input: "hello", firstOptions: { value: ["-a"], fixed: true }, secondOptions: { value: ["-b"], fixed: true } },
    want: "text", through: ids, inputBindings, run: true, publish: "two distinct options" });
  assert.equal(result.executed?.status, "completed", JSON.stringify(result));
  assert.equal(result.executed?.output, "hashed:transformed:hello");
  assert.deepEqual(calls.map(c => c.argv), [["-a"], ["-b"]]);
  await rc.flush();
  assert.ok(store.state!.requirements!.includes(STEP_INPUT_BINDINGS_REQUIREMENT));
  const roundtrip = decodeState(JSON.parse(encodeState(store.state!)));
  assert.deepEqual(roundtrip.published!.find(g => g.slug === "two-distinct-options")!.inputBindings, inputBindings);
  const missing = structuredClone(store.state!);
  missing.requirements = missing.requirements!.filter(r => r !== STEP_INPUT_BINDINGS_REQUIREMENT);
  assert.throws(() => decodeState(missing), /missing the step input bindings requirement/);
  const fresh = await create();
  const reused = await fresh.run("goal:two-distinct-options", { input: "new", firstOptions: ["-b"], secondOptions: ["-a"] });
  assert.equal(reused.status, "completed", reused.error);
  assert.equal(reused.output, "hashed:transformed:new");
  assert.deepEqual(calls.slice(-2).map(c => c.argv), [["-a"], ["-b"]]);
  const before = calls.length;
  const denied = await create([programs[0]]);
  assert.notEqual((await denied.run("goal:two-distinct-options", { input: "new" })).status, "completed");
  assert.equal(calls.length, before);
  await assert.rejects(rc.compose({ have: { input: "hello" }, want: "text", through: ids, inputBindings, run: true }), /unknown or unsupported inputBindings input/);
  await assert.rejects(rc.compose({ have: { input: "hello", firstOptions: ["-a"] }, want: "text", through: ids,
    inputBindings: { [ids[0]]: { missing: "firstOptions" } }, run: true }), /unknown inputBindings port/);
  const count = calls.length;
  const bad = await rc.compose({ have: { input: "hello", firstOptions: ["-b"], secondOptions: ["-b"] },
    want: "text", through: ids, inputBindings, run: true });
  assert.notEqual(bad.executed?.status, "completed");
  assert.equal(calls.length, count, "undocumented options are refused before dispatch");
  for (const option of [["--token", "example-secret"], ["--token=example-secret"], ["-t", "example-secret"], ["-texample-secret"]]) {
    await assert.rejects(rc.compose({ have: { input: "hello", firstOptions: { value: option, fixed: true }, secondOptions: ["-b"] },
      want: "text", through: ids, inputBindings, run: true, publish: "sensitive option" }), error =>
      /refused fixed credential-like CLI option/.test(String(error)) && !String(error).includes("example-secret"));
  }
  assert.equal(calls.length, count, "recognizable fixed credentials are refused before dispatch");
  await rc.flush();
  assert.equal(JSON.stringify(store.state).includes("example-secret"), false, "rejected values do not enter persisted state");
});
