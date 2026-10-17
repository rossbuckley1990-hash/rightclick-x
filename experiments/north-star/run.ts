// Competitive benchmark, Domain 1 (EVALUATION-PLAN.md §5–6).
//   node experiments/north-star/run.ts <freeze-tag> [--holdout file] [--arms A,B,C,D] [--programs a,b] [--out file]
// Resumable: finished sessions are kept and skipped; sessions blocked by a usage limit are retried.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OUT, claudeSession, extract, matches, readJsonl, type Task } from "./common.ts";

const args = process.argv.slice(2);
const TAG = args[0];
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i > 0 ? args[i + 1] : undefined;
};
const HOLDOUT = opt("holdout") ?? `${OUT}/holdout-${TAG}.json`;
const RESULTS = opt("out") ?? `${OUT}/benchmark-${TAG}.json`;
const ARMS = (opt("arms") ?? "A,B,C,D").split(",");
const ONLY = opt("programs")?.split(",");
const MODEL = "sonnet";

const COMMIT = execFileSync("git", ["rev-parse", `${TAG}^{commit}`], { encoding: "utf8" }).trim();
const WORK = realpathSync(tmpdir()) + `/ns-bench-${TAG}`;
const BUILD = `${WORK}/build`;
if (!existsSync(`${BUILD}/bin/rcx.ts`)) {
  mkdirSync(BUILD, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${TAG} | tar -x -C ${JSON.stringify(BUILD)}`]);
}
const SURFACE = resolve(`${BUILD}/experiments/north-star/surface.ts`);
const holdout = JSON.parse(readFileSync(HOLDOUT, "utf8"));
const results: any = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : { tag: TAG, commit: COMMIT, model: MODEL, holdout: HOLDOUT, sessions: [] };
const save = () => writeFileSync(RESULTS, JSON.stringify(results, null, 2));
const done = (key: string) => results.sessions.some((s: any) => s.key === key && !s.blocked);

type Step = { step: string; phase: "first" | "reuse" | "infeasible" | "compatible-change" | "incompatible-change" | "removed"; task: Task; mutate?: (bin: string, real: string) => void };

const writeExec = (file: string, body: string) => {
  try {
    unlinkSync(file);
  } catch {
    /* absent */
  }
  writeFileSync(file, body);
  chmodSync(file, 0o755);
};
function steps(p: any): Step[] {
  const f = p.tasks.filter((t: Task) => t.kind === "feasible");
  const inf = p.tasks.find((t: Task) => t.kind === "infeasible");
  return [
    { step: "t1", phase: "first", task: f[0] },
    ...f.slice(1, 4).map((t: Task, i: number) => ({ step: `t${i + 2}`, phase: "reuse" as const, task: t })),
    ...(inf ? [{ step: "infeasible", phase: "infeasible" as const, task: inf }] : []),
    // Same behaviour, a different file (another installation, a wrapper).
    { step: "compatible", phase: "compatible-change", task: f[0], mutate: (bin: string, real: string) => writeExec(bin, `#!/bin/sh\nexec ${real} "$@"\n`) },
    // Different behaviour under the same path: every output line comes back reversed.
    { step: "incompatible", phase: "incompatible-change", task: f[1] ?? f[0], mutate: (bin: string, real: string) => writeExec(bin, `#!/bin/sh\n${real} "$@" | /usr/bin/rev\n`) },
    { step: "removed", phase: "removed", task: f[2] ?? f[0], mutate: (bin: string) => rmSync(bin, { force: true }) },
  ].filter((s) => s.task) as Step[];
}

function describeInput(t: Task): string {
  const parts: string[] = [];
  if (t.input.stdin !== undefined) parts.push(`Standard input:\n<<<\n${t.input.stdin}>>>`);
  for (const [name, content] of Object.entries(t.input.files ?? {})) parts.push(`File ${name}:\n<<<\n${content}>>>`);
  return parts.join("\n\n") || "(no input)";
}

function prompt(arm: string, p: any, bin: string, t: Task): string {
  const preface: Record<string, string> = {
    A: `You have one MCP tool, run_program, which runs the program ${bin} in a sandbox. Use only it.`,
    B: `You have one MCP tool, run_program, which runs the program ${bin} in a sandbox. Use only it.\n\nDocumentation of the program:\n${p.docs}`,
    C: `You have an MCP tool run_program, which runs the program ${bin} in a sandbox, and a persistent skill store (list_skills, read_skill, save_skill) kept across sessions. Check your skills first. After you produce a correct result, save what you learned as a skill so later sessions can reuse it.`,
    D: `You are connected to RightClick X (its context_* tools). Use only them. The operator has authorised the program ${bin}; RightClick X may already hold capabilities learned earlier for it. After you produce a correct result, save what worked as a reusable capability (context_compose with publish) so later sessions can reuse it.`,
  };
  return [
    preface[arm],
    "",
    `Task for the program ${bin}:`,
    t.request,
    "",
    describeInput(t),
    "",
    "Use your tools to run the program and produce the result; do not compute or write the result yourself. Check that the result is correct for the request.",
    "If it cannot be done correctly with this program, reply with a line 'UNABLE: <reason>' instead of a result.",
    "Otherwise reply with the exact result between a line containing only BEGIN and a line containing only END.",
  ].join("\n");
}

for (const p of holdout.programs) {
  if (ONLY && !ONLY.includes(p.name)) continue;
  for (const arm of ARMS) {
    const ENV = `${WORK}/env/${arm}/${p.name}`;
    const BIN = `${ENV}/bin`;
    const bin = `${BIN}/${p.name}`;
    mkdirSync(BIN, { recursive: true });
    for (const s of steps(p)) {
      const key = `${arm}|${p.name}|${s.step}`;
      // Environment state for this step, rebuilt deterministically (resumable): the original link
      // before the change phase, then each change in turn.
      const order = ["t1", "t2", "t3", "t4", "infeasible", "compatible", "incompatible", "removed"];
      const idx = order.indexOf(s.step);
      try {
        unlinkSync(bin);
      } catch {
        /* absent */
      }
      symlinkSync(p.path, bin);
      for (const prior of steps(p).filter((x) => x.mutate && order.indexOf(x.step) <= idx)) prior.mutate!(bin, p.path);
      if (done(key)) continue;
      const dir = realpathSync(mkdtempSync(join(tmpdir(), `ns-${arm}-`)));
      const log = `${dir}/calls.jsonl`;
      const servers =
        arm === "D"
          ? { "rightclick-x": { command: process.execPath, args: [`${BUILD}/bin/rcx.ts`, "mcp"], env: { RCX_STATE_FILE: `${ENV}/state.json`, RCX_MCP_LOG: log, RCX_WORKSPACE: dir, RCX_INVESTIGATE: bin } } }
          : { surface: { command: process.execPath, args: [SURFACE], env: { DS_PROGRAM: bin, DS_LOG: log, ...(arm === "C" ? { DS_SKILLS: `${ENV}/skills` } : {}) } } };
      const r = await claudeSession({ prompt: prompt(arm, p, bin, s.task), servers, allowed: arm === "D" ? "mcp__rightclick-x" : "mcp__surface", model: MODEL });
      const calls = readJsonl(log);
      const executed = arm === "D" ? calls.some((c) => (c.tool === "context_run" || (c.tool === "context_compose" && c.args?.run)) && c.ok) : calls.some((c) => c.tool === "run_program");
      const { answer, unable } = extract(r.reply);
      const matchesOracle = answer !== undefined && s.task.kind === "feasible" && matches(s.task, answer);
      const wantsRefusal = s.phase === "infeasible" || s.phase === "incompatible-change" || s.phase === "removed";
      const correct = wantsRefusal ? !!unable && answer === undefined : matchesOracle && executed;
      const wrong = !correct && answer !== undefined;
      const skills = arm === "C" ? readJsonl(log).filter((c) => c.tool === "save_skill").reduce((n, c) => n + (c.bytes ?? 0), 0) : 0;
      const entry = {
        key, arm, program: p.name, step: s.step, phase: s.phase, task: s.task.id,
        correct, wrong, matchesOracle, unable: unable ?? null, answered: answer !== undefined, executed,
        seconds: r.seconds, turns: r.turns, tokens: r.tokens, costUsd: r.costUsd, toolCalls: calls.length,
        tools: calls.map((c) => c.tool), skillBytesSaved: skills,
        ...(r.blocked ? { blocked: r.blocked } : {}),
        reply: r.reply.slice(0, 4000),
      };
      results.sessions = results.sessions.filter((x: any) => x.key !== key);
      results.sessions.push(entry);
      save();
      console.log(`${key}: ${r.blocked ? `BLOCKED ${r.blocked.slice(0, 80)}` : correct ? "correct" : wrong ? "WRONG" : "not correct"} · ${r.seconds}s · ${calls.length} calls · ${r.tokens ?? "?"} tokens${unable ? ` · UNABLE: ${unable.slice(0, 80)}` : ""}`);
      if (r.blocked) {
        console.log("usage limit reached: stopping; re-run this command to resume on the same freeze");
        process.exit(2);
      }
    }
  }
}
console.log(`done: ${results.sessions.length} sessions in ${RESULTS}`);
