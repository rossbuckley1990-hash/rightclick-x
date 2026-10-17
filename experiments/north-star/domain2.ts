// Domain 2 (EVALUATION-PLAN.md §4): public, read-only web APIs not used in RightClick X's
// development. The independent evaluator picks three from the fixed list and writes four tasks
// each with a reference GET request and the JSON paths whose values a correct answer must state.
// Arms: D (RightClick X, given the API's root URL) and A (http_get on that origin only).
//   node experiments/north-star/domain2.ts <freeze-tag>          (resumable)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OUT, claudeSession, extract, readJsonl } from "./common.ts";

const TAG = process.argv[2];
// Pilot mode (harness debugging before the freeze): a development API only, separate file.
const PILOT = process.argv.includes("--pilot");
const COMMIT = execFileSync("git", ["rev-parse", `${TAG}^{commit}`], { encoding: "utf8" }).trim();
const FILE = PILOT ? `${OUT}/pilot-domain2-${TAG}.json` : `${OUT}/domain2-${TAG}.json`;
const WORK = realpathSync(tmpdir()) + `/ns-d2-${TAG}`;
const BUILD = `${WORK}/build`;
if (!existsSync(`${BUILD}/bin/rcx.ts`)) {
  mkdirSync(BUILD, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${TAG} | tar -x -C ${JSON.stringify(BUILD)}`]);
}
// Pre-registered list (EVALUATION-PLAN.md §4): name and root URL only.
const APIS = PILOT ? [{ name: "Countries GraphQL (development API)", root: "https://countries.trevorblades.com" }] : [
  { name: "Open-Meteo forecast", root: "https://api.open-meteo.com" },
  { name: "PokeAPI", root: "https://pokeapi.co" },
  { name: "GBIF species", root: "https://api.gbif.org" },
  { name: "Rick and Morty GraphQL", root: "https://rickandmortyapi.com" },
  { name: "Art Institute of Chicago", root: "https://api.artic.edu" },
  { name: "Open Library", root: "https://openlibrary.org" },
  { name: "REST Countries", root: "https://restcountries.com" },
];

const ev: any = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { tag: TAG, commit: COMMIT, apis: APIS, tasks: [], sessions: [] };
const save = () => writeFileSync(FILE, JSON.stringify(ev, null, 2));

function evaluator(prompt: string): Promise<string> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ns-evaluator-")));
  writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: {} }));
  return new Promise((done) => {
    const p = spawn("claude", ["-p", prompt, "--model", "opus", "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--disallowedTools", "Bash,Read,Write,Edit,MultiEdit,WebFetch,WebSearch,Glob,Grep,Task,Agent,NotebookEdit,TodoWrite", "--output-format", "json", "--max-turns", "3"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      try {
        done(String(JSON.parse(out).result ?? ""));
      } catch {
        done(out);
      }
    });
  });
}

const pick = (v: any, path: string): unknown => path.replace(/^\$\.?/, "").split(".").filter(Boolean).reduce((x: any, k) => (x == null ? undefined : Array.isArray(x) && /^\d+$/.test(k) ? x[Number(k)] : x[k]), v);

if (!ev.tasks.length) {
  const prompt = `You are an independent evaluator for a software benchmark. You have no tools; answer from your own knowledge. Reply with JSON only.
From this list of public, read-only, no-authentication web APIs, choose ${PILOT ? "ONE" : "THREE"}, in an order of your own choosing:
${APIS.map((a) => `- ${a.name} (${a.root})`).join("\n")}
For each, write four tasks a user might ask that the API answers. Rules:
- "request": plain words, as a user would ask; do not give URLs or parameter names.
- "referenceUrl": the exact GET URL (on that API's origin) whose JSON response contains the answer.
- "answerPaths": 1-3 dot paths into that JSON response (e.g. "name" or "types.0.type.name") whose values a correct answer must state.
- Choose facts that are stable over days (no current weather, prices, counts that change hourly, or "latest" items).
FORMAT: {"apis":[{"name":"...","tasks":[{"request":"...","referenceUrl":"...","answerPaths":["..."]}]}]}`;
  const text = await evaluator(prompt);
  if (/hit your (session |usage )?limit|usage limit|rate limit/i.test(text) && !/\{/.test(text)) {
    console.log(`BLOCKED by a usage limit: ${text.slice(0, 120)}; re-run to resume`);
    process.exit(2);
  }
  ev.evaluatorReply = text;
  const j = JSON.parse(/\{[\s\S]*\}/.exec(text)![0]);
  for (const api of j.apis.slice(0, PILOT ? 1 : 3)) {
    const root = APIS.find((a) => a.name === api.name)?.root ?? new URL(api.tasks[0].referenceUrl).origin;
    for (const [i, t] of api.tasks.slice(0, 4).entries()) {
      // The reference request's values are the truth (fetched now, read-only).
      let expected: string[] = [];
      let invalid: string | undefined;
      try {
        const res = await fetch(t.referenceUrl, { headers: { accept: "application/json", "user-agent": "rightclick-x-benchmark/1 (+https://github.com/rossbuckley1990-hash/rightclick-x)" } });
        const body = await res.json();
        expected = (t.answerPaths ?? []).map((p: string) => pick(body, p)).filter((v: unknown) => v !== undefined && v !== null && typeof v !== "object").map(String);
        if (!res.ok) invalid = `reference HTTP ${res.status}`;
        else if (!expected.length) invalid = "no answer value at the given paths";
      } catch (e) {
        invalid = String((e as Error).message);
      }
      ev.tasks.push({ id: `${api.name}#${i + 1}`, api: api.name, root, request: t.request, referenceUrl: t.referenceUrl, answerPaths: t.answerPaths, expected, valid: !invalid, ...(invalid ? { invalid } : {}) });
    }
  }
  save();
}

for (const t of ev.tasks.filter((x: any) => x.valid).slice(0, PILOT ? 2 : undefined)) {
  for (const arm of ["A", "D"]) {
    const key = `${arm}|${t.id}`;
    if (ev.sessions.some((s: any) => s.key === key && !s.blocked)) continue;
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `ns-d2-${arm}-`)));
    const log = `${dir}/calls.jsonl`;
    const state = `${WORK}/state-${t.api.replace(/\W+/g, "-")}.json`;
    const servers = arm === "D"
      ? { "rightclick-x": { command: process.execPath, args: [`${BUILD}/bin/rcx.ts`, "mcp"], env: { RCX_STATE_FILE: state, RCX_MCP_LOG: log, RCX_WORKSPACE: dir } } }
      : { surface: { command: process.execPath, args: [resolve(`${BUILD}/experiments/north-star/surface.ts`)], env: { DS_ORIGIN: new URL(t.root).origin, DS_LOG: log } } };
    const preface = arm === "D"
      ? `You are connected to RightClick X (its context_* tools). Use only them. The API at ${t.root} is authorised for this task; RightClick X may already know it.`
      : `You have one MCP tool, http_get, which can GET any URL on ${new URL(t.root).origin}. Use only it.`;
    const prompt = `${preface}\n\nTask: ${t.request}\n\nUse your tools to get the answer from the API; do not answer from memory. If it cannot be answered with this API, reply with a line 'UNABLE: <reason>'. Otherwise reply with the answer between a line containing only BEGIN and a line containing only END.`;
    const r = await claudeSession({ prompt, servers, allowed: arm === "D" ? "mcp__rightclick-x" : "mcp__surface", model: "sonnet" });
    const calls = readJsonl(log);
    const executed = arm === "D" ? calls.some((c) => (c.tool === "context_run" || (c.tool === "context_compose" && c.args?.run)) && c.ok) : calls.some((c) => c.tool === "http_get");
    const { answer, unable } = extract(r.reply);
    const lower = (answer ?? "").toLowerCase();
    const correct = !!answer && executed && t.expected.every((v: string) => lower.includes(v.toLowerCase()));
    ev.sessions = ev.sessions.filter((s: any) => s.key !== key);
    ev.sessions.push({ key, arm, task: t.id, api: t.api, correct, wrong: !correct && answer !== undefined, unable: unable ?? null, executed, seconds: r.seconds, tokens: r.tokens, costUsd: r.costUsd, turns: r.turns, toolCalls: calls.length, tools: calls.map((c) => c.tool), ...(r.blocked ? { blocked: r.blocked } : {}), reply: r.reply.slice(0, 3000) });
    save();
    console.log(`${key}: ${r.blocked ? "BLOCKED" : correct ? "correct" : answer !== undefined ? "WRONG" : "not correct"} · ${r.seconds}s · ${calls.length} calls`);
    if (r.blocked) process.exit(2);
  }
}
const s = ev.sessions.filter((x: any) => !x.blocked);
ev.summary = Object.fromEntries(["A", "D"].map((a) => [a, { n: s.filter((x: any) => x.arm === a).length, correct: s.filter((x: any) => x.arm === a && x.correct).length, wrong: s.filter((x: any) => x.arm === a && x.wrong).length }]));
save();
console.log(JSON.stringify(ev.summary));
