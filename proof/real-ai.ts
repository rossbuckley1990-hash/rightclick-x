// Live public-service proof. No product code or provider-specific adapters live
// here. The owned gateway/formatter/auditor are explicit test infrastructure.
// Run only after deployment and a product freeze:
// node proof/real-ai.ts --run --deployment <manifest.json> --clients codex,codex
// Builder gets one gateway + outcome; reuser gets a new country + saved graph.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsonl, runClient, sourceIdentity, toolCalls, type AgentExecution, type ToolCall } from "./ai-clients.ts";
import { fetchTruth, verifyBrief, negativeControls, type DestinationTruth } from "./real-truth.ts";

export interface RealDeployment {
  gatewayUrl: string;
  formatterUrl: string;
  auditorUrl: string;
  adminSecretFile: string;
  workerNames?: string[];
  createdAt?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const base = (url: string) => url.replace(/\/$/, "");
const allTrue = (checks: Record<string, unknown>) => Object.values(checks).every((value) => value === true);

interface FetchRecord { startedAt: string; finishedAt: string; url: string; method: string; requestBody?: unknown; authenticated: boolean; status: number; body: string }
async function recordedFetch(url: string, method = "GET", body?: unknown, bearer?: string): Promise<{ record: FetchRecord; value: any }> {
  const startedAt = new Date().toISOString();
  const response = await fetch(url, {
    method,
    headers: { "user-agent": "RightClickX-real-proof/0.1", ...(body === undefined ? {} : { "content-type": "application/json" }), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let value: any;
  try { value = JSON.parse(text); } catch { value = text; }
  return { record: { startedAt, finishedAt: new Date().toISOString(), url, method, requestBody: body, authenticated: !!bearer, status: response.status, body: text }, value };
}

async function contractSnapshot(deployment: RealDeployment, out: string, phase: string) {
  const requests = [
    { label: "gateway", url: `${base(deployment.gatewayUrl)}/.well-known/api-catalog` },
    { label: "formatter-openapi", url: `${base(deployment.formatterUrl)}/formatter` },
    { label: "formatter-mcp", url: `${base(deployment.formatterUrl)}/formatter`, method: "POST", body: { jsonrpc: "2.0", id: 71, method: "tools/list", params: {} } },
    { label: "auditor-openapi", url: `${base(deployment.auditorUrl)}/openapi.json` },
    { label: "countries-introspection", url: "https://countries.trevorblades.com/", method: "POST", body: { query: "{ __schema { queryType { name fields { name description args { name description type { kind name ofType { kind name } } } } } } }" } },
    { label: "wikimedia-openapi", url: "https://en.wikipedia.org/api/rest_v1/?spec" },
  ];
  const results: any[] = [];
  // These reads are independent. Every response, including expected 404s for the
  // inactive protocol, is retained rather than silently discarded.
  const settled = await Promise.allSettled(requests.map(async (request) => ({ label: request.label, ...await recordedFetch(request.url, request.method, request.body) })));
  for (const [index, result] of settled.entries()) {
    const value = result.status === "fulfilled" ? result.value : { label: requests[index].label, error: String(result.reason) };
    results.push(value);
    save(resolve(out, `${phase}-${requests[index].label}.json`), value);
  }
  return results;
}

async function events(deployment: RealDeployment, token: string) {
  const requests = await Promise.all([
    recordedFetch(`${base(deployment.formatterUrl)}/__admin/events?since=0`, "GET", undefined, token),
    recordedFetch(`${base(deployment.auditorUrl)}/__admin/events?since=0`, "GET", undefined, token),
  ]);
  if (requests.some((result) => result.record.status !== 200)) throw new Error("Unable to read owned-service audit events");
  return {
    formatter: Array.isArray(requests[0].value) ? requests[0].value : requests[0].value.events ?? [],
    auditor: Array.isArray(requests[1].value) ? requests[1].value : requests[1].value.events ?? [],
    requests: requests.map((result) => result.record),
  };
}

type ServiceEvents = Awaited<ReturnType<typeof events>>;
function phaseEvents(before: ServiceEvents, after: ServiceEvents) {
  const max = (items: any[]) => Math.max(0, ...items.map((item) => Number(item.sequence) || 0));
  return {
    formatter: after.formatter.filter((event: any) => event.sequence > max(before.formatter)),
    auditor: after.auditor.filter((event: any) => event.sequence > max(before.auditor)),
  };
}
const normalized = (text: unknown) => typeof text === "string" ? text.normalize("NFC").replace(/\s+/gu, " ").trim() : "";
function phaseEventChecks(phase: ReturnType<typeof phaseEvents>, truth: DestinationTruth, output: unknown, version: number) {
  return {
    phaseFormatterReceivedPublicExtract: typeof output === "string" && phase.formatter.some((event: any) => event.action === "render" && event.detail?.version === version && event.detail?.place === truth.capital && normalized(event.detail?.text) === normalized(truth.wikiExtract) && event.detail?.markdown === output),
    phaseAuditorRefetchedAndAcceptedCandidate: typeof output === "string" && phase.auditor.some((event: any) => event.action === "check" && event.detail?.country === truth.countryCode && event.detail?.capital === truth.capital && event.detail?.brief === output && event.detail?.valid === true && normalized(event.detail?.extract) === normalized(truth.wikiExtract) && event.detail?.sourceURLs?.countries === "https://countries.trevorblades.com/" && event.detail?.sourceURLs?.wikipediaCanonical === truth.wikiUrl),
  };
}

function clientChecks(run: AgentExecution) {
  return {
    clientExited: run.exit === 0 && !run.timedOut,
    serverStopped: run.serverStopped,
    withinCallBudget: !run.callBudgetExceeded,
    onlyRcxActions: run.nonRcxActions.length === 0,
    codeModeSourceChecked: run.client !== "codex" || !!run.codeModeTrace?.file && !run.codeModeTrace.error && run.codeModeTrace.violations.length === 0,
  };
}

function savedGoalChecks(state: any) {
  const goal = state?.published?.find((item: any) => item.slug === "destination-brief");
  return {
    savedGoalPresent: !!goal,
    onlyCountryInput: Object.keys(goal?.have ?? {}).length === 1 && goal?.have?.country === "country",
    markdownOutput: goal?.want === "markdown",
    requiredRelativeWitnessSaved: goal?.witnesses?.some((witness: any) => witness.args?.country?.input === "country" && witness.args?.candidate?.output === "" && witness.verify?.some((predicate: any) => predicate.op === "equals" && predicate.path === "valid" && predicate.value === true)) === true,
  };
}

function mainReceipts(result: any, state: any) {
  const ids = new Set<string>(result?.runs ?? result?.steps ?? []);
  return (state?.receipts ?? []).filter((receipt: any) => ids.has(receipt.runId));
}

function providerUsed(receipts: any[], state: any, providerUrl: string) {
  const target = new URL(providerUrl);
  const matching = new Set((state?.reflections ?? []).filter((reflection: any) => {
    const origin = reflection.provider?.origin;
    if (!origin) return false;
    try { const url = new URL(origin); return url.origin === target.origin && (target.pathname === "/" || url.pathname.startsWith(target.pathname.replace(/\/$/, ""))); } catch { return false; }
  }).map((reflection: any) => reflection.provider.id));
  return receipts.some((receipt) => receipt.status === "completed" && matching.has(receipt.provider));
}

function outcomeChecks(call: ToolCall | undefined, state: any, truth: DestinationTruth, deployment: RealDeployment) {
  const result = call?.name === "context_compose" ? call.value?.executed : call?.value;
  const witnesses = result?.witnesses ?? [];
  const receipts = mainReceipts(result, state);
  const briefVerification = verifyBrief(typeof result?.output === "string" ? result.output : "", truth);
  return {
    checks: {
      successfulMcpResponse: !!call && !call.response?.error && call.response?.result?.isError === false,
      runtimeCompleted: result?.status === "completed",
      runtimeVerified: result?.verification?.status === "verified",
      independentFreshPublicTruth: briefVerification.verified,
      witnessesCompletedAndVerified: witnesses.length > 0 && witnesses.every((witness: any) => witness.status === "completed" && witness.verification?.status === "verified" && witness.output?.valid === true),
      publicCountriesReceipt: providerUsed(receipts, state, "https://countries.trevorblades.com/"),
      publicWikipediaReceipt: providerUsed(receipts, state, "https://en.wikipedia.org/api/rest_v1/"),
      ownedFormatterReceipt: providerUsed(receipts, state, deployment.formatterUrl),
      separateAuditorReceipt: providerUsed((state?.receipts ?? []).filter((receipt: any) => witnesses.some((witness: any) => witness.runId === receipt.runId)), state, deployment.auditorUrl),
    },
    briefVerification,
    mainReceipts: receipts,
  };
}

function builderPrompt(gateway: string, country: string) {
  return [
    "Use only the rightclick-x MCP tools. Do not use shell, files, browser, external tools, or other agents.",
    `The only environment address supplied is ${gateway}. Discover its available services and contracts through that gateway.`,
    `Objective: produce a destination research brief for country code ${country}, identifying its actual capital, including the complete current Wikipedia summary of that capital, and linking to that Wikipedia page.`,
    "Use live source data, preserve the full summary without paraphrasing or truncation, and return markdown from the environment's destination-formatting service.",
    "Create and publish a reusable checked goal named destination-brief through context_compose. Its ONLY input is country (semantic type country), and its required output type is markdown. Do not add a capital, summary, URL, or expected answer as a fixed goal input.",
    "Discover the independent auditor in this environment. Save it as a required input-relative outcome witness: its country must bind to the goal's country input, and its candidate must bind to the goal's output. Require its valid result to equal true. The audit must rerun for later countries.",
    "Only read business operations are authorized. Publication changes RightClick X's own local graph and state. Publish only after execution and the independent audit pass.",
    "Report the actual brief, saved goal identifier, and verification status. If anything fails, report it honestly without inventing missing information.",
  ].join("\n");
}

function reuserPrompt(country: string) {
  return [
    "Use only the rightclick-x MCP tools. Do not use shell, files, browser, external tools, or other agents.",
    "A different isolated AI session saved a checked destination-brief goal earlier. RightClick X has restarted with its saved graph; you have none of that session's conversation history.",
    `Objective: obtain the checked destination brief for a new country code, ${country}, using the existing saved goal.`,
    "Find the stable goal in the graph and invoke it exactly once with context_run, supplying only the new country input. Do not use a crystallized snapshot, recreate or republish a goal, manually learn providers, or manually compose a replacement.",
    "The underlying environment may have changed. The saved goal must repair and independently verify its result within that single invocation. If it fails, report failure without retrying.",
    "Return the actual resulting brief and verification status.",
  ].join("\n");
}

async function directAuditorNegatives(deployment: RealDeployment, candidate: string, truth: DestinationTruth, other: DestinationTruth, out: string) {
  const listed = await recordedFetch(`${base(deployment.auditorUrl)}/openapi.json`);
  const route = Object.entries(listed.value?.paths ?? {}).find(([, value]: [string, any]) => value.get?.parameters?.some((parameter: any) => parameter.name === "country" && parameter.in === "query") && value.get.parameters.some((parameter: any) => parameter.name === "candidate" && parameter.in === "query"));
  if (!route) throw new Error("Independent auditor did not expose the expected country/candidate GET contract");
  const localControls = negativeControls(candidate, truth, other);
  const corrupt = `# Destination brief: ${truth.capital}\n\nThis intentionally corrupted paragraph is not the current Wikipedia summary.\n\nSource: [Wikipedia — ${truth.capital}](${truth.wikiUrl})\n`;
  const controls = [{ name: "wrong-country", country: other.countryCode, candidate }, { name: "corrupt-summary", country: truth.countryCode, candidate: corrupt }];
  const results = [];
  for (const control of controls) {
    const url = new URL(route[0], deployment.auditorUrl);
    url.searchParams.set("country", control.country);
    url.searchParams.set("candidate", control.candidate);
    const response = await recordedFetch(url.href);
    results.push({ ...control, response: response.record, output: response.value, rejected: response.record.status === 200 && response.value?.valid === false });
  }
  const evidence = { localControls, auditorContract: listed.record, results, passed: localControls.every((control) => control.verified === false) && results.every((result) => result.rejected) };
  save(resolve(out, "negative-controls.json"), evidence);
  return evidence;
}

async function runRealProof() {
  const deploymentPath = option("--deployment") ?? option("--env");
  if (!deploymentPath) throw new Error("--deployment <manifest.json> is required. First deploy with: node proof/real-environment.ts --deploy --manifest .rcx-deploy/real-current.json");
  const deployment: RealDeployment = JSON.parse(readFileSync(resolve(deploymentPath), "utf8"));
  for (const url of [deployment.gatewayUrl, deployment.formatterUrl, deployment.auditorUrl]) if (new URL(url).protocol !== "https:") throw new Error("The real-service proof requires deployed HTTPS service URLs");
  const token = readFileSync(deployment.adminSecretFile, "utf8").trim();
  if (!token) throw new Error("Missing owned-environment admin credential");
  const clients = option("--clients", "codex,codex")!.split(",");
  if (clients.length !== 2 || clients.some((client) => !["claude", "codex"].includes(client))) throw new Error("--clients must name exactly two supported clients");
  const [builderClient, reuserClient] = clients as ["claude" | "codex", "claude" | "codex"];
  const initial = option("--initial", "PT")!.toUpperCase();
  const unseen = option("--unseen", "IS")!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(initial) || !/^[A-Z]{2}$/.test(unseen) || initial === unseen) throw new Error("Two different ISO country codes are required");
  const timeout = Number(option("--timeout-seconds", "480"));
  const maxCalls = Number(option("--max-calls", "60"));
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 1200 || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 100) throw new Error("Invalid time or call bounds");
  const out = resolve(option("--out", resolve(HERE, "results", `real-ai-${new Date().toISOString().replace(/[:.]/g, "-")}`))!);
  mkdirSync(out, { recursive: true });
  const manifestPath = resolve(out, "manifest.json");
  if (existsSync(manifestPath)) throw new Error("Refusing to overwrite an existing evidence manifest");
  const stateFile = resolve(out, "state.json");
  if (existsSync(stateFile)) throw new Error("Builder state must not exist before the first isolated AI session");
  const report: any = { at: new Date().toISOString(), scenario: "Live public countries GraphQL and Wikimedia REST, owned deployed formatter changes REST to MCP, fresh AI reuses independently checked saved goal", clients: { builder: builderClient, reuser: reuserClient }, crossVendor: builderClient !== reuserClient, initial, unseen, deployment: { gatewayUrl: deployment.gatewayUrl, formatterUrl: deployment.formatterUrl, auditorUrl: deployment.auditorUrl, workerNames: deployment.workerNames }, buildBefore: sourceIdentity(), limits: { timeoutSeconds: timeout, maxCalls }, passed: false };
  save(manifestPath, report);
  try {
    console.log(`Evidence: ${out}\nPreparing live source snapshots and owned formatter REST v1.`);
    const versionOne = await recordedFetch(`${base(deployment.formatterUrl)}/__admin/version`, "POST", { version: 1 }, token);
    save(resolve(out, "operator-version-1.json"), versionOne.record);
    if (versionOne.record.status !== 200) throw new Error("Unable to select formatter REST v1");
    report.contractsBefore = await contractSnapshot(deployment, out, "before");
    const initialTruth = await fetchTruth(initial);
    save(resolve(out, "truth-initial-before.json"), initialTruth);
    const beforeEvents = await events(deployment, token);
    save(resolve(out, "events-before.json"), beforeEvents);
    const builder = await runClient(builderClient, "builder", builderPrompt(deployment.gatewayUrl, initial), out, stateFile, timeout, maxCalls);
    const afterBuilderEvents = await events(deployment, token);
    save(resolve(out, "events-after-builder.json"), afterBuilderEvents);
    const builderPhaseEvents = phaseEvents(beforeEvents, afterBuilderEvents);
    const builderAudit = jsonl(builder.audit);
    const builderCalls = toolCalls(builderAudit);
    const publication = builderCalls.findLast((call) => call.name === "context_compose" && call.value?.published?.id === "goal:destination-brief");
    const builderState = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
    const freshInitialTruth = await fetchTruth(initial);
    save(resolve(out, "truth-initial-after.json"), freshInitialTruth);
    const builderOutcome = outcomeChecks(publication, builderState, freshInitialTruth, deployment);
    const builderChecks = { ...clientChecks(builder), gatewayDiscovered: builderCalls.some((call) => call.name === "context_learn" && (base(call.args.source ?? "") === base(deployment.gatewayUrl) || call.args.sources?.some((source: string) => base(source) === base(deployment.gatewayUrl)))), publishedStableGoal: !!publication, ...savedGoalChecks(builderState), ...builderOutcome.checks, ...phaseEventChecks(builderPhaseEvents, freshInitialTruth, publication?.value?.executed?.output, 1) };
    report.builder = { ...builder, calls: builderCalls, ...builderOutcome, phaseServiceEvents: builderPhaseEvents, checks: builderChecks };
    if (typeof publication?.value?.executed?.output === "string") writeFileSync(resolve(out, "builder-brief.md"), publication.value.executed.output);
    if (existsSync(stateFile)) copyFileSync(stateFile, resolve(out, "state-after-builder.json"));
    save(manifestPath, report);
    if (!allTrue(builderChecks)) throw new Error(`Builder checks failed: ${Object.entries(builderChecks).filter(([, value]) => value !== true).map(([name]) => name).join(", ")}`);

    console.log("Builder saved the verified live workflow. Changing owned formatter REST v1 to MCP v3.");
    const changed = await recordedFetch(`${base(deployment.formatterUrl)}/__admin/version`, "POST", { version: 3 }, token);
    save(resolve(out, "operator-version-3.json"), changed.record);
    if (changed.record.status !== 200) throw new Error("Unable to change formatter to MCP v3");
    report.contractsAfter = await contractSnapshot(deployment, out, "after");
    const unseenTruth = await fetchTruth(unseen);
    save(resolve(out, "truth-unseen-before.json"), unseenTruth);
    const beforeReuseEvents = await events(deployment, token);
    save(resolve(out, "events-before-reuser.json"), beforeReuseEvents);
    const reuser = await runClient(reuserClient, "reuser", reuserPrompt(unseen), out, stateFile, timeout, maxCalls);
    const afterReuseEvents = await events(deployment, token);
    save(resolve(out, "events-after-reuser.json"), afterReuseEvents);
    const reuserPhaseEvents = phaseEvents(beforeReuseEvents, afterReuseEvents);
    const reuseAudit = jsonl(reuser.audit);
    const reuseCalls = toolCalls(reuseAudit);
    const invocations = reuseCalls.filter((call) => call.name === "context_run" && call.args.id === "goal:destination-brief");
    const invocation = invocations[0];
    const reuseState = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
    const freshUnseenTruth = await fetchTruth(unseen);
    save(resolve(out, "truth-unseen-after.json"), freshUnseenTruth);
    const reuseOutcome = outcomeChecks(invocation, reuseState, freshUnseenTruth, deployment);
    const firstStart = builderAudit.find((event) => event.event === "start")?.detail;
    const secondStart = reuseAudit.find((event) => event.event === "start")?.detail;
    const formatterReceipts = reuseOutcome.mainReceipts.filter((receipt: any) => receipt.provider?.startsWith("mcp:") && providerUsed([receipt], reuseState, deployment.formatterUrl));
    const reuserChecks = {
      ...clientChecks(reuser), ...savedGoalChecks(reuseState), ...reuseOutcome.checks, ...phaseEventChecks(reuserPhaseEvents, freshUnseenTruth, invocation?.value?.output, 3),
      singleSavedGoalInvocation: invocations.length === 1,
      onlyNewCountryInput: Object.keys(invocation?.args.args ?? {}).length === 1 && invocation?.args.args?.country === unseen,
      differentServerProcess: !!firstStart?.serverPid && !!secondStart?.serverPid && firstStart.serverPid !== secondStart.serverPid,
      samePersistedState: secondStart?.stateExisted === true && secondStart.stateFile === firstStart?.stateFile,
      differentClientProcesses: !!builder.processPid && !!reuser.processPid && builder.processPid !== reuser.processPid,
      differentConversationWorkspaces: builder.cwd !== reuser.cwd && builder.serverWorkspace !== reuser.serverWorkspace,
      differentConversations: !!builder.sessionId && !!reuser.sessionId && (builder.client !== reuser.client || builder.sessionId !== reuser.sessionId),
      noManualReconstruction: !reuseCalls.some((call) => ["context_learn", "context_compose", "context_forget"].includes(call.name)),
      providerDriftRepairedInsideInvocation: invocation?.value?.attempts?.some((attempt: any) => typeof attempt.healing === "string" && attempt.healing.includes("API drift")) === true,
      changedMcpFormatterUsed: formatterReceipts.length > 0,
    };
    report.reuser = { ...reuser, ...reuseOutcome, phaseServiceEvents: reuserPhaseEvents, checks: reuserChecks, calls: reuseCalls, goalInvocations: invocations.length, outputSha256: typeof invocation?.value?.output === "string" ? sha(invocation.value.output) : null };
    if (existsSync(stateFile)) copyFileSync(stateFile, resolve(out, "state-after-reuser.json"));
    if (typeof invocation?.value?.output === "string") {
      writeFileSync(resolve(out, "reuser-brief.md"), invocation.value.output);
      report.negativeControls = await directAuditorNegatives(deployment, invocation.value.output, freshUnseenTruth, freshInitialTruth, out);
    }
    report.passed = allTrue(builderChecks) && allTrue(reuserChecks) && report.negativeControls?.passed === true;
  } catch (error) {
    report.error = String(error);
  } finally {
    report.buildAfter = sourceIdentity();
    report.productUnchanged = report.buildBefore.productSha256 === report.buildAfter.productSha256;
    report.passed = report.passed && report.productUnchanged;
    try { report.finalServiceEvents = await events(deployment, token); } catch (error) { report.eventCaptureError = String(error); report.passed = false; }
    save(manifestPath, report);
  }
  console.log(`${report.passed ? "PASS" : "FAIL"}: ${manifestPath}${report.error ? `\n${report.error}` : ""}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (argv.includes("--run")) await runRealProof();
  else console.log("Live-service two-AI proof. First deploy: node proof/real-environment.ts --deploy --manifest .rcx-deploy/real-current.json\nThen run: node proof/real-ai.ts --run --deployment .rcx-deploy/real-current.json [--clients claude,codex] [--initial PT] [--unseen IS] [--timeout-seconds 480] [--max-calls 60] [--out directory].\n--env is an alias for --deployment. No models are overridden. Only the owned formatter is changed; public providers are read-only. This runner never deploys or deletes cloud resources.");
}
