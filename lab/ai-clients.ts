// "Any compatible AI": real AI agents from different vendors, each given only
// RightClick X as its MCP server, a freshly generated lab environment's root
// addresses, and the objective in plain language. Answers are checked against
// the harness's own data; each agent's RightClick X receipts show which
// services it actually reached through RightClick X.
//   node lab/ai-clients.ts [seed] [--domain logistics] [--clients claude,codex] [--gateway]
// --gateway: the agents are told only the environment's gateway address, which
// publishes an RFC 9727 /.well-known/api-catalog of the running services.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generate, LabService, type Dataset } from "./environment.ts";
import { serve } from "../src/entry/node-host.ts";

const args = process.argv.slice(2);
const domainName = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "logistics";
const clients = (args.includes("--clients") ? args[args.indexOf("--clients") + 1] : "claude,codex").split(",");
const gatewayMode = args.includes("--gateway");
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? Math.floor(Math.random() * 1e9));
const log = (...a: unknown[]) => console.log(...a);
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const env = generate(seed, domainName);
const truth: Dataset = structuredClone(env.data);
const services = env.services.map((s) => new LabService(s, env.data));
for (const s of services) await s.start();
const brands = services.map((s) => s.spec.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
log(`build ${head.slice(0, 10)} · domain ${domainName} · seed ${seed}`);
for (const s of services) log(`  ${s.spec.brand.padEnd(17)} ${s.spec.protocol.padEnd(8)} ${s.url}`);
const gateway = gatewayMode
  ? await serve(async (req) => {
      const u = new URL(req.url);
      if (u.pathname !== "/.well-known/api-catalog") return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ linkset: [{ anchor: `${u.origin}/.well-known/api-catalog`, item: services.map((s) => ({ href: s.url })) }] }), { headers: { "content-type": "application/linkset+json" } });
    }, 0)
  : null;
if (gateway) log(`  gateway (RFC 9727 api-catalog) ${gateway.url}/ — the only address the agents are given`);

const rcx = resolve("bin/rcx.ts");

/** Run a client asynchronously: the lab services live in this process and must keep serving. */
function run(cmd: string, argv: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill(), 600_000);
    p.on("close", () => {
      clearTimeout(timer);
      done({ stdout, stderr });
    });
  });
}
const results: any[] = [];

for (const [i, client] of clients.entries()) {
  const start = env.starts[i % env.starts.length];
  const expected = env.expected(start, truth);
  const dir = mkdtempSync(`${tmpdir()}/rcx-ai-${client}-`);
  const state = `${dir}/state.json`;
  const prompt = [
    "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
    gateway
      ? `This environment's gateway is at ${gateway.url}/ . You have not been told which services exist, where they are, what they are or which protocols they use.`
      : `Some software services are running at these addresses: ${services.map((s) => s.url).join(", ")}.`,
    ...(gateway ? [] : ["You have not been told what they are or which protocols they use."]),
    `Objective: ${env.domain.objective}`,
    `The ${env.domain.have.replace(/_/g, " ")} is ${start}.`,
    "Use the rightclick-x tools to discover what the services can do and accomplish the objective.",
    "End your reply with a final line of the form: ANSWER: <value>",
  ].join("\n");

  const t0 = performance.now();
  let out = "";
  if (client === "claude") {
    writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: { "rightclick-x": { command: process.execPath, args: [rcx, "mcp"], env: { RCX_STATE_FILE: state, RCX_WORKSPACE: dir } } } }));
    const r = await run(
      "claude",
      ["-p", prompt, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit", "--output-format", "json", "--max-turns", "30"],
      dir,
    );
    try {
      out = JSON.parse(r.stdout).result ?? "";
    } catch {
      out = r.stdout + r.stderr;
    }
  } else if (client === "codex") {
    const r = await run(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        // Codex's own automatic reviewer handles approval requests (its review stays on);
        // shell commands run in its workspace-write sandbox, confined to a temp dir.
        "--approve-for-me",
        "-c",
        `mcp_servers.rightclick-x.command=${JSON.stringify(process.execPath)}`,
        "-c",
        `mcp_servers.rightclick-x.args=${JSON.stringify([rcx, "mcp"])}`,
        "-c",
        `mcp_servers.rightclick-x.env={RCX_STATE_FILE=${JSON.stringify(state)},RCX_WORKSPACE=${JSON.stringify(dir)}}`,
        "--output-last-message",
        `${dir}/last.txt`,
        prompt,
      ],
      dir,
    );
    try {
      out = readFileSync(`${dir}/last.txt`, "utf8");
    } catch {
      out = (r.stdout + r.stderr).slice(-2000);
    }
  }
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const answer = /ANSWER:\s*([^\n]+)/i.exec(out)?.[1]?.trim().replace(/[`*]/g, "");
  // Agents may append a unit ("20%", "3.2 EUR"); score the leading number, and keep the strict verdict too.
  const correctStrict = answer !== undefined && String(Number(answer)) === String(expected);
  const leading = answer?.match(/-?\d+(?:\.\d+)?/)?.[0];
  const correct = leading !== undefined && String(Number(leading)) === String(expected);

  // Evidence from RightClick X's own receipts for this client.
  let receipts: any[] = [];
  try {
    receipts = JSON.parse(readFileSync(state, "utf8")).receipts ?? [];
  } catch {
    /* no state written */
  }
  const providers = [...new Set(receipts.map((r: any) => r.provider))];
  const reachedAll = brands.every((b) => providers.some((p) => p.includes(b))) || providers.some((p) => p.startsWith("composite"));
  results.push({ client, prompt, start, expected, answer, correct, correctStrict, seconds, receipts: receipts.length, providers, reachedAll, tail: out.slice(-400) });
  log(`\n${correct ? "✓" : "✗"} ${client}: answered ${answer ?? "(none)"} · expected ${expected} · ${seconds}s`);
  log(`   RightClick X receipts: ${receipts.length}, providers reached through it: ${providers.join(", ") || "(none)"}`);
}

for (const s of services) await s.stop();
await gateway?.close();
mkdirSync("lab/results", { recursive: true });
writeFileSync(`lab/results/ai-clients-${domainName}${gatewayMode ? "-gateway" : ""}-${seed}.json`, JSON.stringify({ at: new Date().toISOString(), build: head, domain: domainName, seed, gateway: gatewayMode, results }, null, 2));
writeFileSync(`lab/results/ai-clients-latest${gatewayMode ? "-gateway" : ""}.json`, JSON.stringify({ at: new Date().toISOString(), build: head, domain: domainName, seed, gateway: gatewayMode, results }, null, 2));
process.exit(results.every((r) => r.correct && r.receipts > 0) ? 0 : 1);
