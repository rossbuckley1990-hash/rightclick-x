import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";

const base = await hostSandbox();
const skip = base ? false : "no host sandbox";
async function fixture() {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-file-roles-`));
  const bin = `${dir}/fixture`;
  writeFileSync(bin, `#!/bin/sh
case "$1" in
  --help|-h) printf 'Usage: fixture [OPTIONS] [FILES]\\n  --dictionary=MAP  Read auxiliary mapping from MAP\\n'; exit 0;;
esac
dictionary=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dictionary) dictionary="$2"; shift 2;;
    --dictionary=*) dictionary="\${1#--dictionary=}"; shift;;
    -*) echo 'unsupported option' >&2; exit 64;;
    *) break;;
  esac
done
if [ -n "$dictionary" ]; then
  [ "$#" -eq 1 ] || { echo 'expected one operand with dictionary' >&2; exit 64; }
  cat "$dictionary" || exit 65
fi
if [ "$#" -gt 0 ]; then
  for file in "$@"; do printf '%s:' "$file"; cat "$file" || exit 66; done
else cat
fi
`, { mode: 0o755 });
  const calls: Array<{ args: string[]; files: Record<string, string> | undefined }> = [];
  const sandbox: Sandbox = { ...base!, async run(program, args, options) { if (options?.purpose === "execution") calls.push({ args, files: options.files }); return base!.run(program, args, options); } };
  const store = new FileStore(`${dir}/state.json`);
  const rc = await RightClick.create({ directories: [], store, authority: { investigate: [bin] }, sandbox });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.get("cli:fixture:invoke")!;
  assert.ok(cap, "generic discovery must offer the documented interface");
  return { rc, cap, bin, store, sandbox, calls };
}

test("explicit file operands separate auxiliary files and survive fresh runtime reuse", { skip }, async () => {
  const { rc, cap, bin, store, sandbox, calls } = await fixture();
  const files = { "source.txt": "payload\n", "mapping.txt": "map\n" };
  const legacy = await rc.run(cap.id, { options: ["--dictionary", "mapping.txt"], files });
  assert.equal(legacy.status, "failed", "the legacy default still explicitly means all named files as operands");
  const run = await rc.run(cap.id, { options: ["--dictionary", "mapping.txt"], files, operands: ["source.txt"] });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, "map\nsource.txt:payload\n");
  assert.deepEqual(calls.at(-1)?.args, ["--dictionary", "mapping.txt", "source.txt"]);
  assert.equal(run.verification.status, "unverified", "a correct fixture output is not a runtime independent witness");
  await rc.flush();
  let investigations = 0;
  const fresh = await RightClick.create({ directories: [], store, authority: { investigate: [bin] }, sandbox, onInvestigationStart: () => investigations++ });
  const again = await fresh.run(cap.id, { options: ["--dictionary=mapping.txt"], files: { ...files, "source.txt": "new input\n" }, operands: ["source.txt"] });
  assert.equal(again.output, "map\nsource.txt:new input\n", again.error);
  assert.equal(investigations, 0);
  await fresh.flush();
});

test("file names, content and explicit operand order are preserved without sanitization", { skip }, async () => {
  const { rc, cap } = await fixture();
  const files = JSON.parse('{"a b.txt":"space\\n","a_b.txt":"underscore\\n","é.txt":"unicode\\n","__proto__":"prototype\\n"}');
  const all = await rc.run(cap.id, { files });
  assert.equal(all.output, "a b.txt:space\na_b.txt:underscore\né.txt:unicode\n__proto__:prototype\n", all.error);
  const reordered = await rc.run(cap.id, { files, operands: ["é.txt", "a b.txt", "é.txt"] });
  assert.equal(reordered.output, "é.txt:unicode\na b.txt:space\né.txt:unicode\n", reordered.error);
  const none = await rc.run(cap.id, { input: "stdin\n", files, operands: [] });
  assert.equal(none.output, "stdin\n", none.error);
});

test("malformed files and operands refuse before execution or healing", { skip }, async () => {
  const { rc, cap, calls } = await fixture();
  const cases = [
    { files: { "-x": "flag smuggling" } }, { files: { "../escape": "x" } },
    { files: { "dir/file": "x" } }, { files: { "dir\\file": "x" } },
    { files: { "": "x" } }, { files: { ".": "x" } }, { files: { "..": "x" } },
    { files: { ".rcx.sb": "profile collision" } }, { files: { "a\0b": "x" } },
    { files: { "a.txt": "one", "A.txt": "two" } },
    { files: { "é.txt": "one", "e\u0301.txt": "two" } },
    { files: [] }, { files: "malformed map" }, { files: null },
    { files: { "ok.txt": "x" }, operands: ["missing.txt"] },
    { files: { "ok.txt": "x" }, operands: ["--dictionary"] },
    { files: { "ok.txt": "x" }, operands: "ok.txt" },
    { files: { "ok.txt": "x" }, operands: [1] },
    { files: { "ok.txt": "x" }, operands: null },
  ];
  for (const args of cases) {
    const before = calls.length;
    const run = await rc.run(cap.id, args);
    assert.equal(run.status, "failed", JSON.stringify(args));
    assert.match(run.error!, /HTTP 400 equivalent/, JSON.stringify(args));
    assert.equal(calls.length, before, "invalid input cannot execute the program");
    assert.equal(run.healing, undefined, "invalid input cannot trigger discovery or retry");
  }
});

test("host sandbox itself rejects unsafe staged names rather than rewriting them", { skip }, async () => {
  const cases: Record<string, string>[] = [{ "../rewritten.txt": "x" }, { ".rcx.sb": "x" }, { "same.txt": "1", "SAME.txt": "2" }];
  for (const files of cases) {
    await assert.rejects(base!.run("/bin/cat", [], { files }), /HTTP 400 equivalent/);
  }
});
