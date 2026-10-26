// Experimental stdio MCP proxy: `rcx mcp` with one startup-guidance variant.
//   node experiments/tool-loading/proxy.ts <original|reuse>
// The server runs unchanged, with this process's environment. Every message passes through
// untouched except an initialize result, whose instructions are the variant's: the tool list,
// tool calls and errors are the server's own. RCX_PROFILE_LOG, when set, records the variant and
// digests of the server's and the served instructions and of the tool list, so a harness can
// check each session.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyGuidance, GUIDANCE_NAMES, type GuidanceName } from "./guidance.ts";

export const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/** Rewrites server output lines; only results of initialize requests the client sent are changed. */
export function transformer(guidance: GuidanceName, record: (e: Record<string, unknown>) => void = () => {}) {
  const inits = new Set<string>(), lists = new Set<string>();
  return {
    request(line: string) {
      try {
        const m = JSON.parse(line);
        for (const r of Array.isArray(m) ? m : [m]) {
          if (r?.id == null) continue;
          if (r.method === "initialize") inits.add(JSON.stringify(r.id));
          if (r.method === "tools/list") lists.add(JSON.stringify(r.id));
        }
      } catch { /* the server answers malformed input itself */ }
    },
    response(line: string): string {
      let m: any;
      try { m = JSON.parse(line); } catch { return line; }
      if (m?.id == null) return line;
      const id = JSON.stringify(m.id);
      if (lists.delete(id) && Array.isArray(m.result?.tools)) record({ event: "tools/list", guidance, tools: digest(m.result.tools) });
      if (inits.delete(id) && typeof m.result?.instructions === "string") {
        const server = m.result.instructions;
        m.result.instructions = applyGuidance(server, guidance);
        record({ event: "initialize", guidance, server: digest(server), served: digest(m.result.instructions), chars: m.result.instructions.length });
        return JSON.stringify(m);
      }
      return line;
    },
  };
}

function lines(stream: NodeJS.ReadableStream, each: (line: string) => void, end: (rest: string) => void) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) { each(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  stream.on("end", () => end(buf));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const guidance = process.argv[2] as GuidanceName;
  if (!GUIDANCE_NAMES.includes(guidance)) { console.error(`usage: proxy.ts <${GUIDANCE_NAMES.join("|")}>`); process.exit(2); }
  const log = process.env.RCX_PROFILE_LOG;
  const t = transformer(guidance, (e) => { if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n"); });
  const server = spawn(process.execPath, [fileURLToPath(new URL("../../bin/rcx.ts", import.meta.url)), "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  lines(process.stdin, (l) => { t.request(l); server.stdin!.write(l + "\n"); }, (rest) => { if (rest) server.stdin!.write(rest); server.stdin!.end(); });
  lines(server.stdout!, (l) => process.stdout.write(t.response(l) + "\n"), (rest) => { if (rest) process.stdout.write(rest); });
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => server.kill(s));
  // After the server's output has closed, exit once everything forwarded has been written.
  server.on("close", (code, signal) => process.stdout.write("", () => process.exit(code ?? (signal ? 1 : 0))));
}
