// Local recovery under a closed network policy must keep program authority and
// semantic change checks. Fixtures are disposable, not holdout software.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";

const native = await hostSandbox();
const skip = native ? false : "no host sandbox";
async function fixture() {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-local-repair-`));
  const bin = `${dir}/shout`;
  const write = (version: string, compatible = true) => writeFileSync(bin, `#!/bin/sh
# ${version}
if [ "$1" = "--help" ]; then printf 'usage: shout [-u] [file]\\n  -u    print the output in upper case\\n'; exit 0; fi
if [ "$1" = "-u" ]; then shift; tr ${compatible ? "a-z A-Z" : "A-Z a-z"}; else cat; fi
`, { mode: 0o755 });
  write("original");
  const events: string[] = [];
  const sandbox: Sandbox = { ...native!, async run(program, args, opts) { events.push(opts?.purpose ?? "unknown"); return native!.run(program, args, opts); } };
  const store = new FileStore(`${dir}/state.json`);
  const create = (authority = { investigate: [bin], execute: [bin] }, sb: Sandbox | null = sandbox) => RightClick.create({
    directories: [], store, authority, sandbox: sb, network: { blockPrivate: true, origins: [] },
    fetch: async () => { events.push("NETWORK"); throw new Error("unexpected network request"); },
  });
  const rc = await create();
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.get("cli:shout:u")!;
  assert.ok(cap);
  const input = cap.inputs[0].name;
  await rc.flush();
  events.length = 0;
  return { dir, bin, write, events, create, rc, cap, input };
}

test("direct CLI repair works with network denied; changed meaning and removal stay refused", { skip }, async () => {
  const f = await fixture();
  f.write("compatible rebuild");
  const run = await f.rc.run(f.cap.id, { [f.input]: "new input\n" });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, "NEW INPUT\n");
  assert.equal(run.healing?.retried, f.cap.id);
  assert.equal(f.events.filter(e => e === "execution").length, 1);
  assert.ok(f.events.includes("investigation"));
  assert.ok(!f.events.includes("NETWORK"));

  f.events.length = 0;
  f.write("incompatible meaning", false);
  const changed = await f.rc.run(f.cap.id, { [f.input]: "Mixed Case\n" });
  assert.equal(changed.status, "failed");
  assert.equal(changed.healing?.retried, undefined);
  assert.equal(f.events.filter(e => e === "execution").length, 0);
  assert.ok(!f.events.includes("NETWORK"));
  const before = f.events.length;
  const repeat = await f.rc.run(f.cap.id, { [f.input]: "More\n" });
  assert.match(repeat.error!, /changed meaning/);
  assert.equal(f.events.length, before);

  // Use a fresh compatible fixture: changed-meaning refusal must not be bypassed
  // just to exercise disappearance and withdrawal.
  const gone = await fixture();
  rmSync(gone.bin);
  const missing = await gone.rc.run(gone.cap.id, { [gone.input]: "x\n" });
  assert.equal(missing.status, "failed");
  assert.equal(gone.rc.graph.get(gone.cap.id), undefined);
  assert.deepEqual(gone.events, []);
});

test("a persisted goal repairs its local step without widening egress or dropping its anchor", { skip }, async () => {
  const f = await fixture();
  const built = await f.rc.compose({ have: { input: { type: "text", value: "first\n" } }, want: "text", through: [f.cap.id], run: true, publish: "local upper", origins: [], verify: [{ op: "matches", pattern: "^[A-Z]+\\n$" }] });
  assert.equal(built.executed?.output, "FIRST\n", JSON.stringify(built));
  assert.equal(built.published?.id, "goal:local-upper");
  await f.rc.flush();
  f.write("compatible saved-goal rebuild");
  const fresh = await f.create();
  f.events.length = 0;
  const run = await fresh.run("goal:local-upper", { input: "second\n" });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, "SECOND\n");
  assert.equal(run.verification.status, "checked", "stored predicates are not an independent witness");
  assert.ok(run.attempts?.some(a => /drift/.test(a.healing ?? "")));
  assert.equal(f.events.filter(e => e === "execution").length, 1);
  assert.ok(!f.events.includes("NETWORK"));

  f.write("incompatible saved-goal rebuild", false);
  f.events.length = 0;
  const refused = await fresh.run("goal:local-upper", { input: "THIRD\n" });
  assert.equal(refused.status, "failed");
  assert.match(refused.error!, /anchor.*changed meaning|unresolved.*anchor/);
  assert.equal(f.events.filter(e => e === "execution").length, 0);
  assert.ok(!f.events.includes("NETWORK"));
});

test("closed-network repair cannot revive revoked program authority or an unavailable sandbox", { skip }, async () => {
  for (const denied of ["investigation", "execution", "all", "sandbox"] as const) {
    const f = await fixture();
    const built = await f.rc.compose({ have: { input: { type: "text", value: "first\n" } }, want: "text", through: [f.cap.id], run: true, publish: "restricted upper", origins: [] });
    assert.equal(built.executed?.output, "FIRST\n");
    await f.rc.flush();
    f.write(`changed ${denied}`);
    const authority = { investigate: ["investigation", "all"].includes(denied) ? [] : [f.bin], execute: ["execution", "all"].includes(denied) ? [] : [f.bin] };
    const fresh = denied === "sandbox" ? await f.create(authority, null) : await f.create(authority);
    f.events.length = 0;
    const run = await fresh.run(f.cap.id, { [f.input]: "not authorised\n" });
    assert.equal(run.status, "failed", denied);
    assert.match(run.error!, denied === "sandbox" ? /no sandbox/ : /not authorised/);
    assert.deepEqual(f.events, [], denied);
    const goal = await fresh.run("goal:restricted-upper", { input: "not authorised\n" });
    assert.equal(goal.status, "failed", denied);
    assert.match(JSON.stringify({ error: goal.error, attempts: goal.attempts }), denied === "sandbox" ? /no sandbox/ : /not authorised/);
    assert.deepEqual(f.events, [], `${denied}: saved goal`);
  }
});

test("a withdrawn local goal stays refused until its authorised source is rediscovered", { skip }, async () => {
  const f = await fixture();
  const built = await f.rc.compose({ have: { input: { type: "text", value: "first\n" } }, want: "text", through: [f.cap.id], run: true, publish: "returning upper", origins: [] });
  assert.equal(built.executed?.output, "FIRST\n");
  await f.rc.flush();
  rmSync(f.bin);
  f.events.length = 0;
  const missing = await f.rc.run("goal:returning-upper", { input: "second\n" });
  assert.equal(missing.status, "failed");
  assert.equal(f.rc.graph.get(f.cap.id), undefined);
  assert.equal(f.events.length, 0);
  await f.rc.flush();

  f.write("returned compatible program");
  const fresh = await f.create();
  const unlearned = await fresh.run("goal:returning-upper", { input: "third\n" });
  assert.equal(unlearned.status, "failed", "return is not assumed to preserve semantics");
  assert.equal(f.events.length, 0);
  await fresh.learn({ source: `cli:${f.bin}` });
  assert.ok(f.events.includes("investigation"));
  f.events.length = 0;
  const returned = await fresh.run("goal:returning-upper", { input: "fourth\n" });
  assert.equal(returned.status, "completed", returned.error);
  assert.equal(returned.output, "FOURTH\n");
  assert.deepEqual(f.events, ["execution"]);
});
