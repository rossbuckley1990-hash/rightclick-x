import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";
import { investigateCli, parseCommandList, parseHelpTopics, parseSubcommands, parseUsage } from "../src/reflectors/cli.ts";

test("subcommand sections and bare command lists are read without inventing help topics", () => {
  const click = [
    "Usage: tool [OPTIONS] COMMAND [ARGS]...",
    "",
    "Options:",
    "  --json  JSON output.",
    "",
    "Commands:",
    "  report  Report records.",
    "  delete-invoice  Delete one invoice through the API.",
    "",
  ].join("\n");
  assert.deepEqual(parseSubcommands(click).map((c) => c.name), ["report", "delete-invoice"]);
  assert.equal(parseSubcommands(click)[1].description, "Delete one invoice through the API.");

  // A help topic list is prose ("tool help flags"), not a command named "tool".
  const topics = ["Type 'tool help {topic}' for:", "Verbs:", "  tool help list-verbs", "  tool help usage-verbs"].join("\n");
  assert.deepEqual(parseSubcommands(topics), []);
  assert.deepEqual(parseHelpTopics(topics), ["list-verbs", "usage-verbs"]);

  const bare = parseCommandList("sort\nfilter\ncount-distinct\n", "mlr");
  assert.deepEqual(bare.map((c) => c.name), ["sort", "filter", "count-distinct"]);
  assert.deepEqual(parseCommandList("total 12\ndrwxr-xr-x user staff 4096 file\n", "ls"), []);
});

test("brace metavariables are option arguments, and command-running options stay refused", () => {
  const parsed = parseUsage(["Usage: tool filter [OPTIONS] {expression}", "Options:", "  -e {expression}  Evaluate expression.", "  --prepipe {command}  Pipe input through a command."].join("\n"));
  assert.equal(parsed.options.find((o) => o.flags.includes("-e"))?.arg, "expression");
  assert.equal(parsed.options.find((o) => o.flags.includes("--prepipe"))?.arg, "command");
});

const base = await hostSandbox();

test("a declared dispatcher yields executable subcommands with global options before the verb and local options after it", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-subcommands-`));
  const bin = `${dir}/report-tool`;
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: report-tool [OPTIONS] COMMAND [ARGS]...

Options:
  --json  Machine-readable JSON output.
  --api-base TEXT  API base URL.
  --help  Show this message and exit.

Commands:
  report  Report records.
  delete  Delete records.
EOF
  exit 0
fi
if [ "$1" = "report" ] && [ "$2" = "--help" ]; then
  cat <<'EOF'
Usage: report-tool report [OPTIONS] [FILE]

  Report records from FILE.

Options:
  -r REGION  Region to keep.  [required]
  -n NUM     Number.  [required]
  -e {expression}  Expression to evaluate.
  --columns TEXT  Columns.  [default: a,b]
  --prepipe {command}  Pipe input through a command.
  --help  Show this message and exit.
EOF
  exit 0
fi
if [ "$1" = "delete" ] && [ "$2" = "--help" ]; then
  cat <<'EOF'
Usage: report-tool delete [OPTIONS] [FILE]

  Delete records.

Options:
  --id TEXT  Record id.  [required]
  --help  Show this message and exit.
EOF
  exit 0
fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    -*) shift;;
    *) break;;
  esac
done
if [ "$1" = "report" ]; then
  shift
  printf 'ARGV'
  for a in "$@"; do printf ' [%s]' "$a"; done
  printf '\\n'
  for last in "$@"; do :; done
  if [ -f "$last" ]; then cat "$last"; fi
  exit 0
fi
if [ "$1" = "delete" ]; then
  printf 'DELETED\\n'
  exit 0
fi
exit 2
`, { mode: 0o755 });

  const calls: string[][] = [];
  const sandbox: Sandbox = { ...base!, async run(program, args, options) { if (options?.purpose === "execution") calls.push(args); return base!.run(program, args, options); } };
  const rc = await RightClick.create({ directories: [], sandbox, authority: { investigate: [bin] }, store: new FileStore(`${dir}/state.json`) });
  await rc.learn({ source: `cli:${bin}` });

  const report = rc.graph.get("cli:report-tool:report")!;
  const del = rc.graph.get("cli:report-tool:delete")!;
  assert.equal(report.invoke.kind === "cli" && report.invoke.options?.port, "global_options");
  assert.equal(report.invoke.kind === "cli" && report.invoke.optionsAfterArgs?.port, "options");
  assert.ok(report.invoke.kind === "cli" && report.invoke.args[0] === "report");
  assert.ok(report.invoke.kind === "cli" && report.invoke.optionsAfterArgs?.allowed.some((o) => o.flags.includes("-e") && o.arg));
  assert.ok(report.invoke.kind === "cli" && report.invoke.optionsAfterArgs?.excluded?.includes("--prepipe"));
  assert.ok(report.invoke.kind === "cli" && report.invoke.options?.excluded?.includes("--api-base"), "a read subcommand keeps network options refused");
  assert.equal(del.risk, "destructive");
  assert.ok(del.invoke.kind === "cli" && del.invoke.options?.allowed.some((o) => o.flags.includes("--api-base")), "the external destructive subcommand may name its API");

  const ran = await rc.run(report.id, {
    global_options: ["--json"],
    options: ["-r", "EMEA", "-n", "5", "-e", "amount>1", "--columns", "a,b"],
    files: { "input.csv": "ID,AMOUNT\n1,5\n" },
    operands: ["input.csv"],
  });
  assert.equal(ran.status, "completed", ran.error);
  assert.deepEqual(calls.at(-1), ["--json", "report", "-r", "EMEA", "-n", "5", "-e", "amount>1", "--columns", "a,b", "input.csv"]);
  assert.match(String(ran.output), /^ARGV \[-r\] \[EMEA\]/);
  assert.match(String(ran.output), /ID,AMOUNT/);

  const before = calls.length;
  await assert.rejects(rc.run(del.id, { options: ["--id", "1"], operands: [] }), /operator/i);
  assert.equal(calls.length, before, "an unapproved destructive subcommand never reaches the program");
});

test("a help-implied bare list is investigated as subcommands", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-verb-list-`));
  const bin = `${dir}/list-tool`;
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf 'Usage: list-tool [flags] [verb] [args]\\n\\nVerbs are listed with -l.\\n'
  exit 0
fi
if [ "$1" = "-l" ]; then
  printf 'alpha\\nbeta\\ngamma\\n'
  exit 0
fi
if [ "$1" = "alpha" ] && [ "$2" = "--help" ]; then
  printf 'Usage: list-tool alpha [OPTIONS]\\n\\n  Do alpha.\\n\\nOptions:\\n  -x  Export.\\n'
  exit 0
fi
if [ "$1" = "beta" ] && [ "$2" = "--help" ]; then
  printf 'Usage: list-tool beta [OPTIONS]\\n\\n  Do beta.\\n\\nOptions:\\n  -y  Yield.\\n'
  exit 0
fi
exit 2
`, { mode: 0o755 });
  const { reflection, investigation } = await investigateCli(bin, base!);
  assert.ok(reflection);
  assert.deepEqual(reflection!.capabilities.map((c) => c.id), ["cli:list-tool:alpha", "cli:list-tool:beta"]);
  assert.match(investigation.summary, /3 commands discovered/);
  assert.ok(reflection!.capabilities.every((c) => c.invoke.kind === "cli" && c.invoke.args[0] === c.id.split(":").pop()));
});
