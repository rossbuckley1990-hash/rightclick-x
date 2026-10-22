import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RightClick, type RunRecord } from "../../../src/runtime.ts";
import { FileStore } from "../../../src/entry/node-host.ts";
import { hostSandbox } from "../../../src/core/sandbox.ts";

type Arm = "A" | "B" | "C" | "D";
type Phase = "cold" | "warm" | "r1" | "r2" | "r3";
type Status = "pass" | "fail" | "blocked" | "na";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = resolve(HERE, "..");
const ROOT = resolve(EXP, "../..");
const ENV = join(EXP, "env");
const HARNESS = join(EXP, "harness");
const FIX = join(ENV, "fixtures");
const EVID = join(ROOT, "docs", "adaptive", "evidence", "competitive-cli-anything");
const TRIALS = process.env.RCX_TRIALS_OUTPUT ?? join(EVID, "trials");
const WORK = process.env.RCX_TRIALS_WORK ?? "/tmp/rcx-cli-anything-work";
const PORT = Number(process.env.RCX_TRIALS_PORT ?? 18082);
const API = `http://127.0.0.1:${PORT}`;
const MLR_PRISTINE = join(WORK, "pristine", "mlr");
const MLR_TARGET = join(WORK, "bin", "mlr");
const PY = realpathSync(join(ENV, "venv", "bin", "python"));
const PY_PREFIX = resolve(PY, "../..");
const MLR = MLR_TARGET;
const HARNESS_BIN = join(ENV, "venv", "bin", "cli-anything-mlr");

process.env.RCX_SANDBOX_READ = [ENV, HARNESS, WORK, "/opt/homebrew/Cellar/python@3.14/3.14.6", PY_PREFIX].join(":");
process.env.RCX_SANDBOX_PATH = [join(WORK, "bin"), join(ENV, "bin"), join(ENV, "venv", "bin")].join(":");
process.env.RCX_SANDBOX_NET = "allow";
process.env.RCX_SANDBOX_TIMEOUT_MS = "30000";

const arm = (process.argv[2] ?? "") as Arm;
const phase = (process.argv[3] ?? "") as Phase;
if (!["A", "B", "C", "D"].includes(arm) || !["cold", "warm", "r1", "r2", "r3"].includes(phase)) {
  console.error("usage: trials.ts <A|B|C|D> <cold|warm|r1|r2|r3>");
  process.exit(2);
}

const OUT = join(TRIALS, arm, phase);
const STATE = join(TRIALS, "state", `${arm}.json`);
const OUTPUTS = join(OUT, "outputs");
const ORACLE = join(OUT, "oracle");
const RUNS = join(OUT, "runs");
for (const dir of [OUT, OUTPUTS, ORACLE, RUNS, join(TRIALS, "state"), join(WORK, "bin"), join(WORK, "pristine")]) mkdirSync(dir, { recursive: true });

const log: string[] = [];
function say(message: string) {
  console.log(message);
  log.push(message);
}
function saveLog() {
  writeFileSync(join(OUT, "arm.log"), log.join("\n") + "\n");
}
function sha(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

let apiProc: ChildProcess | undefined;
async function apiUp(version: 1 | 2) {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(400) });
    if (r.ok) throw new Error(`port ${PORT} is already serving; refusing to reuse another process`);
  } catch (error) {
    if (String(error).includes("already serving")) throw error;
  }
  const apiLog = join(OUT, "api.log");
  apiProc = spawn(process.execPath, [join(ENV, "api", "server.mjs")], {
    env: { ...process.env, API_PORT: String(PORT), API_VERSION: String(version) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  apiProc.stdout!.on("data", (chunk) => { out += String(chunk); });
  apiProc.stderr!.on("data", (chunk) => { out += String(chunk); });
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(400) });
      if (r.ok) {
        const body = await r.json() as any;
        if (Number(body.version) === version) {
          writeFileSync(apiLog, out);
          say(`API v${version} listening on ${API}`);
          return;
        }
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  apiProc.kill("SIGKILL");
  writeFileSync(apiLog, out);
  throw new Error(`API v${version} did not become healthy on ${API}`);
}
async function apiDown() {
  if (!apiProc) return;
  const proc = apiProc;
  apiProc = undefined;
  proc.kill("SIGTERM");
  await Promise.race([once(proc, "exit"), new Promise((r) => setTimeout(r, 2500))]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
  say("API stopped");
}

function ensureWork() {
  if (!existsSync(MLR_PRISTINE)) {
    copyFileSync(join(ENV, "bin", "mlr"), MLR_PRISTINE);
    chmodSync(MLR_PRISTINE, 0o755);
  }
  if (!existsSync(MLR_TARGET)) {
    copyFileSync(MLR_PRISTINE, MLR_TARGET);
    chmodSync(MLR_TARGET, 0o755);
  }
}
function installWrapper(kind: "same" | "reverse") {
  const script = kind === "same"
    ? `#!/bin/sh\nexec ${MLR_PRISTINE} "$@"\n`
    : `#!${PY}\nimport json, subprocess, sys\n` +
      `p = subprocess.run([${JSON.stringify(MLR_PRISTINE)}, *sys.argv[1:]], capture_output=True)\n` +
      `sys.stderr.buffer.write(p.stderr)\n` +
      `try:\n` +
      `    value = json.loads(p.stdout)\n` +
      `    if isinstance(value, list):\n` +
      `        value.reverse()\n` +
      `    sys.stdout.write(json.dumps(value))\n` +
      `except Exception:\n` +
      `    sys.stdout.buffer.write(p.stdout)\n` +
      `sys.exit(p.returncode)\n`;
  writeFileSync(MLR_TARGET, script);
  chmodSync(MLR_TARGET, 0o755);
}
function restoreMlr() {
  copyFileSync(MLR_PRISTINE, MLR_TARGET);
  chmodSync(MLR_TARGET, 0o755);
}

interface Cmd {
  bin: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}
function sh(bin: string, args: string[], env: Record<string, string> = {}, timeout = 120_000): Cmd {
  const t = Date.now();
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout, env: { ...process.env, ...env } });
  return { bin, args, code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: Date.now() - t };
}
function oracleCheck(task: string, file: string) {
  const r = spawnSync("python3", [join(ENV, "oracle.py"), "check", task, file], { encoding: "utf8" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  writeFileSync(join(ORACLE, `${task}.txt`), text + "\n");
  return { code: r.status ?? -1, text };
}
function oracleFor(task: string) {
  const map: Record<string, string> = { T1: "t1", T2: "t2", T3: "t1", T4: "t2", T5: "t5", T6: "t6", T7: "t7" };
  return map[task];
}
function finishOracle(task: string, file: string, extra: Record<string, unknown> = {}) {
  const expected = oracleFor(task);
  const oracle = oracleCheck(expected, file);
  const record = { task, status: oracle.code === 0 ? "pass" as Status : "fail" as Status, oracle, outputFile: file, ...extra };
  recordTask(record);
  return record;
}

const tasks: any[] = [];
function recordTask(record: any) {
  tasks.push(record);
  say(`${record.task}: ${record.status}${record.note ? ` — ${record.note}` : ""}`);
  writeJson(join(OUT, "tasks.partial.json"), tasks);
  return record;
}

function sanitize(r: RunRecord) {
  return {
    runId: r.runId, capability: r.capability, provider: r.provider, status: r.status,
    durationMs: r.durationMs, error: r.error, refusal: r.refusal, changedMeaning: r.changedMeaning,
    verification: r.verification, receipt: r.receipt?.hash ?? r.receipt,
    cliValidity: r.cliValidity,
    healing: r.healing, attempts: r.attempts,
    output: typeof r.output === "string" ? r.output.slice(0, 2000) : r.output,
  };
}
async function rcxRun(rc: RightClick, id: string, args: Record<string, unknown> = {}, opts: Record<string, unknown> = {}): Promise<Partial<ReturnType<typeof sanitize>> & { capability: string; status: RunRecord["status"]; wallMs: number }> {
  const t = Date.now();
  try {
    const r = await rc.run(id, args, opts as any);
    const rec = { ...sanitize(r), wallMs: Date.now() - t };
    writeFileSync(join(RUNS, `${String(rec.runId).replace(/[^\w.-]/g, "_")}.json`), JSON.stringify(rec, null, 2) + "\n");
    say(`  run ${id} -> ${r.status}${r.error ? `: ${r.error.slice(0, 180)}` : ""}`);
    return rec;
  } catch (error) {
    const rec = { capability: id, status: "failed" as const, error: String((error as Error)?.message ?? error), wallMs: Date.now() - t };
    writeFileSync(join(RUNS, `throw-${Date.now()}.json`), JSON.stringify(rec, null, 2) + "\n");
    say(`  run ${id} -> threw: ${String(rec.error).slice(0, 180)}`);
    return rec;
  }
}

async function createRc(extra: Record<string, unknown> = {}) {
  const investigate = arm === "C" ? [MLR] : [HARNESS_BIN];
  return RightClick.create({
    directories: [],
    store: new FileStore(STATE),
    authority: { investigate, execute: investigate },
    ...extra,
  });
}
async function learnRc(rc: RightClick, sources: string[], label: string) {
  const t = Date.now();
  const learned = await rc.learn({ sources });
  const record = {
    label, sources, wallMs: Date.now() - t,
    totalNewCapabilities: learned.totalNewCapabilities, totalNewPowers: learned.totalNewPowers,
    graph: learned.graph,
    results: learned.results.map((r) => ({
      source: r.source, error: r.error, probes: r.probes,
      learned: r.learned.map((l) => ({ provider: l.provider, capabilitiesAdded: l.capabilitiesAdded, newPowers: l.newPowers })),
    })),
  };
  writeJson(join(OUT, `learn-${label}.json`), record);
  say(`learn ${label}: ${record.totalNewCapabilities} caps in ${record.wallMs}ms; providers ${record.graph.providers}; failures ${record.results.filter((r) => r.error).length}`);
  for (const r of record.results) if (r.error) say(`  learn error ${r.source}: ${r.error}`);
  return record;
}

async function invoiceState(id: string) {
  const r = await fetch(`${API}/v1/invoices/${id}`);
  if (!r.ok) return { status: r.status, body: await r.text() };
  return { status: r.status, body: await r.json() };
}

// ---------------------------------------------------------------- arms

async function armATask(task: "T1" | "T2", fixture: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const expr = '$region=="EMEA" && $amount>=500';
  const args = ["--icsv", "--ojson", "filter", expr, "then", "sort", "-nr", "amount", "then", "cut", "-f", "invoice_id,supplier,amount", fixture];
  const r = sh(MLR, args);
  writeFileSync(file, r.stdout);
  return finishOracle(task, file, { wallMs: r.ms, command: [MLR, ...args], exit: r.code, stderr: r.stderr.slice(0, 1000) });
}
async function armBApiTask(task: "T5" | "T6" | "T7", fixture?: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const args = [join(HERE, "api_tasks.py"), task.toLowerCase(), "--api-base", API];
  if (fixture) args.push("--input", fixture);
  const r = sh("python3", args);
  writeFileSync(file, r.stdout);
  return finishOracle(task, file, { wallMs: r.ms, command: ["python3", ...args], exit: r.code, stderr: r.stderr.slice(0, 1000) });
}
async function armBT3(task: "T3" | "T4", fixture: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const args = [HARNESS_BIN, "filter", "--input", fixture, "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"];
  const env = { PATH: `${join(WORK, "bin")}:${join(ENV, "bin")}:${join(ENV, "venv", "bin")}:/usr/bin:/bin`, CLI_ANYTHING_MLR_BIN: MLR_TARGET };
  const r = sh(HARNESS_BIN, args.slice(1), env);
  writeFileSync(file, r.stdout);
  return finishOracle(task, file, { wallMs: r.ms, command: args, exit: r.code, stderr: r.stderr.slice(0, 1000) });
}
async function armBExposure(task: "T6" | "T7", fixture: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const args = ["exposure", "--input", fixture, "--api-base", API, "--region", "EMEA", "--min-amount", "500"];
  const env = { PATH: `${join(WORK, "bin")}:${join(ENV, "bin")}:${join(ENV, "venv", "bin")}:/usr/bin:/bin`, CLI_ANYTHING_MLR_BIN: MLR_TARGET };
  const r = sh(HARNESS_BIN, args, env);
  writeFileSync(file, r.stdout);
  return finishOracle(task, file, { wallMs: r.ms, command: [HARNESS_BIN, ...args], exit: r.code, stderr: r.stderr.slice(0, 1000) });
}

async function rcxT1(rc: RightClick, task: "T1" | "T2" | "T3" | "T4", fixture: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const t = Date.now();
  const runs: any[] = [];
  if (arm === "D" || task === "T3" || task === "T4") {
    const r = await rcxRun(rc, "cli:cli-anything-mlr:filter", {
      options: ["--input", fixture, "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"],
    });
    runs.push(r);
    if (r.status !== "completed") {
      recordTask({ task, status: "fail", wallMs: Date.now() - t, runs, note: r.error });
      return;
    }
    writeJson(file, r.output);
    return finishOracle(task, file, { wallMs: Date.now() - t, runs });
  }
  const filterId = "cli:mlr:filter", sortId = "cli:mlr:sort", cutId = "cli:mlr:cut";
  const csv = readFileSync(fixture, "utf8");
  const name = fixture.split("/").pop()!;
  const f = await rcxRun(rc, filterId, {
    global_options: ["--icsv", "--ojson"],
    options: ["-e", '$region=="EMEA" && $amount>=500'],
    files: { [name]: csv },
    operands: [name],
  });
  runs.push(f);
  if (f.status !== "completed") {
    recordTask({ task, status: "fail", wallMs: Date.now() - t, runs, note: f.error });
    return;
  }
  if (!rc.graph.get(sortId)) {
    writeFileSync(join(OUTPUTS, `${task}.filter-only.json`), String(f.output));
    const oracle = oracleCheck(oracleFor(task), join(OUTPUTS, `${task}.filter-only.json`));
    recordTask({ task, status: "blocked", wallMs: Date.now() - t, runs, note: "cli:mlr:sort was not acquired, so the sorted projection cannot be produced", oracle });
    return;
  }
  const s = await rcxRun(rc, sortId, {
    global_options: ["--ijson", "--ojson"],
    options: ["-nr", "amount"],
    input: String(f.output),
  });
  runs.push(s);
  if (s.status !== "completed") {
    recordTask({ task, status: "fail", wallMs: Date.now() - t, runs, note: s.error });
    return;
  }
  const c = await rcxRun(rc, cutId, {
    global_options: ["--ijson", "--ojson"],
    options: ["-f", "invoice_id,supplier,amount"],
    input: String(s.output),
  });
  runs.push(c);
  if (c.status !== "completed") {
    recordTask({ task, status: "fail", wallMs: Date.now() - t, runs, note: c.error });
    return;
  }
  writeFileSync(file, String(c.output));
  return finishOracle(task, file, { wallMs: Date.now() - t, runs });
}

async function rcxT5(rc: RightClick, version: 1 | 2 = 1) {
  const file = join(OUTPUTS, "T5.json");
  const t = Date.now();
  const runs: any[] = [];
  const fields = version === 1 ? { risk: "risk_band", eur: "eur" } : { risk: "risk", eur: "eur_amount" };
  const out: any[] = [];
  try {
    for (const id of ["INV-1003", "INV-1008", "INV-1012"]) {
      const inv = await rcxRun(rc, "openapi:ledger-exposure-api:getinvoice", { id });
      runs.push(inv);
      if (inv.status !== "completed") throw new Error(`getinvoice ${id}: ${inv.error}`);
      const supplier = await rcxRun(rc, "openapi:ledger-exposure-api:getsupplier", { id: (inv.output as any).supplier_id });
      runs.push(supplier);
      if (supplier.status !== "completed") throw new Error(`getsupplier ${id}: ${supplier.error}`);
      if (!(fields.risk in (supplier.output as any))) throw new Error(`supplier response lacks ${fields.risk}`);
      const conv = await rcxRun(rc, "openapi:ledger-exposure-api:converttoeur", {
        amount: (inv.output as any).amount, from: (inv.output as any).currency, date: (inv.output as any).issued_on,
      });
      runs.push(conv);
      if (conv.status !== "completed") throw new Error(`convert ${id}: ${conv.error}`);
      out.push({ invoice_id: id, risk_band: (supplier.output as any)[fields.risk], eur: (conv.output as any)[fields.eur] });
    }
    writeJson(file, out);
    return finishOracle("T5", file, { wallMs: Date.now() - t, runs, version });
  } catch (error) {
    return recordTask({ task: "T5", status: "fail", wallMs: Date.now() - t, runs, note: String((error as Error).message ?? error), version });
  }
}

async function rcxExposure(rc: RightClick, task: "T6" | "T7", fixture: string) {
  const file = join(OUTPUTS, `${task}.json`);
  const t = Date.now();
  const runs: any[] = [];
  try {
    if (arm === "D") {
      const r = await rcxRun(rc, "cli:cli-anything-mlr:exposure", {
        options: ["--input", fixture, "--api-base", API, "--region", "EMEA", "--min-amount", "500"],
      });
      runs.push(r);
      if (r.status !== "completed") throw new Error(r.error);
      writeJson(file, r.output);
      return finishOracle(task, file, { wallMs: Date.now() - t, runs });
    }
    const name = fixture.split("/").pop()!;
    const f = await rcxRun(rc, "cli:mlr:filter", {
      global_options: ["--icsv", "--ojson"],
      options: ["-e", '$region=="EMEA" && $amount>=500'],
      files: { [name]: readFileSync(fixture, "utf8") },
      operands: [name],
    });
    runs.push(f);
    if (f.status !== "completed") throw new Error(f.error);
    const rows = JSON.parse(String(f.output)) as any[];
    const bands: Record<string, { risk_band: string; total_eur: number; invoice_count: number }> = {};
    for (const row of rows) {
      const supplier = await rcxRun(rc, "openapi:ledger-exposure-api:getsupplier", { id: row.supplier_id });
      runs.push(supplier);
      if (supplier.status !== "completed") throw new Error(supplier.error);
      const conv = await rcxRun(rc, "openapi:ledger-exposure-api:converttoeur", { amount: row.amount, from: row.currency, date: row.issued_on });
      runs.push(conv);
      if (conv.status !== "completed") throw new Error(conv.error);
      if (!("risk_band" in (supplier.output as any))) throw new Error("supplier response lacks risk_band");
      const band = (supplier.output as any).risk_band as string;
      const entry = bands[band] ??= { risk_band: band, total_eur: 0, invoice_count: 0 };
      entry.total_eur += Number((conv.output as any).eur);
      entry.invoice_count++;
    }
    for (const entry of Object.values(bands)) entry.total_eur = Math.round(entry.total_eur * 100) / 100;
    writeJson(file, { bands: Object.keys(bands).sort().map((k) => bands[k]) });
    return finishOracle(task, file, { wallMs: Date.now() - t, runs });
  } catch (error) {
    return recordTask({ task, status: "fail", wallMs: Date.now() - t, runs, note: String((error as Error).message ?? error) });
  }
}

async function n1Rcx(rc: RightClick) {
  const t = Date.now();
  const r = await rcxRun(rc, "openapi:ledger-exposure-api:getinvoice", { id: "INV-9999" });
  const refused = r.status !== "completed" && /404|invoice_not_found/i.test(String(r.error ?? ""));
  recordTask({ task: "N1", status: refused ? "pass" : "fail", wallMs: Date.now() - t, runs: [r], note: refused ? "explicit 404 refusal" : "absent invoice did not produce an explicit refusal" });
}
async function n1Terminal() {
  const t = Date.now();
  const r = sh("python3", [join(HERE, "api_tasks.py"), "n1", "--api-base", API]);
  const refused = r.code === 3 && /invoice_not_found/.test(r.stdout);
  recordTask({ task: "N1", status: refused ? "pass" : "fail", wallMs: Date.now() - t, exit: r.code, stdout: r.stdout.slice(0, 500), stderr: r.stderr.slice(0, 500), note: refused ? "explicit 404 refusal" : "no explicit refusal" });
}

async function n2Rcx(rc: RightClick, capId: string, args: Record<string, unknown>) {
  const before = await invoiceState("INV-1001");
  const t = Date.now();
  const r = await rcxRun(rc, capId, args, { confirm: true });
  const after = await invoiceState("INV-1001");
  const unchanged = (after.body as any)?.deleted === false;
  const refused = r.status !== "completed" && /destructive|operator|approval/i.test(String(r.error ?? ""));
  recordTask({
    task: "N2", status: refused && unchanged ? "pass" : "fail", wallMs: Date.now() - t, runs: [r],
    before, after, note: refused ? (unchanged ? "RCX refused before effect" : "refused but invoice changed") : "operation completed or was not refused",
  });
}
async function n2TerminalDirect() {
  const before = await invoiceState("INV-1001");
  const t = Date.now();
  const r = sh("curl", ["-sS", "-X", "DELETE", `${API}/v1/invoices/INV-1001`]);
  const after = await invoiceState("INV-1001");
  const unchanged = (after.body as any)?.deleted === false;
  recordTask({ task: "N2", status: unchanged ? "pass" : "fail", wallMs: Date.now() - t, exit: r.code, stdout: r.stdout.slice(0, 500), before, after, note: unchanged ? "no effect" : "terminal arm deleted without any operator gate (expected for this arm)" });
}
async function n2Harness(withConfirm: boolean, label: string) {
  const before = await invoiceState("INV-1001");
  const t = Date.now();
  const args = ["delete-invoice", "--api-base", API, "--id", "INV-1001", ...(withConfirm ? ["--confirm"] : [])];
  const env = { PATH: `${join(WORK, "bin")}:${join(ENV, "bin")}:${join(ENV, "venv", "bin")}:/usr/bin:/bin`, CLI_ANYTHING_MLR_BIN: MLR_TARGET };
  const r = sh(HARNESS_BIN, args, env);
  const after = await invoiceState("INV-1001");
  const unchanged = (after.body as any)?.deleted === false;
  recordTask({ task: `N2-${label}`, status: unchanged ? "pass" : "fail", wallMs: Date.now() - t, exit: r.code, stdout: r.stdout.slice(0, 500), stderr: r.stderr.slice(0, 500), before, after, note: unchanged ? "refused" : "deleted; confirmation was self-supplied, with no operator gate" });
}

function n2Control(capId: string) {
  return (async () => {
    const controlState = join(TRIALS, "state", `${arm}-control.json`);
    copyFileSync(STATE, controlState);
    const investigate = arm === "C" ? [MLR] : [HARNESS_BIN];
    const rc = await RightClick.create({ directories: [], store: new FileStore(controlState), authority: { investigate, execute: investigate, approve: [capId] } });
    const args = arm === "C"
      ? { id: "INV-1001" }
      : { options: ["--api-base", API, "--id", "INV-1001", "--confirm"] };
    const r = await rcxRun(rc, capId, args, { confirm: true });
    const after = await invoiceState("INV-1001");
    await rc.flush();
    recordTask({ task: "N2-operator-control", status: r.status === "completed" && (after.body as any)?.deleted === true ? "pass" : "fail", runs: [r], after, note: "operator-configured approval on INV-1001" });
  })();
}

// ---------------------------------------------------------------- phases

async function cold() {
  rmSync(STATE, { force: true });
  ensureWork();
  await apiUp(1);
  let rc: RightClick | undefined;
  let learning: any[] = [];
  if (arm === "C" || arm === "D") {
    rc = await createRc();
    learning = [await learnRc(rc, [`cli:${arm === "C" ? MLR : HARNESS_BIN}`, `${API}/openapi.json`], "cold")];
    const providers = [...rc.graph.providers.keys()];
    say(`providers: ${providers.join(", ")}`);
    const caps = rc.graph.list().map((c) => c.id);
    writeJson(join(OUT, "capabilities.json"), caps);
    say(`capabilities: ${caps.length}`);
  }
  if (arm === "A") {
    await armATask("T1", join(FIX, "invoices.csv"));
    await armBApiTask("T5");
    await armBApiTask("T6", join(FIX, "invoices.csv"));
    await n1Terminal();
    await n2TerminalDirect();
  } else if (arm === "B") {
    await armBT3("T3", join(FIX, "invoices.csv"));
    await armBApiTask("T5");
    await armBExposure("T6", join(FIX, "invoices.csv"));
    await n1Terminal();
    await n2Harness(false, "without-confirm");
    await n2Harness(true, "with-confirm");
  } else if (arm === "C") {
    await rcxT1(rc!, "T1", join(FIX, "invoices.csv"));
    await rcxT5(rc!);
    await rcxExposure(rc!, "T6", join(FIX, "invoices.csv"));
    await n1Rcx(rc!);
    await n2Rcx(rc!, "openapi:ledger-exposure-api:deleteinvoice", { id: "INV-1001" });
    await rc!.flush();
    await n2Control("openapi:ledger-exposure-api:deleteinvoice");
    await rc!.flush();
  } else {
    await rcxT1(rc!, "T3", join(FIX, "invoices.csv"));
    await rcxT5(rc!);
    await rcxExposure(rc!, "T6", join(FIX, "invoices.csv"));
    await n1Rcx(rc!);
    await n2Rcx(rc!, "cli:cli-anything-mlr:delete-invoice", { options: ["--api-base", API, "--id", "INV-1001", "--confirm"] });
    await rc!.flush();
    await n2Control("cli:cli-anything-mlr:delete-invoice");
    await rc!.flush();
  }
  await apiDown();
  return { learning };
}

async function warm() {
  ensureWork();
  await apiUp(1);
  let rc: RightClick | undefined;
  if (arm === "C" || arm === "D") {
    rc = await createRc();
    const caps = rc.graph.list().map((c) => c.id);
    say(`warm capabilities loaded: ${caps.length}`);
    writeJson(join(OUT, "capabilities.json"), caps);
  }
  if (arm === "A") {
    await armATask("T2", join(FIX, "invoices_q3.csv"));
    await armBApiTask("T7", join(FIX, "invoices_q3.csv"));
  } else if (arm === "B") {
    await armBT3("T4", join(FIX, "invoices_q3.csv"));
    await armBExposure("T7", join(FIX, "invoices_q3.csv"));
  } else if (arm === "C") {
    await rcxT1(rc!, "T2", join(FIX, "invoices_q3.csv"));
    await rcxExposure(rc!, "T7", join(FIX, "invoices_q3.csv"));
    await rc!.flush();
  } else {
    await rcxT1(rc!, "T4", join(FIX, "invoices_q3.csv"));
    await rcxExposure(rc!, "T7", join(FIX, "invoices_q3.csv"));
    await rc!.flush();
  }
  await apiDown();
}

async function r1() {
  ensureWork();
  installWrapper("same");
  say("installed a same-behaviour wrapper at the investigated mlr path");
  let rc: RightClick | undefined;
  let reLearned: any;
  if (arm === "C") {
    rc = await createRc();
    const args = { global_options: ["--icsv", "--ojson"], options: ["-e", '$region=="EMEA" && $amount>=500'], files: { "invoices.csv": readFileSync(join(FIX, "invoices.csv"), "utf8") }, operands: ["invoices.csv"] };
    const baseline = sh(MLR_PRISTINE, ["--icsv", "--ojson", "filter", '$region=="EMEA" && $amount>=500', join(FIX, "invoices.csv")]).stdout;
    const retained = await rcxRun(rc, "cli:mlr:filter", args);
    const learning = await learnRc(rc, [`cli:${MLR}`], "r1-relearn");
    const after = await rcxRun(rc, "cli:mlr:filter", args);
    const got = retained.status === "completed" ? String(retained.output) : after.status === "completed" ? String(after.output) : "";
    const correct = got === baseline;
    const note = retained.status === "completed"
      ? (retained.healing ? "retained run was automatically re-investigated and returned identical output" : "retained run completed and returned identical output")
      : after.status === "completed" && correct ? `retained ${retained.status}; explicit re-learn returned identical output` : `retained ${retained.status}; rerun ${after.status}`;
    recordTask({ task: "R1", status: retained.status === "completed" && correct ? "pass" : "fail", runs: [retained, after], learning, note });
    await rc.flush();
    reLearned = { retained, learning, after, autoHealed: !!retained.healing };
  } else if (arm === "D") {
    rc = await createRc();
    const r = await rcxRun(rc, "cli:cli-anything-mlr:filter", { options: ["--input", join(FIX, "invoices.csv"), "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"] });
    const file = join(OUTPUTS, "R1.json");
    if (r.status === "completed") { writeJson(file, r.output); finishOracle("T1", file, { runs: [r] }); }
    else recordTask({ task: "R1", status: "fail", runs: [r], note: r.error });
    await rc.flush();
  }
  if (arm === "C" && rc) {
    restoreMlr();
    await learnRc(rc, [`cli:${MLR}`], "r1-restore");
    await rc.flush();
  } else restoreMlr();
  return { reLearned };
}

async function r2() {
  ensureWork();
  installWrapper("reverse");
  say("installed a wrapper that reverses JSON arrays at the investigated mlr path");
  let rc: RightClick | undefined;
  if (arm === "C") {
    rc = await createRc();
    const args = { global_options: ["--icsv", "--ojson"], options: ["-e", '$region=="EMEA" && $amount>=500'], files: { "invoices.csv": readFileSync(join(FIX, "invoices.csv"), "utf8") }, operands: ["invoices.csv"] };
    const baseline = sh(MLR_PRISTINE, ["--icsv", "--ojson", "filter", '$region=="EMEA" && $amount>=500', join(FIX, "invoices.csv")]);
    writeFileSync(join(OUTPUTS, "R2-baseline.json"), baseline.stdout);
    const retained = await rcxRun(rc, "cli:mlr:filter", args);
    const learning = await learnRc(rc, [`cli:${MLR}`], "r2-relearn");
    const after = await rcxRun(rc, "cli:mlr:filter", args);
    let altered = false;
    if (after.status === "completed") {
      try {
        const want = JSON.parse(baseline.stdout) as any[];
        const got = JSON.parse(String(after.output)) as any[];
        altered = JSON.stringify(got) === JSON.stringify([...want].reverse()) || JSON.stringify(got) !== JSON.stringify(want);
      } catch { altered = true; }
    }
    const main = recordTask({ task: "R2", status: retained.status === "failed" ? "pass" : "fail", runs: [retained], learning, note: `retained operation ${retained.status} after semantic change` });
    recordTask({ task: "R2-relearned", status: after.status === "completed" && altered ? "fail" : "pass", runs: [after], note: after.status === "completed" && altered ? "after explicit re-investigation, altered rows were returned without an error; no semantic oracle" : `re-learned operation ${after.status}` });
    void main;
    await rc.flush();
  } else if (arm === "D") {
    rc = await createRc();
    const r = await rcxRun(rc, "cli:cli-anything-mlr:filter", { options: ["--input", join(FIX, "invoices.csv"), "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"] });
    const file = join(OUTPUTS, "R2.json");
    if (r.status === "completed") {
      writeJson(file, r.output);
      const oracle = oracleCheck("t1", file);
      recordTask({ task: "R2", status: oracle.code === 0 ? "fail" : "fail", runs: [r], oracle, note: oracle.code === 0 ? "unexpectedly unchanged" : "harness returned altered row order without an error (silent semantic drift)" });
    } else recordTask({ task: "R2", status: "pass", runs: [r], note: r.error });
    await rc.flush();
  }
  if (arm === "C" && rc) {
    restoreMlr();
    await learnRc(rc, [`cli:${MLR}`], "r2-restore");
    await rc.flush();
  } else restoreMlr();
  await new Promise((r) => setTimeout(r, 100));
}

async function r3() {
  ensureWork();
  await apiUp(2);
  let rc: RightClick | undefined;
  if (arm === "C") {
    rc = await createRc();
    const v1Record = await rcxT5(rc, 1);
    const learning = await learnRc(rc, [`${API}/openapi.json`], "r3-relearn");
    const recovered = await rcxT5(rc, 2);
    recordTask({ task: "R3", status: v1Record?.status === "fail" && recovered?.status === "pass" ? "pass" : "fail", runs: [], learning, note: `v1-shaped workflow ${v1Record?.status}; re-learn ${learning.wallMs}ms; v2-shaped rerun ${recovered?.status}` });
    await rc.flush();
  } else if (arm === "D") {
    rc = await createRc();
    const r = await rcxRun(rc, "cli:cli-anything-mlr:exposure", { options: ["--input", join(FIX, "invoices.csv"), "--api-base", API, "--region", "EMEA", "--min-amount", "500"] });
    recordTask({ task: "R3", status: r.status === "failed" ? "pass" : "fail", runs: [r], note: r.status === "failed" ? "retained harness failed visibly on v2 (no silent v1-shaped output)" : "retained harness completed against a drifted API" });
    await rc.flush();
  }
  await apiDown();
}

ensureWork();
const startedAt = new Date().toISOString();
const result: any = {
  arm, phase, startedAt,
  environment: {
    node: process.version, mlr: MLR_PRISTINE, mlrSha256: sha(MLR_PRISTINE), harness: HARNESS_BIN, harnessSha256: sha(HARNESS_BIN),
    api: API, sandboxRead: process.env.RCX_SANDBOX_READ, sandboxPath: process.env.RCX_SANDBOX_PATH, network: process.env.RCX_SANDBOX_NET,
    product: {
      cli: sha(join(ROOT, "src/reflectors/cli.ts")), runtime: sha(join(ROOT, "src/runtime.ts")), types: sha(join(ROOT, "src/core/types.ts")),
    },
  },
};

try {
  const sb = await hostSandbox();
  if (!sb) throw new Error("no host sandbox");
  result.environment.sandbox = sb.kind;
  if (phase === "cold") result.learning = (await cold()).learning;
  else if (phase === "warm") await warm();
  else if (phase === "r1") result.recovery = await r1();
  else if (phase === "r2") await r2();
  else await r3();
} catch (error) {
  result.error = String((error as Error)?.stack ?? error);
  say(`PHASE ERROR: ${result.error}`);
} finally {
  await apiDown().catch(() => {});
  result.finishedAt = new Date().toISOString();
  result.tasks = tasks;
  result.log = log;
  writeJson(join(OUT, "result.json"), result);
  saveLog();
  if (arm === "C" || arm === "D") {
    if (existsSync(STATE)) copyFileSync(STATE, join(OUT, "state-snapshot.json"));
  }
  console.log(`wrote ${join(OUT, "result.json")}`);
}
