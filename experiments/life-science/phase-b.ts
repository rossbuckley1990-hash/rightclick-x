// PHASE B — real AI agents whose only MCP server is RightClick X answer the
// pre-registered questions (PREREGISTRATION.md §8). One fresh session per
// question per client, each starting from a copy of the Phase A state. Truth is
// recomputed by the harness right after each session, directly against the
// databases (questions.ts), never through RightClick X.
//   RCX_FREEZE=lifesci-freeze-3 node experiments/life-science/phase-b.ts [--clients claude,codex] [--only Q01,Q02] [--state <file>] [--label <name>]

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { bodies, frozenBuild, HERE, readJsonl, serverCommand, serverFiles, TAG, WORK } from "./harness.ts";
import { parseAnswer, QUESTIONS, type Question, type Truth } from "./questions.ts";

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
const clients = (opt("clients") ?? "claude,codex").split(",") as Array<"claude" | "codex">;
const only = opt("only")?.split(",");
const label = opt("label") ?? "phase-b";
const startState = opt("state") ?? `${WORK}/${TAG}/phase-a-state.json`;
const questions = QUESTIONS.filter((q) => !only || only.includes(q.id));
const build = frozenBuild();
const log = (...a: unknown[]) => console.log(...a);
if (!existsSync(startState)) throw new Error(`no start state at ${startState}; run phase-a.ts first`);

const PROMPT = (q: Question) =>
  [
    "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
    "RightClick X has already learned several public life-science databases (see context_providers).",
    "Answer the question using only data you obtain through rightclick-x tools, not from memory.",
    "If the tools cannot give you the answer, say so instead of guessing.",
    `Question: ${q.text}`,
    `End your reply with a final line exactly of the form: ${q.format}`,
  ].join("\n");

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill();
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, code, timedOut });
    });
  });
}

async function agent(client: "claude" | "codex", dir: string, prompt: string) {
  const f = serverFiles(dir);
  const s = serverCommand(build.rcx, f);
  const t0 = performance.now();
  let output = "";
  let meta: any = {};
  let r;
  if (client === "claude") {
    writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: { "rightclick-x": { command: s.command, args: s.args, env: s.env } } }));
    r = await run("claude", ["-p", prompt, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit", "--output-format", "json", "--max-turns", "40"], dir, 900_000);
    try {
      const j = JSON.parse(r.stdout);
      output = j.result ?? "";
      meta = { turns: j.num_turns, costUsd: j.total_cost_usd, isError: j.is_error, subtype: j.subtype };
    } catch {
      output = (r.stdout + r.stderr).slice(-3000);
    }
  } else {
    const env = Object.entries(s.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",");
    r = await run(
      "codex",
      // Account-level app connectors would add MCP servers other than RightClick X
      // (seen in the post hoc Q09 re-run: a remote RightClick app answered instead).
      ["exec", "--skip-git-repo-check", "--approve-for-me", "--disable", "apps", "-c", `mcp_servers.rightclick-x.command=${JSON.stringify(s.command)}`, "-c", `mcp_servers.rightclick-x.args=${JSON.stringify(s.args)}`, "-c", `mcp_servers.rightclick-x.env={${env}}`, "-c", "mcp_servers.rightclick-x.tool_timeout_sec=300", "--output-last-message", `${dir}/last.txt`, prompt],
      dir,
      900_000,
    );
    try {
      output = readFileSync(`${dir}/last.txt`, "utf8");
    } catch {
      output = (r.stdout + r.stderr).slice(-3000);
    }
  }
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const answer = [...output.matchAll(/ANSWER:\s*([^\n]+)/gi)].at(-1)?.[1]?.trim().replace(/[`*]/g, "");
  return { output, answer, seconds, exit: r.code, timedOut: r.timedOut, meta, stderrTail: r.stderr.slice(-800), files: f };
}

/** Grounding: the truth's identifier/string values appear in what RightClick X fetched (PREREGISTRATION §7). */
function grounding(q: Question, t: Truth, fetched: string, net: any[]): { grounded: boolean; checks: Array<{ value: string; found: boolean }> } {
  if (q.id === "Q13") {
    const asked = net.some((n) => /rest\.uniprot\.org|ebi\.ac\.uk\/proteins/.test(n.url) && /QZX9NOTAGENE/i.test(decodeURIComponent(n.url)));
    return { grounded: asked, checks: [{ value: "a UniProt/Proteins query naming QZX9NOTAGENE", found: asked }] };
  }
  const vals: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v && !/^\d+(\.\d+)?$/.test(v)) vals.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (add(k), add(x)));
  };
  t.parts.forEach(add);
  const hay = fetched.toLowerCase();
  // Method strings are matched loosely (X-RAY DIFFRACTION); formulas ignore spaces.
  const checks = [...new Set(vals)].map((v) => ({ value: v, found: hay.includes(v.toLowerCase()) || hay.replace(/\s+/g, "").includes(v.toLowerCase().replace(/\s+/g, "")) }));
  return { grounded: checks.every((c) => c.found), checks };
}

const outDir = `${HERE}/evidence/${label}-${TAG}`;
mkdirSync(outDir, { recursive: true });
const sessions: any[] = [];
log(`${label} · build ${TAG} (${build.commit.slice(0, 7)}) · start state ${startState}`);
for (const client of clients) {
  for (const q of questions) {
    const dir = `${WORK}/${TAG}/${label}/${client}-${q.id}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(startState, `${dir}/state.json`);
    const prompt = PROMPT(q);
    log(`\n${client} ${q.id} …`);
    const a = await agent(client, dir, prompt);
    // Independent truth, recomputed now, directly against the databases.
    let truth: Truth | null = null;
    let truthError: string | undefined;
    try {
      truth = await q.truth();
    } catch (e) {
      truthError = String((e as Error).message ?? e);
    }
    const parts = parseAnswer(a.answer);
    const perPart = truth ? q.score(parts, truth) : [];
    const correct = !!truth && perPart.length > 0 && perPart.every(Boolean);
    const calls = readJsonl(a.files.mcpLog);
    const net = readJsonl(a.files.netlog);
    const g = truth ? grounding(q, truth, bodies(a.files.bodyDir), net) : { grounded: false, checks: [] };
    let receipts: any[] = [];
    try {
      receipts = JSON.parse(readFileSync(a.files.state, "utf8")).receipts ?? [];
    } catch {
      /* state not written */
    }
    const startReceipts = JSON.parse(readFileSync(startState, "utf8")).receipts?.length ?? 0;
    const mine = receipts.slice(startReceipts);
    const byTool: Record<string, number> = {};
    for (const c of calls) byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
    const composeCalls = calls.filter((c) => c.tool === "context_compose");
    const session = {
      client,
      question: q.id,
      prompt,
      answer: a.answer ?? null,
      parts,
      truth: truth?.parts ?? null,
      truthFacts: truth?.facts ?? null,
      witness: truth?.witness ?? null,
      truthError,
      perPart,
      correct,
      grounded: g.grounded,
      correctAndGrounded: correct && g.grounded,
      groundingChecks: g.checks,
      fabricationOnNegativeControl: q.id === "Q13" ? !!a.answer && !/^\s*(none|no such|not found|n\/a)/i.test(a.answer) : undefined,
      seconds: a.seconds,
      exit: a.exit,
      timedOut: a.timedOut,
      clientMeta: a.meta,
      mcpCalls: calls.length,
      mcpCallsByTool: byTool,
      mcpCallLog: calls.map((c) => ({ tool: c.tool, ok: c.ok, ms: c.ms, args: c.args, error: c.error })),
      learnedByAgent: calls.filter((c) => c.tool === "context_learn" || c.tool === "context_research").map((c) => c.args),
      composeUsed: composeCalls.length,
      receipts: mine.map((x) => ({ capability: x.capability, provider: x.provider, status: x.status, ms: x.durationMs })),
      providersReached: [...new Set(mine.filter((x) => x.status === "completed").map((x) => x.provider))],
      requests: net.length,
      requestsPerHost: net.reduce((m: Record<string, number>, n: any) => ((m[new URL(n.url).host] = (m[new URL(n.url).host] ?? 0) + 1), m), {}),
      finalText: a.output.slice(-3000),
      stderrTail: a.exit === 0 ? undefined : a.stderrTail,
    };
    sessions.push(session);
    writeFileSync(`${outDir}/${client}-${q.id}.json`, JSON.stringify(session, null, 2));
    log(`  ${session.correctAndGrounded ? "✓" : session.correct ? "~ (correct, NOT grounded)" : "✗"} answer: ${a.answer ?? "(none)"}`);
    log(`    truth: ${JSON.stringify(truth?.parts ?? truthError).slice(0, 200)} · parts ${JSON.stringify(perPart)} · grounded ${g.grounded}`);
    log(`    ${a.seconds}s · ${calls.length} MCP calls ${JSON.stringify(byTool)} · providers ${session.providersReached.join(", ")}`);
  }
}

const summary = clients.map((c) => {
  const s = sessions.filter((x) => x.client === c);
  const cg = s.filter((x) => x.correctAndGrounded).length;
  return {
    client: c,
    questions: s.length,
    correct: s.filter((x) => x.correct).length,
    correctAndGrounded: cg,
    verdict: s.length === 14 ? (cg >= 11 ? "PASS" : cg >= 7 ? "PARTIAL" : "FAIL") : "(subset)",
    fabricationOnQ13: s.find((x) => x.question === "Q13")?.fabricationOnNegativeControl ?? null,
    composeSessions: s.filter((x) => x.composeUsed > 0).length,
    medianSeconds: s.map((x) => x.seconds).sort((a, b) => a - b)[Math.floor(s.length / 2)],
    totalMcpCalls: s.reduce((n, x) => n + x.mcpCalls, 0),
  };
});
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ phase: "B", label, build: { tag: TAG, commit: build.commit }, at: new Date().toISOString(), startState, summary, sessions: sessions.map((s) => ({ client: s.client, question: s.question, answer: s.answer, correct: s.correct, grounded: s.grounded, perPart: s.perPart, seconds: s.seconds, mcpCalls: s.mcpCalls })) }, null, 2));
log(`\n${JSON.stringify(summary, null, 2)}`);
