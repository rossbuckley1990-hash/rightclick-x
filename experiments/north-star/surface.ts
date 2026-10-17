// The baseline arms' MCP server (EVALUATION-PLAN.md §5): the same authorised execution surface
// RightClick X has, without RightClick X.
//   run_program  - runs DS_PROGRAM (only that program) in the same host sandbox, argv only
//   save_skill / list_skills / read_skill - an Agent-Skills-style store in DS_SKILLS (arm C)
//   http_get     - GET on DS_ORIGIN only (Domain 2, arm A)
// Every call is appended to DS_LOG.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hostSandbox } from "../../src/core/sandbox.ts";

const PROGRAM = process.env.DS_PROGRAM;
const SKILLS = process.env.DS_SKILLS;
const ORIGIN = process.env.DS_ORIGIN;
const LOG = process.env.DS_LOG;
const sandbox = PROGRAM ? await hostSandbox() : null;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const tools: any[] = [];
if (PROGRAM)
  tools.push({
    name: "run_program",
    description: `Run the command-line program ${PROGRAM} on this machine (sandboxed: no network, files only in a temporary directory). Pass argv (no program name), optional stdin text, and optional files {name: content} created in the working directory before the run; refer to them by name in argv. Returns exit code, stdout and stderr.`,
    inputSchema: obj({ args: { type: "array", items: { type: "string" } }, stdin: { type: "string" }, files: { type: "object", additionalProperties: { type: "string" } } }),
    annotations: { readOnlyHint: true },
  });
if (SKILLS)
  tools.push(
    { name: "list_skills", description: "List the skills saved in your persistent skill store (kept across sessions).", inputSchema: obj({}), annotations: { readOnlyHint: true } },
    { name: "read_skill", description: "Read a saved skill (its SKILL.md content).", inputSchema: obj({ name: { type: "string" } }, ["name"]), annotations: { readOnlyHint: true } },
    { name: "save_skill", description: "Save or replace a skill: a short name and a SKILL.md-style text (when to use it, exactly how to run the program, how to check the result). Persists across sessions.", inputSchema: obj({ name: { type: "string" }, content: { type: "string" } }, ["name", "content"]) },
  );
if (ORIGIN)
  tools.push({
    name: "http_get",
    description: `HTTP GET on ${ORIGIN} (only that origin). Returns status and body (first 60 kB).`,
    inputSchema: obj({ url: { type: "string" } }, ["url"]),
    annotations: { readOnlyHint: true },
  });

const log = (e: unknown) => LOG && appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...(e as object) }) + "\n");
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const safeName = (n: string) => String(n).replace(/[^\w.-]/g, "_").slice(0, 80);

async function call(name: string, a: any): Promise<string> {
  if (name === "run_program" && PROGRAM) {
    if (!sandbox) return "unavailable: no sandbox";
    const r = await sandbox.run(PROGRAM, (a.args ?? []).map(String), { stdin: a.stdin ?? "", files: a.files ?? {} });
    log({ tool: name, args: a.args ?? [], stdinBytes: String(a.stdin ?? "").length, files: Object.keys(a.files ?? {}), exit: r.code });
    return JSON.stringify({ exit: r.code, stdout: r.stdout.slice(0, 60_000), stderr: r.stderr.slice(0, 4000), timedOut: r.timedOut });
  }
  if (name === "list_skills" && SKILLS) {
    mkdirSync(SKILLS, { recursive: true });
    log({ tool: name });
    return JSON.stringify(readdirSync(SKILLS).map((f) => f.replace(/\.md$/, "")));
  }
  if (name === "read_skill" && SKILLS) {
    const f = `${SKILLS}/${safeName(a.name)}.md`;
    log({ tool: name, name: a.name });
    return existsSync(f) ? readFileSync(f, "utf8") : "no such skill";
  }
  if (name === "save_skill" && SKILLS) {
    mkdirSync(SKILLS, { recursive: true });
    writeFileSync(`${SKILLS}/${safeName(a.name)}.md`, String(a.content ?? ""));
    log({ tool: name, name: a.name, bytes: String(a.content ?? "").length });
    return "saved";
  }
  if (name === "http_get" && ORIGIN) {
    let u: URL;
    try {
      u = new URL(String(a.url));
    } catch {
      return "invalid URL";
    }
    if (u.origin !== ORIGIN) return `refused: only ${ORIGIN} is allowed`;
    const res = await fetch(u, { redirect: "manual", headers: { "user-agent": "rightclick-x-benchmark/1 (+https://github.com/rossbuckley1990-hash/rightclick-x)" } });
    const body = await res.text();
    log({ tool: name, url: u.toString(), status: res.status });
    return JSON.stringify({ status: res.status, body: body.slice(0, 60_000) });
  }
  return `unknown tool ${name}`;
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "surface", version: "1" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
  else if (msg.method === "tools/call") {
    const text = await call(msg.params?.name, msg.params?.arguments ?? {}).catch((e) => `error: ${(e as Error).message}`);
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
  } else if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
}
