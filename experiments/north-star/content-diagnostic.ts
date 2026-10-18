// Known development target only. Isolate data fidelity; no model/holdout/economic claim.
import { writeFileSync, readFileSync, mkdtempSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/entry/node-host.ts";
import { RightClick } from "../../src/runtime.ts";
import { hostSandbox, type Sandbox } from "../../src/core/sandbox.ts";
const file = process.argv[2];
if (!file) throw new Error("provide a fresh evidence output filename");
const bin = "/usr/bin/json_xs";
const base = await hostSandbox();
if (!base) throw new Error("host sandbox unavailable");
const executions: any[] = [];
const sandbox: Sandbox = { ...base, async run(program, args, opts) { const r = await base.run(program, args, opts); if (opts?.purpose === "execution") executions.push({ program, args, stdin: opts.stdin, stdout: r.stdout, code: r.code }); return r; } };
const state = new FileStore(`${realpathSync(mkdtempSync(tmpdir()+"/rcx-fidelity-state-"))}/state.json`);
const rc = await RightClick.create({ directories: [], store: state, authority: { investigate: [bin] }, sandbox });
const learned = await rc.learn({ source: `cli:${bin}` });
const cap = rc.graph.list().find(c => c.invoke.kind === "cli" && c.id.endsWith(":default"));
if (!cap || cap.invoke.kind !== "cli" || !cap.invoke.stdin) throw new Error(`no learned stdin capability: ${JSON.stringify(learned)}`);
const cases = [
  { name: "whitespace", input: ' { "name" : "same", "count" : 2 }\n' },
  { name: "integer-precision", input: '{"account":9007199254740993}\n' },
  { name: "duplicate-key", input: '{"value":1,"value":2}\n' },
  { name: "structured-object", input: { name: "structured", count: 2 } },
];
const observations = [];
for (const c of cases) {
  const bytes = typeof c.input === "string" ? c.input : JSON.stringify(c.input);
  const direct = await base.run(bin, [], { stdin: bytes });
  const response = await rc.run(cap.id, { [cap.invoke.stdin]: c.input });
  const wire = executions.at(-1);
  const rawCap = rc.graph.get(`${cap.provider}:stdout`);
  const rawResponse = rawCap ? await rc.run(rawCap.id, { [(rawCap.invoke as any).stdin]: c.input }) : null;
  const rawWire = rawResponse ? executions.at(-1) : null;
  observations.push({ ...c, direct, response, wire, suppliedInputPreserved: wire?.stdin === bytes, rawResponse, rawWire, rawOutputPreserved: rawResponse?.status === "completed" && rawResponse.output === rawWire?.stdout, rawMatchesDirect: rawResponse?.output === direct.stdout });
}
await rc.flush();
let freshInvestigations = 0;
const fresh = await RightClick.create({ directories: [], store: state, authority: { investigate: [bin] }, sandbox, onInvestigationStart: () => freshInvestigations++ });
const freshCap = fresh.graph.get(`${cap.provider}:stdout`);
const newInput = '{"account":9007199254740995}\n';
const freshResponse = freshCap ? await fresh.run(freshCap.id, { [(freshCap.invoke as any).stdin]: newInput }) : null;
const freshReuse = { investigations: freshInvestigations, input: newInput, response: freshResponse, wire: executions.at(-1), correct: freshResponse?.status === "completed" && typeof freshResponse.output === "string" && freshResponse.output.includes("9007199254740995") };
const sourceFiles = ["src/runtime.ts", "src/core/json.ts", "src/core/semantics.ts", "src/reflectors/cli.ts", "experiments/north-star/content-diagnostic.ts"];
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const report = { sourceHashes, sourceDirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), freshReuse, scope: "known development target, no model or competitive result", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), capability: cap, observations };
writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ capability: cap.id, freshReuse, observations: observations.map(o => ({ name: o.name, suppliedInputPreserved: o.suppliedInputPreserved, input: o.input, wireInput: o.wire?.stdin, rawOutput: o.wire?.stdout, status: o.response.status, exposedOutput: o.response.output, rawOutputPreserved: o.rawOutputPreserved, rawMatchesDirect: o.rawMatchesDirect })) }, null, 2));
