// The acceptance task for fresh agents: RightClick X against a competent agent with ordinary tools.
//   node experiments/north-star-acceptance/agents.ts [--reps 2] [--arms rcx,shell,shell-memory] [--budget 10] [--out dir]
// Billed agent execution. Each session is a fresh `claude -p` with the pinned model, at most $1 and
// 30 turns, no session history, project settings only, and only its arm's tools: the settings of
// experiments/agent-baseline/run.ts. Every session counts against one global budget kept in the
// ledger; none starts with less than $0.50 left. A discarded primer opens each arm's block, so no
// measured session pays the shared prompt-cache write.
//
// The task, the same for every arm apart from its tool sentence: fingerprint a release manifest
// (the SHA-1 of its canonical JSON) with the operator-authorised programs, and confirm it with a
// second implementation before answering. Each repetition is a first session and two later ones
// with new manifests:
//   rcx           RightClick X tools only; its state persists across the sessions
//   rcx-seeded    the same, but every session reuses the complete goal the operator saved, as in
//                 acceptance.ts: jq then sha1sum, verified by json_pp then shasum
//   shell         Bash only; nothing persists
//   shell-memory  Bash only; a notes directory persists, and the agent is told to use it
// The script checks every answer against its own oracle. Whether an agent confirmed the result is
// observed: from the server's audit log (RightClick X), or from the commands it ran (shell).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const REPS = Number(arg("--reps", "2")), ARMS = arg("--arms", "rcx,shell,shell-memory").split(",");
const BUDGET = Number(arg("--budget", "10")), LEDGER = arg("--ledger", "experiments/north-star-acceptance/results/agents-ledger.jsonl");
const OUT = arg("--out", "experiments/north-star-acceptance/results/agents");
const MODEL = "claude-opus-5-5", MIN_LEFT = 0.5;
const RCX = resolve("bin/rcx.ts");
const PROGRAMS: Record<string, string> = { jq: "/opt/homebrew/bin/jq", sha1sum: "/sbin/sha1sum", json_pp: "/usr/bin/json_pp", shasum: "/usr/bin/shasum" };
const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
mkdirSync(OUT, { recursive: true });

// New manifests for every session; the oracle is the direct pipeline, confirmed by the independent one.
const manifest = (i: number) => ({ name: ["ledger-sync", "billing-export", "ops-console", "docs-site", "edge-cache", "audit-trail", "report-mailer", "sync-agent"][i % 8],
  version: `${1 + (i % 3)}.${i}.${(i * 7) % 10}`, build: 100 + i * 13, artifacts: Array.from({ length: 1 + (i % 3) }, (_, k) => ({ os: ["linux", "darwin", "windows"][k], sha: (i * 31 + k * 17).toString(16).padStart(4, "0") })),
  ...(i % 2 ? { notes: ["Zürich release", "naïve café build", "Ångström fix"][i % 3] } : {}) });
const sh = (cmd: string, input: string) => execFileSync("/bin/sh", ["-c", cmd], { input, encoding: "utf8" });
const real = Object.fromEntries(Object.entries(PROGRAMS).map(([n, p]) => [n, realpathSync(p)]));
function oracle(m: object) {
  const text = JSON.stringify(m);
  const a = sh(`'${real.jq}' -S -c -j . | '${real.sha1sum}'`, text), b = sh(`'${real.json_pp}' -json_opt canonical | '${real.shasum}'`, text);
  if (a !== b) throw new Error("the oracle's two implementations disagree");
  return a.trim();
}

class BudgetExhausted extends Error {}
const spent = () => !existsSync(LEDGER) ? 0 : readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).costUsd ?? 0), 0);
const jsonl = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const RCX_TOOLS = ["--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,Agent"];
const SHELL_TOOLS = ["--allowedTools", "Bash", "--disallowedTools", "WebFetch,WebSearch,Task,Agent"];

async function agent(s: { prompt: string; cwd: string; tools: string[]; mcp?: object; arm: string }) {
  const left = BUDGET - spent();
  if (left < MIN_LEFT) throw new BudgetExhausted(`global budget: $${left.toFixed(2)} of $${BUDGET} left`);
  const cap = Math.min(1, left);
  writeFileSync(`${s.cwd}/mcp.json`, JSON.stringify({ mcpServers: s.mcp ?? {} }));
  const args = ["-p", s.prompt, "--model", MODEL, "--output-format", "stream-json", "--verbose", "--max-turns", "30", "--max-budget-usd", String(cap),
    "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", `${s.cwd}/mcp.json`, ...s.tools];
  const t0 = Date.now();
  const p = spawn("claude", args, { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  p.stdout.on("data", (d) => (stdout += d));
  const timer = setTimeout(() => p.kill("SIGTERM"), 600_000);
  await new Promise((done) => p.on("close", done));
  clearTimeout(timer);
  const events = stdout.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const result = events.findLast((e) => e.type === "result") ?? {};
  const calls = new Map<string, any>(), toolCalls: any[] = [];
  for (const e of events.filter((e) => e.type === "assistant")) {
    if (!calls.has(e.message.id)) calls.set(e.message.id, e.message.usage ?? {});
    for (const b of e.message.content ?? []) if (b.type === "tool_use") toolCalls.push({ name: b.name, input: b.input });
  }
  const u = result.usage ?? {}, reply: string = result.result ?? "";
  const r = { arm: s.arm, wallMs: Date.now() - t0, turns: result.num_turns ?? null, costUsd: result.total_cost_usd ?? null, apiCalls: calls.size, subtype: result.subtype ?? null,
    tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
    models: Object.keys(result.modelUsage ?? {}), toolCalls, answer: /^BEGIN\s*$\n?([\s\S]*?)^END\s*$/m.exec(reply)?.[1]?.trim(), reply: reply.slice(0, 2500) };
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), arm: s.arm, costUsd: r.costUsd ?? cap, out: OUT }) + "\n");
  return r as any;
}

const task = (paths: Record<string, string>, m: object) =>
  `A release manifest needs its fingerprint: the SHA-1 of its canonical JSON (object keys sorted, no insignificant whitespace, no trailing newline), printed the way sha1sum prints standard input ("<40 hex digits>  -"). ` +
  `The operator has authorised these programs for this task: ${Object.values(paths).join(", ")}. Confirm the fingerprint with a second, independent implementation before you answer. ` +
  `Manifest (JSON): ${JSON.stringify(m)}. Reply with the fingerprint line alone between a line containing only BEGIN and a line containing only END.`;
const PROMPTS: Record<string, string> = {
  rcx: "Use RightClick X (its context_* tools only). Save what you build so later sessions can reuse it, and use anything already saved.",
  "rcx-seeded": "Use RightClick X (its context_* tools only). Save what you build so later sessions can reuse it, and use anything already saved.",
  shell: "Use the shell.",
  "shell-memory": "Use the shell. The current directory persists across sessions: check it first for notes or scripts from earlier sessions, and leave anything that would help a later session.",
};

/** The operator's scripted setup for rcx-seeded: the acceptance's complete, independently verified goal. */
async function seed(env: Record<string, string>) {
  const p = spawn(process.execPath, [RCX, "mcp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", n = 0;
  const waiting = new Map<number, (m: any) => void>();
  p.stdout!.setEncoding("utf8").on("data", (d: string) => { buf += d; for (let i; (i = buf.indexOf("\n")) >= 0;) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const m = JSON.parse(l); waiting.get(m.id)?.(m); } } });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((done) => { const id = ++n; waiting.set(id, done); p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const call = async (name: string, args: unknown) => { const r = (await rpc("tools/call", { name, arguments: args })).result; return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text); };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "operator", version: "1" } });
  for (const path of env.RCX_INVESTIGATE.split(",")) await call("context_learn", { source: `cli:${path}` });
  const m = manifest(99), json = { type: "json", value: m };
  const w = await call("context_compose", { have: { json, options: ["-json_opt", "canonical"] }, want: "text", intent: "canonical json fingerprint by an independent implementation", through: ["cli:json-pp:stdout", "cli:shasum:default"], maxSteps: 2, run: true });
  const g = await call("context_compose", { have: { json, options: { value: ["-S", "-c", "-j"], fixed: true } }, want: "text", intent: "canonical json manifest fingerprint", through: ["cli:jq:stdout", "cli:sha1sum:default"], maxSteps: 2, run: true,
    publish: "manifest fingerprint", verify: [{ op: "matches", pattern: "^[0-9a-f]{40}  -\\n$" }], witnesses: [{ capability: w.crystallized?.id, args: { json: { input: "json" }, options: { value: ["-json_opt", "canonical"] } }, agree: { mode: "exact" } }] });
  await new Promise((done) => { p.on("close", done); p.stdin!.end(); });
  if (g.executed?.verification?.status !== "verified" || g.executed.output.trim() !== oracle(m) || g.published?.id !== "goal:manifest-fingerprint") throw new Error(`operator seed failed: ${JSON.stringify(g).slice(0, 400)}`);
  return g.published.id;
}

const results: any = { at: new Date().toISOString(), claude: spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout.trim(), model: MODEL, rcx: spawnSync("git", ["log", "-1", "--format=%h %s"], { encoding: "utf8" }).stdout.trim(), primers: [], sessions: [] };
const save = () => writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
let seq = 0;
try {
  for (let rep = 0; rep < REPS; rep++) {
    for (const arm of (rep % 2 ? [...ARMS].reverse() : ARMS)) {
      const dir = tmp(`rcx-ns-agents-${arm}-`);
      mkdirSync(`${dir}/bin`); mkdirSync(`${dir}/notes`);
      const paths = Object.fromEntries(Object.keys(PROGRAMS).map((n) => { symlinkSync(real[n], `${dir}/bin/${n}`); return [n, `${dir}/bin/${n}`]; }));
      const mcpFor = (cwd: string) => ({ "rightclick-x": { command: process.execPath, args: [RCX, "mcp"], env: { RCX_STATE_FILE: `${dir}/state.json`, RCX_INVESTIGATE: Object.values(paths).join(","), RCX_WORKSPACE: cwd, RCX_MCP_LOG: `${cwd}/mcp-audit.jsonl` } } });
      if (arm === "rcx-seeded") results.seeded = await seed({ RCX_STATE_FILE: `${dir}/state.json`, RCX_INVESTIGATE: Object.values(paths).join(","), RCX_WORKSPACE: dir });
      const primerCwd = tmp("rcx-ns-primer-");
      results.primers.push(await agent({ arm, cwd: primerCwd, prompt: "Reply with OK.", tools: arm.startsWith("rcx") ? RCX_TOOLS : SHELL_TOOLS, ...(arm.startsWith("rcx") ? { mcp: { "rightclick-x": { ...mcpFor(primerCwd)["rightclick-x"], env: { ...mcpFor(primerCwd)["rightclick-x"].env, RCX_STATE_FILE: `${primerCwd}/state.json` } } } } : {}) }));
      for (let s = 0; s < 3; s++) {
        const m = manifest(seq++), truth = oracle(m);
        const cwd = arm === "shell-memory" ? `${dir}/notes` : tmp(`rcx-ns-agent-${arm}-`);
        const rcxArm = arm.startsWith("rcx");
        const r = await agent({ arm, cwd, prompt: `${PROMPTS[arm]} ${task(paths, m)}`, tools: rcxArm ? RCX_TOOLS : SHELL_TOOLS, ...(rcxArm ? { mcp: mcpFor(cwd) } : {}) });
        Object.assign(r, { rep: rep + 1, session: s + 1, truth, pass: r.answer === truth });
        if (rcxArm) {
          const audit = jsonl(`${cwd}/mcp-audit.jsonl`);
          r.mcpCalls = audit.map((e: any) => ({ tool: e.tool, ok: e.ok, ms: e.ms, outcome: e.outcome, id: e.args?.id, witnesses: e.args?.witnesses?.map((w: any) => ({ capability: w.capability, agree: !!w.agree })) }));
          r.verified = audit.some((e: any) => e.outcome?.verification === "verified");
          r.agreementWitness = audit.some((e: any) => (e.args?.witnesses ?? []).some((w: any) => w.agree)) || (s > 0 && r.verified);
        } else {
          const commands = r.toolCalls.filter((t: any) => t.name === "Bash").map((t: any) => String(t.input.command));
          r.commands = commands.map((c: string) => c.slice(0, 300));
          // Confirmed with a second implementation: both fingerprint programs (or both canonicalisers) actually run.
          r.confirmedIndependently = commands.some((c: string) => /json_pp/.test(c)) && commands.some((c: string) => /jq/.test(c)) || commands.some((c: string) => /shasum/.test(c)) && commands.some((c: string) => /sha1sum/.test(c));
          r.outsideAuthorised = commands.filter((c: string) => /\b(python|perl -e|node |ruby|openssl|curl|wget)\b/.test(c)).map((c: string) => c.slice(0, 160));
        }
        results.sessions.push(r); save();
        console.log(`rep ${rep + 1} ${arm} s${s + 1}: ${r.pass ? "PASS" : "FAIL"} ${(r.wallMs / 1000).toFixed(1)} s, ${r.turns} turns, $${r.costUsd?.toFixed(3)}, ${r.tokens.output} out` +
          (arm === "rcx" ? `, verified=${r.verified}` : `, independent=${r.confirmedIndependently}`));
      }
    }
  }
} catch (e) {
  if (!(e instanceof BudgetExhausted)) throw e;
  results.stopped = e.message;
  console.log(`STOPPED: ${e.message}`);
}
results.spent = spent();
save();
console.log(`${results.sessions.length} sessions; ledger $${results.spent.toFixed(2)} of $${BUDGET}`);
