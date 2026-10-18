// Disposable format-specific programs expose duplicate probe inputs without
// adding format- or application-specific integration to the runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick, SEMANTICS } from "../src/runtime.ts";
import { samplesFor } from "../src/reflectors/cli.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";
import { MemoryStore } from "./helpers.ts";

const native = await hostSandbox();
const skip = native ? false : "no host sandbox";
type Format = "json" | "xml" | "csv";
const input: Record<Format, string> = { json: '{"unseen":[17,"later"]}\n', xml: '<?xml version="1.0"?><item>unseen</item>\n', csv: 'name,count\nunseen,17\n' };

async function fixture(format: Format, pair = false, control?: "constant" | "singleton") {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-probe-coverage-`));
  const program = `${dir}/structured`;
  const pattern = format === "json" ? "'{'*" : format === "xml" ? "'<?xml'*" : "'name,count'*";
  const first = samplesFor("structured data", 7).find(s => s.kind === format)!.content.trimEnd();
  writeFileSync(program, `#!/bin/sh
if [ "$1" = "--help" ]; then printf 'usage: structured ${pair ? "FILE1 FILE2" : "[FILE]"}\\n'; exit 0; fi
${pair ? '[ "$#" = 2 ] || exit 65\na=$(cat "$1"); b=$(cat "$2"); input="$a"' : '[ "$#" = 0 ] || exit 65\ninput=$(cat)'}
case "$input" in ${pattern}) ;; *) exit 65;; esac
${pair ? `case "$b" in ${pattern}) ;; *) exit 65;; esac` : ""}
${control === "singleton" ? `[ "$input" = '${first.replaceAll("'", "'\\''")}' ] || exit 65` : ""}
${control === "constant" ? "printf 'constant output\\n'" : pair ? 'printf \'%s\\n%s\\n\' "$a" "$b"' : 'printf \'%s\\n\' "$input"'}
`, { mode: 0o755 });
  const wires: Array<{ args: string[]; stdin?: string; files?: Record<string, string>; purpose?: string }> = [];
  const sandbox: Sandbox = { ...native!, async run(bin, args, opts = {}) {
    if (bin === program) wires.push({ args, stdin: opts.stdin, files: opts.files, purpose: opts.purpose });
    return native!.run(bin, args, opts);
  } };
  const store = new MemoryStore();
  const create = (authorised = true) => RightClick.create({ directories: [], network: { origins: [], blockPrivate: true },
    authority: { investigate: authorised ? [program] : [], execute: authorised ? [program] : [] }, sandbox, store,
    fetch: async () => { throw new Error("unexpected network request"); },
  });
  const rc = await create();
  await rc.learn({ source: `cli:${program}` });
  return { rc, create, store, wires, program };
}

test("structured unary programs receive distinct probes and compose on unseen input", { skip }, async () => {
  for (const format of ["json", "xml", "csv"] as const) {
    const f = await fixture(format);
    const cap = f.rc.graph.get("cli:structured:default")!;
    assert.ok(cap, format);
    assert.ok(!cap.tags.includes("unsupported"), `${format}: distinct evidence was not established`);
    const probes = f.wires.filter(w => w.purpose === "investigation" && w.args.length === 0 && w.stdin?.startsWith(format === "json" ? "{" : format === "xml" ? "<?xml" : "name,count"));
    assert.ok(new Set(probes.map(w => w.stdin)).size >= 2, format);
    const before = f.wires.length;
    const run = await f.rc.compose({ have: { [cap.inputs[0].name]: { type: cap.inputs[0].type, value: input[format] } }, want: cap.outputs[0].type, through: [cap.id], origins: [], run: true });
    assert.equal(run.executed?.status, "completed", JSON.stringify(run));
    assert.deepEqual(run.executed?.output, format === "json" ? JSON.parse(input[format]) : input[format]);
    assert.notEqual(run.executed?.verification.status, "verified");
    assert.equal(f.wires.slice(before).filter(w => w.purpose === "execution").length, 1);
    assert.ok(!f.rc.investigations.get(f.program)!.claims.some(c => c.status === "verified"));
  }
});

test("structured two-file programs receive two distinct pairs, then compose both new inputs", { skip }, async () => {
  for (const format of ["json", "xml", "csv"] as const) {
    const f = await fixture(format, true);
    const cap = f.rc.graph.get("cli:structured:default")!;
    assert.ok(cap && !cap.tags.includes("unsupported"), format);
    assert.equal(cap.inputs.length, 2);
    const matching = f.wires.filter(w => w.purpose === "investigation" && w.files && Object.keys(w.files).length === 2 && Object.keys(w.files)[0].endsWith(`.${format}`));
    assert.ok(new Set(matching.map(w => JSON.stringify(w.files))).size >= 2, format);
    const second = input[format].replace("unseen", "different");
    const run = await f.rc.compose({ have: {
      [cap.inputs[0].name]: { type: cap.inputs[0].type, value: input[format] },
      [cap.inputs[1].name]: { type: cap.inputs[1].type, value: second },
    }, want: "text", through: [cap.id], origins: [], run: true });
    assert.equal(run.executed?.status, "completed", JSON.stringify(run));
    assert.equal(run.executed?.output, input[format] + second);
  }
});

test("more synthetic samples do not promote constant output or one successful distinct input", { skip }, async () => {
  for (const control of ["constant", "singleton"] as const) {
    const f = await fixture("json", false, control);
    const cap = f.rc.graph.get("cli:structured:default")!;
    assert.ok(cap && cap.tags.includes("unsupported"), control);
    const before = f.wires.length;
    const run = await f.rc.compose({ have: { document: { type: "json", value: input.json } }, want: cap.outputs[0].type, through: [cap.id], run: true, origins: [] });
    assert.equal(run.executed, undefined);
    assert.equal(f.wires.length, before, "insufficient evidence must not dispatch");
  }
});

test("old CLI inference is re-derived on upgrade only under current program authority", { skip }, async () => {
  for (const authorised of [true, false]) {
    const f = await fixture("json");
    const built = await f.rc.compose({ have: { json: { type: "json", value: input.json } }, want: "json", through: ["cli:structured:default"], run: true, publish: "migration pin", origins: [] });
    assert.equal(built.executed?.status, "completed");
    await f.rc.flush();
    f.store.state!.semantics = SEMANTICS - 1;
    // A saved goal's original operation must not be rewritten to the new inference.
    f.store.state!.published![0].anchors![0].operation = "original-operation-not-reestablished";
    const before = f.wires.length;
    const fresh = await f.create(authorised);
    const cap = fresh.graph.get("cli:structured:default");
    if (authorised) {
      assert.ok(f.wires.slice(before).some(w => w.purpose === "investigation"), "changed inference must not reuse a byte-only cache");
      assert.ok(cap && !cap.tags.includes("unsupported"));
    } else {
      assert.equal(cap, undefined, "old inference is not executable after refused migration");
      assert.equal(f.wires.length, before);
    }
    const callsBefore = f.wires.length;
    const goal = await fresh.run("goal:migration-pin", { json: input.json });
    assert.equal(goal.status, "failed");
    assert.match(goal.error!, /anchor/);
    assert.equal(f.wires.length, callsBefore);
    await fresh.flush();
    assert.equal(f.store.state?.semantics, SEMANTICS);
  }
});
