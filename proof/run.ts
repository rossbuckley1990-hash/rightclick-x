// Reproducible black-box proof, not an AI evaluation.
//   node proof/run.ts [seed]
// Product access is MCP JSON-RPC over stdio only. Direct fixture requests below
// are explicitly labelled independent controls, never used to obtain a result.
import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startEnvironment, type ProofEnvironment } from "./environment.ts";

type RpcLog = { client: string; method: string; params: unknown; result?: unknown; error?: string };
type Check = { name: string; passed: boolean; detail: unknown };

function sourceManifest() {
  const files: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files[relative(process.cwd(), path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(join(process.cwd(), "src"));
  walk(join(process.cwd(), "bin"));
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

class StdioClient {
  child: ChildProcessWithoutNullStreams;
  readonly name: string;
  readonly log: RpcLog[];
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = "";
  stderr = "";
  constructor(name: string, state: string, log: RpcLog[]) {
    this.name = name;
    this.log = log;
    this.child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], {
      env: { ...process.env, RCX_STATE_FILE: state, RCX_WORKSPACE: join(state, ".."), RCX_AUTH: "{}", RCX_MCP_LOG: "", RCX_TOKEN: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        try {
          const response = JSON.parse(line);
          const pending = this.pending.get(response.id);
          if (pending) { clearTimeout(pending.timer); this.pending.delete(response.id); pending.resolve(response); }
        } catch (error) { this.fail(new Error(`Non-JSON output from MCP server: ${line.slice(0, 200)} (${error})`)); }
      }
    });
    this.child.stderr.on("data", (chunk) => { this.stderr += String(chunk); });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code, signal) => this.fail(new Error(`MCP process exited (${code ?? signal})`)));
  }
  private fail(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  async rpc(method: string, params: unknown = {}) {
    const id = ++this.nextId;
    const entry: RpcLog = { client: this.name, method, params };
    this.log.push(entry);
    try {
      const response: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after 30 seconds`)); }, 30_000);
        this.pending.set(id, { resolve, reject, timer });
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
      entry.result = response;
      if (response.error) throw new Error(JSON.stringify(response.error));
      return response.result;
    } catch (error) { entry.error = String(error); throw error; }
  }
  async start() {
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: `rightclick-proof-${this.name}`, version: "1" } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await this.rpc("tools/list");
    if (!tools.tools?.some((tool: any) => tool.name === "context_compose")) throw new Error("RightClick X context tools are missing");
  }
  async call(name: string, args: Record<string, unknown> = {}) {
    const result = await this.rpc("tools/call", { name, arguments: args });
    if (result.isError) return { status: "failed", toolError: result.content?.[0]?.text };
    return result.structuredContent;
  }
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.child.kill("SIGTERM"), 5000);
      this.child.once("exit", () => { clearTimeout(timer); resolve(); });
      this.child.stdin.end();
    });
  }
}

class PublishedApiConsumer {
  private child: ChildProcessWithoutNullStreams;
  private ready: Promise<string>;
  readonly requests: unknown[] = [];
  constructor(state: string) {
    this.child = spawn(process.execPath, ["bin/rcx.ts", "serve", "--port", "0", "--host", "127.0.0.1"], {
      env: { ...process.env, RCX_STATE_FILE: state, RCX_WORKSPACE: join(state, ".."), RCX_AUTH: "{}", RCX_MCP_LOG: "", RCX_TOKEN: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Published HTTP API did not start")), 10_000);
      let output = "";
      this.child.stdout.on("data", (chunk) => {
        output += String(chunk);
        const match = /RightClick X .* on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      this.child.once("error", (error) => { clearTimeout(timer); reject(error); });
      this.child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Published API exited: ${code}`)); });
    });
    this.child.stderr.resume();
  }
  async get(path: string) {
    const base = await this.ready;
    const response = await fetch(`${base}${path}`);
    const result: any = await response.json();
    this.requests.push({ path, httpStatus: response.status, result });
    return result;
  }
  async post(path: string, body: unknown) {
    const base = await this.ready;
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result: any = await response.json();
    this.requests.push({ path, method: "POST", body, httpStatus: response.status, result });
    return result;
  }
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => { this.child.once("exit", () => resolve()); this.child.kill("SIGTERM"); });
  }
}

const seed = Number(process.argv[2] ?? 472901);
if (!Number.isSafeInteger(seed)) throw new Error("seed must be an integer");
const before = sourceManifest();
const directory = mkdtempSync(join(tmpdir(), "rcx-proof-"));
const stateFile = join(directory, "state.json");
const checks: Check[] = [];
const calls: RpcLog[] = [];
const phases: unknown[] = [];
const evidence: Record<string, any> = {
  title: "Verified order tax through unfamiliar contract interfaces",
  kind: "Deterministic MCP harness; no AI client or real business environment is claimed",
  seed,
  startedAt: new Date().toISOString(),
  conditions: {
    providers: "Controlled loopback fixtures; independent records; synthetic fixed 20% tax rule",
    productEntry: "MCP JSON-RPC over stdio, followed by a consumer of the published REST endpoint; only the gateway address is supplied for discovery",
    mainRoute: "The first lifecycle supplies no through anchors; a separate fresh-state lifecycle explicitly tests a saved anchored workflow",
    verification: "Numeric predicate plus independent MCP auditor, then harness checks against separately held truth",
    clients: "Two independent deterministic MCP client processes, not two AI agents",
  },
  sourceBefore: before,
  checks, phases, calls,
};
let environment: ProofEnvironment | undefined;
let client: StdioClient | undefined;
let apiConsumer: PublishedApiConsumer | undefined;
const check = (name: string, passed: boolean, detail: unknown = {}) => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${passed ? "" : ` ${JSON.stringify(detail).slice(0, 4000)}`}`);
};

try {
  environment = await startEnvironment(seed);
  const env = environment;
  evidence.environment = { gateway: env.gateway, orders: env.ordersUrl, tax: env.taxUrl, auditor: env.auditorUrl, independentTruth: env.truth };
  client = new StdioClient("builder", stateFile, calls);
  await client.start();
  const learned = await client.call("context_learn", { source: env.gateway });
  const providers = await client.call("context_providers");
  evidence.discovery = { learned, providers };
  const auditSearch = await client.call("context_graph", { op: "search", query: "Audit order tax independently", limit: 10 });
  const auditor = auditSearch.result?.find((capability: any) => /audit.order.tax/i.test(`${capability.id} ${capability.title}`));
  if (!auditor) throw new Error("Independent auditor was not discovered from the gateway");
  const witness = {
    capability: auditor.id,
    args: { order_id: { input: "order_id" }, tax_amount: { output: "" } },
    verify: [{ op: "equals", path: "valid", value: true }],
  };
  const goal = {
    have: { order_id: env.orderIds[0] },
    want: "quantity:money:USD:major",
    intent: "order tax",
    maxSteps: 4,
    risks: ["read"],
    verify: [{ op: "gt", value: 0 }],
    witnesses: [witness],
  };
  evidence.goal = goal;
  const startEvents = await client.call("context_watch", { since: 0, waitMs: 0 });
  const compose = await client.call("context_compose", { ...goal, run: true, publish: "Verified order tax" });
  const goalId = compose.published?.id ?? "goal:verified-order-tax";
  evidence.stableGoal = { id: goalId, path: compose.published?.path, slug: compose.published?.slug };

  const successful = (name: string, orderId: string, result: any) => {
    const run = result.executed ?? result;
    const expected = env.expected(orderId);
    const witnesses = run.witnesses ?? [];
    const witnessVerified = witnesses.some((item: any) => item.capability === auditor.id && item.status === "completed" && ["checked", "verified"].includes(item.verification?.status) && item.output?.valid === true);
    const truthMatched = typeof run.output === "number" && Math.abs(run.output - expected) < 0.000001;
    const passed = run.status === "completed" && run.verification?.status === "verified" && truthMatched && witnessVerified;
    phases.push({ name, orderId, expected, result, truthMatched, witnessVerified });
    check(name, passed, { expected, output: run.output, status: run.status, witnessVerified,
      ...(!passed ? { error: run.error ?? result.toolError, attempts: run.attempts, witnesses } : {}) });
    return passed;
  };
  successful("initial complete pipeline and independent witness", env.orderIds[0], compose);
  check("goal published under stable identity", !!compose.published && goalId === "goal:verified-order-tax", compose.published);
  const quotes = env.events.filter((event) => event.service === "tax" && event.action === "quote");
  const firstAmount = env.truth[0].amount_cents / 100;
  check("minor units converted before tax provider invocation", quotes.some((event) => event.detail.amount_dollars === firstAmount), { expectedDollars: firstAmount, quotes });

  // Deliberately bypass conversion as an independent negative control. Neither
  // this result nor the expected answer is supplied to RightClick X.
  const badQuote: any = await (await fetch(`${env.taxUrl}/quote?amount_dollars=${env.truth[0].amount_cents}`)).json();
  const directAudit: any = await (await fetch(`${env.auditorUrl}/mcp`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "audit_order_tax", arguments: { order_id: env.orderIds[0], tax_amount: badQuote.tax_amount } } }),
  })).json();
  check("independent control rejects cents misread as dollars", directAudit.result?.structuredContent?.valid === false && badQuote.tax_amount !== env.expected(env.orderIds[0]), { directProviderControl: true, wrong: badQuote.tax_amount, expected: env.expected(env.orderIds[0]), auditor: directAudit });

  await client.stop();
  client = new StdioClient("reuser-after-restart", stateFile, calls);
  await client.start();
  successful("second MCP client reuses persisted goal on unseen order", env.orderIds[1], await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[1] } }));

  env.setTaxVersion(2);
  successful("same goal recovers renamed REST and nested response", env.orderIds[2], await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[2] } }));
  env.setTaxVersion(3);
  successful("same goal recovers protocol change to MCP", env.orderIds[3], await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[3] } }));

  env.setBadArithmetic(true);
  const bad = await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[4] } });
  phases.push({ name: "same-contract arithmetic corruption", orderId: env.orderIds[4], expected: env.expected(env.orderIds[4]), result: bad });
  check("same-contract wrong arithmetic is never reported as successful", bad.status !== "completed" && bad.verification?.status !== "verified", { status: bad.status, verification: bad.verification, output: bad.output, witnesses: bad.witnesses });
  check("independent auditor actually refutes corrupt quote", env.events.some((event) => event.service === "auditor" && event.detail.order_id === env.orderIds[4] && event.detail.valid === false));
  env.setBadArithmetic(false);
  successful("same goal works after arithmetic is corrected", env.orderIds[5], await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[5] } }));

  await env.removeTax();
  const missing = await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[6] } });
  phases.push({ name: "required provider disappearance", result: missing });
  check("required provider disappearance fails honestly", missing.status !== "completed" && missing.verification?.status !== "verified", missing);
  await env.restoreTax(1);
  const rediscovered = await client.call("context_learn", { source: env.gateway });
  evidence.rediscovery = rediscovered;
  successful("same goal works after gateway rediscovery of restored provider", env.orderIds[7], await client.call("context_run", { id: goalId, args: { order_id: env.orderIds[7] } }));

  const watch = await client.call("context_watch", { since: 0, waitMs: 0 });
  const receipts = await client.call("context_run_status", { limit: 300 });
  evidence.graphEvents = { first: startEvents, final: watch };
  evidence.receipts = receipts;
  check("receipt chain remains intact", receipts.chain?.intact === true, receipts.chain);
  await client.stop();
  evidence.persistedState = JSON.parse(readFileSync(stateFile, "utf8"));

  // A third process loads the same state and exposes the existing goal through
  // REST. The consumer supplies only a new order ID, never an implementation.
  apiConsumer = new PublishedApiConsumer(stateFile);
  const spec = await apiConsumer.get("/openapi.json");
  const stablePath = "/x/verified-order-tax";
  check("published stable endpoint survives process restart", !!spec.paths?.[stablePath]);
  const consume = async (name: string, orderId: string) => {
    const response = await apiConsumer!.get(`${stablePath}?order_id=${encodeURIComponent(orderId)}`);
    const witnessVerified = response.witnesses?.some((item: any) => item.capability === auditor.id && item.status === "completed" && ["checked", "verified"].includes(item.verification?.status) && item.output?.valid === true);
    const truthMatched = typeof response.result === "number" && Math.abs(response.result - env.expected(orderId)) < 0.000001;
    check(name, response.ok === true && response.verification === "verified" && truthMatched && witnessVerified, { expected: env.expected(orderId), response });
  };
  await consume("REST consumer obtains independently verified quote", env.orderIds[8]);
  env.setTaxVersion(2);
  await consume("same REST endpoint heals another contract change", env.orderIds[9]);
  evidence.restReceipts = await apiConsumer.post("/api/context_run_status", { limit: 300 });
  check("REST consumer receipt chain remains intact", evidence.restReceipts.chain?.intact === true, evidence.restReceipts.chain);
  evidence.restConsumer = apiConsumer.requests;
  await apiConsumer.stop();

  // Fresh product state keeps this independent of the unanchored lifecycle:
  // neither route gets the benefit of the other route's prior re-discovery.
  // Anchors are discovered capability IDs, not fixture constants.
  env.setTaxVersion(1);
  const anchoredStateFile = join(directory, "anchored-state.json");
  client = new StdioClient("anchored-builder", anchoredStateFile, calls);
  await client.start();
  const anchoredDiscovery = await client.call("context_learn", { source: env.gateway });
  const anchoredGoal = { ...goal, have: { order_id: env.orderIds[10] } };
  const preview = await client.call("context_compose", anchoredGoal);
  const anchors: string[] = preview.plans?.[0]?.steps.map((step: any) => step.capability) ?? [];
  check("anchored lifecycle discovers all three initial steps", anchors.length === 3, { anchors });
  if (anchors.length !== 3) throw new Error("Expected order lookup, currency-unit conversion and tax calculation in fresh preview");
  const anchoredCompose = await client.call("context_compose", { ...anchoredGoal, through: anchors, run: true, publish: "Anchored order tax" });
  const anchoredGoalId = anchoredCompose.published?.id ?? "goal:anchored-order-tax";
  evidence.anchoredLifecycle = { discovery: anchoredDiscovery, preview, anchors, published: anchoredCompose.published, goalId: anchoredGoalId };
  successful("anchored goal is published with independent witness", env.orderIds[10], anchoredCompose);
  check("anchored goal has stable published identity", !!anchoredCompose.published && anchoredGoalId === "goal:anchored-order-tax", anchoredCompose.published);
  await client.stop();
  client = new StdioClient("anchored-reuser-after-restart", anchoredStateFile, calls);
  await client.start();

  const anchoredCall = async (name: string, orderId: string) => {
    const beforeCalls = calls.length;
    const result = await client!.call("context_run", { id: anchoredGoalId, args: { order_id: orderId } });
    successful(name, orderId, result);
    check(`${name}: one caller invocation, no repair calls`, calls.length - beforeCalls === 1, { calls: calls.slice(beforeCalls) });
  };
  env.setTaxVersion(2);
  await anchoredCall("persisted anchored goal heals renamed REST in its first call", env.orderIds[11]);
  env.setTaxVersion(3);
  await anchoredCall("persisted anchored goal heals REST to MCP in its first call", env.orderIds[12]);

  const unknownAnchor = await client.call("context_compose", {
    ...goal,
    have: { order_id: env.orderIds[13] },
    through: ["missing:proof-required-anchor"],
    run: true,
    publish: "Must never publish unknown anchor",
  });
  check("unknown required anchor is refused rather than dropped", unknownAnchor.status !== "completed" && unknownAnchor.executed?.status !== "completed" && !unknownAnchor.published, unknownAnchor);
  await env.removeTax();
  const absentAnchor = await client.call("context_run", { id: anchoredGoalId, args: { order_id: env.orderIds[14] } });
  check("persisted required anchor disappearance fails closed", absentAnchor.status !== "completed" && absentAnchor.verification?.status !== "verified", absentAnchor);
  evidence.anchoredLifecycle.missingAnchor = { unknown: unknownAnchor, disappeared: absentAnchor };
  evidence.anchoredLifecycle.receipts = await client.call("context_run_status", { limit: 300 });
  evidence.anchoredLifecycle.graphEvents = await client.call("context_watch", { since: 0, waitMs: 0 });
  check("anchored lifecycle receipt chain remains intact", evidence.anchoredLifecycle.receipts.chain?.intact === true, evidence.anchoredLifecycle.receipts.chain);
  await client.stop();
  evidence.anchoredLifecycle.persistedState = JSON.parse(readFileSync(anchoredStateFile, "utf8"));
} catch (error) {
  evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  check("harness completed", false, evidence.error);
} finally {
  if (client) { await client.stop().catch(() => {}); if (client.stderr) evidence.serverStderr = client.stderr; }
  if (apiConsumer) { evidence.restConsumer = apiConsumer.requests; await apiConsumer.stop().catch(() => {}); }
  if (environment) { evidence.serviceEvents = environment.events; await environment.stop(); }
  const after = sourceManifest();
  evidence.sourceAfter = after;
  check("product source unchanged during proof", before.sha256 === after.sha256, { before: before.sha256, after: after.sha256 });
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = checks.filter((item) => item.passed).length;
  evidence.total = checks.length;
  evidence.verdict = checks.every((item) => item.passed) ? "PASS" : "FAIL";
  mkdirSync("proof/results", { recursive: true });
  writeFileSync("proof/results/latest.json", `${JSON.stringify(evidence, null, 2)}\n`);
  rmSync(directory, { recursive: true, force: true });
  console.log(`${evidence.verdict}: ${evidence.passed}/${evidence.total} checks; proof/results/latest.json`);
  if (evidence.verdict !== "PASS") process.exitCode = 1;
}
