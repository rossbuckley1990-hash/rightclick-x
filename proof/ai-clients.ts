// Two real AI clients, one persisted checked goal, and a breaking provider change.
// Explicitly opt in to billed agent execution: node proof/ai-clients.ts --run
// Optional: --clients claude,codex --seed 472901 --timeout-seconds 480
// --max-calls 60 --out <directory>. --clients codex,codex runs independent
// sessions of the same client; that proves reuse, not cross-vendor portability.
// No model is selected here: both CLIs use their defaults and normal approvals.
// Raw prompts, client transcripts, MCP requests/responses, state snapshots, and
// independently observed service calls are retained. Final prose is NOT scored.
// --mcp-bridge is an internal transparent stdio transport used by the clients.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startEnvironment, type ProofEnvironment, type ServiceEvent } from "./environment.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SELF = resolve(HERE, "ai-clients.ts");
const RCX = resolve(ROOT, "bin/rcx.ts");
const argv = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
};
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
export const jsonl = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Preserve the protocol byte-for-byte while capturing both sides independently. */
async function bridge() {
  const stateFile = option("--state");
  const auditFile = option("--audit");
  const workspace = option("--workspace");
  const maxCalls = Number(option("--max-calls", "60"));
  if (!stateFile || !auditFile || !workspace) throw new Error("bridge requires state, audit, and workspace paths");
  const record = (event: string, detail: unknown) => appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n");
  const child = spawn(process.execPath, [RCX, "mcp"], {
    cwd: workspace,
    env: { ...process.env, RCX_STATE_FILE: stateFile, RCX_WORKSPACE: workspace, RCX_AUTH: "", RCX_MCP_LOG: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  record("start", { bridgePid: process.pid, serverPid: child.pid, stateFile, stateExisted: existsSync(stateFile) });
  let count = 0;
  let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    if (closed) return;
    closed = true;
    child.stdin.end(); // RightClick X flushes its state on EOF.
    killTimer = setTimeout(() => child.kill("SIGTERM"), 3000);
  };
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (closed) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { record("invalid-client-line", line); child.stdin.write(line + "\n"); return; }
    record("request", msg);
    const calls = (Array.isArray(msg) ? msg : [msg]).filter((item) => item.method === "tools/call");
    count += calls.length;
    if (count > maxCalls) {
      record("call-limit", { count, maxCalls });
      for (const item of calls) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: item.id, error: { code: -32000, message: "Proof harness MCP call budget exhausted" } }) + "\n");
      end();
      return;
    }
    child.stdin.write(line + "\n");
  });
  input.on("close", end);
  const output = createInterface({ input: child.stdout });
  output.on("line", (line) => {
    try { record("response", JSON.parse(line)); } catch { record("invalid-server-line", line); }
    process.stdout.write(line + "\n");
  });
  child.stderr.on("data", (data) => process.stderr.write(data));
  child.stdin.on("error", (error) => record("stdin-error", String(error)));
  child.on("error", (error) => record("spawn-error", String(error)));
  process.once("SIGTERM", end);
  process.once("SIGINT", end);
  await new Promise<void>((done) => child.once("close", (code, signal) => {
    if (killTimer) clearTimeout(killTimer);
    record("stop", { serverPid: child.pid, code, signal, calls: count });
    input.close();
    process.stdin.pause();
    done();
  }));
}

export interface ToolCall { id: string | number; name: string; args: any; response?: any; value?: any }
export function toolCalls(events: any[]): ToolCall[] {
  const requests: ToolCall[] = [];
  const pending = new Map<string | number, ToolCall>();
  for (const event of events) {
    const messages = Array.isArray(event.detail) ? event.detail : [event.detail];
    for (const msg of messages) {
      if (event.event === "request" && msg.method === "tools/call") {
        const item = { id: msg.id, name: msg.params.name, args: msg.params.arguments ?? {} };
        requests.push(item); pending.set(msg.id, item);
      } else if (event.event === "response" && pending.has(msg.id)) {
        const item = pending.get(msg.id)!;
        item.response = msg;
        item.value = msg.result?.structuredContent;
        if (item.value === undefined) {
          const text = msg.result?.content?.find((part: any) => part.type === "text")?.text;
          try { item.value = JSON.parse(text); } catch { /* errors remain in raw response */ }
        }
      }
    }
  }
  return requests;
}

export interface AgentExecution {
  client: "claude" | "codex";
  phase: "builder" | "reuser";
  cwd: string;
  serverWorkspace: string;
  processPid?: number;
  sessionId?: string;
  exit: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  seconds: number;
  transcript: string;
  stderr: string;
  audit: string;
  final: string;
  nonRcxActions: string[];
  serverStopped: boolean;
  callBudgetExceeded: boolean;
  codeModeTrace?: { file?: string; source?: string; threadId?: string; calls: number; violations: string[]; error?: string };
}

/** CLI JSONL exposes nested MCP calls but omits Code Mode wrapper source. Keep
 * only this spawned session's raw tool records, excluding unrelated context. */
function captureCodeModeTrace(transcript: string, destination: string): NonNullable<AgentExecution["codeModeTrace"]> {
  try {
    const threadId = jsonl(transcript).find((event) => event.type === "thread.started")?.thread_id;
    if (typeof threadId !== "string") throw new Error("CLI transcript has no thread identifier");
    const sessions = resolve(process.env.CODEX_HOME ?? resolve(homedir(), ".codex"), "sessions");
    const matching = readdirSync(sessions, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(`${threadId}.jsonl`));
    if (matching.length !== 1) throw new Error(`Expected one rollout for this spawned session, found ${matching.length}`);
    const source = resolve(sessions, matching[0]);
    const toolLines = readFileSync(source, "utf8").split("\n").filter((line) => {
      if (!line) return false;
      const event = JSON.parse(line);
      return event.type === "response_item" && ["function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"].includes(event.payload?.type);
    });
    writeFileSync(destination, toolLines.join("\n") + "\n");
    const calls = toolLines.map((line) => JSON.parse(line).payload).filter((item) => ["function_call", "custom_tool_call"].includes(item.type));
    const violations: string[] = [];
    for (const call of calls) {
      if (/^mcp__rightclick[-_]x__context_/.test(call.name)) continue;
      if (!["exec", "functions.exec"].includes(call.name)) { violations.push(`Unexpected tool: ${call.name}`); continue; }
      const code = call.input ?? call.arguments;
      if (typeof code !== "string") { violations.push("Code Mode wrapper has no inspectable source"); continue; }
      const toolAccesses = [...code.matchAll(/\btools\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      if (toolAccesses.some((name) => !/^mcp__rightclick[-_]x__context_/.test(name))) violations.push("Code Mode accessed a non-RightClick tool");
      if (/\btools\b/.test(code.replace(/\btools\.[A-Za-z0-9_]+/g, ""))) violations.push("Code Mode used dynamic tool access; manual audit required");
      if (/\b(?:fetch|require|import|eval|Function|process|globalThis|Deno|Bun)\b|\.constructor\b/.test(code)) violations.push("Code Mode used a general execution or I/O primitive; manual audit required");
    }
    return { file: destination, source, threadId, calls: calls.length, violations };
  } catch (error) {
    return { calls: 0, violations: [], error: String(error) };
  }
}

/** Check actual trace actions too; prompt compliance alone cannot establish isolation. */
function nonRcxActions(client: "claude" | "codex", transcript: string): string[] {
  const violations = new Set<string>();
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "tool_use" || value.type === "function_call" || value.type === "custom_tool_call") {
      if (typeof value.name === "string" && !/^mcp__rightclick[-_]x__context_/.test(value.name)) violations.add(value.name);
    }
    if (client === "codex" && value.type === "mcp_tool_call" && value.server !== "rightclick-x") violations.add(`MCP:${value.server}`);
    if (["command_execution", "file_change", "web_search", "computer_use", "image_generation", "collab_tool_call"].includes(value.type)) violations.add(value.type);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  for (const line of transcript.split("\n").filter(Boolean)) {
    try { visit(JSON.parse(line)); } catch { /* raw non-JSON diagnostics are preserved */ }
  }
  return [...violations];
}

export async function runClient(client: "claude" | "codex", phase: "builder" | "reuser", prompt: string, out: string, stateFile: string, timeoutSeconds: number, maxCalls: number): Promise<AgentExecution> {
  const prefix = `${phase}-${client}`;
  const work = mkdtempSync(resolve(tmpdir(), `rcx-proof-${prefix}-`));
  const serverWork = mkdtempSync(resolve(tmpdir(), `rcx-proof-server-${prefix}-`));
  const audit = resolve(out, `${prefix}-mcp.jsonl`);
  const transcript = resolve(out, `${prefix}-transcript.jsonl`);
  const stderr = resolve(out, `${prefix}-stderr.txt`);
  const final = resolve(out, `${prefix}-final.txt`);
  writeFileSync(resolve(out, `${prefix}-prompt.txt`), prompt + "\n");
  const serverArgs = [SELF, "--mcp-bridge", "--state", stateFile, "--audit", audit, "--workspace", serverWork, "--max-calls", String(maxCalls)];
  let cliArgs: string[];
  if (client === "claude") {
    const config = resolve(out, `${prefix}-mcp.json`);
    save(config, { mcpServers: { "rightclick-x": { command: process.execPath, args: serverArgs } } });
    cliArgs = ["-p", prompt, "--mcp-config", config, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__rightclick-x", "--disable-slash-commands", "--no-chrome", "--output-format", "stream-json", "--verbose", "--max-turns", "40"];
  } else {
    cliArgs = ["exec", "--skip-git-repo-check", "--ignore-user-config", "--approve-for-me", "--json", "--color", "never",
      // Remove other action channels, keeping the normal automatic approval reviewer.
      // Code Mode stays enabled: this Codex version uses it to discover/invoke
      // MCP tools. Disabling the host prevents the proof's MCP access itself.
      ...["shell_tool", "apps", "plugins", "multi_agent", "browser_use", "computer_use", "image_generation", "remote_plugin"].flatMap((feature) => ["--disable", feature]),
      "-c", "web_search=\"disabled\"",
      "-c", `mcp_servers.rightclick-x.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.rightclick-x.args=${JSON.stringify(serverArgs)}`,
      "--output-last-message", final, prompt];
  }
  // Config has only local proof paths; never serialize auth-bearing process.env.
  save(resolve(out, `${prefix}-invocation.json`), { command: client, phase, args: cliArgs, cwd: work, timeoutSeconds, maxCalls });
  writeFileSync(transcript, ""); writeFileSync(stderr, "");
  const started = performance.now();
  let timedOut = false;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(client, cliArgs, { cwd: work, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  const stopGroup = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* it may have just exited */ }
  };
  const timer = setTimeout(() => {
    timedOut = true; stopGroup("SIGTERM");
    hardTimer = setTimeout(() => stopGroup("SIGKILL"), 4000);
  }, timeoutSeconds * 1000);
  child.stdout.on("data", (data) => appendFileSync(transcript, data));
  child.stderr.on("data", (data) => appendFileSync(stderr, data));
  const ended = await new Promise<{ exit: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("error", (error) => { appendFileSync(stderr, String(error) + "\n"); done({ exit: null, signal: null }); });
    child.once("close", (exit, signal) => done({ exit, signal }));
  });
  clearTimeout(timer); if (hardTimer) clearTimeout(hardTimer);
  // Also terminate any server descendants a failed CLI left behind.
  stopGroup("SIGTERM");
  // Wait for the transport's EOF-driven product flush before inspecting or reusing
  // the state. A normal client exit does not itself prove its MCP child exited.
  const flushDeadline = Date.now() + 5000;
  let auditEvents = jsonl(audit);
  while (auditEvents.some((event) => event.event === "start") && !auditEvents.some((event) => event.event === "stop") && Date.now() < flushDeadline) {
    await new Promise((done) => setTimeout(done, 50));
    auditEvents = jsonl(audit);
  }
  if (client === "claude") {
    const events = readFileSync(transcript, "utf8").split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = events.findLast((event) => event.type === "result");
    writeFileSync(final, String(result?.result ?? ""));
  }
  const codeModeTrace = client === "codex" ? captureCodeModeTrace(transcript, resolve(out, `${prefix}-code-mode.jsonl`)) : undefined;
  const sessionId = client === "codex" ? codeModeTrace?.threadId : jsonl(transcript).find((event) => event.type === "system" && event.subtype === "init")?.session_id;
  return { client, phase, cwd: work, serverWorkspace: serverWork, processPid: child.pid, sessionId, ...ended, timedOut, seconds: Math.round((performance.now() - started) / 100) / 10, transcript, stderr, audit, final, nonRcxActions: nonRcxActions(client, readFileSync(transcript, "utf8")), serverStopped: auditEvents.some((event) => event.event === "stop"), callBudgetExceeded: auditEvents.some((event) => event.event === "call-limit"), codeModeTrace };
}

function outcomeChecks(call: ToolCall | undefined, expected: number, orderId: string, serviceEvents: ServiceEvent[]) {
  const result = call?.name === "context_compose" ? call.value?.executed : call?.value;
  const witnesses = result?.witnesses ?? [];
  return {
    successfulMcpResponse: !!call && !call.response?.error && call.response?.result?.isError === false,
    runtimeCompleted: result?.status === "completed",
    runtimeVerified: result?.verification?.status === "verified",
    exactIndependentTruth: typeof result?.output === "number" && Math.abs(result.output - expected) < 1e-8,
    witnessCompletedAndVerified: witnesses.length > 0 && witnesses.every((witness: any) => witness.status === "completed" && witness.verification?.status === "verified" && witness.output?.valid === true),
    ordersReadObserved: serviceEvents.some((event) => event.service === "orders" && event.action === "read" && event.detail.order_id === orderId),
    taxQuoteObserved: serviceEvents.some((event) => event.service === "tax" && event.action === "quote" && event.detail.tax_amount === expected),
    independentAuditObserved: serviceEvents.some((event) => event.service === "auditor" && event.action === "check" && event.detail.order_id === orderId && event.detail.proposed === expected && event.detail.valid === true),
  };
}

export function sourceIdentity() {
  const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "src", "bin"]).split("\n").filter(Boolean);
  const source = createHash("sha256");
  for (const path of files.sort()) source.update(path + "\0").update(readFileSync(resolve(ROOT, path))).update("\0");
  return { commit: git(["rev-parse", "HEAD"]), workingTree: git(["status", "--porcelain"]), productSha256: source.digest("hex"), node: process.version };
}

function buildPrompt(env: ProofEnvironment, orderId: string) {
  return [
    "Use only the rightclick-x MCP tools. Do not use shell, files, browser, external tools, or other agents.",
    `You have access to a controlled synthetic environment whose only supplied address is ${env.gateway}/ .`,
    `Objective: obtain the tax amount in USD dollars for order ${orderId}, independently check that amount, and save the checked workflow so another AI can use it for other orders later.`,
    "Discover the services and their contracts through that gateway. The amount to return is tax, not the order subtotal. Respect the units in each service contract.",
    "Use context_compose to create and publish a reusable goal named order-tax-usd. Its initial input should be named order_id; its required output type is quantity:money:USD:major.",
    "The saved goal must contain a required independent outcome witness using the environment's auditor. Bind its order identifier to the goal's input and its proposed tax amount to the goal's output, so the witness applies to later orders too. Discover the auditor identifier and inspect the tool schema to do this.",
    "Use only read operations for the business workflow. The authorized publication changes RightClick X's own local graph and state.",
    "Run the goal for the given order, save it only after the required audit passes, and report the published goal identifier, amount, and verification status. Do not invent missing data or claim a pass after an error.",
  ].join("\n");
}

function reusePrompt(orderId: string) {
  return [
    "Use only the rightclick-x MCP tools. Do not use shell, files, browser, external tools, or other agents.",
    "A different AI created a reusable checked order-tax workflow earlier. RightClick X has now restarted with its saved state. You have none of that AI's conversation history.",
    `Objective: obtain the tax amount in USD dollars for a new order, ${orderId}, using the existing saved goal and its independent outcome audit.`,
    "Find the goal in the capability graph and invoke it using context_run with the new order_id. Use the stable goal capability, not a crystallized snapshot. Do not recreate, republish, manually re-learn providers, or manually compose a replacement workflow.",
    "The provider environment may have changed. Invoke the goal once and let it perform its own repair and verification within that invocation. If it fails, report that failure; do not retry or substitute another value.",
  ].join("\n");
}

async function proof() {
  const seed = Number(option("--seed", "472901"));
  const timeoutSeconds = Number(option("--timeout-seconds", "480"));
  const maxCalls = Number(option("--max-calls", "60"));
  const selectedClients = option("--clients", "claude,codex")!.split(",");
  if (selectedClients.length !== 2 || selectedClients.some((client) => !["claude", "codex"].includes(client))) throw new Error("--clients requires exactly two clients, each claude or codex, e.g. claude,codex or codex,codex");
  const [builderClient, reuserClient] = selectedClients as ["claude" | "codex", "claude" | "codex"];
  if (![seed, timeoutSeconds, maxCalls].every(Number.isSafeInteger) || timeoutSeconds < 1 || timeoutSeconds > 1200 || maxCalls < 1 || maxCalls > 100) throw new Error("Invalid limits: integer timeout 1–1200 seconds and max-calls 1–100 required");
  const out = resolve(option("--out", resolve(HERE, "results", `ai-clients-${new Date().toISOString().replace(/[:.]/g, "-")}-${seed}`))!);
  mkdirSync(out, { recursive: true });
  const stateFile = resolve(out, "state.json");
  if (existsSync(stateFile)) throw new Error("Refusing to overwrite an existing proof state; choose a fresh --out directory");
  const buildBefore = sourceIdentity();
  const report: any = { at: new Date().toISOString(), seed, buildBefore, outputDirectory: out, clients: { builder: builderClient, reuser: reuserClient }, crossVendor: builderClient !== reuserClient, scenario: `Controlled synthetic order-tax workflow, saved by an isolated ${builderClient} session, reused after restart by another isolated ${reuserClient} session following REST-to-MCP provider drift`, limits: { timeoutSeconds, maxCalls }, passed: false };
  save(resolve(out, "manifest.json"), report);
  const env = await startEnvironment(seed);
  const first = env.orderIds[0];
  const unseen = env.orderIds[1];
  save(resolve(out, "ground-truth.json"), { records: env.truth, first, unseen, expectedFirst: env.expected(first), expectedUnseen: env.expected(unseen) });
  try {
    console.log(`Evidence: ${out}\n${builderClient} builder session will create a checked goal for ${first}.`);
    const builder = await runClient(builderClient, "builder", buildPrompt(env, first), out, stateFile, timeoutSeconds, maxCalls);
    const builderAudit = jsonl(builder.audit);
    const builderCalls = toolCalls(builderAudit);
    const publication = builderCalls.findLast((call) => call.name === "context_compose" && call.value?.published?.id === "goal:order-tax-usd");
    const firstEvents = structuredClone(env.events);
    const builderChecks = {
      clientExited: builder.exit === 0 && !builder.timedOut,
      serverStopped: builder.serverStopped,
      withinCallBudget: !builder.callBudgetExceeded,
      onlyRcxActions: builder.nonRcxActions.length === 0,
      codeModeSourceChecked: builderClient !== "codex" || !!builder.codeModeTrace?.file && !builder.codeModeTrace.error && builder.codeModeTrace.violations.length === 0,
      gatewayDiscovered: builderCalls.some((call) => call.name === "context_learn" && (call.args.source?.replace(/\/$/, "") === env.gateway || call.args.sources?.some((source: string) => source.replace(/\/$/, "") === env.gateway))),
      publishedStableGoal: !!publication,
      witnessInputIsRelative: publication?.args.witnesses?.some((witness: any) => witness.args?.order_id?.input === "order_id" && witness.args?.tax_amount?.output === "") === true,
      ...outcomeChecks(publication, env.expected(first), first, firstEvents),
    };
    report.builder = { ...builder, checks: builderChecks, calls: builderCalls, serviceEvents: firstEvents };
    if (existsSync(stateFile)) { copyFileSync(stateFile, resolve(out, "state-after-builder.json")); report.stateAfterBuilderSha256 = digest(stateFile); }
    save(resolve(out, "manifest.json"), report);
    if (!Object.values(builderChecks).every(Boolean)) throw new Error(`Builder did not establish the checked goal: ${Object.entries(builderChecks).filter(([, ok]) => !ok).map(([key]) => key).join(", ")}`);

    // The operator changes the provider, not the product or saved goal. The second
    // AI is given a new order and no service addresses, pipeline or goal ID.
    env.setTaxVersion(3);
    const boundary = env.events.length;
    console.log(`Tax provider changed from REST to MCP. Independent ${reuserClient} reuser session will invoke the goal for ${unseen}.`);
    const reuser = await runClient(reuserClient, "reuser", reusePrompt(unseen), out, stateFile, timeoutSeconds, maxCalls);
    const reuseAudit = jsonl(reuser.audit);
    const reuseCalls = toolCalls(reuseAudit);
    const invokedGoal = reuseCalls.findLast((call) => call.name === "context_run" && call.args.id === "goal:order-tax-usd" && call.args.args?.order_id === unseen);
    const secondEvents = env.events.slice(boundary);
    const firstStart = builderAudit.find((event) => event.event === "start")?.detail;
    const secondStart = reuseAudit.find((event) => event.event === "start")?.detail;
    const reuseChecks = {
      clientExited: reuser.exit === 0 && !reuser.timedOut,
      serverStopped: reuser.serverStopped,
      withinCallBudget: !reuser.callBudgetExceeded,
      onlyRcxActions: reuser.nonRcxActions.length === 0,
      codeModeSourceChecked: reuserClient !== "codex" || !!reuser.codeModeTrace?.file && !reuser.codeModeTrace.error && reuser.codeModeTrace.violations.length === 0,
      invokedPersistedGoal: !!invokedGoal,
      singleGoalInvocation: reuseCalls.filter((call) => call.name === "context_run" && call.args.id === "goal:order-tax-usd").length === 1,
      differentServerProcess: !!firstStart?.serverPid && !!secondStart?.serverPid && firstStart.serverPid !== secondStart.serverPid,
      samePersistedState: secondStart?.stateExisted === true && secondStart.stateFile === firstStart?.stateFile,
      noManualReconstruction: !reuseCalls.some((call) => ["context_learn", "context_forget", "context_compose"].includes(call.name)),
      previouslyUnseenOrder: !firstEvents.some((event) => ["orders", "auditor"].includes(event.service) && event.detail.order_id === unseen),
      newMcpProviderUsed: secondEvents.some((event) => event.service === "tax" && event.action === "quote" && event.detail.version === 3),
      ...outcomeChecks(invokedGoal, env.expected(unseen), unseen, secondEvents),
    };
    const goalInvocations = reuseCalls.filter((call) => call.name === "context_run" && call.args.id === "goal:order-tax-usd").map((call) => ({ orderId: call.args.args?.order_id, status: call.value?.status, verification: call.value?.verification?.status, error: call.value?.error, attempts: call.value?.attempts }));
    report.reuser = { ...reuser, checks: reuseChecks, goalInvocations, requiredAgentRetry: goalInvocations.length > 1, calls: reuseCalls, serviceEvents: secondEvents };
    if (existsSync(stateFile)) copyFileSync(stateFile, resolve(out, "state-after-reuser.json"));
    report.passed = Object.values(builderChecks).every(Boolean) && Object.values(reuseChecks).every(Boolean);
  } catch (error) {
    report.error = String(error);
  } finally {
    report.buildAfter = sourceIdentity();
    report.productUnchanged = buildBefore.productSha256 === report.buildAfter.productSha256;
    report.passed = report.passed && report.productUnchanged;
    report.serviceEvents = env.events;
    save(resolve(out, "manifest.json"), report);
    save(resolve(out, "service-events.json"), env.events);
    await env.stop();
  }
  console.log(`${report.passed ? "PASS" : "FAIL"}: ${resolve(out, "manifest.json")}${report.error ? `\n${report.error}` : ""}`);
  if (!report.passed) process.exitCode = 1;
}

// This explicit audit mode adds derived trace evidence to an existing manifest.
// It never invokes an AI, changes the product, or rewrites raw protocol records.
function auditExisting() {
  const path = resolve(option("--audit-existing")!);
  const report = JSON.parse(readFileSync(path, "utf8"));
  const original = resolve(dirname(path), "manifest-before-additional-audit.json");
  if (!existsSync(original)) copyFileSync(path, original);
  report.verdictBeforeAdditionalAudit ??= report.passed;
  for (const phase of ["builder", "reuser"]) {
    const run = report[phase];
    if (!run || run.client !== "codex") continue;
    run.codeModeTrace = captureCodeModeTrace(run.transcript, resolve(dirname(path), `${phase}-codex-code-mode.jsonl`));
    run.checks.codeModeSourceChecked = !!run.codeModeTrace.file && !run.codeModeTrace.error && run.codeModeTrace.violations.length === 0;
    if (!run.checks.codeModeSourceChecked) report.passed = false;
  }
  if (report.reuser) {
    report.reuser.goalInvocations = report.reuser.calls.filter((call: ToolCall) => call.name === "context_run" && call.args.id === "goal:order-tax-usd").map((call: ToolCall) => ({ orderId: call.args.args?.order_id, status: call.value?.status, verification: call.value?.verification?.status, error: call.value?.error, attempts: call.value?.attempts }));
    report.reuser.requiredAgentRetry = report.reuser.goalInvocations.length > 1;
    report.reuser.checks.singleGoalInvocation = report.reuser.goalInvocations.length === 1;
    if (!report.reuser.checks.singleGoalInvocation) report.passed = false;
  }
  report.additionalTraceAuditAt = new Date().toISOString();
  save(path, report);
  console.log(`Preserved Code Mode source and audited existing evidence: ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (argv.includes("--mcp-bridge")) await bridge();
  else if (argv.includes("--audit-existing")) auditExisting();
  else if (argv.includes("--run")) await proof();
  else console.log("Two-AI checked-goal proof (uses local authenticated CLIs and may incur model charges).\nRun: node proof/ai-clients.ts --run [--clients claude,codex] [--seed 472901] [--timeout-seconds 480] [--max-calls 60] [--out directory]\nUse --clients codex,codex for independent sessions of the same client; this does not prove cross-vendor portability.\nNo models are overridden. Evidence is retained under proof/results/ by default. No AI runs without --run.");
}
