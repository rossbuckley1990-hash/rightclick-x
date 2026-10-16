// Runs a real AI client (Claude Code or Codex) whose only tools are RightClick X's
// context_* MCP tools. Setup and verification happen elsewhere (the experiment
// scripts), never inside the agent's session.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export type Client = "claude" | "codex";

export type McpTarget =
  | { kind: "stdio"; stateFile: string; logFile: string }
  | { kind: "http"; url: string; token: string };

export interface AgentRun {
  client: Client;
  output: string;
  answer?: string;
  seconds: number;
  exit: number | null;
}

function run(cmd: string, argv: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((done) => {
    const p = spawn(cmd, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, code });
    });
  });
}

const RCX = resolve("bin/rcx.ts");

export async function runAgent(client: Client, target: McpTarget, prompt: string, timeoutMs = 900_000, model?: string): Promise<AgentRun> {
  const dir = mkdtempSync(`${tmpdir()}/rcx-agent-${client}-`);
  const t0 = performance.now();
  let output = "";
  let exit: number | null = null;
  if (client === "claude") {
    const server =
      target.kind === "stdio"
        ? { command: process.execPath, args: [RCX, "mcp"], env: { RCX_STATE_FILE: target.stateFile, RCX_MCP_LOG: target.logFile, RCX_WORKSPACE: dir } }
        : { type: "http", url: `${target.url}/mcp`, headers: { Authorization: `Bearer ${target.token}` } };
    writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: { "rightclick-x": server } }));
    const r = await run(
      "claude",
      ["-p", prompt, ...(model ? ["--model", model] : []), "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit", "--output-format", "json", "--max-turns", "40"],
      dir,
      timeoutMs,
    );
    exit = r.code;
    try {
      output = JSON.parse(r.stdout).result ?? "";
    } catch {
      output = (r.stdout + r.stderr).slice(-3000);
    }
  } else {
    const cfg =
      target.kind === "stdio"
        ? [
            "-c", `mcp_servers.rightclick-x.command=${JSON.stringify(process.execPath)}`,
            "-c", `mcp_servers.rightclick-x.args=${JSON.stringify([RCX, "mcp"])}`,
            "-c", `mcp_servers.rightclick-x.env={RCX_STATE_FILE=${JSON.stringify(target.stateFile)},RCX_MCP_LOG=${JSON.stringify(target.logFile)},RCX_WORKSPACE=${JSON.stringify(dir)}}`,
          ]
        : [
            "-c", `mcp_servers.rightclick-x.url=${JSON.stringify(`${target.url}/mcp`)}`,
            "-c", `mcp_servers.rightclick-x.http_headers={Authorization=${JSON.stringify(`Bearer ${target.token}`)}}`,
          ];
    // Codex's own automatic reviewer handles approval requests; shell commands are sandboxed in a temp dir.
    const r = await run("codex", ["exec", "--skip-git-repo-check", "--approve-for-me", ...(model ? ["-m", model] : []), ...cfg, "--output-last-message", `${dir}/last.txt`, prompt], dir, timeoutMs);
    exit = r.code;
    try {
      output = readFileSync(`${dir}/last.txt`, "utf8");
    } catch {
      output = (r.stdout + r.stderr).slice(-3000);
    }
  }
  const answer = /ANSWER:\s*([^\n]+)/i.exec(output)?.[1]?.trim().replace(/[`*]/g, "");
  return { client, output, answer, seconds: Math.round((performance.now() - t0) / 100) / 10, exit };
}

export function readJsonl(file: string): any[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
