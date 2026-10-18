// Development transport for the unchanged North Star tasks/sandbox/scoring.
// ChatGPT subscription only. A current read-only allowance preflight is required by run-codex.ts.
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { subscriptionEnvironment, type Session } from "./common.ts";
import { quotaBlock } from "./quota.ts";
import ts from "typescript";

export function codexEvents(stdout: string) {
  return stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

export function codexSummary(events: any[]) {
  const completed = events.filter(e => e.type === "turn.completed");
  const validUsage = completed.length > 0 && completed.every(e => [e.usage?.input_tokens, e.usage?.output_tokens].every(n => Number.isSafeInteger(n) && n >= 0));
  // Codex input_tokens already includes cached_input_tokens; never add cached twice.
  const tokens = validUsage ? completed.reduce((sum, e) => sum + e.usage.input_tokens + e.usage.output_tokens, 0) : undefined;
  const messages = events.filter(e => e.type === "item.completed" && e.item?.type === "agent_message");
  return { reply: messages.at(-1)?.item.text ?? "", tokens, turns: completed.length || undefined,
    errors: events.filter(e => e.type === "error" || e.type === "turn.failed") };
}

export function inspectCodeMode(code: string, allowed: string): string[] {
  const source = ts.createSourceFile("trace.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const violations = new Set<string>();
  if ((source as any).parseDiagnostics.length) violations.add("unparseable Code Mode source");
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "Deno", "Bun"]);
  const permitted = (name: string) => name.startsWith(`${allowed}__`) || name.startsWith(`${allowed.replaceAll("-", "_")}__`);
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.ImportKeyword || ts.isImportDeclaration(node)) violations.add("general execution primitive: manual review required");
    if (ts.isIdentifier(node)) {
      if (forbidden.has(node.text)) violations.add("general execution primitive: manual review required");
      if (node.text === "tools") {
        const parent = node.parent;
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) violations.add("dynamic tool access: manual review required");
        else if (!permitted(parent.name.text)) violations.add("non-benchmark tool in Code Mode");
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "constructor" || ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "constructor") violations.add("general execution primitive: manual review required");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...violations];
}

function auditRollout(events: any[], directory: string, allowed: string) {
  const threadId = events.find(e => e.type === "thread.started")?.thread_id;
  if (typeof threadId !== "string" || !/^[a-f0-9-]+$/.test(threadId)) throw new Error("missing thread identity");
  const root = join(homedir(), ".codex", "sessions");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(`${threadId}.jsonl`));
  if (files.length !== 1) throw new Error("missing/ambiguous raw rollout");
  const all = codexEvents(readFileSync(join(root, files[0]), "utf8"));
  const toolRecords = all.filter(e => e.type === "response_item" && ["function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"].includes(e.payload?.type));
  writeFileSync(join(directory, "agent-tools.jsonl"), toolRecords.map(e => JSON.stringify(e)).join("\n") + "\n");
  const violations: string[] = [];
  const toolAllowed = (name: string) => name.startsWith(`${allowed}__`) || name.startsWith(`${allowed.replaceAll("-", "_")}__`);
  for (const e of toolRecords) {
    const c = e.payload;
    if (!["function_call", "custom_tool_call"].includes(c.type)) continue;
    if (toolAllowed(c.name)) continue;
    if (!["exec", "functions.exec"].includes(c.name)) { violations.push(`unexpected tool ${c.name}`); continue; }
    const code = c.input ?? c.arguments;
    if (typeof code !== "string") { violations.push("missing Code Mode source"); continue; }
    violations.push(...inspectCodeMode(code, allowed));
  }
  for (const e of events) {
    if (["command_execution", "file_change", "web_search", "collab_tool_call"].includes(e.item?.type)) violations.push(`unexpected ${e.item.type}`);
  }
  // This conservative trace check is not an independent execution boundary.
  const contexts = all.filter(e => e.type === "turn_context").map(e => ({ model: e.payload?.model, effort: e.payload?.effort, cwd: e.payload?.cwd, approvalPolicy: e.payload?.approval_policy, sandboxPolicy: e.payload?.sandbox_policy }));
  return { threadId, toolRecords: toolRecords.length, violations, contexts };
}

export async function codexSession(opts: { prompt: string; servers: Record<string, unknown>; allowed: string; model: string; timeoutMs?: number; evidenceDir: string }): Promise<Session> {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "ns-codex-agent-")));
  const args = ["exec", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--json", "--color", "never", "--sandbox", "read-only", "-c", 'approval_policy="never"',
    "-c", 'forced_login_method="chatgpt"', "-c", 'model_provider="openai"', "--model", opts.model, "-c", 'model_reasoning_effort="low"',
    "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0", "--enable", "skip_host_skill_discovery"];
  for (const feature of ["shell_tool", "apps", "plugins", "multi_agent", "multi_agent_v2", "browser_use", "computer_use", "image_generation", "remote_plugin", "hooks", "skill_search", "skill_mcp_dependency_install"])
    args.push("--disable", feature);
  for (const [name, server] of Object.entries(opts.servers)) {
    args.push("-c", `mcp_servers.${name}=${toml(server)}`);
  }
  args.push(opts.prompt);
  writeFileSync(join(opts.evidenceDir, "agent-invocation.json"), JSON.stringify({ command: "codex", args, cwd: work, timeoutMs: opts.timeoutMs ?? 600_000, environmentKeys: Object.keys(subscriptionEnvironment(process.env)).sort() }, null, 2));
  const started = performance.now();
  writeFileSync(join(opts.evidenceDir, "agent.stdout"), "", { flag: "wx" });
  writeFileSync(join(opts.evidenceDir, "agent.stderr"), "", { flag: "wx" });
  const child = spawn("codex", args, { cwd: work, env: subscriptionEnvironment(process.env), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false;
  child.stdout.on("data", data => { stdout += data; appendFileSync(join(opts.evidenceDir, "agent.stdout"), data); });
  child.stderr.on("data", data => { stderr += data; appendFileSync(join(opts.evidenceDir, "agent.stderr"), data); });
  const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch {} };
  let hard: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => { timedOut = true; kill(); hard = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} }, 3000); }, opts.timeoutMs ?? 600_000);
  child.on("error", error => stderr += String(error));
  const exit = await new Promise<number | null>(done => child.once("close", done));
  clearTimeout(timer); if (hard) clearTimeout(hard);
  // CLI closes its MCP children normally; terminate leftovers before observations are scored.
  kill();
  await new Promise(done => setTimeout(done, 300));
  writeFileSync(join(opts.evidenceDir, "agent.stdout"), stdout);
  writeFileSync(join(opts.evidenceDir, "agent.stderr"), stderr);
  writeFileSync(join(opts.evidenceDir, "agent-exit.json"), JSON.stringify({ code: exit, timedOut }));
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  let parsed;
  try {
    const events = codexEvents(stdout);
    parsed = codexSummary(events);
    const audit = auditRollout(events, opts.evidenceDir, opts.allowed);
    writeFileSync(join(opts.evidenceDir, "agent-audit.json"), JSON.stringify(audit, null, 2));
    if (audit.violations.length || parsed.errors.length || exit !== 0 || timedOut) throw new Error(`session not valid: ${JSON.stringify({ audit: audit.violations, errors: parsed.errors, exit, timedOut })}`);
    return { ...parsed, exit, timedOut, seconds, evidenceDir: opts.evidenceDir };
  } catch (error) {
    const reason = String(error);
    writeFileSync(join(opts.evidenceDir, "agent-invalid.json"), JSON.stringify({ reason }));
    const blocked = quotaBlock(stdout + stderr) ?? `Codex evaluation transport or trace failure: ${reason}`;
    return { reply: parsed?.reply ?? "", tokens: parsed?.tokens, exit, timedOut, seconds, evidenceDir: opts.evidenceDir, blocked };
  }
}

// Encode only the controlled MCP server configuration, never process.env.
export function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}=${toml(v)}`).join(",")}}`;
  if (["string", "boolean", "number"].includes(typeof value)) return JSON.stringify(value);
  throw new Error("unsupported MCP configuration value");
}
