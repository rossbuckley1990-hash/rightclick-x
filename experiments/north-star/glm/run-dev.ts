// Development-scale North Star comparison (Domain-2 shaped) on fictional, genuinely
// unfamiliar APIs. THIS IS NOT THE INDEPENDENT HOLDOUT and never replaces it.
//
// Recorded deviations from the preregistered protocol (EVALUATION-PLAN.md):
//   - Agent model: GLM-4-Plus via the in-process loop below, not Claude Code Sonnet
//     (Claude is unavailable in this environment). All arms use the same model.
//   - Evaluator: the implementation author, not an independent session; the APIs and
//     tasks are development material, excluded from any holdout.
//   - Software: two fictional HTTP APIs served on loopback (no model prior knowledge),
//     not the fixed public API list; the public list was unreachable (Cloudflare,
//     rate limits) from this environment.
//   - Transport: MCP servers speak stdio to this loop rather than to a vendor CLI;
//     the servers are the production surface.ts and `rcx mcp` unchanged.
//
// The plan's arm definitions, prompt shape, session sequencing (first use, reuse,
// compatible change), oracle-at-evaluation-time, contains-all scoring and per-session
// measures (correctness, tokens, turns, tool calls, wall time, authored material) are
// preserved. Nothing here updates any gate.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "./mcp.ts";
import { runAgent, type AgentTool } from "./agent.ts";
import { startKilnWatch, startPortLog, type FictionalApi } from "./apis.ts";

// The harness must survive transient API and MCP noise across a long run: stray
// rejections (a killed MCP server's in-flight replies) are logged, never fatal.
process.on("unhandledRejection", (e) => console.error("[harness] ignored rejection:", String(e).slice(0, 160)));
process.on("uncaughtException", (e) => console.error("[harness] ignored exception:", String((e as Error)?.message ?? e).slice(0, 160)));

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const EVIDENCE = fileURLToPath(new URL("../../../docs/north-star/evidence/glm-dev", import.meta.url));
const ARMS = ["A", "B", "C", "D"] as const;
type Arm = (typeof ARMS)[number];

interface Task {
  id: string;
  ask: string;
  // The reference invocation, resolved against the live contract at evaluation time:
  // `pattern` matches the OpenAPI path template (with {parameters}), `params` substitutes.
  ref: { operationId: string; pattern: RegExp; params?: Record<string, string>; query?: Record<string, string> };
  expected: (oracle: any) => string[];
}

const PORTLOG_TASKS: Task[] = [
  { id: "PL1", ask: "Which berths on the south quay are currently open? Give their berth ids.", ref: { operationId: "listBerths", pattern: /berths/ }, expected: (o) => o.filter((b: any) => b.quay === "south" && b.status === "open").map((b: any) => b.id) },
  { id: "PL2", ask: "What is the name and the two-letter flag code of the vessel with IMO number 9455628?", ref: { operationId: "getVessel", pattern: /vessels\/\{imo\}/, params: { imo: "9455628" } }, expected: (o) => [o.name, o.flag] },
  { id: "PL3", ask: "For berth BR-03: give each arriving vessel's IMO number and its ETA.", ref: { operationId: "berthSchedule", pattern: /schedule/, query: { berth: "BR-03" } }, expected: (o) => o.flatMap((s: any) => [s.vessel, s.eta]) },
  { id: "PL4", ask: "Give the tide heights in metres for tuesday, in time order.", ref: { operationId: "tideTable", pattern: /tides/, query: { day: "tuesday" } }, expected: (o) => o.map((t: any) => String(t.height_m)) },
];
const KILN_TASKS: Task[] = [
  { id: "KW1", ask: "Which porcelain batches are at the glazed stage? Give their batch ids only.", ref: { operationId: "listBatches", pattern: /(batches|lots)/, query: { stage: "glazed" } }, expected: (o) => o.items.filter((b: any) => b.clay === "porcelain").map((b: any) => b.id) },
  { id: "KW2", ask: "How many firings has batch KB-1043 had, and what clay is it made from?", ref: { operationId: "getBatch", pattern: /batches\/\{id\}/, params: { id: "KB-1043" } }, expected: (o) => [String(o.firings), o.clay] },
  { id: "KW3", ask: "Which kilns can reach at least 1280 degrees Celsius and are idle right now? Give their ids.", ref: { operationId: "listKilns", pattern: /kilns/ }, expected: (o) => o.filter((k: any) => k.max_temp_c >= 1280 && k.status === "idle").map((k: any) => k.id) },
  { id: "KW4", ask: "Which glaze recipes fire below 1230 degrees Celsius? Names only.", ref: { operationId: "listGlazes", pattern: /glazes/, query: { below_temp: "1230" } }, expected: (o) => o.map((g: any) => g.name) },
];

/** Resolve the reference invocation against the live contract, then fetch it: the oracle
 *  is computed at evaluation time, exactly as the plan requires. */
async function oracle(api: FictionalApi, task: Task): Promise<{ url: string; body: any }> {
  const spec = await (await fetch(api.contractUrl)).json();
  const template = Object.keys(spec.paths).find((p) => task.ref.pattern.test(p) && spec.paths[p].get?.operationId === task.ref.operationId);
  if (!template) throw new Error(`oracle: no path for ${task.ref.operationId}`);
  let path = template;
  for (const [k, v] of Object.entries(task.ref.params ?? {})) path = path.replace(`{${k}}`, v);
  const url = new URL(api.base + path);
  for (const [k, v] of Object.entries(task.ref.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url);
  return { url: url.toString(), body: await res.json() };
}

const extract = (reply: string): { answer?: string; unable?: string } => {
  const m = /\bBEGIN\b([\s\S]*?)\bEND\b/.exec(reply);
  const text = (m ? m[1] : reply).trim();
  const u = /^UNABLE:?\s*(.*)$/im.exec(reply);
  return u ? { unable: u[1] ?? "unable" } : { answer: text };
};

const SYSTEM = "You are a careful software agent. Use your tools to find real answers; never guess API output or compute results yourself. Answer between BEGIN and END lines.";

function promptFor(arm: Arm, api: FictionalApi, task: Task): string {
  const lines = [
    `The task: ${task.ask}`,
    `The API's base URL is ${api.base}.`,
    arm === "D" ? `The operator has authorised the API's contract URL for learning: ${api.contractUrl}.` : "",
    arm === "B" ? `Documentation (the API's OpenAPI contract):\n${api.docs}` : "",
    "Use your tools to produce the result; do not compute it yourself.",
    "Check it is correct.",
    "If it cannot be done correctly, answer UNABLE: <reason>.",
    "Answer between BEGIN and END lines.",
    arm === "C" || arm === "D" ? "Retained knowledge from your earlier sessions may exist; use it when it helps." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

interface Counters { discoveryCalls: number; skillBytes: number }

interface SessionRecord {
  arm: Arm; api: string; task: string; phase: "first" | "reuse" | "changed";
  error?: string;
  correct: boolean; unable: boolean; wrongPresented: boolean;
  answer: string; expected: string[];
  tokens: number; turns: number; seconds: number;
  toolCalls: number; discoveryCalls: number; skillBytesAuthored: number;
  verifiedLabelledWrong: boolean;
}

async function armTools(arm: Arm, api: FictionalApi, workdir: string): Promise<{ tools: AgentTool[]; instructions: string; close: () => void; counters: Counters }> {
  const mcpEnv: Record<string, string> = { DS_ORIGIN: api.base, DS_LOG: `${workdir}/surface-tool.log` };
  if (arm === "C") mcpEnv.DS_SKILLS = `${workdir}/skills`;
  if (arm === "D") mcpEnv.RCX_STATE_FILE = `${workdir}/rcx-state.json`;
  const server = arm === "D"
    ? new McpServer(process.execPath, [`${ROOT}/bin/rcx.ts`, "mcp"], mcpEnv, `d-${api.name}`)
    : new McpServer(process.execPath, [`${ROOT}/experiments/north-star/surface.ts`], mcpEnv, `${arm}-${api.name}`);
  await server.initialize();
  const listed = await server.tools();
  const discovery = new Set(["context_learn", "context_research", "context_graph", "context_explain", "context_runtime", "context_providers", "list_skills", "read_skill"]);
  const counters: Counters = { discoveryCalls: 0, skillBytes: 0 };
  const tools: AgentTool[] = listed.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
    call: async (args) => {
      if (discovery.has(t.name)) counters.discoveryCalls++;
      if (t.name === "save_skill") counters.skillBytes += String(args.content ?? "").length;
      return server.call(t.name, args);
    },
  }));
  return { tools, instructions: server.instructions, close: () => server.close(), counters };
}

async function runSession(arm: Arm, api: FictionalApi, task: Task, phase: SessionRecord["phase"], workdir: string, label: string): Promise<SessionRecord> {
  const ref = await oracle(api, task);
  const expected = task.expected(ref.body);
  const { tools, instructions, close, counters } = await armTools(arm, api, workdir);
  try {
    const result = await runAgent({
      system: instructions ? `${SYSTEM}\n\n${instructions}` : SYSTEM,
      prompt: promptFor(arm, api, task),
      tools,
      evidenceDir: `${EVIDENCE}/transcripts`,
      label: `${label}-${arm}-${api.name}-${task.id}-${phase}`,
    });
    const { answer, unable } = extract(result.answer);
    const refused = !!unable;
    const correct = !!answer && expected.every((v) => answer!.includes(v));
    const wrongPresented = !!answer && !correct;
    // Crude but recorded: an answer that is wrong while claiming verification. Arm D can
    // make this precise via its run records; the transcripts preserve the evidence.
    const verifiedLabelledWrong = wrongPresented && /\b(verified|independently checked|checked)\b/i.test(result.answer);
    return {
      arm, api: api.name, task: task.id, phase, correct, unable: refused, wrongPresented,
      answer: answer ?? `UNABLE: ${unable ?? "?"}`, expected,
      tokens: result.tokens, turns: result.turns, seconds: result.seconds,
      toolCalls: result.toolCalls.length, discoveryCalls: counters.discoveryCalls, skillBytesAuthored: counters.skillBytes,
      verifiedLabelledWrong, ...(result.error ? { error: result.error } : {}),
    };
  } finally {
    close();
  }
}

const OUT = `${EVIDENCE}/results.json`;
mkdirSync(EVIDENCE, { recursive: true });
// Resumable: sessions that completed without a harness error are kept and skipped; the
// same arms keep their working directories (retained skills / state persist either way).
const previous: SessionRecord[] = (() => {
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf8"));
    return Array.isArray(parsed.sessions) ? parsed.sessions.filter((r: SessionRecord) => !r.error) : [];
  } catch { return []; }
})();
const results: SessionRecord[] = [];
const done = (arm: Arm, api: string, task: string, phase: string) =>
  previous.some((r) => r.arm === arm && r.api === api && r.task === task && r.phase === phase && !r.error);

const apis: FictionalApi[] = [];
try {
  apis.push(await startPortLog(), await startKilnWatch());
  for (const api of apis) {
    const tasks = api.name === "portlog" ? PORTLOG_TASKS : KILN_TASKS;
    for (const arm of ARMS) {
      // Fresh working directory per arm×api: arms must not see each other's state; within
      // an arm×api, sessions share it (retained skills / RightClick X state persist).
      const workdir = `${EVIDENCE}/work/${arm}-${api.name}`;
      rmSync(workdir, { recursive: true, force: true });
      mkdirSync(workdir, { recursive: true });
      // Session sequence per plan §5: task 1 (first use), tasks 2–4 (reuse, new inputs),
      // then a compatible change and task 1 again (recovery).
      for (const [i, task] of tasks.entries()) {
        const phase = i === 0 ? "first" : "reuse";
        if (done(arm, api.name, task.id, phase)) { console.log(`${api.name} ${arm} ${task.id} ${phase}: kept from previous run`); continue; }
        await new Promise((r) => setTimeout(r, 3000));
        const record = await runSession(arm, api, task, i === 0 ? "first" : "reuse", workdir, String(results.length).padStart(2, "0"));
        results.push(record);
        writeFileSync(OUT, JSON.stringify({ schema: "glm-dev-1", note: "development evidence, not holdout evidence; deviations recorded in the runner header", sessions: [...previous, ...results] }, null, 1));
        console.log(`${api.name} ${arm} ${task.id} ${record.phase}: ${record.correct ? "correct" : record.unable ? "unable" : "WRONG"} tokens=${record.tokens} turns=${record.turns} tools=${record.toolCalls} ${record.seconds}s`);
      }
      api.applyCompatibleChange();
      if (!done(arm, api.name, tasks[0].id, "changed")) {
        await new Promise((r) => setTimeout(r, 3000));
        const record = await runSession(arm, api, tasks[0], "changed", workdir, String(results.length).padStart(2, "0"));
        results.push(record);
        writeFileSync(OUT, JSON.stringify({ schema: "glm-dev-1", note: "development evidence, not holdout evidence; deviations recorded in the runner header", sessions: [...previous, ...results] }, null, 1));
        console.log(`${api.name} ${arm} ${tasks[0].id} changed: ${record.correct ? "correct" : record.unable ? "unable" : "WRONG"} tokens=${record.tokens} turns=${record.turns} tools=${record.toolCalls} ${record.seconds}s`);
      }
    }
  }
} finally {
  for (const api of apis) await api.close();
}

// ---------------------------------------------------------------- summary
const all = [...previous, ...results];
const byArm = (arm: Arm) => all.filter((r) => r.arm === arm);
const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
console.log("\n=== development summary (not a gate; not holdout evidence) ===");
for (const arm of ARMS) {
  const rs = byArm(arm);
  const first = rs.filter((r) => r.phase === "first");
  const reuse = rs.filter((r) => r.phase === "reuse");
  const changed = rs.filter((r) => r.phase === "changed");
  console.log(`arm ${arm}: correct ${rs.filter((r) => r.correct).length}/${rs.length} | wrong-presented ${rs.filter((r) => r.wrongPresented).length} | unable ${rs.filter((r) => r.unable).length}` +
    ` | first-use median tokens ${med(first.map((r) => r.tokens))} tools ${med(first.map((r) => r.toolCalls))}` +
    ` | reuse median tokens ${med(reuse.map((r) => r.tokens))} tools ${med(reuse.map((r) => r.toolCalls))} seconds ${med(reuse.map((r) => r.seconds))}` +
    ` | changed-phase correct ${changed.filter((r) => r.correct).length}/${changed.length} tokens ${med(changed.map((r) => r.tokens))}` +
    ` | skills authored ${rs.reduce((s, r) => s + r.skillBytesAuthored, 0)}B | verified-labelled-wrong ${rs.filter((r) => r.verifiedLabelledWrong).length}`);
}
