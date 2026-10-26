// A minimal MCP stdio client: the operator's scripted setup and tests.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RCX = fileURLToPath(new URL("../../bin/rcx.ts", import.meta.url));
export const PROXY = fileURLToPath(new URL("./proxy.ts", import.meta.url));

/** Starts `rcx mcp` directly, or through the guidance proxy when a variant is given. */
export async function mcpClient(env: Record<string, string>, guidance?: string) {
  const args = guidance ? [PROXY, guidance] : [RCX, "mcp"];
  const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", n = 1;
  const waiting = new Map<number, (m: any) => void>();
  const raw: string[] = [];
  p.stdout!.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { raw.push(line); const m = JSON.parse(line); waiting.get(m.id)?.(m); }
    }
  });
  const req = (method: string, params: unknown = {}) => new Promise<any>((done) => {
    const id = n++; waiting.set(id, done); p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const init = await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "operator", version: "1" } });
  return {
    init, req, raw,
    /** A tool call's parsed result; a refusal or error comes back as {error}. */
    tool: async (name: string, args: unknown) => {
      const r = (await req("tools/call", { name, arguments: args })).result;
      return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
    },
    close: () => new Promise((done) => { p.on("close", done); p.stdin!.end(); }),
  };
}
