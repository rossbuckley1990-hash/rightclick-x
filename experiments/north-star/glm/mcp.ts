// A minimal MCP stdio client for the development evaluation harness: spawn a server,
// initialize, list tools, call tools. Line-delimited JSON-RPC, exactly what the
// production surface.ts and `rcx mcp` speak.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpServer {
  private proc: ChildProcess;
  instructions = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = "";
  readonly logFile: string;

  constructor(command: string, args: string[], env: Record<string, string>, label: string) {
    const dir = mkdtempSync(join(tmpdir(), `rcx-mcp-${label}-`));
    this.logFile = join(dir, "mcp-io.log");
    this.proc = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout!.on("data", (d) => this.onStdout(d));
    this.proc.stderr!.on("data", (d) => writeFileSync(this.logFile, `[stderr] ${d}`, { flag: "a" }));
    this.proc.on("exit", (code) => {
      writeFileSync(this.logFile, `[exit ${code}]\n`, { flag: "a" });
      for (const p of this.pending.values()) p.reject(new Error(`mcp server exited (${code})`));
    });
  }

  private onStdout(chunk: Buffer) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (!line.trim()) continue;
      writeFileSync(this.logFile, `<= ${line}\n`, { flag: "a" });
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(String(msg.error.message ?? msg.error)));
          else p.resolve(msg.result);
        }
      } catch { /* not for us */ }
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      writeFileSync(this.logFile, `=> ${line}\n`, { flag: "a" });
      this.proc.stdin!.write(line + "\n");
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`mcp request timed out: ${method}`));
        }
      }, 120_000);
    });
  }

  async initialize(): Promise<void> {
    const out = await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rcx-dev-eval", version: "1" } });
    // Production hosts (Claude Code, Cursor) surface these instructions to the agent;
    // for arm D this carries the retained-capability announcement. Same for every session.
    if (typeof out?.instructions === "string") this.instructions = out.instructions;
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  async tools(): Promise<McpTool[]> {
    const out = await this.request("tools/list", {});
    return out.tools.map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const out = await this.request("tools/call", { name, arguments: args });
    // MCP content shape: [{type:"text", text}]. Errors arrive as isError content, not throws.
    const text = (out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return out?.isError ? `TOOL ERROR: ${text}` : text;
  }

  close(): void {
    this.proc.kill("SIGTERM");
  }
}
