// Baselines (PREREGISTRATION.md, Stage 6): the same tasks, same model and budgets, with and
// without RightClick X. First use and reuse (a second task with new input in a fresh session).
//   node experiments/universal-capability-engine/baselines.ts <freeze-tag>
// Requires the challenge evidence of the same tag (its Stage A state is RightClick X's arm).
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Mcp, frozenBuild, readJsonl, serverFiles } from "../life-science/harness.ts";

const TAG = process.argv[2];
const OUT = "experiments/universal-capability-engine/evidence";
const ch = JSON.parse(readFileSync(`${OUT}/challenge-${TAG}.json`, "utf8"));
const build = frozenBuild(TAG);
const A = ch.A as string;
const env = realpathSync(mkdtempSync(join(tmpdir(), "uce-base-")));
const BIN = `${env}/bin`;
mkdirSync(BIN);
symlinkSync(`/usr/bin/${A}`, `${BIN}/${A}`);

// Re-create RightClick X's Stage A state on this build (same harness calls as the challenge).
const docA = `<html><head><title>Quarterly report</title></head>\n<body><h2>Results</h2>\n<p>Revenue grew in every region\n<p>Costs fell sharply\n<ul><li>North<li>South</ul>\n</body></html>\n`;
process.env.RCX_INVESTIGATE = `${BIN}/`;
const sf = serverFiles(`${env}/rcx`);
const m = new Mcp(build.rcx, sf);
await m.init();
await m.tool("context_learn", { source: `cli:${BIN}/${A}` });
await m.tool("context_compose", { have: { html: { type: "html", value: docA } }, want: "html", intent: "correct and pretty-print an html document", run: true, publish: "Correct HTML", verify: [{ op: "contains", value: "</html>" }] });
const capId = (await m.tool("context_graph", { op: "export" })).value.capabilities.find((c: any) => c.provider === `cli:${A}` && c.id.endsWith(":default"))?.id;
const card = capId ? (await m.tool("context_explain", { id: capId })).value.card : null;
await m.close();
const investigation = (() => { try { return JSON.parse(readFileSync(sf.state, "utf8")).reflections.find((r: any) => r.provider.id === `cli:${A}`)?.provider.meta.investigation; } catch { return null; } })();
const transcript = investigation ? investigation.runs.map((r: any) => `run ${r.id} (${r.purpose}): args ${JSON.stringify(r.args)} -> exit ${r.code}, stdout ${r.stdoutBytes} bytes: ${r.stdoutPreview.replace(/\n/g, "\\n").slice(0, 200)}`).join("\n") : "";

// Tasks (unseen inputs) and the independent check, the same as the challenge's Stage B.
const VOID = new Set(["br", "img", "meta", "link", "hr", "input", "!doctype"]);
const balanced = (h: string) => { const st: string[] = []; for (const x of h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?\s*([a-zA-Z!][\w:-]*)[^>]*?(\/?)>/g)) { const n = x[1].toLowerCase(); if (VOID.has(n) || x[2] === "/") continue; if (!x[0].startsWith("</")) st.push(n); else if (st.pop() !== n) return false; } return !st.length; };
const words = (s: string) => s.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const check = (input: string, out?: string) => !!out && balanced(out) && [...new Set(words(input))].every((w) => words(out).includes(w)) && ["p", "li"].filter((t) => new RegExp(`<${t}\\b`, "i").test(input)).every((t) => new RegExp(`</${t}>`, "i").test(out));
const TASKS = [
  `<html><head><title>Field notes</title></head>\n<body><h3>Station seven</h3>\n<p>Wind from the northwest\n<p>Rain overnight\n<ul><li>Tuesday<li>Wednesday</ul>\n</body></html>\n`,
  `<html><head><title>Inventory</title></head>\n<body><h3>Shelf four</h3>\n<p>Copper wire\n<p>Brass hinges\n<ul><li>Boxed<li>Loose</ul>\n</body></html>\n`,
];
const prompt = (doc: string, how: string, extra = "") => [how, extra, "A colleague needs the HTML document below cleaned up and corrected (every element properly closed) and neatly formatted.", "Do the correction with your tools; do not rewrite the document yourself.", "Reply with the corrected document between a line containing only BEGIN and a line containing only END.", "", doc].filter(Boolean).join("\n");

function claude(mcpConfig: object, allowed: string, text: string, dir: string): Promise<{ output: string; turns?: number; usage?: any; seconds: number }> {
  writeFileSync(`${dir}/mcp.json`, JSON.stringify(mcpConfig));
  const t0 = performance.now();
  return new Promise((done) => {
    const p = spawn("claude", ["-p", text, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", allowed, "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit", "--output-format", "json", "--max-turns", "40"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill(), 900_000);
    p.on("close", () => {
      clearTimeout(timer);
      const seconds = Math.round((performance.now() - t0) / 100) / 10;
      try {
        const j = JSON.parse(out);
        done({ output: j.result ?? "", turns: j.num_turns, usage: j.usage, seconds });
      } catch {
        done({ output: out.slice(-2000), seconds });
      }
    });
  });
}
const tokens = (u: any) => (u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null);

const ARMS: Array<{ id: string; label: string }> = [
  { id: "rightclick-x", label: "RightClick X (13 context_* tools; capability learned once in Stage A)" },
  { id: "direct", label: "Baseline 1: direct surface only (run_program), no RightClick X" },
  { id: "transcript", label: "Baseline 2: direct surface + RightClick X's investigation transcript as text" },
  { id: "docs", label: "Baseline 3: direct surface + the generated capability card as structured text" },
];
const ev: any = { tag: TAG, commit: build.commit, program: A, model: "Claude Code default", budgets: { maxTurns: 40, timeoutSeconds: 900 }, arms: {}, notRun: { "coding-agent": "Baseline 4 (an agent allowed to write and keep integration code) needs arbitrary code execution; the programme's safety rules exclude granting it, so it was not run." } };
for (const arm of ARMS) {
  ev.arms[arm.id] = { label: arm.label, tasks: [] };
  for (const [i, doc] of TASKS.entries()) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `uce-arm-${arm.id}-`)));
    const log = `${dir}/calls.jsonl`;
    let r;
    if (arm.id === "rightclick-x") {
      copyFileSync(sf.state, `${dir}/state.json`);
      const cfg = { mcpServers: { "rightclick-x": { command: process.execPath, args: [build.rcx, "mcp"], env: { RCX_STATE_FILE: `${dir}/state.json`, RCX_MCP_LOG: log, RCX_WORKSPACE: dir, RCX_INVESTIGATE: `${BIN}/` } } } };
      r = await claude(cfg, "mcp__rightclick-x", prompt(doc, "You are connected to exactly one MCP server, rightclick-x. Use only its tools."), dir);
    } else {
      const cfg = { mcpServers: { surface: { command: process.execPath, args: [resolve("experiments/universal-capability-engine/direct-surface.ts")], env: { DS_PROGRAM: `${BIN}/${A}`, DS_LOG: log } } } };
      const extra = arm.id === "transcript" ? `Notes from an earlier exploration of this program (as plain text):\n${transcript}` : arm.id === "docs" ? `Documentation of this program's capability (generated earlier):\n${JSON.stringify(card, null, 1)}` : "";
      r = await claude(cfg, "mcp__surface", prompt(doc, "You have one MCP tool, run_program, which runs a command-line program on this machine. Use only it.", extra), dir);
    }
    const calls = readJsonl(log).length;
    const answer = /^BEGIN\s*$([\s\S]*?)^END\s*$/m.exec(r.output)?.[1]?.trim();
    const correct = calls > 0 && check(doc, answer);
    ev.arms[arm.id].tasks.push({ task: i === 0 ? "first use" : "reuse (new input, fresh session)", correct, toolCalls: calls, turns: r.turns, seconds: r.seconds, tokens: tokens(r.usage), answered: !!answer });
    console.log(`${arm.id} ${i === 0 ? "first" : "reuse"}: ${correct ? "correct" : "NOT correct"} · ${calls} tool calls · ${r.turns ?? "?"} turns · ${r.seconds}s · ${tokens(r.usage) ?? "?"} tokens`);
    writeFileSync(`${OUT}/baselines-${TAG}.json`, JSON.stringify(ev, null, 2));
  }
}
