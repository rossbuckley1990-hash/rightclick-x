// North Star Stage 3: general investigation mechanisms (documented options with arguments,
// literal operands, manual-page parsing). Synthetic programs and text only: no real program is
// used, so none is consumed before the independent holdout draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { isLiteralOperand, parseOperands, parseUsage, validateOptions } from "../src/reflectors/cli.ts";
import { spawnSync } from "node:child_process";

const spawnSyncOk = (cmd: string, args: string[]) => {
  try {
    return spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
};

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
function program(dir: string, name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

const MANPAGE = `NAME
     wrapper - wrap and number lines

SYNOPSIS
     wrapper [-n] [-w width] [-s sep] [file ...]
     unwrapper [-a] [file ...]

DESCRIPTION
     The following options are available:

     -n      Number the output lines.

     -w width
             Wrap lines longer than width columns.  The default
             is 80.

     -s sep  Use sep to separate the line number from the text.

     -t -Sm tab1, tab2, ..., tabn Sm
             Set tab stops at the given columns.

     --output=FILE
             Write the result to FILE instead of standard output.
`;

test("manual pages: lower-case argument names, wrapped descriptions and rendering artefacts are read", () => {
  const { options, synopsis } = parseUsage(MANPAGE);
  const by = (f: string) => options.find((o) => o.flags.includes(f))!;
  assert.equal(by("-n").arg, undefined);
  assert.match(by("-n").description, /Number the output lines/);
  assert.equal(by("-w").arg, "width");
  assert.match(by("-w").description, /Wrap lines longer than width columns\. The default is 80\./);
  assert.equal(by("-s").arg, "sep");
  assert.equal(by("-t").arg, "tab1, tab2, ..., tabn");
  assert.ok(!options.some((o) => o.flags.includes("-Sm")), "a rendering artefact is not an option");
  const ops = parseOperands([...synopsis, "wrapper [-n] [-w width] [-s sep] [file ...]", "unwrapper [-a] [file ...]"], "wrapper");
  assert.ok(!ops.required.includes("unwrapper"), "a sibling command in the synopsis is not an operand");
});

test("operands: values (patterns, sets, numbers) are told apart from files", () => {
  for (const n of ["string1", "set2", "pattern", "regexp", "start", "stop", "count", "delimiter", "fields"]) assert.equal(isLiteralOperand(n), true, n);
  for (const n of ["file", "file1", "input_file", "XML-FILE", "source", "archive"]) assert.equal(isLiteralOperand(n), false, n);
});

test("documented options: only documented flags and their values pass; nothing else reaches the program", () => {
  const allowed = [{ flags: ["-n"], arg: false }, { flags: ["-b"], arg: false }, { flags: ["-w", "--width"], arg: true }];
  assert.deepEqual(validateOptions(["-w", "20", "-n"], allowed), ["-w", "20", "-n"]);
  assert.deepEqual(validateOptions(["--width=20"], allowed), ["--width=20"]);
  assert.deepEqual(validateOptions(["-w20"], allowed), ["-w", "20"]);
  assert.deepEqual(validateOptions(["-nb"], allowed), ["-n", "-b"]);
  assert.deepEqual(validateOptions("-w 20", allowed), ["-w", "20"]);
  assert.throws(() => validateOptions(["-x"], allowed), /not one this program documents/);
  assert.throws(() => validateOptions(["-n", "extra"], allowed), /not one this program documents/);
  assert.throws(() => validateOptions(["-w"], allowed), /needs a value/);
  assert.throws(() => validateOptions(["--width"], [{ flags: ["-n"], arg: false }]), /not one/);
});

test("a program taking literal operands (two character sets) is investigated and runs with caller-chosen values", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "swapchars", `if [ "$1" = "--help" ]; then echo "usage: swapchars string1 string2"; echo "translate characters of string1 into string2"; exit 0; fi; [ $# -eq 2 ] || { echo "usage: swapchars string1 string2" >&2; exit 2; }; /usr/bin/tr "$1" "$2"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  const l = await rc.learn({ source: `cli:${p}` });
  assert.equal(l.results[0].error, undefined, String(l.results[0].error));
  const cap = rc.graph.list().find((c) => c.id === "cli:swapchars:default");
  assert.ok(cap, `learned: ${rc.graph.list().filter((c) => c.provider === "cli:swapchars").map((c) => c.id).join(", ") || l.results[0].probes?.[0]?.detail}`);
  assert.deepEqual(cap!.inputs.map((i) => i.name).sort(), ["input", "string1", "string2"].sort());
  assert.ok(cap!.tags.includes("direct-only"), "values the caller must choose: not composed automatically");
  const r = await rc.run(cap!.id, { string1: "abc", string2: "ABC", input: "aabbcc dd\n" });
  assert.equal(r.output, "AABBCC dd\n", String(r.error));
  const smuggled = await rc.run(cap!.id, { string1: "-d", string2: "x", input: "abc\n" });
  assert.equal(smuggled.status, "failed");
  assert.match(String(smuggled.error), /may not start with "-"/);
});

test("documented-options interface: a caller chooses a documented option with a value; undocumented ones are refused before running", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const help = `usage: folder [-w width] [-u] [file ...]
  -w width   wrap lines at width columns (default 10)
  -u         print the output in upper case
  -o file    write the output to file`;
  const p = program(dir, "folder", `if [ "$1" = "--help" ]; then cat <<'EOF'\n${help}\nEOF\nexit 0; fi\nw=10; up=0\nwhile [ $# -gt 0 ]; do case "$1" in -w) w="$2"; shift 2;; -u) up=1; shift;; -o) echo "nope" >&2; exit 3;; *) break;; esac; done\nif [ $up = 1 ]; then /usr/bin/fold -w "$w" "$@" | /usr/bin/tr a-z A-Z; else /usr/bin/fold -w "$w" "$@"; fi`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const inv = rc.graph.list().find((c) => c.id === "cli:folder:invoke");
  assert.ok(inv, rc.graph.list().map((c) => c.id).join(", "));
  assert.ok(!(inv!.invoke as any).options.allowed.some((o: any) => o.flags.includes("-o")), "an option that writes files is not offered");
  const r = await rc.run(inv!.id, { input: "abcdefghij\n", options: ["-w", "4"] });
  assert.equal(r.output, "abcd\nefgh\nij\n", String(r.error));
  const refused = await rc.run(inv!.id, { input: "abc\n", options: ["-o", "out.txt"] });
  assert.equal(refused.status, "failed");
  assert.match(String(refused.error), /excluded from this capability/);
  assert.equal(refused.healing, undefined, "a caller's mistake triggers no repair");
  const card: any = rc.card(inv!);
  assert.ok(card.verification.evidence.some((e: string) => /option -w width .* changes the output/.test(e)), card.verification.evidence.join(" | "));
});

// ------------------------------------------------------------------ Stage 4/6: retained, portable knowledge

test("capability contract: a learned program capability states its status, environment, invalidation conditions and reproduction examples", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [file]"; echo "  convert text to upper case"; exit 0; fi; /usr/bin/tr a-z A-Z`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const card: any = rc.card(rc.graph.get("cli:shout:default")!);
  assert.equal(card.contract.status, "unverified");
  assert.equal(card.contract.sourceEnvironment.program, p);
  assert.ok(card.contract.invalidatedWhen.some((x: string) => /behaviour on the stored examples differs/.test(x)));
  assert.equal(card.contract.reproduction.examples, 2);
});

test("knowledge export needs the operator's evidence-sharing authority, and carries no credential or caller data", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [file]"; echo "  convert text to upper case"; exit 0; fi; /usr/bin/tr a-z A-Z`);
  const closed = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await closed.learn({ source: `cli:${p}` });
  assert.throws(() => closed.exportKnowledge(), /evidence-sharing authority/);
  const open = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`], shareEvidence: true } });
  (open as any).net.auth.set("https://api.private.test", { Authorization: "Bearer dummy-credential-7f3a9c" });
  await open.learn({ source: `cli:${p}` });
  await open.compose({ have: { input: { type: "text", value: "private customer note 4711" } }, want: "text", intent: "convert text to upper case", run: true, publish: "Shout" } as any);
  const bundle = open.exportKnowledge();
  const text = JSON.stringify(bundle);
  assert.ok(!text.includes("dummy-credential"), "no credential");
  assert.ok(!text.includes("4711") && !text.includes("PRIVATE CUSTOMER"), "no caller input or output");
  assert.equal(bundle.programs[0].name, "shout");
  assert.ok(bundle.programs[0].capabilities.every((c: any) => c.invoke.examples?.length));
});

test("knowledge import revalidates on the receiving host: accepted when the program reproduces its examples, refused when it differs, is absent or is not authorised", { skip, timeout: 120_000 }, async () => {
  const src = tmp("rcx-src-");
  const p = program(src, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [file]"; echo "  convert text to upper case"; exit 0; fi; /usr/bin/tr a-z A-Z`);
  const exporter = await RightClick.create({ directories: [], authority: { investigate: [`${src}/`], shareEvidence: true } });
  const cold = await exporter.learn({ source: `cli:${p}` });
  const coldRuns = exporter.investigations.get(p)!.runs.length;
  const bundle = exporter.exportKnowledge();
  // Same program on the receiving host (another installation directory): accepted, cheaply.
  const dst = tmp("rcx-dst-");
  program(dst, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [file]"; echo "  convert text to upper case"; exit 0; fi; /usr/bin/tr a-z A-Z`);
  const receiver = await RightClick.create({ directories: [], authority: { investigate: [`${dst}/`] } });
  const rep = await receiver.importKnowledge(bundle);
  assert.equal(rep.programs[0].status, "accepted", JSON.stringify(rep.programs[0]));
  assert.ok(rep.programs[0].revalidationRuns < coldRuns, `revalidation (${rep.programs[0].revalidationRuns} runs) is cheaper than investigation (${coldRuns})`);
  const run = await receiver.run("cli:shout:default", { input: "abc\n" });
  assert.equal(run.output, "ABC\n");
  // A same-named program that behaves differently: refused.
  const odd = tmp("rcx-odd-");
  program(odd, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [file]"; exit 0; fi; /usr/bin/tr a-z A-Z | /usr/bin/rev`);
  const r2 = await (await RightClick.create({ directories: [], authority: { investigate: [`${odd}/`] } })).importKnowledge(bundle);
  assert.equal(r2.programs[0].status, "refused");
  assert.ok(r2.programs[0].capabilities.every((c) => c.status === "refused" && /behaves differently here/.test(c.reason ?? "")));
  // Absent, or present but not authorised: refused without running anything.
  const r3 = await (await RightClick.create({ directories: [], authority: { investigate: [`${tmp("rcx-empty-")}/`] } })).importKnowledge(bundle);
  assert.equal(r3.programs[0].status, "refused");
  assert.equal(r3.programs[0].revalidationRuns, 0);
  const r4 = await (await RightClick.create({ directories: [], authority: { investigate: [] } })).importKnowledge(bundle);
  assert.equal(r4.programs[0].status, "refused");
  assert.equal(r4.programs[0].revalidationRuns, 0);
  void cold;
});

test("documented-options interface: several named input files are passed as operands in order", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "joiner", `if [ "$1" = "--help" ]; then echo "usage: joiner [-n] [file ...]"; echo "  -n   number the output lines"; exit 0; fi; n=0; [ "$1" = "-n" ] && { n=1; shift; }; if [ $n = 1 ]; then /bin/cat "$@" | /usr/bin/nl -ba; else /bin/cat "$@"; fi`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const r = await rc.run("cli:joiner:invoke", { files: { "a.txt": "one\n", "b.txt": "two\n" } });
  assert.equal(r.output, "one\ntwo\n", String(r.error));
});

test("agent interface: unknown inputs are refused with the real ones listed; an unchanged program is not re-investigated; new sessions are told what is learned", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "shout", `if [ "$1" = "--help" ]; then echo "usage: shout [-r] [file]"; echo "  -r   reverse each line"; exit 0; fi; if [ "$1" = "-r" ]; then /usr/bin/tr a-z A-Z | /usr/bin/rev; else /usr/bin/tr a-z A-Z; fi`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const runsBefore = rc.investigations.get(p)!.runs.length;
  const bad = await rc.run("cli:shout:invoke", { input: "abc\n", reverse: true });
  assert.equal(bad.status, "failed");
  assert.match(String(bad.error), /unknown input\(s\) "reverse".*options \(optional\)/);
  assert.equal(bad.healing, undefined);
  const again = await rc.learn({ source: `cli:${p}` });
  assert.match(String(again.results[0].probes?.[0]?.detail), /already learned and unchanged/);
  assert.equal(rc.investigations.get(p)!.runs.length, runsBefore, "nothing re-run");
  assert.match(rc.retainedSummary(), /cli:shout:invoke: .*options: .*-r/);
  // A caller value named like the options port binds to it in a composition.
  const r: any = await rc.compose({ have: { input: { type: "text", value: "abc\n" }, options: { value: ["-r"], fixed: true } }, want: "text", intent: "reverse each line", through: ["cli:shout:invoke"], run: true } as any);
  assert.equal(r.executed?.output, "CBA\n", JSON.stringify(r.executed ?? r.outcome));
});

test("manual pages: arguments with optional suffixes, optional arguments, and options that write to standard output", () => {
  const page = `OPTIONS
       -t, --trace=MACRO[:FORMAT]
              trace invocations of MACRO
       --color[=WHEN]
              colourise the output; WHEN is always, never or auto
       -o toformat
           Write the file in the given format to STDOUT.
       -O outname
           Write the result to the given file instead of standard output.
`;
  const { options } = parseUsage(page);
  const by = (f: string) => options.find((o) => o.flags.includes(f));
  assert.deepEqual(by("-t")?.flags, ["-t", "--trace"]);
  assert.equal(by("-t")?.arg, "MACRO");
  assert.equal(by("--color")?.optionalArg, "WHEN");
  assert.equal(by("--color")?.arg, undefined);
  assert.equal(by("-o")?.arg, "toformat");
  const allowed = [{ flags: ["-t", "--trace"], arg: true }, { flags: ["--color"], arg: false, optionalArg: true }];
  assert.deepEqual(validateOptions(["--trace=FOO:$1", "-t", "BAR", "--color", "--color=always"], allowed), ["--trace=FOO:$1", "-t", "BAR", "--color", "--color=always"]);
});

test("documented-options interface offers options that write to standard output, not ones that write files", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const help = `usage: conv [-o toformat] [-O outname] [file]
  -o toformat   Write the data in the given format to standard output.
  -O outname    Write the result to the given file instead.`;
  const p = program(dir, "conv", `if [ "$1" = "--help" ]; then cat <<'EOF'\n${help}\nEOF\nexit 0; fi\nif [ "$1" = "-o" ]; then shift 2; /usr/bin/tr a-z A-Z; else /bin/cat; fi`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const allowed = ((rc.graph.get("cli:conv:invoke")?.invoke as any)?.options?.allowed ?? []).map((o: any) => o.flags[0]);
  assert.ok(allowed.includes("-o"), allowed.join(" "));
  assert.ok(!allowed.includes("-O"), allowed.join(" "));
});

test("synopsis spellings are retained without inventing constituent single-letter options", () => {
  const u = "Usage: compx [-v] [-csuffix csuffix] [-except] [-strip|s pattern] [-typemap typemap]... file.xs\nusage: catx [-belnstuv] [file ...]";
  const { options } = parseUsage(u);
  const flags = options.map((o) => o.flags.join("/") + (o.arg ? ` <${o.arg}>` : ""));
  for (const f of ["-v", "-csuffix <csuffix>", "-except", "-strip/-s <pattern>", "-typemap <typemap>", "-belnstuv"]) assert.ok(flags.includes(f), `${f} in ${flags.join(", ")}`);
  for (const f of ["-e", "-x", "-c", "-p", "-t", "-b", "-u"]) assert.ok(!flags.includes(f), `undeclared ${f}`);
  const allowed = options.map(o => ({ flags: o.flags, arg: !!o.arg }));
  assert.deepEqual(validateOptions(["-typemap", "my.map", "-except", "-belnstuv"], allowed), ["-typemap", "my.map", "-except", "-belnstuv"]);
  assert.throws(() => validateOptions(["-bn"], allowed), /not one this program documents/);
});

test("output that differs between identical runs only by date-times is deterministic apart from them; a behaviour-identical wrapper is still accepted", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-gen-");
  // The sandbox creates a fresh TMPDIR for every invocation. Encode its unique six-character
  // suffix injectively as decimal fractional seconds, so the date-time field changes on
  // identical runs without the 1-in-3600 collision possible with random minute/second fields.
  const body = `if [ "$1" = "--help" ]; then echo "usage: stamp [file]"; echo "  report a text with the time it was processed"; exit 0; fi; /usr/bin/tr a-z A-Z; suffix=$(printf '%s' "\${TMPDIR##*-}" | /usr/bin/od -An -v -tu1 | /usr/bin/awk '{for (i=1; i<=NF; i++) printf "%03d", $i}'); printf "Processed: 2026-10-17T14:00:00.%sZ\\n" "$suffix"`;
  const p = program(dir, "stamp", body);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const cap = rc.graph.get("cli:stamp:default")!;
  assert.equal((cap.invoke as any).volatile, "timestamps");
  assert.ok(!cap.tags.includes("nondeterministic"), cap.tags.join(","));
  // The same program behind a wrapper (another file): same behaviour, so it is not a different operation.
  const real = join(dir, "stamp.real");
  writeFileSync(real, `#!/bin/sh\n${body}\n`);
  chmodSync(real, 0o755);
  writeFileSync(p, `#!/bin/sh\nexec ${real} "$@"\n`);
  chmodSync(p, 0o755);
  const r = await rc.run(cap.id, { input: "abc\n" });
  assert.equal(r.status, "completed", String(r.error));
  assert.match(String(r.output), /^ABC\nProcessed: 2026-10-17T14:00:00\.\d+Z\n$/);
});

test("content passed as a file operand is named by what it is (JSON as .json)", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "kindof", `if [ "$1" = "--help" ]; then echo "usage: kindof file"; echo "  print the name of the file"; exit 0; fi; [ -n "$1" ] || { echo "usage: kindof file" >&2; exit 2; }; /usr/bin/basename "$1"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const cap = rc.graph.list().find((c) => c.provider === "cli:kindof" && c.id.endsWith(":default"))!;
  const port = cap.inputs[0].name;
  assert.match(String((await rc.run(cap.id, { [port]: '{"a": 1}' })).output), /\.json$/m);
  assert.match(String((await rc.run(cap.id, { [port]: "<html><body>x</body></html>" })).output), /\.html$/m);
  assert.match(String((await rc.run(cap.id, { [port]: "plain words" })).output), /\.txt$/m);
});

test("structured content (an object or array given for a json input) reaches the program as JSON", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "echojson", `if [ "$1" = "--help" ]; then echo "usage: echojson"; echo "  read JSON on standard input and print it"; exit 0; fi; /bin/cat`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const cap = rc.graph.list().find((c) => c.provider === "cli:echojson" && c.id.endsWith(":default"))!;
  const port = cap.inputs[0].name;
  assert.equal(String((await rc.run(cap.id, { [port]: [1, "two", null] })).output).trim(), '[1,"two",null]');
  assert.equal(String((await rc.run(cap.id, { [port]: { a: 1 } })).output).trim(), '{"a":1}');
});

test("investigation tries two files for numbered operands, supplies an optional pattern when nothing works without it, and offers a documented program it cannot exercise as declared only", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const cmp = program(dir, "pairdiff", `if [ "$1" = "--help" ]; then echo "Usage: pairdiff [OPTION]... FILE1 [FILE2]"; echo "Compare FILE1 to FILE2 line by line."; exit 0; fi; [ $# -eq 2 ] || { echo "pairdiff: Invalid number of operands" >&2; exit 2; }; /usr/bin/diff "$1" "$2"; exit 0`);
  const grepish = program(dir, "findlines", `if [ "$1" = "--help" ]; then echo "Usage: findlines [OPTION]... [PATTERN] [FILE]"; echo "Print lines matching PATTERN."; echo "  -c   count matching lines"; exit 0; fi; c=0; [ "$1" = "-c" ] && { c=1; shift; }; [ -n "$1" ] || { echo "Usage: findlines [OPTION]... [PATTERN] [FILE]" >&2; exit 2; }; if [ $c = 1 ]; then /usr/bin/grep -c -- "$1"; else /usr/bin/grep -- "$1"; fi`);
  const decoder = program(dir, "undecode", `if [ "$1" = "--help" ]; then echo "usage: undecode [-p] [-v] [file]"; echo "  -p   write the decoded data to standard output"; echo "  -v   verbose"; exit 0; fi; /bin/cat >/dev/null; echo "undecode: missing or bad header line" >&2; exit 1`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ sources: [`cli:${cmp}`, `cli:${grepish}`, `cli:${decoder}`] });
  const d = rc.graph.list().find((c) => c.provider === "cli:pairdiff" && c.id.endsWith(":default"));
  assert.ok(d, "two-file comparison learned");
  assert.equal(d!.inputs.filter((p) => !["options", "files"].includes(p.name)).length, 2);
  const g = rc.graph.list().find((c) => c.provider === "cli:findlines" && c.id.endsWith(":default"));
  assert.ok(g && g.inputs.some((p) => p.name.toLowerCase() === "pattern"), rc.graph.list().filter((c) => c.provider === "cli:findlines").map((c) => c.id).join(","));
  const run = await rc.run(g!.id, { [g!.inputs.find((p) => p.name.toLowerCase() === "pattern")!.name]: "bee", input: "ant\nbee\ncat bee\n" });
  assert.equal(run.output, "bee\ncat bee\n", String(run.error));
  const u = rc.graph.list().find((c) => c.provider === "cli:undecode");
  assert.ok(u && u.tags.includes("declared-only") && u.tags.includes("unsupported"), u?.tags.join(","));
  assert.equal((rc.card(u!) as any).contract.status, "observed");
  assert.equal((u!.invoke as any).behaviour, undefined, "no fingerprint, so never imported elsewhere");
});

test("a wrapper's options documented by the program it passes them to are declared", { skip: skip || (spawnSyncOk("/usr/bin/man", ["-w", "base64"]) ? false : "no manual for base64 here"), timeout: 60_000 }, async () => {
  const dir = tmp("rcx-gen-");
  const p = program(dir, "b64wrap", `if [ "$1" = "--help" ]; then echo "Usage: b64wrap [OPTION]... [FILE]"; echo "Encode FILE. OPTIONs are the same as for 'base64'."; exit 0; fi; exec /usr/bin/base64 "$@"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const inv = rc.investigations.get(p)!;
  assert.ok(inv.options.some((o) => o.flags.some((f) => f === "-d" || f === "-D" || f === "--decode") && /documented by base64/.test(o.description)), inv.options.map((o) => o.flags[0]).join(" "));
});

test("discovered JSON programs retain an exact stdout capability across stores and imports", { skip, timeout: 60_000 }, async () => {
  const { MemoryStore } = await import("./helpers.ts");
  const dir = tmp("rcx-json-output-");
  const p = program(dir, "jsonmeasure", `if [ "$1" = "--help" ]; then echo "usage: jsonmeasure"; echo "Read standard input and print JSON describing its length"; exit 0; fi; n=$(/usr/bin/wc -c); printf '{"bytes":%s}\\n' "$n"`);
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], store, authority: { investigate: [p], shareEvidence: true } });
  await rc.learn({ source: `cli:${p}` });
  const raw = rc.graph.get("cli:jsonmeasure:stdout");
  assert.ok(raw && raw.invoke.kind === "cli" && raw.invoke.stdin);
  assert.equal(raw.outputs.length, 1, "raw text cannot claim structured JSON field projections");
  assert.equal(raw.outputs[0].type, "text");
  const input = ' {"identifier":9007199254740993} \n';
  const result = await rc.run(raw.id, { [raw.invoke.stdin]: input });
  assert.equal(result.status, "completed", result.error);
  assert.equal(typeof result.output, "string");
  assert.equal(JSON.parse(String(result.output)).bytes, Buffer.byteLength(input));
  assert.equal(result.verification.status, "unverified", "preserving representation does not independently verify an outcome");
  await rc.flush();
  let investigations = 0;
  const fresh = await RightClick.create({ directories: [], store, authority: { investigate: [p] }, onInvestigationStart: () => investigations++ });
  const again = await fresh.run(raw.id, { [raw.invoke.stdin]: input + "\n" });
  assert.equal(JSON.parse(String(again.output)).bytes, Buffer.byteLength(input) + 1);
  assert.equal(investigations, 0);
  const imported = await RightClick.create({ directories: [], authority: { investigate: [p] } });
  const validation = await imported.importKnowledge(rc.exportKnowledge());
  assert.ok(validation.programs[0].capabilities.some(c => c.id === raw.id && c.status === "accepted"));
  assert.equal((await imported.run(raw.id, { [raw.invoke.stdin]: input })).output, result.output);
  const restricted = await RightClick.create({ directories: [], store, authority: { investigate: [p], execution: { allowedCapabilities: ["cli:jsonmeasure:default"] } } });
  const refused = await restricted.run(raw.id, { [raw.invoke.stdin]: input });
  assert.equal(refused.status, "failed");
  assert.match(refused.error!, /blocked by execution policy/);
});

test("an option the description lists alone takes the argument its synopsis declares, nested repetition included", () => {
  const page = [
    "usage: convertkit [-v] [-f from_format] [-o opt1[,opt2[,...]]]",
    "",
    "OPTIONS",
    "     -f",
    "         Reads the input in the given format.",
    "",
    "     -o",
    "         Options passed to the encoder.",
    "",
    "     -v",
    "         Be verbose.",
  ].join("\n");
  const { options } = parseUsage(page);
  const arg = (flag: string) => options.find((o) => o.flags.includes(flag))?.arg;
  assert.equal(arg("-f"), "from_format");
  assert.equal(arg("-o"), "opt1", "a value followed by nested repetition groups is still the option's argument");
  assert.equal(arg("-v"), undefined, "a flag the synopsis declares without a value stays a flag");
  const allowed = options.map((o) => ({ flags: o.flags, arg: !!o.arg }));
  assert.deepEqual(validateOptions(["-o", "canonical", "-v"], allowed), ["-o", "canonical", "-v"]);
  assert.throws(() => validateOptions(["-o"], allowed), /needs a value/);
});
