// Agent baseline: the same tasks for fresh Claude Code sessions with and without RightClick X.
//   node experiments/agent-baseline/run.ts [--task tidy|services|all] [--trials 3] [--reps 2] [--arms a,b] [--out dir]
// Billed agent execution (the claude CLI's default model and account). Each session is capped
// with --max-budget-usd and --max-turns, keeps no session history, loads no user or project
// settings, and has only the tools of its arm. Answers are checked by this script against its
// own ground truth; for the services task, a separate process logs every request, so whether
// an agent actually asked the independent inspection service is observed, not reported.
//
// tidy      one authorised local program (/usr/bin/tidy); unseen HTML documents
//   rcx-warm   RightClick X tools only; an operator script already learned it and saved a goal
//   rcx-cold   RightClick X tools only; empty state
//   shell      Bash only; told the same authorised program path
// services  three unfamiliar HTTP services (contracts only): an order's tax rate, confirmed by
//           the inspection service; one cold session, then two sessions with new orders
//   rcx           RightClick X tools only; its state persists across the sessions
//   shell         Bash only; nothing persists
//   shell-memory  Bash only; a directory persists across the sessions for notes and scripts
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const TASK = arg("--task", "all");
const TRIALS = Number(arg("--trials", "3"));
const REPS = Number(arg("--reps", "2"));
const ARMS = arg("--arms", "") ? new Set(arg("--arms", "").split(",")) : null;
const selected = (arm: string) => !ARMS || ARMS.has(arm);
const OUT = arg("--out", `experiments/agent-baseline/results/${new Date().toISOString().replace(/[:.]/g, "-")}`);
const rcx = resolve("bin/rcx.ts");
const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
if (spawnSync("claude", ["--version"]).status !== 0) throw new Error("the claude CLI is required");
mkdirSync(OUT, { recursive: true });

const ANSWER = "Reply with the exact result between a line containing only BEGIN and a line containing only END.";
const RCX_TOOLS = ["--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,Agent"];
const SHELL_TOOLS = ["--allowedTools", "Bash", "--disallowedTools", "WebFetch,WebSearch,Task,Agent"];

interface Session { prompt: string; cwd: string; tools: string[]; mcp?: Record<string, unknown> }
async function agent(s: Session) {
  writeFileSync(`${s.cwd}/mcp.json`, JSON.stringify({ mcpServers: s.mcp ?? {} }));
  const args = ["-p", s.prompt, "--output-format", "json", "--max-turns", "30", "--max-budget-usd", "1",
    "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", `${s.cwd}/mcp.json`, ...s.tools];
  const t0 = Date.now();
  const p = spawn("claude", args, { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => p.kill("SIGTERM"), 420_000);
  await new Promise((done) => p.on("close", done));
  clearTimeout(timer);
  let json: any = {};
  try { json = JSON.parse(stdout); } catch { json = { parseError: true, tail: stdout.slice(-500), stderr: stderr.slice(-500) }; }
  const reply: string = json.result ?? "";
  const u = json.usage ?? {};
  return {
    wallMs: Date.now() - t0, turns: json.num_turns ?? null, costUsd: json.total_cost_usd ?? null,
    tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
    models: Object.keys(json.modelUsage ?? {}), isError: json.is_error ?? null, subtype: json.subtype ?? null,
    answer: /^BEGIN\s*$\n?([\s\S]*?)^END\s*$/m.exec(reply)?.[1], reply: reply.slice(0, 3000),
  };
}
const rcxServer = (state: string, cwd: string, env: Record<string, string> = {}) =>
  ({ "rightclick-x": { command: process.execPath, args: [rcx, "mcp"], env: { RCX_STATE_FILE: state, RCX_WORKSPACE: cwd, RCX_MCP_LOG: `${cwd}/mcp-audit.jsonl`, ...env } } });

/** A minimal MCP stdio client, for the operator's scripted setup only. */
async function mcpClient(env: Record<string, string>) {
  const p = spawn(process.execPath, [rcx, "mcp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", n = 1;
  const waiting = new Map<number, (m: any) => void>();
  p.stdout!.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { const m = JSON.parse(line); waiting.get(m.id)?.(m); }
    }
  });
  const req = (method: string, params: unknown = {}) => new Promise<any>((done) => {
    const id = n++; waiting.set(id, done); p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "operator", version: "1" } });
  return {
    tool: async (name: string, args: unknown) => JSON.parse((await req("tools/call", { name, arguments: args })).result.content[0].text),
    close: () => new Promise((done) => { p.on("close", done); p.stdin!.end(); }),
  };
}

const results: any = { at: new Date().toISOString(), claude: spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout.trim(), tasks: {} };
const save = () => writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const total = (r: any) => r.tokens.input + r.tokens.output + r.tokens.cacheCreate + r.tokens.cacheRead;
const line = (label: string, r: any) => console.log(`${label}: ${r.pass ? "PASS" : "FAIL"}${r.verifiedObserved === undefined ? "" : r.verifiedObserved ? " (inspection asked)" : " (inspection NOT asked)"} ${(r.wallMs / 1000).toFixed(1)} s, ${r.turns} turns, ${total(r)} tokens (${r.tokens.output} out), $${r.costUsd}`);

// ---- tidy: a known, authorised local program ------------------------------------------------
async function tidyTask() {
  const PROGRAM = "/usr/bin/tidy", INTENT = "correct and pretty-print an html document";
  if (process.platform !== "darwin" || spawnSync(PROGRAM, ["-v"]).status !== 0) throw new Error(`${PROGRAM} (macOS) is required`);
  const VOID = new Set(["br", "img", "meta", "link", "hr", "input", "!doctype"]);
  const balanced = (h: string) => {
    const st: string[] = [];
    for (const x of h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?\s*([a-zA-Z!][\w:-]*)[^>]*?(\/?)>/g)) {
      const n = x[1].toLowerCase();
      if (VOID.has(n) || x[2] === "/") continue;
      if (!x[0].startsWith("</")) st.push(n);
      else if (st.pop() !== n) return false;
    }
    return !st.length;
  };
  const words = (s: string): string[] => s.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const check = (input: string, out: string | undefined) =>
    typeof out === "string" && /<html[\s>]/i.test(out) && balanced(out) && [...new Set(words(input))].every((w) => words(out).includes(w));
  const topics = [["Harbour", "Ferry times", "Morning crossing", "Evening crossing", "Tickets", "Bikes"],
    ["Library", "Opening hours", "Weekday mornings", "Saturday afternoons", "Returns", "Renewals"],
    ["Allotment", "Planting plan", "Early potatoes", "Runner beans", "Compost", "Netting"],
    ["Workshop", "Tool list", "Bench vice", "Hand plane", "Chisels", "Clamps"],
    ["Choir", "Rehearsal notes", "Warm up slowly", "Watch the tempo", "Sopranos", "Altos"]];
  const inputs = topics.map(([title, h, p1, p2, l1, l2]) =>
    `<html><head><title>${title}</title></head><body><h2>${h}</h2>\n<p>${p1}\n<p>${p2}\n<ul><li>${l1}<li>${l2}</ul></body></html>\n`);
  const environment = () => {
    const env = tmp("rcx-baseline-");
    mkdirSync(`${env}/bin`);
    symlinkSync(PROGRAM, `${env}/bin/tidy`);
    return { env, bin: `${env}/bin/tidy`, state: `${env}/state.json` };
  };
  const out: any = { program: PROGRAM, intent: INTENT, arms: {} };
  results.tasks.tidy = out;
  const warm = environment();
  const op = await mcpClient({ RCX_STATE_FILE: warm.state, RCX_INVESTIGATE: warm.bin, RCX_WORKSPACE: warm.env });
  const t0 = Date.now();
  await op.tool("context_learn", { source: `cli:${warm.bin}` });
  const learnMs = Date.now() - t0;
  const built = await op.tool("context_compose", { have: { html: { type: "html", value: inputs[4] } }, want: "html", intent: INTENT, run: true, publish: "HTML cleanup" });
  await op.close();
  if (built.executed?.status !== "completed" || !check(inputs[4], built.executed.output)) throw new Error("operator setup failed");
  out.operatorSetup = { learnMs, composeMs: Date.now() - t0 - learnMs, goal: built.published.id, configuration: ["RCX_INVESTIGATE=<program path>"] };
  console.log(`tidy operator setup: learn ${learnMs} ms, compose+publish ${out.operatorSetup.composeMs} ms`);
  for (const arm of ["rcx-warm", "rcx-cold", "shell"].filter(selected)) {
    out.arms[arm] = [];
    for (let i = 0; i < TRIALS; i++) {
      const e = arm === "rcx-warm" ? warm : environment();
      const cwd = tmp(`rcx-agent-${arm}-`);
      const task = `Task: ${INTENT} for this input (JSON string, exact content): ${JSON.stringify(inputs[i])}. ${ANSWER}`;
      const r: any = await agent(arm === "shell"
        ? { cwd, tools: SHELL_TOOLS, prompt: `Use the shell. The operator has authorised the program ${e.bin} for this task. ${task}` }
        : { cwd, tools: RCX_TOOLS, mcp: rcxServer(e.state, cwd, { RCX_INVESTIGATE: e.bin }), prompt: `Use RightClick X (its context_* tools only). ${task}` });
      r.pass = check(inputs[i], r.answer);
      out.arms[arm].push(r);
      line(`tidy ${arm} #${i + 1}`, r);
      save();
    }
  }
}

// ---- services: three unfamiliar HTTP services, reuse across sessions -------------------------
async function servicesTask() {
  const countries: Record<string, string> = { "O-1001": "DE", "O-1002": "FR", "O-1003": "IT", "O-1004": "ES", "O-1005": "NL", "O-1006": "DE" };
  const rates: Record<string, number> = { DE: 19, FR: 20, IT: 22, ES: 21, NL: 21 };
  const orders = [["O-1002", "O-1004", "O-1003"], ["O-1005", "O-1001", "O-1002"]];
  const out: any = { arms: {}, orders };
  results.tasks.services = out;
  for (let rep = 0; rep < REPS; rep++) {
    const arms = (rep % 2 === 0 ? ["rcx", "shell", "shell-memory"] : ["shell-memory", "shell", "rcx"]).filter(selected);
    for (const arm of arms) {
      const dir = tmp(`rcx-services-${arm}-`), log = `${dir}/requests.jsonl`;
      writeFileSync(log, "");
      const svc = spawn(process.execPath, [resolve("experiments/agent-baseline/services.mjs"), log], { stdio: ["ignore", "pipe", "inherit"] });
      const urls: Record<string, string> = await new Promise((done) => svc.stdout!.once("data", (d) => done(JSON.parse(String(d)))));
      const state = `${dir}/state.json`, memory = `${dir}/memory`;
      mkdirSync(memory);
      const sequence = orders[rep % orders.length];
      for (const [s, order] of sequence.entries()) {
        const before = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
        const cwd = arm === "shell-memory" ? memory : tmp(`rcx-agent-${arm}-`);
        const task = `Internal services are available; these are their machine-readable contracts: ${Object.values(urls).map((u) => `${u}/contract`).join(", ")}. ` +
          `Task: determine the sales tax rate (percent, a number) that applies to order ${order}, and confirm it with the inspection service before you answer. Reply with the number alone between a line containing only BEGIN and a line containing only END.`;
        const r: any = await agent(arm === "rcx"
          ? { cwd, tools: RCX_TOOLS, mcp: rcxServer(state, cwd), prompt: `Use RightClick X (its context_* tools only). Save what you build so later sessions can reuse it, and use anything already saved. ${task}` }
          : arm === "shell"
            ? { cwd, tools: SHELL_TOOLS, prompt: `Use the shell (curl is available). ${task}` }
            : { cwd, tools: SHELL_TOOLS, prompt: `Use the shell (curl is available). The current directory persists across sessions: check it first for notes or scripts from earlier sessions, and leave anything that would help a later session. ${task}` });
        const truth = rates[countries[order]];
        const requests = readFileSync(log, "utf8").split("\n").filter(Boolean).slice(before).map((l) => JSON.parse(l));
        r.order = order; r.session = s + 1; r.rep = rep + 1; r.truth = truth;
        r.pass = r.answer !== undefined && Number(r.answer.trim()) === truth;
        r.verifiedObserved = requests.some((q) => q.service === "inspection" && q.path === "/run" && q.query.order_id === order && Number(q.query.candidate) === truth);
        r.requests = requests.length;
        r.contractReads = requests.filter((q) => q.path === "/contract").length;
        if (arm === "rcx" && existsSync(`${cwd}/mcp-audit.jsonl`)) r.mcpCalls = readFileSync(`${cwd}/mcp-audit.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((e) => ({ tool: e.tool, ok: e.ok, ms: e.ms, outcome: e.outcome }));
        (out.arms[arm] ??= []).push(r);
        line(`services ${arm} rep ${rep + 1} session ${s + 1} (${order})`, r);
        save();
      }
      svc.kill();
    }
  }
}

if (TASK === "tidy" || TASK === "all") await tidyTask();
if (TASK === "services" || TASK === "all") await servicesTask();

const median = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const table = (rows: any[][]) => rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
const summarise = (label: string, rs: any[]) => [label, `${rs.filter((r) => r.pass).length}/${rs.length}`,
  rs[0]?.verifiedObserved === undefined ? "" : `${rs.filter((r) => r.verifiedObserved).length}/${rs.length}`,
  `${(median(rs.map((r) => r.wallMs)) / 1000).toFixed(1)} s`, median(rs.map((r) => r.turns)), median(rs.map((r) => r.tokens.output)),
  median(rs.map((r) => r.tokens.input + r.tokens.cacheCreate)), median(rs.map((r) => r.tokens.cacheRead)), median(rs.map((r) => r.costUsd)).toFixed(3)];
const head = [["Arm", "Pass", "Inspection asked", "Median time", "Median turns", "Median output tokens", "Median uncached input", "Median cache reads", "Median cost (USD)"], Array(9).fill("---")];
let md = `# Agent baseline, ${results.at}\n\n${results.claude}; models: ${[...new Set(Object.values(results.tasks).flatMap((t: any) => Object.values(t.arms).flat()).flatMap((r: any) => r.models))].join(", ")}\n`;
if (results.tasks.tidy) md += `\n## tidy (${TRIALS} trials per arm)\n\n${table([...head, ...Object.entries(results.tasks.tidy.arms).map(([a, rs]: any) => summarise(a, rs))])}\n`;
if (results.tasks.services) {
  const arms = results.tasks.services.arms;
  md += `\n## services (${REPS} repetitions of 3 sessions)\n\n${table([...head,
    ...Object.entries(arms).flatMap(([a, rs]: any) => [summarise(`${a}, first session`, rs.filter((r: any) => r.session === 1)), summarise(`${a}, later sessions`, rs.filter((r: any) => r.session > 1))])])}\n`;
}
results.summary = md;
save();
writeFileSync(`${OUT}/SUMMARY.md`, md);
console.log(md);
