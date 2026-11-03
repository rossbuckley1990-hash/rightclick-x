import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServices, RULES_DIGEST } from "./service.ts";
import { fixtureContract } from "./setup.ts";
import { verifyReconciliation } from "../../src/reconciliation.ts";
import { INTROSPECTION_QUERY } from "../../src/reflectors/graphql.ts";
import { readWith, maintainedClient, generateClient, admitModelSelection, type ReadClient } from "./controls.ts";
import { codexControl, parseControlEvents } from "./codex-control.ts";
import { sourceIdentity } from "./source-identity.ts";
const destination = resolve(process.argv[2] ?? `/tmp/rcx-reconciliation-${Date.now()}`);
await mkdir(destination, { recursive: false }); // Never overwrite a failed or historical run.
const initialSource = await sourceIdentity();
const root = await mkdtemp(join(tmpdir(), "rcx-reconciliation-"));
const s = await startServices(join(root, "ledger.sqlite"));
const events: unknown[] = [], arms: unknown[] = [];
const started = performance.now();
const snapshot = () => JSON.stringify([s.db.prepare("SELECT * FROM authoritative ORDER BY account").all(), s.db.prepare("SELECT * FROM secondary ORDER BY account").all()]);
const before = snapshot();
let failure: string | undefined;
async function processRun(script: string, args: string[]) {
  const p = spawn(process.execPath, [resolve(`experiments/reconciliation/${script}`), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", b => out += b); p.stderr.on("data", b => err += b);
  const code = await new Promise<number | null>((done, reject) => { p.once("error", reject); p.once("close", done); });
  if (code !== 0) throw new Error(`worker ${script} failed (${code}): ${err.slice(0,1000)}`);
  return out.trim() ? JSON.parse(out.trim()) : null;
}
try {
  const setupStart = performance.now();
  const contract = await fixtureContract(s.gateway, s.checker);
  const config = join(root, "contract.json"); await writeFile(config, JSON.stringify(contract));
  events.push({ kind: "operator-setup", elapsedMs: performance.now() - setupStart, rulesDigest: RULES_DIGEST,
    checkerContract: contract.checker.contract, humanSetupMinutes: null, reason: "automated fixture enrollment; checker engineering time was not independently metered" });
  const state = join(root, "state.json");
  const day1 = await processRun("worker.ts", [config, state, "ACC-77"]); events.push({ kind: "day-one", ...day1 });
  assert.equal(day1.result.outcome, "VERIFIED MATCH");
  await processRun("fault.ts", [join(root, "ledger.sqlite"), "2"]);
  events.push({ kind: "independent-fault-process", removed: ["/v1/settlements", "/openapi.json"], introduced: "/graphql" });
  const recovered = await processRun("worker.ts", [config, state, "ACC-88"]); events.push({ kind: "recovery", ...recovered });
  assert.equal(recovered.result.outcome, "VERIFIED MISMATCH"); assert.equal(recovered.result.differenceMinor, "51");
  const fresh = await processRun("worker.ts", [config, state, "ACC-99"]); events.push({ kind: "cold-reuse", ...fresh });
  assert.equal(fresh.result.outcome, "VERIFIED MATCH"); assert.equal(fresh.result.route, "retained");
  assert.notEqual(fresh.pid, recovered.pid); assert.equal(fresh.result.measurements.fallbackCalls, 0);
  const [parallelA, parallelB] = await Promise.all([processRun("worker.ts", [config, state, "ACC-77"]), processRun("worker.ts", [config, state, "ACC-88"])]);
  events.push({ kind: "concurrent-readers", results: [parallelA, parallelB] });
  assert.ok([parallelA, parallelB].some(r => r.result.state === "verified"));
  assert.ok([parallelA, parallelB].every(r => r.result.outcome !== "VERIFIED MATCH" || r.result.differenceMinor === "0"));
  for (const fault of ["amount", "identity", "currency", "rate-limit", "loss", "pending", "checker-drift"]) {
    await processRun("fault.ts", [join(root, "ledger.sqlite"), "2", fault]);
    const r = await processRun("worker.ts", [config, join(root, `fault-${fault}.json`), "ACC-77"]);
    events.push({ kind: "adverse", fault, ...r }); assert.equal(r.result.outcome, "UNRESOLVED/UNVERIFIED");
  }
  await processRun("fault.ts", [join(root, "ledger.sqlite"), "2", "none"]);
  const inputs = [{ account: "ACC-77", period: "2026-10" }, { account: "ACC-88", period: "2026-10" }];
  // Equal-contract arms: same auth scope, fixed observations, independent checker and exact acceptance.
  for (const arm of ["A-maintained-static", "B-schema-generated", "C-codex-cli"] as const) {
    const start = performance.now(); let requests = 0, requestBytes = 0, responseBytes = 0;
    const request: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers); const url = new URL(String(input));
      assert.ok(contract.approvedOrigins.includes(url.origin));
      headers.set("authorization", `Bearer fixture-${url.origin === s.gateway ? "gateway" : "checker"}-read`);
      requests++; requestBytes += typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
      const r = await fetch(input, { ...init, headers, redirect: "error" }); responseBytes += (await r.clone().arrayBuffer()).byteLength; return r;
    };
    let model: unknown = null, client: ReadClient;
    if (arm === "A-maintained-static") client = maintainedClient();
    else {
      const doc = await request(`${s.gateway}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: INTROSPECTION_QUERY }) }).then(r => r.json());
      if (arm === "B-schema-generated") client = await generateClient(doc, join(destination, "generated-client.mjs"));
      else {
        const replayFlag = process.argv.indexOf("--codex-replay");
        if (!process.argv.includes("--codex") && replayFlag < 0) { arms.push({ arm, status: "NOT ESTABLISHED", reason: "live CLI control not requested for this replay" }); continue; }
        let result;
        if (replayFlag >= 0) {
          const raw = await readFile(process.argv[replayFlag + 1], "utf8");
          const parsed = parseControlEvents(raw);
          result = { proposal: parsed.valid ? parsed.proposal : null, receipt: { ...parsed, proposal: undefined,
            eventHash: createHash("sha256").update(raw).digest("hex"), mode: "recorded actual CLI selection replay; no new inference", inferenceCostUsd: null } };
        } else result = await codexControl(join(root, "codex-control"), { business: contract.expected, providerContract: doc,
          checkerRules: "independent canonical observations; exact account/period/currency/unit/basis and safe-integer amounts; candidate agrees with secondary snapshot" });
        model = result.receipt;
        // Copy only the sanitised receipt; raw CLI events remain outside published evidence.
        await writeFile(join(destination, "codex-receipt.json"), JSON.stringify(result.receipt, null, 2));
        if (!result.proposal) { arms.push({ arm, status: "NOT ESTABLISHED", model }); continue; }
        client = admitModelSelection(result.proposal, doc);
      }
    }
    const outcomes = [];
    for (const input of inputs) {
      // Same pinned checker obligation, repeated before every dispatch in every arm.
      const current = await fixtureContract(s.gateway, s.checker, request);
      assert.equal(current.checker.contract, contract.checker.contract);
      const candidate = await readWith(client, s.gateway, input, request);
      const witness = await request(`${s.checker}/check?${new URLSearchParams(input)}`).then(r => r.json());
      const accepted = verifyReconciliation(input, contract.expected, candidate, witness, RULES_DIGEST);
      assert.equal(accepted.valid, true); assert.equal(accepted.differenceMinor, input.account === "ACC-77" ? "0" : "51");
      outcomes.push({ accountHash: createHash("sha256").update(input.account).digest("hex"), ...accepted });
    }
    const recordedReplay = arm === "C-codex-cli" && process.argv.includes("--codex-replay");
    arms.push({ arm, status: "verified-observations", outcomes, elapsedMs: recordedReplay ? null : performance.now() - start,
      ...(recordedReplay ? { validationReplayElapsedMs: performance.now() - start } : {}),
      requests, requestBytes, responseBytes, model, inferenceCostUsd: arm === "C-codex-cli" ? null : 0,
      humanSetupMinutes: null, maintenanceMinutes: null, totalDeliveryCostUsd: null,
      scope: arm === "A-maintained-static" ? "maintained client already supports both published protocols; migration-specific code supplied by engineer" : arm === "B-schema-generated" ? "narrow actual schema-to-client generator; no claim to represent every codegen platform" : recordedReplay ? "recorded actual CLI selection validated and executed again; original inference latency is separate" : "one live CLI selection, reused for the second account; not Responses API" });
  }
  for (const [arm, mode] of [["D-rightclick-with-checker", "deterministic"], ["E-same-checker-fallback-gate", "fallback-gate"]]) {
    const results = [];
    for (const input of inputs) results.push(await processRun("worker.ts", [config, join(root, `${arm}.json`), input.account, mode]));
    assert.equal(results[0].result.outcome, "VERIFIED MATCH"); assert.equal(results[1].result.outcome, "VERIFIED MISMATCH");
    arms.push({ arm, results, modelFallbackSuccess: false, scope: "deterministic execution; no model proposal used", responsesGate: "NOT ESTABLISHED" });
  }
  assert.equal(snapshot(), before, "no authorised or erroneous business database mutation");
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM calls WHERE method NOT IN ('GET','HEAD') AND queryOnly=0").get()!.n, 0, "every POST independently classified as an approved read query");
} catch (e) { failure = String(e); process.exitCode = 1; }
finally {
  let finalSource: Awaited<ReturnType<typeof sourceIdentity>> | null = null;
  try { finalSource = await sourceIdentity(); if (finalSource.digest !== initialSource.digest) failure ??= "implementation files changed during evaluation"; }
  catch { failure ??= "final source identity unavailable"; }
  if (failure) process.exitCode = 1;
  const calls = s.db.prepare("SELECT service,method,path,queryOnly,COUNT(*) count FROM calls GROUP BY service,method,path,queryOnly").all();
  const report = { schema: "rcx-readonly-development@1", source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceIdentity: initialSource, finalSourceDigest: finalSource?.digest ?? null,
    frozenAuditSource: "ebfbf857d5189db44d3043c284c4e89b9e8dcba1", failure: failure ?? null,
    elapsedMs: performance.now() - started, businessTablesUnchanged: snapshot() === before, calls, events, arms,
    directResponsesApi: { status: "NOT ESTABLISHED", environmentKeyPresent: !!process.env.OPENAI_API_KEY, requestCount: 0 },
    economics: { engineeringTokens: null, engineeringCostUsd: null, humanSetupMinutes: null, avoidedInterventionMinutes: null,
      totalCostUsd: null, reason: "desktop engineering usage and labour not metered; controlled fixture has no customer savings evidence" },
    rawCliEvidenceDirectory: process.argv.includes("--codex") ? join(root, "codex-control") : null, independentHeldOut: false };
  await writeFile(join(destination, "report.json"), JSON.stringify(report, null, 2));
  await s.close();
  // Preserve raw CLI attempts locally if one was authorised. Otherwise clear scratch data.
  if (!process.argv.includes("--codex")) await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ destination, failure: failure ?? null, events: events.length, arms: arms.length }));
}
