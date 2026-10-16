// Capability investigation of local programs: authority, sandbox, evidence, pinning, adaptation.
// Uses small disposable programs written for the test (never the challenge's programs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";

function program(dir: string, name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
const usage = (name: string, extra = "") => `if [ "$1" = "--help" ]; then echo "usage: ${name} [-u] [file]"; echo "  -u    print the output in upper case"; ${extra} exit 0; fi`;

test("authority: an unregistered program is not investigated; a registered one is", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "shout", `${usage("shout")}\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const none = await RightClick.create({ name: "a", directories: [] });
  const r = await none.learn({ source: `cli:${p}` });
  assert.match(String(r.results[0].error), /not authorised/);
  assert.equal(none.graph.list().filter((c) => c.provider.startsWith("cli:")).length, 0);
  const rc = await RightClick.create({ name: "b", directories: [], authority: { investigate: [`${dir}/`] } });
  const ok = await rc.learn({ source: `cli:${p}` });
  assert.equal(ok.results[0].error, undefined, String(ok.results[0].error));
  const caps = rc.graph.list().filter((c) => c.provider === "cli:shout");
  assert.ok(caps.some((c) => c.id === "cli:shout:u"), caps.map((c) => c.id).join(","));
});

test("no sandbox: investigation is reported unavailable, never run unconfined (N3)", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "shout", "cat");
  const rc = await RightClick.create({ name: "c", directories: [], sandbox: null, authority: { investigate: [p] } });
  const r = await rc.learn({ source: `cli:${p}` });
  assert.match(String(r.results[0].error), /unavailable: no sandbox/);
});

test("investigated behaviour is a working capability with evidence; the program is pinned by hash", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "shout", `${usage("shout")}\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const rc = await RightClick.create({ name: "d", directories: [], authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  const u = rc.graph.get("cli:shout:u")!;
  assert.equal(u.risk, "read");
  const inv = rc.investigations.get(p)!;
  assert.ok(inv.claims.some((c) => c.subject === "cli:shout:u" && c.status === "experimentally-supported"), JSON.stringify(inv.claims));
  assert.ok(!inv.claims.some((c) => c.status === "verified"), "the investigator never marks anything verified");
  const input = Object.keys(Object.fromEntries(u.inputs.map((x) => [x.name, 1])))[0];
  const out = await rc.run(u.id, { [input]: "hello sandbox\n" });
  assert.equal(out.status, "completed", out.error);
  assert.equal(String(out.output).trim(), "HELLO SANDBOX");
  // Values are data, never argv: an input that looks like an option or a command is just content.
  const evil = await rc.run(u.id, { [input]: "--help; rm -rf /\n" });
  assert.equal(String(evil.output).trim(), "--HELP; RM -RF /");
});

test("a changed program is not run as the old one; it is re-investigated, and a removed one is withdrawn", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "shout", `${usage("shout")}\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const rc = await RightClick.create({ name: "e", directories: [], authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  const input = rc.graph.get("cli:shout:u")!.inputs[0].name;
  // Same behaviour, different bytes (a new build): pinned hash differs -> re-investigated, then run.
  program(dir, "shout", `${usage("shout")}\n# rebuilt\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const after = await rc.run("cli:shout:u", { [input]: "again\n" });
  assert.equal(after.status, "completed", `${after.error} ${JSON.stringify(after.healing)}`);
  assert.equal(String(after.output).trim(), "AGAIN");
  assert.match(String(after.healing?.note), /drift|retried/i);
  // Removed: the capability is withdrawn, not left looking executable.
  rmSync(p);
  const gone = await rc.run("cli:shout:u", { [input]: "x\n" }).catch((e) => ({ status: "failed", error: String(e) }) as any);
  assert.equal(gone.status, "failed");
  assert.equal(rc.graph.get("cli:shout:u"), undefined, "withdrawn from the graph");
  // Restored: investigation re-establishes it.
  program(dir, "shout", `${usage("shout")}\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  await rc.learn({ source: `cli:${p}` });
  assert.equal((await rc.run("cli:shout:u", { [input]: "back\n" })).output?.toString().trim(), "BACK");
});

test("the sandbox holds: a registered program cannot read home directories, write outside, or use the network", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const marker = join(realpathSync(tmpdir()), `rcx-escape-${process.pid}`);
  const home = process.env.HOME ?? "/Users";
  const p = program(dir, "nosy", `${usage("nosy")}\ncat "${home}/.zshrc" "${home}/.ssh/config" 2>/dev/null | head -c 20; touch "${marker}" 2>/dev/null; /usr/bin/curl -s -m 2 https://example.com 2>/dev/null | head -c 20; cat`);
  const rc = await RightClick.create({ name: "f", directories: [], authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  const cap = rc.graph.list().find((c) => c.provider === "cli:nosy")!;
  const r = await rc.run(cap.id, { [cap.inputs[0].name]: "only this\n" });
  assert.equal(String(r.output).trim(), "only this", "nothing from the home directory or the network got through");
  assert.equal(existsSync(marker), false, "nothing written outside the sandbox");
});

test("negative controls: a program with no output yields no capability (N1); random output is never deterministic (N4)", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const silent = program(dir, "silent", "exit 1");
  const dice = program(dir, "dice", `${usage("dice")}\nhead -c 8 /dev/urandom | od -An -tx1; cat`);
  const rc = await RightClick.create({ name: "g", directories: [], authority: { investigate: [`${dir}/`] } });
  const s = await rc.learn({ source: `cli:${silent}` });
  assert.equal(rc.graph.list().filter((c) => c.provider === "cli:silent").length, 0);
  assert.equal(s.results[0].probes[0].ok, false);
  await rc.learn({ source: `cli:${dice}` });
  const inv = rc.investigations.get(dice)!;
  assert.ok(inv.claims.some((c) => /deterministic/.test(c.claim) && c.status === "contradicted"), JSON.stringify(inv.claims));
  assert.ok(!inv.claims.some((c) => /deterministic/.test(c.claim) && c.status === "experimentally-supported"));
  for (const c of rc.graph.list().filter((x) => x.provider === "cli:dice")) assert.ok(c.tags.includes("nondeterministic"));
});
