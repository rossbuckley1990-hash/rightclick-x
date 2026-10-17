// The Zero-Integration Challenge (PREREGISTRATION.md, 82b4a47): stages A-F on a frozen build.
//   node experiments/universal-capability-engine/challenge.ts <freeze-tag>
// RightClick X is reached only through its MCP tools (stdio), started from a git-archive export
// of the tag. A and C are the seeded draws (selection-ac.json), run from copies in a disposable
// directory the operator registers. Every check is the harness's own code, never A or C.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, frozenBuild, readJsonl, serverFiles } from "../life-science/harness.ts";
import { runAgent } from "../gauntlet/agent.ts";

const TAG = process.argv[2];
if (!TAG) throw new Error("usage: challenge.ts <freeze-tag>");
const OUT = "experiments/universal-capability-engine/evidence";
mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.log(...a);
const sel = JSON.parse(readFileSync(`${OUT}/selection-ac.json`, "utf8"));
const A = sel.draws.A as string;
const C = sel.draws.C as string;
const build = frozenBuild(TAG);
const env = realpathSync(mkdtempSync(join(tmpdir(), "uce-env-")));
const BIN = `${env}/bin`;
mkdirSync(BIN);
// Deviation from the pre-registration (recorded): A and C are installed into the registered
// directory as symlinks to the system programs, not copies. macOS kills a copied Apple platform
// binary run from another location (exit 137; observed in run 1 on uce-freeze-1). Removing the
// symlink removes the program from the registered location; /usr/bin itself is SIP-protected.
symlinkSync(`/usr/bin/${A}`, `${BIN}/${A}`);
symlinkSync(`/usr/bin/${C}`, `${BIN}/${C}`);
// Operator discovery authority: this directory only.
// Links to system programs are authorised by name (a directory authorises only what really lives in it).
process.env.RCX_INVESTIGATE = `${BIN}/,${BIN}/${A},${BIN}/${C}`;
const ev: any = { tag: TAG, commit: build.commit, at: new Date().toISOString(), A, C, env, stages: {}, wrongOutcomes: [] as string[], metrics: {} };
const save = () => writeFileSync(`${OUT}/challenge-${TAG}.json`, JSON.stringify(ev, null, 2));

// ---------------------------------------------------------------- independent checks (harness code)
const VOID = new Set(["br", "img", "meta", "link", "hr", "input", "col", "area", "base", "wbr", "source", "param", "embed", "track", "!doctype"]);
function tagsBalanced(html: string): { ok: boolean; detail: string } {
  const stack: string[] = [];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?\s*([a-zA-Z!][\w:-]*)[^>]*?(\/?)>/g)) {
    const name = m[1].toLowerCase();
    const closing = m[0].startsWith("</");
    if (VOID.has(name) || m[2] === "/") continue;
    if (!closing) stack.push(name);
    else {
      if (stack[stack.length - 1] !== name) return { ok: false, detail: `</${name}> closes <${stack[stack.length - 1] ?? "nothing"}>` };
      stack.pop();
    }
  }
  return { ok: stack.length === 0, detail: stack.length ? `unclosed: ${stack.join(",")}` : "balanced" };
}
const words = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
function htmlCorrected(input: string, output: unknown): { pass: boolean; detail: string } {
  if (typeof output !== "string" || !output.trim()) return { pass: false, detail: "no HTML output" };
  const bal = tagsBalanced(output);
  const missing = [...new Set(words(input))].filter((w) => !words(output).includes(w));
  const closes = ["p", "li"].filter((t) => new RegExp(`<${t}\\b`, "i").test(input)).every((t) => new RegExp(`</${t}>`, "i").test(output));
  return { pass: bal.ok && !missing.length && closes, detail: `tags ${bal.detail}; words missing ${missing.length ? missing.join(",") : "none"}; unclosed p/li now closed ${closes}` };
}
function sideBySide(original: string, output: unknown): { pass: boolean; detail: string } {
  if (typeof output !== "string" || !output.trim()) return { pass: false, detail: "no output" };
  const out = output.split("\n");
  let at = 0;
  const lines = original.split("\n").map((l) => l.trim()).filter(Boolean);
  const inOrder = lines.every((l) => {
    const k = out.findIndex((o, i) => i >= at && o.includes(l.slice(0, 40)));
    if (k < 0) return false;
    at = k;
    return true;
  });
  const markers = out.some((o) => /\s[|<>]\s|\s[<>]$/.test(o));
  const corrected = ["</p>", "</li>"].some((t) => !original.includes(t) && output.includes(t));
  const missing = [...new Set(words(original))].filter((w) => !words(output).includes(w));
  return { pass: inOrder && markers && corrected && !missing.length, detail: `original lines in order ${inOrder}; change markers ${markers}; corrected side has closing tags ${corrected}; words missing ${missing.length}` };
}

// ---------------------------------------------------------------- unseen inputs (never used by the investigator)
const docA = `<html><head><title>Quarterly report</title></head>\n<body><h2>Results</h2>\n<p>Revenue grew in every region\n<p>Costs fell sharply\n<ul><li>North<li>South</ul>\n</body></html>\n`;
const docB = `<html><head><title>Field notes</title></head>\n<body><h3>Station seven</h3>\n<p>Wind from the northwest\n<p>Rain overnight\n<ul><li>Tuesday<li>Wednesday</ul>\n</body></html>\n`;
const docC = `<html><head><title>Menu</title></head>\n<body>\n<p>Soup of the day\n<p>Fresh bread\n<ul><li>Coffee<li>Tea</ul>\n</body></html>\n`;

async function server(name: string, stateFrom?: string) {
  const f = serverFiles(`${env}/${name}`);
  if (stateFrom) copyFileSync(stateFrom, f.state);
  const m = new Mcp(build.rcx, f);
  await m.init();
  return { m, f };
}

// ================================================================ Stage A
log(`build ${TAG} (${build.commit.slice(0, 10)}) · A=${A} · C=${C}`);
{
  const { m, f } = await server("stage-a");
  const t0 = Date.now();
  const learned = await m.tool("context_learn", { source: `cli:${BIN}/${A}` });
  const learnMs = Date.now() - t0;
  const caps = (await m.tool("context_graph", { op: "export" })).value.capabilities.filter((c: any) => c.provider === `cli:${A}`);
  const cards = [];
  for (const c of caps) cards.push((await m.tool("context_explain", { id: c.id })).value.card);
  const supported = cards.filter((c: any) => (c.verification?.evidence ?? []).some((e: string) => /experimentally-supported/.test(e)));
  const t1 = Date.now();
  const r = await m.tool("context_compose", { have: { html: { type: "html", value: docA } }, want: "html", intent: "correct and pretty-print an html document", run: true, publish: "Correct HTML", verify: [{ op: "contains", value: "</html>" }], view: { full: true } });
  const composeMs = Date.now() - t1;
  const output = r.value?.executed?.output;
  const check = htmlCorrected(docA, output);
  if (r.value?.executed?.status === "completed" && !check.pass) ev.wrongOutcomes.push(`A: completed but failed independent check (${check.detail})`);
  await m.close();
  // Retained across a restart, with its evidence.
  const again = new Mcp(build.rcx, f);
  await again.init();
  const found = (await again.tool("context_graph", { op: "search", query: "correct html", limit: 10 })).value;
  const hits = (found.results ?? found).map((x: any) => (x.capability ?? x).id);
  await again.close();
  ev.stages.A = {
    learn: { ms: learnMs, probes: learned.value?.results?.[0]?.probes, error: learned.value?.results?.[0]?.error },
    capabilities: cards.map((c: any) => ({ id: c.identity.id, title: c.identity.title, evidence: c.verification?.evidence, limitations: c.limitations })),
    experimentallySupported: supported.length,
    compose: { ms: composeMs, plan: r.value?.executed?.titles, status: r.value?.executed?.status, published: r.value?.published, verification: r.value?.executed?.verification?.status },
    independentCheck: check,
    retainedAfterRestart: { goal: hits.includes("goal:correct-html"), capability: hits.some((h: string) => h.startsWith(`cli:${A}:`)), hits },
    stateFile: f.state,
  };
  ev.stages.A.pass = supported.length > 0 && r.value?.executed?.status === "completed" && check.pass && ev.stages.A.retainedAfterRestart.goal && ev.stages.A.retainedAfterRestart.capability;
  ev.metrics.timeToFirstCapabilityMs = learnMs;
  ev.metrics.timeToFirstVerifiedCapabilityMs = learnMs + composeMs;
  ev.metrics.integrationCodeLines = 0;
  log(`A: ${ev.stages.A.pass ? "PASS" : "FAIL"} · ${caps.length} capabilities (${supported.length} experimentally supported) in ${learnMs} ms · compose ${r.value?.executed?.status} via ${(r.value?.executed?.titles ?? []).join(" → ")} · check: ${check.detail}`);
  save();
}

// ================================================================ Stages B + F: fresh agents reuse the capability
const PROMPT_B = [
  "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
  "A colleague needs the HTML document below cleaned up and corrected (every element properly closed) and neatly formatted.",
  "Do the correction with the rightclick-x tools; do not rewrite the document yourself. (Deviation from runs 1-2, recorded: their prompt let the agent answer without tools, and Claude Code did.)".replace(/ \(Deviation[^)]*\)/, ""),
  "Reply with the corrected document between a line containing only BEGIN and a line containing only END.",
  "",
  docB,
].join("\n");
for (const client of ["claude", "codex"] as const) {
  const dir = `${env}/agent-${client}`;
  mkdirSync(dir, { recursive: true });
  const state = `${dir}/state.json`;
  copyFileSync(ev.stages.A.stateFile, state);
  const receiptsBefore = (() => { try { return (JSON.parse(readFileSync(state, "utf8")).receipts ?? []).length; } catch { return 0; } })();
  const logFile = `${dir}/mcp.jsonl`;
  const r = await runAgent(client, { kind: "stdio", stateFile: state, logFile, rcx: build.rcx, env: { RCX_INVESTIGATE: process.env.RCX_INVESTIGATE! } }, PROMPT_B, 600_000);
  const calls = readJsonl(logFile);
  const tools = calls.map((c: any) => c.tool ?? c.name);
  const relearned = calls.some((c: any) => (c.tool ?? c.name) === "context_learn" && JSON.stringify(c.args ?? c.arguments ?? {}).includes("cli:"));
  const receipts = (() => { try { return JSON.parse(readFileSync(state, "utf8")).receipts ?? []; } catch { return []; } })();
  // Only receipts created during this agent's session count (runs 1-2 read Stage A's copied receipts).
  const usedCli = tools.length > 0 && receipts.slice(receiptsBefore).some((x: any) => String(x.provider).startsWith(`cli:${A}`) || String(x.capability).startsWith(`cli:${A}`) || String(x.capability) === "goal:correct-html");
  const answer = /^BEGIN\s*$([\s\S]*?)^END\s*$/m.exec(r.output)?.[1]?.trim();
  const check = htmlCorrected(docB, answer);
  const stage = { client, seconds: r.seconds, turns: r.meta?.turns, usage: r.meta?.usage, toolCalls: tools.length, tools, relearnedProgram: relearned, executedThroughCapability: usedCli, independentCheck: check, pass: !relearned && usedCli && check.pass, tail: r.output.slice(-600) };
  const blocked = /usage limit|rate limit|hit your/i.test(r.output) && !tools.length;
  if (blocked) Object.assign(stage, { blocked: true, pass: false, note: "client unavailable (usage limit); not a RightClick X result" });
  if (!check.pass && answer) ev.wrongOutcomes.push(`${client === "claude" ? "B" : "F"}: agent returned HTML failing the check (${check.detail})`);
  ev.stages[client === "claude" ? "B" : "F"] = stage;
  log(`${client === "claude" ? "B" : "F"} (${client}): ${stage.pass ? "PASS" : "FAIL"} · ${r.seconds}s · ${tools.length} tool calls (${tools.join(", ")}) · relearned ${relearned} · used capability ${usedCli} · ${check.detail}`);
  save();
}
ev.stages.F.label = "different vendor (OpenAI Codex) from the session that built the capability (harness-driven Stage A); B is Anthropic Claude Code";

// ================================================================ Stage C: composition of A and C
{
  const { m } = await server("stage-c", ev.stages.A.stateFile);
  const lc = await m.tool("context_learn", { source: `cli:${BIN}/${C}` });
  const r = await m.tool("context_compose", { have: { html: { type: "html", value: docC } }, want: "text", intent: "side by side comparison of an html document before and after correction", run: true, view: { full: true }, maxSteps: 3 });
  const titles: string[] = r.value?.executed?.titles ?? [];
  const runs: string[] = r.value?.executed?.runs ?? [];
  const providers = new Set<string>();
  for (const id of runs) {
    const st = (await m.tool("context_run_status", { runId: id })).value;
    if (st?.provider) providers.add(st.provider);
    for (const s of st?.steps ?? []) {
      const inner = (await m.tool("context_run_status", { runId: s })).value;
      if (inner?.provider) providers.add(inner.provider);
    }
  }
  const check = sideBySide(docC, r.value?.executed?.output);
  const both = [...providers].some((p) => p === `cli:${A}`) && [...providers].some((p) => p === `cli:${C}`);
  if (r.value?.executed?.status === "completed" && !check.pass) ev.wrongOutcomes.push(`C: completed but failed independent check (${check.detail})`);
  ev.stages.C = { learn: lc.value?.results?.[0]?.probes, plan: titles, status: r.value?.executed?.status, providers: [...providers], usesBoth: both, independentCheck: check, attempts: r.value?.executed?.attempts, output: String(r.value?.executed?.output ?? "").slice(0, 2000), pass: r.value?.executed?.status === "completed" && both && check.pass };
  log(`C: ${ev.stages.C.pass ? "PASS" : "FAIL"} · ${titles.join(" → ")} · providers ${[...providers].join(", ")} · ${check.detail}`);
  await m.close();
  save();
}

// ================================================================ Stage D: mutations (synthetic program, operator authority)
{
  // The synthetic program's versions are plain files (experiments/universal-capability-engine/programs).
  const P = "experiments/universal-capability-engine/programs";
  const V: Record<string, string> = Object.fromEntries(["v1", "renamed", "file-input", "nested", "incompatible", "unavailable"].map((k) => [k, readFileSync(`${P}/textkit-${k}.sh`, "utf8")]));
  V.fileInput = V["file-input"];
  const checker = readFileSync(`${P}/casecheck.sh`, "utf8");
  const put = (file: string, body: string) => { writeFileSync(file, body); chmodSync(file, 0o755); };
  put(`${BIN}/textkit`, V.v1);
  put(`${BIN}/casecheck`, checker);
  const { m } = await server("stage-d");
  await m.tool("context_learn", { sources: [`cli:${BIN}/textkit`, `cli:${BIN}/casecheck`] });
  const graph = (await m.tool("context_graph", { op: "export" })).value.capabilities;
  const witnessCap = graph.find((c: any) => c.provider === "cli:casecheck");
  const wIn = witnessCap?.inputs?.map((p: any) => p.name) ?? [];
  const witnesses = witnessCap ? [{ capability: witnessCap.id, args: { [wIn[0]]: { input: "input" }, [wIn[1]]: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }] : [];
  const built = await m.tool("context_compose", { have: { input: { type: "text", value: "hello world\n" } }, want: "text", intent: "upper case text", run: true, witnesses, publish: "Upper case text", view: { full: true } });
  const steps: any[] = [];
  const call = async (label: string, text: string, expectation: "adapt" | "fail") => {
    const r = await m.tool("context_run", { id: "goal:upper-case-text", args: { input: text }, view: { full: true } });
    const out = r.value?.output;
    const want = text.toUpperCase().replace(/\n$/, "");
    const correct = r.value?.status === "completed" && String(out ?? "").trim() === want.trim();
    const wrong = r.value?.status === "completed" && !correct;
    if (wrong) ev.wrongOutcomes.push(`D ${label}: presented ${JSON.stringify(out)} for ${JSON.stringify(text)}`);
    const ok = expectation === "adapt" ? correct : r.value?.status !== "completed" || !r.ok;
    steps.push({ label, expectation, status: r.ok ? r.value?.status : "error", output: out, correct, wrong, pass: ok && !wrong, error: r.ok ? r.value?.error : r.value });
    log(`  D ${label}: ${r.ok ? r.value?.status : "error"} · ${JSON.stringify(out ?? r.value?.error ?? r.value).slice(0, 90)} · expected ${expectation} · ${ok && !wrong ? "ok" : "NOT OK"}`);
  };
  await call("baseline v1", "abc def\n", "adapt");
  put(`${BIN}/textkit`, V.renamed); await call("renamed operation (-u -> -U)", "ghi jkl\n", "adapt");
  put(`${BIN}/textkit`, V.fileInput); await call("changed input (stdin -> file operand)", "mno pqr\n", "adapt");
  put(`${BIN}/textkit`, V.nested); await call("nested output (JSON result.text)", "stu vwx\n", "adapt");
  put(`${BIN}/textkit`, V.incompatible); await call("incompatible semantic change (now lower-cases)", "yza bcd\n", "fail");
  put(`${BIN}/textkit`, V.unavailable); await call("temporarily unavailable (exit 75)", "efg hij\n", "fail");
  put(`${BIN}/textkit`, V.nested);
  const relearn = await m.tool("context_learn", { source: `cli:${BIN}/textkit` });
  await call("restored (operator re-investigates)", "klm nop\n", "adapt");
  ev.stages.D = { built: { status: built.value?.executed?.status, trust: built.value?.published?.trust, witness: witnessCap?.id ?? null }, relearnAfterRestore: relearn.value?.results?.[0]?.probes, steps, pass: steps.every((s) => s.pass) };
  log(`D: ${ev.stages.D.pass ? "PASS" : "FAIL"}`);
  await m.close();
  save();
}

// ================================================================ Stage E: withdrawal and re-establishment
{
  const { m } = await server("stage-e", ev.stages.A.stateFile);
  const run = async () => m.tool("context_run", { id: "goal:correct-html", args: { html: docA }, view: { full: true } });
  const before = await run();
  rmSync(`${BIN}/${A}`);
  const gone = await run();
  const capsAfter = (await m.tool("context_graph", { op: "export" })).value.capabilities.filter((c: any) => c.provider === `cli:${A}`).length;
  const goneWrong = gone.value?.status === "completed";
  if (goneWrong) ev.wrongOutcomes.push("E: goal completed with the program removed");
  symlinkSync(`/usr/bin/${A}`, `${BIN}/${A}`);
  const relearn = await m.tool("context_learn", { source: `cli:${BIN}/${A}` });
  const back = await run();
  const checkBack = htmlCorrected(docA, back.value?.output);
  ev.stages.E = { before: before.value?.status, afterRemoval: { status: gone.value?.status, error: gone.value?.error, programCapabilitiesInGraph: capsAfter }, relearn: relearn.value?.results?.[0]?.probes, afterRestore: { status: back.value?.status, independentCheck: checkBack }, pass: before.value?.status === "completed" && gone.value?.status !== "completed" && capsAfter === 0 && back.value?.status === "completed" && checkBack.pass };
  log(`E: ${ev.stages.E.pass ? "PASS" : "FAIL"} · before ${before.value?.status} · removed → ${gone.value?.status} (program capabilities left: ${capsAfter}) · restored → ${back.value?.status}`);
  await m.close();
  save();
}

// ================================================================ Negative controls N1/N2 (N3/N4 are regression tests)
{
  const { m } = await server("controls");
  writeFileSync(`${BIN}/silent`, "#!/bin/sh\nexit 1\n");
  chmodSync(`${BIN}/silent`, 0o755);
  const n1 = await m.tool("context_learn", { source: `cli:${BIN}/silent` });
  const n1caps = (await m.tool("context_graph", { op: "export" })).value.capabilities.filter((c: any) => c.provider === "cli:silent").length;
  const n2 = await m.tool("context_learn", { source: `cli:/usr/bin/${C}` });
  ev.controls = {
    N1: { capabilities: n1caps, probes: n1.value?.results?.[0]?.probes, pass: n1caps === 0 },
    N2: { error: n2.value?.results?.[0]?.error, pass: /not authorised/.test(String(n2.value?.results?.[0]?.error)) },
  };
  log(`N1: ${ev.controls.N1.pass ? "PASS" : "FAIL"} · N2: ${ev.controls.N2.pass ? "PASS" : "FAIL"}`);
  await m.close();
}
ev.summary = Object.fromEntries(Object.entries(ev.stages).map(([k, v]: any) => [k, v.pass]));
ev.summary.wrongOutcomes = ev.wrongOutcomes.length;
save();
log(`summary ${JSON.stringify(ev.summary)}`);
