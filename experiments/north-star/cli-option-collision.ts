// Exposed development regression: excluded long options must not masquerade as compact short flags.
import { existsSync, mkdtempSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { RightClick } from "../../src/runtime.ts";
import { hostSandbox, type Sandbox } from "../../src/core/sandbox.ts";
const output = process.argv[2];
if (!output || existsSync(output)) throw new Error("provide a new output path");
const base = await hostSandbox();
if (!base) throw new Error("host sandbox required");
const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-option-collision-`));
const program = `${dir}/format-records`;
const body = `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf 'Usage: format-records [OPTIONS] [FILES]\\n  -d FORMAT  Print using FORMAT\\n  -delete    Delete all supplied input files\\n  -r         Report records\\n  -e         Echo records\\n  -a         Annotate records\\n  -s         Summarize records\\n  -erase     Delete all supplied input files\\n'
  exit 0
fi
case "$1" in
  -delete|-erase) shift; rm -f "$@"; printf 'REMOVED\\n'; exit 0;;
  -d) format="$2"; shift 2; printf 'FORMAT:%s\\n' "$format";;
  -d*) printf 'FORMAT:%s\\n' "\${1#-d}"; shift;;
  -r|-e|-a|-s) shift;;
  -*) printf 'unsupported option\\n' >&2; exit 64;;
esac
if [ "$#" -gt 0 ]; then cat "$@"; else cat; fi
`;
writeFileSync(program, body, { mode: 0o755 });
const wires: any[] = [];
const sandbox: Sandbox = { ...base, async run(bin, args, opts) { const result = await base.run(bin, args, opts); if (opts?.purpose === "execution") wires.push({ args, options: opts, result }); return result; } };
const rc = await RightClick.create({ directories: [], authority: { investigate: [program] }, sandbox });
await rc.learn({ source: `cli:${program}` });
const cap = rc.graph.get("cli:format-records:invoke");
if (!cap) throw new Error("generic fixture did not yield an invocation capability");
const cases = [];
for (const options of [["-d", "compact"], ["-dcompact"], ["-delete"], ["-erase"]]) {
  const start = wires.length;
  const response = await rc.run(cap.id, { options, files: { "record.txt": "record content\n" } });
  cases.push({ options, response, wires: wires.slice(start) });
}
const sourceHashes = Object.fromEntries(["src/runtime.ts", "src/core/types.ts", "src/reflectors/cli.ts", "experiments/north-star/cli-option-collision.ts"].map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
const report = { scope: "synthetic sandbox-local option ambiguity; not a containment escape or model benchmark", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceDirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), sourceHashes, programSource: body, capability: cap, cases };
writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(cases.map(c => ({ options: c.options, status: c.response.status, output: c.response.output, error: c.response.error, dispatches: c.wires.length, argv: c.wires.map(w => w.args) })), null, 2));
