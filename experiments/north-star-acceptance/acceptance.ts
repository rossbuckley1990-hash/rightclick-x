// North Star acceptance on real, unfamiliar software: the eleven steps, end to end.
//   node experiments/north-star-acceptance/acceptance.ts [--rcx <checkout>] [--label name] [--out dir]
// Drives the real `rcx mcp` server of a checkout (default: this one) over stdio, one fresh process
// per session, as an MCP client would. No language model is involved: every call is scripted, and
// every outcome is checked by this script itself, outside RightClick X, against the real programs.
//
// Software: jq, json_pp, shasum, sha1sum, idn2 and idn as installed on this Mac. None is in the
// pre-registered development set (docs/north-star/evidence/development-set.json) or named in
// RightClick X's src/ or bin/. The operator authorises each by its exact path in an installation
// directory this script owns; software changes happen there, never to the installed programs.
//
// Task: fingerprint a release manifest, the SHA-1 of its canonical JSON (keys sorted, no
// whitespace, no trailing newline), as content-addressed stores do. Producer: jq then sha1sum (the
// system md5 family). Independent implementation: json_pp (Perl JSON::PP) then shasum (Perl
// Digest::SHA). Builds without agreement witnesses can only check the result's form.
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const RCX = resolve(arg("--rcx", "."));
const LABEL = arg("--label", spawnSync("git", ["-C", RCX, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim());
const OUT = arg("--out", `experiments/north-star-acceptance/results/${LABEL}`);
const PROGRAMS: Record<string, string> = { jq: "/opt/homebrew/bin/jq", json_pp: "/usr/bin/json_pp", shasum: "/usr/bin/shasum", sha1sum: "/sbin/sha1sum", idn2: "/opt/homebrew/bin/idn2", idn: "/opt/homebrew/bin/idn" };

const env = realpathSync(mkdtempSync(join(tmpdir(), "rcx-north-star-")));
mkdirSync(`${env}/bin`); mkdirSync(`${env}/work`);
const real = Object.fromEntries(Object.entries(PROGRAMS).map(([n, p]) => [n, realpathSync(p)]));
const bin = (n: string) => `${env}/bin/${n}`;
for (const n of Object.keys(PROGRAMS)) symlinkSync(real[n], bin(n));
const install = (n: string, body?: string) => { try { unlinkSync(bin(n)); } catch {} if (body === undefined) symlinkSync(real[n], bin(n)); else { writeFileSync(bin(n), body); chmodSync(bin(n), 0o755); } };

const manifests = [
  { name: "ledger-sync", version: "2.4.1", build: 7, artifacts: [{ os: "linux", sha: "ab12" }, { os: "darwin", sha: "cd34" }], notes: "Zürich release" },
  { version: "0.9.0", name: "billing-export", artifacts: [{ sha: "ef56", os: "windows" }], build: 112 },
  { build: 3, artifacts: [], name: "tidy-docs", version: "1.0.0-rc.2", notes: "naïve café" },
  { name: "ops-console", artifacts: [{ os: "linux", sha: "99aa", size: 2048 }], version: "5.1.0", build: 40 },
];
const sh = (cmd: string, input: string) => execFileSync("/bin/sh", ["-c", cmd], { input, encoding: "utf8" });
/** The script's own oracle: the direct pipeline, and the independent one, which must agree. */
function expected(m: object) {
  const text = JSON.stringify(m);
  const direct = sh(`'${real.jq}' -S -c -j . | '${real.sha1sum}'`, text), independent = sh(`'${real.json_pp}' -json_opt canonical | '${real.shasum}'`, text);
  if (direct !== independent) throw new Error(`the oracle's two implementations disagree for ${text}`);
  return direct;
}

// The operator's standing configuration authorises exact conformance samples for the producer's
// canonicaliser, with expected outputs recorded from the original program by this script. A build
// with CLI conformance revalidation (PR #20) pins them before any change; others ignore it.
const conformance = JSON.stringify({ "cli:jq:stdout": { samples: manifests.slice(1, 3).map((m) => ({ args: { json: m, options: ["-S", "-c", "-j"] }, output: sh(`'${real.jq}' -S -c -j .`, JSON.stringify(m)) })) } });

/** One `rcx mcp` process: a fresh session over the shared state. */
async function session(extraEnv: Record<string, string | null> = {}) {
  const vars: Record<string, string | undefined> = { ...process.env, RCX_STATE_FILE: `${env}/state.json`, RCX_WORKSPACE: `${env}/work`, RCX_INVESTIGATE: Object.keys(PROGRAMS).map(bin).join(","), RCX_CLI_CONFORMANCE: conformance };
  for (const [k, v] of Object.entries(extraEnv)) if (v === null) delete vars[k]; else vars[k] = v;
  const p = spawn(process.execPath, [join(RCX, "bin/rcx.ts"), "mcp"], { env: vars, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", n = 0, stderr = "";
  const waiting = new Map<number, (m: any) => void>();
  p.stderr!.on("data", (d) => (stderr += d));
  p.stdout!.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { const m = JSON.parse(line); waiting.get(m.id)?.(m); } }
  });
  let exited = false;
  const failures = new Set<(e: Error) => void>();
  p.on("exit", (code) => { exited = true; for (const f of failures) f(new Error(`rcx mcp exited (${code}) before replying: ${stderr.slice(-400)}`)); });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((done, fail) => {
    if (exited) return fail(new Error(`rcx mcp has exited: ${stderr.slice(-400)}`));
    const id = ++n; failures.add(fail); waiting.set(id, (m) => { failures.delete(fail); done(m); });
    p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "north-star-acceptance", version: "1" } });
  const calls: Array<{ tool: string; ms: number; ok: boolean }> = [];
  return {
    instructions: init.result.instructions as string, calls, stderr: () => stderr,
    tools: async () => (await rpc("tools/list")).result.tools,
    call: async (tool: string, args: unknown) => {
      const t0 = performance.now();
      const r = (await rpc("tools/call", { name: tool, arguments: args })).result;
      calls.push({ tool, ms: Math.round(performance.now() - t0), ok: !r.isError });
      return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
    },
    close: () => new Promise((done) => { if (exited) return done(undefined); p.on("close", done); p.stdin!.end(); }),
  };
}

const steps: Array<{ step: number; name: string; pass: boolean | null; ms: number; evidence: unknown }> = [];
const t = () => performance.now();
async function step(n: number, name: string, body: () => Promise<{ pass: boolean | null; evidence: unknown }>) {
  const t0 = t();
  let r: { pass: boolean | null; evidence: unknown };
  try { r = await body(); } catch (e) { r = { pass: false, evidence: { error: String((e as Error)?.stack ?? e).slice(0, 800) } }; }
  steps.push({ step: n, name, ms: Math.round(t() - t0), ...r });
  console.log(`${String(n).padStart(2)}. ${r.pass === true ? "PASS" : r.pass === null ? "N/A " : "FAIL"}  ${name}${r.pass === true ? "" : `: ${JSON.stringify(r.evidence).slice(0, 220)}`}`);
}
const fp = (m: object) => ({ json: { type: "json", value: m } });
// Judged as of first encounter: this experiment adds its own programs to the development set.
const devSet = JSON.parse(readFileSync(join(RCX, "docs/north-star/evidence/development-set.json"), "utf8"));
const ownEntry = (devSet.updates ?? []).filter((u: any) => /north-star-acceptance/.test(u.reason)).flatMap((u: any) => u.added);
const developmentSet: string[] = devSet.programs.filter((p: string) => !ownEntry.includes(p));
const commit = spawnSync("git", ["-C", RCX, "log", "-1", "--format=%H %s"], { encoding: "utf8" }).stdout.trim();

// ---- operator session: discover, compose, verify, save -------------------------------------------
const op = await session();
const tools = await op.tools();
const witnessSchema = tools.find((x: any) => x.name === "context_compose").inputSchema.properties.witnesses.items.properties;
const supportsAgreement = "agree" in witnessSchema;
let goal = "", witnessPipeline = "", independentPipeline: unknown = null;

await step(1, "Encounter unfamiliar supported software", async () => {
  const versions = Object.fromEntries(Object.entries(real).map(([n, p]) => [n, { path: p, version: spawnSync(p, n === "jq" || n.startsWith("idn") ? ["--version"] : ["-v"], { encoding: "utf8" }).stdout.split("\n")[0].slice(0, 60) }]));
  const familiar = Object.keys(PROGRAMS).filter((n) => developmentSet.includes(n));
  return { pass: familiar.length === 0, evidence: { programs: versions, inDevelopmentSetBeforeThisExperiment: familiar, addedToDevelopmentSetByThisExperiment: ownEntry, authorisedPaths: Object.keys(PROGRAMS).map(bin) } };
});

const learned: Record<string, string[]> = {};
await step(2, "Discover its real capabilities without a bespoke adapter", async () => {
  const timing: Record<string, number> = {};
  for (const n of Object.keys(PROGRAMS)) {
    const t0 = t();
    const r = await op.call("context_learn", { source: `cli:${bin(n)}` });
    timing[n] = Math.round(t() - t0);
    learned[n] = (r.results?.[0]?.learned ?? []).length ? (await op.call("context_graph", { op: "search", query: n, limit: 40 })).map((c: any) => c.id).filter((id: string) => id.startsWith(`cli:${n.replace("_", "-")}:`)) : [];
  }
  return { pass: Object.values(learned).every((ids) => ids.length > 0), evidence: { capabilities: learned, learnMs: timing } };
});

await step(3, "Represent them through the existing typed interface", async () => {
  const card = async (id: string) => { const e = await op.call("context_explain", { id }); return { id, inputs: e.capability?.inputs?.map((i: any) => `${i.name}${i.required ? "" : "?"}:${i.type}`), outputs: e.capability?.outputs?.map((o: any) => o.type), risk: e.capability?.risk, allowed: e.execution?.allowed }; };
  const cards = [await card("cli:jq:stdout"), await card("cli:sha1sum:default"), await card("cli:json-pp:stdout"), await card("cli:shasum:default")];
  return { pass: tools.length === 13 && cards.every((c) => c.inputs?.length && c.risk === "read" && c.allowed), evidence: { tools: tools.length, cards } };
});

const verify = [{ op: "matches", pattern: "^[0-9a-f]{40}  -\\n$" }];
let composed: any;
await step(4, "Compose multiple capabilities to solve a meaningful task", async () => {
  if (supportsAgreement) {
    // The independent implementation is itself composed and saved as a pipeline first.
    const w = await op.call("context_compose", { have: { ...fp(manifests[0]), options: ["-json_opt", "canonical"] }, want: "text", intent: "canonical json fingerprint by an independent implementation",
      through: ["cli:json-pp:stdout", "cli:shasum:default"], maxSteps: 2, run: true });
    witnessPipeline = w.crystallized?.id ?? "";
    independentPipeline = { status: w.executed?.status, crystallized: witnessPipeline || null, error: String(w.executed?.attempts?.[0]?.error ?? w.executed?.error ?? w.error ?? "").slice(0, 240) };
  }
  composed = await op.call("context_compose", {
    have: { ...fp(manifests[0]), options: { value: ["-S", "-c", "-j"], fixed: true } }, want: "text", intent: "canonical json manifest fingerprint",
    through: ["cli:jq:stdout", "cli:sha1sum:default"], maxSteps: 2, run: true, publish: "manifest fingerprint", verify,
    ...(witnessPipeline ? { witnesses: [{ capability: witnessPipeline, args: { json: { input: "json" }, options: { value: ["-json_opt", "canonical"] } }, agree: { mode: "exact" } }] } : {}),
  });
  goal = composed.published?.id ?? "";
  const ok = composed.executed?.status === "completed" && composed.executed.output === expected(manifests[0]);
  return { pass: ok, evidence: { pipeline: composed.executed?.titles, output: composed.executed?.output, expected: expected(manifests[0]), error: composed.executed?.error ?? composed.error, independentPipeline } };
});

await step(5, "Execute with appropriate authority and confinement", async () => {
  const unauthorised = await op.call("context_learn", { source: "cli:/bin/cp" });
  const operand = await op.call("context_run", { id: "cli:jq:invoke", args: { json: { a: 1 }, operands: ["/etc/hosts"] } });
  const doctor = spawnSync(process.execPath, [join(RCX, "bin/rcx.ts"), "doctor"], { encoding: "utf8", env: { ...process.env, RCX_STATE_FILE: `${env}/doctor.json` } }).stdout;
  const sandbox = doctor.split("\n").find((l) => /sandbox/i.test(l))?.trim();
  const refusedLearn = /not authori[sz]ed/.test(JSON.stringify(unauthorised));
  const refusedOperand = /operands must be a list of names present in files|HTTP 400 equivalent/.test(JSON.stringify(operand));
  return { pass: refusedLearn && refusedOperand && !!sandbox && !/unavailable|missing|disabled/i.test(sandbox), evidence: { unauthorisedProgram: JSON.stringify(unauthorised).slice(0, 220), fileOperandOutsideFiles: JSON.stringify(operand).slice(0, 220), sandbox } };
});

await step(6, "Independently verify the actual outcome", async () => {
  const status = composed?.executed?.verification?.status, agreementEvidence = composed?.executed?.witnesses?.[0]?.agreement;
  const ownCheck = composed?.executed?.output === expected(manifests[0]);
  if (!supportsAgreement || !witnessPipeline) return { pass: false, evidence: { rightClickX: status, independentPipeline, note: supportsAgreement ? "the independent implementation could not be composed" : "this build can only check the result's form: no real checker accepts a candidate fingerprint", script: ownCheck ? "the script's own two independent implementations confirm it" : "the script does not confirm it" } };
  // The independent recomputation must also refute a subtly wrong producer: jq keeping its trailing newline.
  const subtle = await op.call("context_compose", { have: { ...fp(manifests[0]), options: ["-S", "-c"] }, want: "text", intent: "canonical json manifest fingerprint with a trailing newline",
    through: ["cli:jq:stdout", "cli:sha1sum:default"], maxSteps: 2, run: true, crystallize: false,
    witnesses: [{ capability: witnessPipeline, args: { json: { input: "json" }, options: { value: ["-json_opt", "canonical"] } }, agree: { mode: "exact" } }] });
  // Observation only: two independent IDN libraries (IDNA2008 against IDNA2003). The sandbox's C
  // locale stops idn2 converting non-ASCII input, so this is recorded, not required.
  const idn = async (name: string) => (await op.call("context_compose", { have: { input: { type: "text", value: `${name}\n` } }, want: "text", intent: "ascii domain name", through: ["cli:idn2:default"], maxSteps: 1, run: true, crystallize: false,
    witnesses: [{ capability: "cli:idn:default", args: { input: { input: "input" } }, agree: { mode: "trimmed" } }] })).executed;
  const [plain, eszett] = [await idn("bücher.example"), await idn("faß.de")];
  // The wrong producer must run and be refuted by the recomputation itself, not fail for another reason.
  const refutedByAgreement = subtle.executed?.status !== "completed" && /independent recomputation disagrees/.test(JSON.stringify(subtle.executed));
  const pass = status === "verified" && agreementEvidence?.ok === true && ownCheck && refutedByAgreement;
  return { pass, evidence: { rightClickX: status, agreement: agreementEvidence, script: ownCheck, trailingNewlineProducer: { status: subtle.executed?.status, refutedByAgreement, error: String(subtle.executed?.attempts?.[0]?.error ?? subtle.executed?.error ?? "").slice(0, 240) },
    idnObservation: { "bücher.example": { status: plain?.status, verification: plain?.verification?.status, output: plain?.output }, "faß.de": { status: eszett?.status, error: String(eszett?.attempts?.[0]?.error ?? eszett?.error ?? "").slice(0, 200) } } } };
});

await step(7, "Save the successful workflow as a reusable goal", async () => {
  const e = goal ? await op.call("context_explain", { id: goal }) : {};
  return { pass: !!goal && !!e.capability, evidence: { goal, trust: composed?.published?.trust, witnesses: e.contract?.verificationObligations?.witnesses, predicates: e.contract?.verificationObligations?.predicates?.length } };
});
await op.close();

// ---- fresh sessions: reuse, change, removal ------------------------------------------------------
const reuse = async (label: string, m: object, extraEnv: Record<string, string | null> = {}) => {
  const s = await session(extraEnv);
  const t0 = t();
  // Run arguments are plain values by port name (compose's typed {type, value} form is for have).
  const r = await s.call("context_run", { id: goal, args: { json: m } });
  const ms = Math.round(t() - t0);
  const learnedAgain = s.calls.some((c) => c.tool === "context_learn");
  await s.close();
  return { label, status: r.status, verification: r.verification?.status, correct: r.output === expected(m), output: r.output, error: r.error ? String(r.error).slice(0, 260) : undefined, ms, learnedAgain, announced: s.instructions.includes(goal) };
};
await step(8, "Reuse the goal in a fresh session without rediscovery", async () => {
  const r = await reuse("fresh process, unseen manifest", manifests[1]);
  return { pass: r.status === "completed" && r.correct && !r.learnedAgain && r.announced && (!supportsAgreement || r.verification === "verified"), evidence: r };
});

await step(9, "Survive a compatible software change", async () => {
  install("jq", `#!/bin/sh\n# rebuilt jq: same program, new file\nexec '${real.jq}' "$@"\n`);
  const plain = await reuse("compatible wrapper, samples withdrawn from the configuration", manifests[2], { RCX_CLI_CONFORMANCE: null });
  const sampled = await reuse("compatible wrapper, the operator's standing conformance samples", manifests[2]);
  return { pass: sampled.status === "completed" && sampled.correct, evidence: { withoutSamples: plain, withSamples: sampled } };
});

await step(10, "Refuse incompatible or unsafe changes", async () => {
  // Same path, different behaviour: the "upgrade" silently stops sorting keys.
  install("jq", `#!/bin/sh\nfor a in "$@"; do shift; [ "$a" = "-S" ] || set -- "$@" "$a"; done\nexec '${real.jq}' "$@"\n`);
  const r = await reuse("incompatible wrapper", manifests[3]);
  const presentedWrong = r.status === "completed" && !r.correct;
  return { pass: r.status !== "completed" && !presentedWrong, evidence: { ...r, presentedWrong } };
});

await step(11, "Retain knowledge when a provider is unavailable, and recover", async () => {
  unlinkSync(bin("jq"));
  const gone = await reuse("jq removed", manifests[3]);
  const s = await session();
  const retained = s.instructions.includes(goal);
  const known = (await s.call("context_graph", { op: "search", query: "manifest fingerprint" })).some((c: any) => c.id === goal);
  await s.close();
  install("jq");
  const before = await reuse("jq restored, before anything is re-learned", manifests[3]);
  // Recovery is one explicit operator action: re-learning the restored program. The goal is kept.
  const operator = await session();
  const relearned = await operator.call("context_learn", { source: `cli:${bin("jq")}` });
  await operator.close();
  const back = await reuse("jq restored and re-learned", manifests[3]);
  return { pass: gone.status !== "completed" && retained && known && back.status === "completed" && back.correct && (!supportsAgreement || !witnessPipeline || back.verification === "verified"),
    evidence: { removed: gone, goalRetained: retained, goalSearchable: known, restoredBeforeRelearn: before, relearned: (relearned.results?.[0]?.learned ?? []).length > 0, restored: back } };
});

const report = { at: new Date().toISOString(), label: LABEL, commit, supportsAgreement, node: process.version, platform: `${process.platform} ${process.arch}`, steps, passed: steps.filter((s) => s.pass).length };
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/acceptance.json`, JSON.stringify(report, null, 2));
console.log(`${LABEL} (${commit.slice(0, 7)}): ${report.passed}/11 steps pass; ${OUT}/acceptance.json`);
