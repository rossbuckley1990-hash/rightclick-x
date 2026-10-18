import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";
import { validateOptions } from "../src/reflectors/cli.ts";

test("known exclusions precede all compact-option encodings and conflicting allowed aliases", () => {
  const allowed = [{ flags: ["-d"], arg: true }, ...["-e", "-r", "-a", "-s"].map(f => ({ flags: [f], arg: false })), { flags: ["--erase"], arg: true }];
  for (const token of ["-delete", "-delete=value", "-erase", "--erase=value", "--erase"]) {
    assert.throws(() => validateOptions([token], allowed, ["-delete", "-erase", "--erase"]), /excluded.*HTTP 400 equivalent/);
  }
  assert.throws(() => validateOptions(["-dvalue"], allowed, ["-d"]), /excluded/);
  assert.throws(() => validateOptions(["-ra"], allowed, ["-a"]), /not one/);
  assert.deepEqual(validateOptions(["-dvalue", "-ra"], allowed), ["-d", "value", "-r", "-a"]);
  assert.throws(() => validateOptions(["-ra"], [{ flags: ["-r"], arg: false, optionalArg: true }, { flags: ["-a"], arg: false }]), /not one/, "optional argument ambiguity must not be guessed");
});

const base = await hostSandbox();
test("excluded long options never dispatch through compact syntax, persistence or import", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-option-grammar-`));
  const bin = `${dir}/report-records`;
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf 'Usage: report-records [OPTIONS] [FILES]\\n  -d FORMAT  Print using FORMAT\\n  -delete    Delete supplied files\\n  -r         Report records\\n  -e         Echo records\\n  -a         Annotate records\\n  -s         Summarize records\\n  -erase     Delete supplied files\\n'
  exit 0
fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    -delete|-erase) shift; rm -f "$@"; echo REMOVED; exit 0;;
    -d) printf 'FORMAT:%s\\n' "$2"; shift 2;;
    -r|-e|-a|-s) shift;;
    -*) echo unsupported >&2; exit 64;;
    *) break;;
  esac
done
if [ "$#" -gt 0 ]; then cat "$@"; else cat; fi
`, { mode: 0o755 });
  const calls: string[][] = [];
  let investigations = 0;
  const sandbox: Sandbox = { ...base!, async run(program, args, options) { if (options?.purpose === "execution") calls.push(args); return base!.run(program, args, options); } };
  const store = new FileStore(`${dir}/state.json`);
  const config = { directories: [], sandbox, authority: { investigate: [bin], shareEvidence: true }, onInvestigationStart: () => investigations++ };
  const first = await RightClick.create({ ...config, store });
  await first.learn({ source: `cli:${bin}` });
  const id = "cli:report-records:invoke";
  const cap = first.graph.get(id)!;
  assert.ok(cap?.invoke.kind === "cli");
  assert.ok(cap.invoke.options?.excluded?.includes("-delete"));
  assert.ok(cap.invoke.options?.excluded?.includes("-erase"));
  const args = { files: { "records.txt": "input record\n" } };
  const read = await first.run(id, { ...args, options: ["-dcompact", "-ra"] });
  assert.equal(read.output, "FORMAT:compact\ninput record\n", read.error);
  assert.deepEqual(calls.at(-1), ["-d", "compact", "-r", "-a", "records.txt"]);
  await first.flush();
  const persisted = await RightClick.create({ ...config, store });
  const imported = await RightClick.create(config);
  const importedReport = await imported.importKnowledge(first.exportKnowledge());
  assert.ok(imported.graph.get(id), JSON.stringify(importedReport));
  const beforeCalls = calls.length, beforeInvestigations = investigations;
  for (const rc of [first, persisted, imported]) {
    for (const option of ["-delete", "-erase"]) {
      const denied = await rc.run(id, { ...args, options: [option] });
      assert.equal(denied.status, "failed");
      assert.match(denied.error!, /excluded.*HTTP 400 equivalent/);
      assert.equal(denied.healing, undefined);
    }
  }
  assert.equal(calls.length, beforeCalls, "no excluded option reached the program");
  assert.equal(investigations, beforeInvestigations, "input refusal cannot trigger rediscovery");
  await persisted.flush();
});
