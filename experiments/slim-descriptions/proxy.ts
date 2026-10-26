// Experimental stdio MCP proxy: `rcx mcp` with one description profile's tool descriptions.
//   node experiments/slim-descriptions/proxy.ts <original|compact-top|compact-full>
// The server runs unchanged, with this process's environment. Every message passes through
// untouched except a tools/list result, whose descriptions are replaced: initialize (and so the
// startup instructions), tool calls and errors are the server's own. RCX_PROFILE_LOG, when set,
// records the served profile and digests of what was served, so a harness can check each session.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyProfile, PROFILE_NAMES, type ProfileName } from "./profiles.ts";

export const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/** Rewrites server output lines; only results of tools/list requests the client sent are changed. */
export function transformer(profile: ProfileName, record: (e: Record<string, unknown>) => void = () => {}) {
  const lists = new Set<string>();
  return {
    request(line: string) {
      try {
        const m = JSON.parse(line);
        for (const r of Array.isArray(m) ? m : [m]) if (r?.method === "tools/list" && r.id != null) lists.add(JSON.stringify(r.id));
      } catch { /* the server answers malformed input itself */ }
    },
    response(line: string): string {
      let m: any;
      try { m = JSON.parse(line); } catch { return line; }
      if (m?.id != null && lists.delete(JSON.stringify(m.id)) && Array.isArray(m.result?.tools)) {
        m.result.tools = applyProfile(m.result.tools, profile);
        record({ event: "tools/list", profile, tools: digest(m.result.tools), bytes: JSON.stringify(m.result).length });
        return JSON.stringify(m);
      }
      if (typeof m?.result?.instructions === "string") record({ event: "initialize", profile, instructions: digest(m.result.instructions) });
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
  const profile = process.argv[2] as ProfileName;
  if (!PROFILE_NAMES.includes(profile)) { console.error(`usage: proxy.ts <${PROFILE_NAMES.join("|")}>`); process.exit(2); }
  const log = process.env.RCX_PROFILE_LOG;
  const t = transformer(profile, (e) => { if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n"); });
  const server = spawn(process.execPath, [fileURLToPath(new URL("../../bin/rcx.ts", import.meta.url)), "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  lines(process.stdin, (l) => { t.request(l); server.stdin!.write(l + "\n"); }, (rest) => { if (rest) server.stdin!.write(rest); server.stdin!.end(); });
  lines(server.stdout!, (l) => process.stdout.write(t.response(l) + "\n"), (rest) => { if (rest) process.stdout.write(rest); });
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => server.kill(s));
  // After the server's output has closed, exit once everything forwarded has been written.
  server.on("close", (code, signal) => process.stdout.write("", () => process.exit(code ?? (signal ? 1 : 0))));
}
