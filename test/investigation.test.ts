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

test("synthesis: a goal composed from investigated programs is saved with a capability card and an honest trust label", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const up = program(dir, "upcase", `if [ "$1" = "--help" ]; then echo "usage: upcase [file]"; echo "  convert text to upper case"; exit 0; fi\ntr a-z A-Z`);
  const rev = program(dir, "rev2", `if [ "$1" = "--help" ]; then echo "usage: rev2 [file]"; echo "  reverse the order of lines of text"; exit 0; fi\ntail -r`);
  const mk = (extra: object = {}) => RightClick.create({ name: "s", directories: [], authority: { investigate: [`${dir}/`], ...extra } });
  const rc = await mk();
  await rc.learn({ sources: [`cli:${up}`, `cli:${rev}`] });
  const goal = { have: { input: { type: "text", value: "one\ntwo\nthree\n" } }, want: "text", intent: "reverse lines upper case", run: true, maxSteps: 2 };
  // Unverified: published, but labelled so.
  const u = await rc.compose({ ...goal, publish: "Shout backwards" });
  assert.equal(u.executed?.status, "completed", JSON.stringify(u.executed?.attempts ?? u.plans?.map((p) => p.summary)));
  assert.equal(String(u.executed?.output).trim(), "THREE\nTWO\nONE");
  assert.equal(u.published?.trust, "unverified");
  const card = rc.explain("goal:shout-backwards").card;
  assert.equal((card.verification as any).trust, "unverified");
  assert.ok(card.limitations.some((l) => /no independent check/.test(l)));
  assert.ok(card.dependencies.length >= 1);
  // With a stored check it passes and is verified.
  const v = await rc.compose({ ...goal, verify: [{ op: "matches", pattern: "^THREE\\nTWO\\nONE\\s*$" }], publish: "Shout backwards checked" });
  assert.equal(v.published?.trust, "verified");
  // Operator publication authority: verified-only refuses unverified goals.
  const strict = await mk({ publish: "verified" });
  await strict.learn({ sources: [`cli:${up}`, `cli:${rev}`] });
  const refused = await strict.compose({ ...goal, publish: "Unchecked" });
  assert.equal(refused.published, undefined);
  assert.match(String(refused.publishRefused), /only verified/);
  // A program capability's card carries its investigation evidence and sandbox limitation.
  const pc = rc.explain(rc.graph.list().find((c) => c.provider === "cli:upcase")!.id).card;
  assert.ok(pc.identity.sha256);
  assert.ok((pc.verification as any).evidence.length > 0);
  assert.ok(pc.limitations.some((l) => /sandbox/.test(l)));
});

test("permission changed: revoking the operator's authority stops an existing program capability", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "shout", `${usage("shout")}\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const { MemoryStore } = await import("./helpers.ts");
  const store = new MemoryStore();
  const rc = await RightClick.create({ name: "h", directories: [], store, authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  const input = rc.graph.get("cli:shout:u")!.inputs[0].name;
  assert.equal((await rc.run("cli:shout:u", { [input]: "a\n" })).status, "completed");
  await rc.flush();
  // Same saved graph, restarted by an operator who no longer registers the program.
  const revoked = await RightClick.create({ name: "h", directories: [], store, authority: { investigate: [] } });
  assert.ok(revoked.graph.get("cli:shout:u"), "the capability is still in the saved graph");
  const r = await revoked.run("cli:shout:u", { [input]: "a\n" });
  assert.equal(r.status, "failed");
  assert.match(String(r.error), /not authorised to run/);
});

test("a step that only matches the requested type's name is not added (Stage D on uce-freeze-1: upper case -> Summarize text)", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "upper", `if [ "$1" = "--help" ]; then echo "usage: upper [-u] [file]"; echo "  -u    print the input in upper case"; exit 0; fi\nif [ "$1" = "-u" ]; then shift; tr a-z A-Z; else cat; fi`);
  const rc = await RightClick.create({ name: "i", directories: [], authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  const r = await rc.compose({ have: { input: { type: "text", value: "one two three. four five six. seven eight nine.\n" } }, want: "text", intent: "upper case text", run: true });
  assert.deepEqual(r.executed?.titles, ["upper -u: print the input in upper case"]);
  assert.equal(String(r.executed?.output).trim(), "ONE TWO THREE. FOUR FIVE SIX. SEVEN EIGHT NINE.");
});

test("usage text is not output: a program that answers anything with its usage yields no capability (cups-config, holdout on uce-freeze-2)", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const p = program(dir, "confish", `echo "Usage: confish --api-version"; echo "       confish --cflags"; exit 1`);
  const rc = await RightClick.create({ name: "u", directories: [], authority: { investigate: [p] } });
  await rc.learn({ source: `cli:${p}` });
  assert.equal(rc.graph.list().filter((c) => c.provider === "cli:confish").length, 0);
});

test("a type-preserving correction feeds a comparison of two distinct inputs (Stage C on uce-freeze-2)", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  // fixhtml: closes paragraphs (HTML -> corrected HTML). twocol: shows two files side by side.
  const fix = program(dir, "fixhtml", `if [ "$1" = "--help" ]; then echo "usage: fixhtml [file]"; echo "  correct and close html paragraphs"; exit 0; fi\nsed 's#<p>\\([^<]*\\)$#<p>\\1</p>#'`);
  const two = program(dir, "twocol", `if [ "$1" = "--help" ]; then echo "usage: twocol file1 file2"; echo "  side by side comparison of two files"; exit 0; fi\npaste -d '|' "$1" "$2"`);
  const rc = await RightClick.create({ name: "c", directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ sources: [`cli:${fix}`, `cli:${two}`] });
  const doc = "<html><body>\n<p>soup\n<p>bread\n</body></html>\n";
  const r = await rc.compose({ have: { html: { type: "html", value: doc } }, want: "text", intent: "side by side comparison of an html document before and after correction", run: true, maxSteps: 3 });
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.plans?.slice(0, 3).map((p) => p.summary)));
  assert.ok(r.executed!.titles[0].startsWith("fixhtml"), r.executed!.titles.join(" → "));
  const lines = String(r.executed?.output).trim().split("\n");
  assert.ok(lines.some((l) => l.includes("<p>soup</p>|<p>soup") || l.includes("<p>soup|<p>soup</p>")), String(r.executed?.output));
});

test("an error report on stdout is not a result (holdout zipinfo on uce-freeze-3), and flag alternatives are not operands (xmllint)", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-prog-")));
  const zipish = program(dir, "zipish", `if [ "$1" = "--help" ]; then echo "usage: zipish [-h] file"; echo "  -h    list detailed information about an archive"; exit 0; fi\nfor f; do [ "$f" = "-h" ] && continue; echo "Archive: $f"; echo "  End-of-central-directory signature not found."; done; exit 9`);
  const rc = await RightClick.create({ name: "z", directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${zipish}` });
  assert.equal(rc.graph.list().filter((c) => c.provider === "cli:zipish").length, 0, "no capability from an error report");
  const { parseOperands } = await import("../src/reflectors/cli.ts");
  const ops = parseOperands(["Usage : xmlish [options] XMLfiles ...", "xmlish [--version | --debug | --shell | --xpath XPath_expression] [XML-FILE ...]"], "xmlish");
  assert.deepEqual(ops.required, ["XMLfiles"]);
});
