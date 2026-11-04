// Minimal MCP stdio client. Spawns the product's own server exactly as an AI client would,
// so every measurement includes the real disclosure and interaction cost.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface McpClient {
  tools: string[];
  callTool(name: string, args: Record<string, unknown>): Promise<any>;
  close(): void;
  /** Every request/response pair, for interaction-cost accounting. */
  transcript: Array<{ method: string; sentChars: number; receivedChars: number; ms: number }>;
}

export async function connect(opts: {
  repo: string;
  state: string;
  investigate?: string;
  execute?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<McpClient> {
  const child: ChildProcess = spawn("node", ["bin/rcx.ts", "mcp"], {
    cwd: opts.repo,
    env: {
      ...process.env,
      RCX_STATE_FILE: opts.state,
      ...(opts.investigate ? { RCX_INVESTIGATE: opts.investigate } : {}),
      ...(opts.execute ? { RCX_EXECUTE: opts.execute } : {}),
      ...opts.env,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = createInterface({ input: child.stdout! });
  let nextId = 1;
  const pending = new Map<number, (m: any) => void>();
  const transcript: McpClient["transcript"] = [];

  rl.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: any;
    try { msg = JSON.parse(t); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });

  const timeoutMs = opts.timeoutMs ?? 600_000;
  const rpc = (method: string, params: unknown) => new Promise<any>((res, rej) => {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const t0 = performance.now();
    pending.set(id, (m) => {
      transcript.push({ method, sentChars: body.length, receivedChars: JSON.stringify(m.result ?? m.error ?? {}).length, ms: Math.round(performance.now() - t0) });
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    });
    child.stdin!.write(body + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout after ${timeoutMs}ms: ${method}`)); } }, timeoutMs);
  });

  const callTool = async (name: string, args: Record<string, unknown>) => {
    let r: any;
    try { r = await rpc("tools/call", { name, arguments: args }); }
    catch (e: any) { return { threw: String(e?.message ?? e).slice(0, 600) }; }
    const text = (r.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    try { return JSON.parse(text); } catch { return { raw: text, isError: !!r.isError }; }
  };

  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "north-star-acquisition", version: "1.0" } });
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listed = await rpc("tools/list", {});

  return {
    tools: (listed.tools || []).map((t: any) => t.name),
    callTool,
    transcript,
    // The readline interface holds the event loop open after the child is killed, so a finished
    // harness would otherwise hang instead of exiting.
    close: () => { rl.close(); child.stdin!.end(); child.kill(); child.unref(); },
  };
}
