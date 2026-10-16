// Shared harness pieces for the life-science experiment: the frozen build,
// a minimal MCP stdio client (the harness talks to RightClick X only through
// its MCP tools), and file helpers.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const HERE = resolve(import.meta.dirname);
export const PRELOAD = resolve(HERE, "polite-fetch.ts");
export const WORK = resolve(process.env.RCX_LIFESCI_WORK ?? `${tmpdir()}/rcx-lifesci`);
export const TAG = process.env.RCX_FREEZE ?? "lifesci-freeze-1";
export const TRUTH_UA = "rightclick-x-lifescience-truth/0.1 (independent verification; read-only; 1 req/s per host)";

/** Export the frozen tag (git archive) once; every run uses this copy, never the working tree. */
export function frozenBuild(tag = TAG): { dir: string; rcx: string; commit: string } {
  const commit = execFileSync("git", ["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim();
  const dir = `${WORK}/build-${tag}`;
  if (!existsSync(`${dir}/bin/rcx.ts`)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${tag} | tar -x -C ${JSON.stringify(dir)}`]);
  }
  return { dir, rcx: `${dir}/bin/rcx.ts`, commit };
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function readJsonl(file: string): any[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** All response bodies the RightClick X process received, concatenated (for grounding). */
export function bodies(dir: string): string {
  try {
    return readdirSync(dir).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n\u0000\n");
  } catch {
    return "";
  }
}

export interface ServerFiles {
  state: string;
  mcpLog: string;
  netlog: string;
  bodyDir: string;
  workspace: string;
}

export function serverFiles(dir: string): ServerFiles {
  mkdirSync(dir, { recursive: true });
  return { state: `${dir}/state.json`, mcpLog: `${dir}/mcp-calls.jsonl`, netlog: `${dir}/net.jsonl`, bodyDir: `${dir}/bodies`, workspace: dir };
}

/** How an MCP client launches the frozen RightClick X with the polite preload. */
export function serverCommand(rcx: string, f: ServerFiles): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: ["--import", PRELOAD, rcx, "mcp"],
    env: { RCX_STATE_FILE: f.state, RCX_MCP_LOG: f.mcpLog, RCX_NETLOG: f.netlog, RCX_BODYDIR: f.bodyDir, RCX_WORKSPACE: f.workspace, RCX_NETLOG_TAG: "rcx" },
  };
}

/** Minimal MCP client over stdio (newline-delimited JSON-RPC). */
export class Mcp {
  private p: ChildProcess;
  private buf = "";
  private next = 1;
  private waiting = new Map<number, (m: any) => void>();
  stderr = "";

  constructor(rcx: string, f: ServerFiles) {
    const s = serverCommand(rcx, f);
    this.p = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "pipe"] });
    this.p.stdout!.setEncoding("utf8");
    this.p.stdout!.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        this.waiting.get(m.id)?.(m);
        this.waiting.delete(m.id);
      }
    });
    this.p.stderr!.on("data", (d) => (this.stderr += d));
  }

  request(method: string, params: unknown = {}): Promise<any> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, done);
      this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async init(): Promise<any> {
    const r = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lifesci-harness", version: "0.1" } });
    this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return r.result;
  }

  /** Call a context_* tool; returns { ok, ms, value } where value is the parsed JSON (or error text). */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; ms: number; value: any }> {
    const t0 = performance.now();
    const r = await this.request("tools/call", { name, arguments: args });
    const ms = Math.round(performance.now() - t0);
    const text = r.result?.content?.[0]?.text ?? r.error?.message ?? "";
    if (r.error || r.result?.isError) return { ok: false, ms, value: text };
    try {
      return { ok: true, ms, value: JSON.parse(text) };
    } catch {
      return { ok: true, ms, value: text };
    }
  }

  close(): Promise<void> {
    return new Promise((done) => {
      this.p.on("close", () => done());
      this.p.stdin!.end();
    });
  }
}
