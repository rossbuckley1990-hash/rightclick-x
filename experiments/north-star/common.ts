// Shared pieces of the North Star benchmark (docs/north-star/EVALUATION-PLAN.md): the sandboxed
// reference oracle, comparison modes, agent sessions and statistics. Nothing here knows any program.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostSandbox } from "../../src/core/sandbox.ts";
import { quotaBlock } from "./quota.ts";

export const OUT = "docs/north-star/evidence";

// ---------------------------------------------------------------- tasks and the oracle

export interface TaskInput {
  stdin?: string;
  files?: Record<string, string>;
}
export interface Task {
  id: string;
  program: string;
  kind: "feasible" | "infeasible";
  request: string;
  input: TaskInput;
  reference?: { argv: string[] };
  compare?: "exact" | "trim" | "whitespace" | "lines-unordered" | "contains-all";
  expect?: string[];
  /** The oracle's output: the reference invocation run on the real program in the sandbox. */
  expected?: string;
  valid?: boolean;
  invalidReason?: string;
}

const usageLike = (s: string) => /^\s*usage:/im.test(s.split("\n").slice(0, 3).join("\n"));

/** Run a task's reference invocation in the same sandbox RightClick X uses; its output is the truth. */
export async function oracle(bin: string, task: Task): Promise<Task> {
  const sb = await hostSandbox();
  if (!sb) throw new Error("no sandbox on this host");
  if (task.kind !== "feasible" || !task.reference) return { ...task, valid: task.kind === "infeasible" };
  const r = await sb.run(bin, task.reference.argv, { stdin: task.input.stdin ?? "", files: task.input.files });
  const strip = (t: string) => t.split(r.workDir).join("").split(r.workDir.replace(/^\/private/, "")).join("");
  const out = strip(r.stdout);
  const bad = r.timedOut ? "timed out" : r.limit ? `hit the ${r.limit} limit` : !out.trim() ? `no output (exit ${r.code}; ${r.stderr.slice(0, 120)})` : usageLike(out) ? "printed usage text" : (r.code ?? 0) !== 0 && !out.trim() ? `exit ${r.code}` : "";
  return { ...task, expected: out, valid: !bad, ...(bad ? { invalidReason: bad } : {}) };
}

/** Does an answer satisfy a task under its comparison mode? (exact ignores one trailing newline, which the answer transport cannot carry.) */
export function matches(task: Task, answer: string): boolean {
  const want = task.expected ?? "";
  switch (task.compare ?? "trim") {
    case "exact":
      return answer.replace(/\n$/, "") === want.replace(/\n$/, "");
    case "trim":
      return answer.trim() === want.trim();
    case "whitespace":
      return answer.replace(/\s+/g, " ").trim() === want.replace(/\s+/g, " ").trim();
    case "lines-unordered": {
      const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).sort().join("\n");
      return lines(answer) === lines(want);
    }
    case "contains-all":
      return (task.expect ?? []).length > 0 && (task.expect ?? []).every((e) => answer.includes(e));
  }
}

/** The answer block of an agent's reply, or an UNABLE refusal. */
export function extract(reply: string): { answer?: string; unable?: string } {
  const unable = /^\s*UNABLE:\s*(.+)$/m.exec(reply)?.[1];
  const block = /^BEGIN\s*$\n?([\s\S]*?)^END\s*$/m.exec(reply)?.[1];
  if (block !== undefined) {
    const inner = block.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "");
    if (/^\s*UNABLE:/m.test(inner)) return { unable: /UNABLE:\s*(.+)/.exec(inner)?.[1] ?? "unable" };
    return { answer: inner.replace(/\n$/, "") };
  }
  return unable ? { unable } : {};
}

// ---------------------------------------------------------------- agent sessions

export interface Session {
  reply: string;
  seconds: number;
  turns?: number;
  costUsd?: number;
  tokens?: number;
  exit: number | null;
  blocked?: string;
}

export function claudeSession(opts: { prompt: string; servers: Record<string, unknown>; allowed: string; model: string; maxTurns?: number; timeoutMs?: number }): Promise<Session> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ns-session-")));
  writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: opts.servers }));
  const t0 = performance.now();
  return new Promise((done) => {
    const p = spawn("claude", ["-p", opts.prompt, "--model", opts.model, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", opts.allowed, "--disallowedTools", "Bash,Read,Write,Edit,MultiEdit,WebFetch,WebSearch,Glob,Grep,Task,Agent,NotebookEdit,TodoWrite", "--output-format", "json", "--max-turns", String(opts.maxTurns ?? 30)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 600_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      const seconds = Math.round((performance.now() - t0) / 100) / 10;
      try {
        const j = JSON.parse(out);
        const u = j.usage ?? {};
        const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        const reply = String(j.result ?? "");
        const blocked = quotaBlock(reply);
        done({ reply, seconds, turns: j.num_turns, costUsd: j.total_cost_usd, tokens, exit: code, ...(blocked ? { blocked } : {}) });
      } catch {
        const text = (out + err).slice(-2000);
        const blocked = quotaBlock(text);
        done({ reply: text, seconds, exit: code, ...(blocked ? { blocked } : {}) });
      }
    });
  });
}

export function readJsonl(file: string): any[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- statistics

/** Wilson 95% interval for k successes in n. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

/** Exact two-sided McNemar test on paired outcomes: b = only A right, c = only B right. */
export function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  const choose = (nn: number, kk: number) => {
    let r = 1;
    for (let i = 1; i <= kk; i++) r = (r * (nn - kk + i)) / i;
    return r;
  };
  for (let i = 0; i <= k; i++) tail += choose(n, i) / 2 ** n;
  return Math.min(1, 2 * tail);
}

/** Wilcoxon signed-rank test (two-sided, normal approximation with tie correction). */
export function wilcoxon(a: number[], b: number[]): { p: number; n: number; medianDiff: number } {
  const d = a.map((x, i) => x - b[i]).filter((x) => x !== 0 && Number.isFinite(x));
  const n = d.length;
  if (n < 1) return { p: 1, n, medianDiff: 0 };
  const abs = d.map((x, i) => ({ v: Math.abs(x), s: Math.sign(x), i })).sort((x, y) => x.v - y.v);
  const ranks = new Array(n).fill(0);
  let tie = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && abs[j + 1].v === abs[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    tie += t * t * t - t;
    i = j + 1;
  }
  const wPlus = abs.reduce((s, x, k) => s + (x.s > 0 ? ranks[k] : 0), 0);
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tie / 48);
  const z = sd ? (wPlus - mean) / sd : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  const sorted = [...d].sort((x, y) => x - y);
  return { p: Math.min(1, p), n, medianDiff: sorted[Math.floor((sorted.length - 1) / 2)] };
}

function normCdf(z: number): number {
  // Abramowitz-Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
}

export const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
export const quantile = (xs: number[], q: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : NaN;
};
