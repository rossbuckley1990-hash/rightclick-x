// Oracle-guided DEVELOPMENT diagnostic. These targets are exposed; no agent/holdout/economic score.
import { existsSync, writeFileSync, readFileSync, mkdtempSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/entry/node-host.ts";
import { RightClick } from "../../src/runtime.ts";
import { hostSandbox, type Sandbox, type SandboxRun } from "../../src/core/sandbox.ts";
const file = process.argv[2];
if (!file || existsSync(file)) throw new Error("provide a fresh evidence output filename");
const manifestPath = "docs/north-star/evidence/holdout-ns-freeze-1.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const targets = ["xsubpp5.34", "autom4te", "lzdiff", "exiftool"];
const base = await hostSandbox();
if (!base) throw new Error("host sandbox unavailable");
const normalized = (r: SandboxRun) => r.stdout.split(r.workDir).join("<work>").split(r.workDir.replace(/^\/private/, "")).join("<work>");
const programs: any[] = [];
for (const p of manifest.programs.filter((p: any) => targets.includes(p.name))) {
  const executions: any[] = [];
  const sandbox: Sandbox = { ...base, async run(program, args, opts) { const r = await base.run(program, args, opts); if (opts?.purpose === "execution") executions.push({ program, args, options: opts, result: r }); return r; } };
  const state = new FileStore(`${realpathSync(mkdtempSync(tmpdir()+"/rcx-cli-files-"))}/state.json`);
  let investigations = 0;
  const rc = await RightClick.create({ directories: [], store: state, authority: { investigate: [p.path] }, sandbox, onInvestigationStart: () => investigations++ });
  const learned = await rc.learn({ source: `cli:${p.path}` });
  const caps = rc.graph.list().filter(c => c.invoke.kind === "cli");
  const cap = caps.find(c => c.id.endsWith(":stdout")) ?? caps.find(c => c.id.endsWith(":invoke"));
  const observations = [];
  for (const task of p.tasks.filter((t: any) => t.kind === "feasible")) {
    const start = executions.length;
    const before = investigations;
    const direct = await base.run(p.path, task.reference.argv, { ...task.input, purpose: "execution" });
    // Interpret only exact declared option arities. Unknown flags are retained for refusal;
    // ambiguous bare arguments stop this diagnostic case rather than inventing an invocation.
    const options: string[] = [];
    let mappingError: string | undefined;
    const declared: any[] = [...rc.graph.providers.values()][0]?.meta?.investigation?.options as any[] ?? [];
    for (let i = 0; i < task.reference.argv.length; i++) {
      const token = task.reference.argv[i];
      const option = declared.find(o => o.flags.includes(token));
      if (option) {
        options.push(token);
        if (option.arg) options.push(task.reference.argv[++i]);
      } else if (token.startsWith("-")) options.push(token);
      else if (!(token in (task.input.files ?? {}))) mappingError = `unmapped non-file operand: ${token}`;
    }
    const args: Record<string, unknown> = {};
    if (cap?.invoke.kind === "cli") {
      if (cap.invoke.options) args[cap.invoke.options.port] = options;
      else if (options.length) mappingError = "no documented-options port";
      if (task.input.files && cap.invoke.filesPort) args[cap.invoke.filesPort] = task.input.files;
      if (task.input.stdin !== undefined && cap.invoke.stdin) args[cap.invoke.stdin] = task.input.stdin;
    }
    const response = cap && !mappingError ? await rc.run(cap.id, args) : null;
    const wires = executions.slice(start);
    const wire = wires.at(-1);
    const actual = wire ? normalized(wire.result) : null;
    const expected = normalized(direct);
    const expectedFragments = task.expect ?? [];
    observations.push({ task, args, mappingError, direct, response, wires, investigations: investigations - before,
      exactDirectMatch: response?.status === "completed" && actual === expected,
      responsePreservesStdout: response?.status === "completed" && response.output === wire?.result.stdout,
      referenceFragmentsPresent: expectedFragments.every((s: string) => direct.stdout.includes(s)),
    });
  }
  await rc.flush();
  programs.push({ name: p.name, path: p.path, binarySha256: createHash("sha256").update(readFileSync(p.path)).digest("hex"), learned, caps, investigations, observations });
  console.log(JSON.stringify({ name: p.name, capability: cap?.id, investigations, observations: observations.map(o => ({ id: o.task.id, exactDirectMatch: o.exactDirectMatch, referenceFragmentsPresent: o.referenceFragmentsPresent, responsePreservesStdout: o.responsePreservesStdout, mappingError: o.mappingError, error: o.response?.error, argv: o.wires.map(w => w.args) })) }));
}
const paths = [manifestPath, "src/runtime.ts", "src/core/types.ts", "src/core/sandbox.ts", "src/core/semantics.ts", "src/reflectors/cli.ts", "experiments/north-star/cli-files-diagnostic.ts"];
const sourceHashes = Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const report = { scope: "oracle-guided exposed development tasks, no model or competitive result", at: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceDirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), sourceHashes, programs };
writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
