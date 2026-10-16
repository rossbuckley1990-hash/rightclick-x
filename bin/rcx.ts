#!/usr/bin/env node
// rcx — the RightClick X command line. Runs on Node >= 22.18 (native
// TypeScript), Bun, or as a single compiled binary (`npm run build:bin`).

import { createHandler } from "../src/interface/http.ts";
import { dispatch } from "../src/interface/tools.ts";
import { FileStore, serve, serveStdio } from "../src/entry/node-host.ts";
import { Authority } from "../src/reflectors/net.ts";
import { RightClick, VERSION } from "../src/runtime.ts";

const proc = (globalThis as any).process;
const argv: string[] = proc.argv.slice(2);
const env: Record<string, string | undefined> = proc.env;

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : "true";
}

function kv(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of args) {
    const i = a.indexOf("=");
    if (i > 0) out[a.slice(0, i)] = a.slice(i + 1);
  }
  return out;
}

const HELP = `RightClick X ${VERSION} — a live capability graph that composes itself

  rcx demo [--online]               seven-act demo across OpenAPI, GraphQL, MCP, web, federation
  rcx serve [--port 8787] [--host 127.0.0.1] [--demo]
                                    HTTP API + MCP (/mcp) + live dashboard (/)
  rcx mcp                           MCP over stdio (for Claude Code, Cursor, Codex, ...)
  rcx connect [client]              print the exact MCP config for: claude-code, claude-desktop,
                                    cursor, vscode, codex, windsurf, remote (any HTTP MCP client)

  rcx research [topic] [--learn N]  survey the environment and public directories
  rcx learn <url...> [--deep]       reflect any spec / endpoint / MCP server / page / peer
  rcx forget <provider>
  rcx inspect <value>               semantic type of a value
  rcx actions <value>               what can be done with it, directly and through pipelines
  rcx explain <capability-id>
  rcx run <capability-id> [k=v ...] [--verify '<json predicates>']
  rcx compose k=v ... --want <type> [--intent "..."] [--run]
  rcx graph [stats|types|search|neighbors|paths|edges] [--query q] [--id id] [--from t] [--to t]
  rcx providers | runtime | status [runId] | watch

State: ${env.RCX_STATE_FILE ?? "~/.rightclick-x/state.json"} (RCX_STATE_FILE). Credentials: RCX_AUTH='{"https://api.x.com":"Bearer …"}'.`;

async function main() {
  const cmd = argv.shift() ?? "help";
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  if (cmd === "version" || cmd === "--version") return console.log(VERSION);

  if (cmd === "connect") return console.log(await connectInstructions(argv[0]));

  if (cmd === "demo") {
    const { runDemo } = await import("../demo/run.ts");
    return runDemo({ online: !!flag("online") });
  }

  const auth = new Authority();
  auth.loadEnv(env.RCX_AUTH);
  const home = env.HOME ?? env.USERPROFILE ?? ".";
  const stateFile = env.RCX_STATE_FILE ?? `${home}/.rightclick-x/state.json`;
  const demoMode = cmd === "serve" && !!flag("demo");
  const rc = await RightClick.create({
    name: env.RCX_NAME ?? "rightclick-x",
    region: env.RCX_REGION,
    auth,
    workspace: env.RCX_WORKSPACE ?? proc.cwd(),
    store: demoMode ? undefined : new FileStore(stateFile),
  });

  if (env.RCX_MCP_LOG) {
    const { appendFileSync } = await import("node:fs");
    const file = env.RCX_MCP_LOG;
    rc.toolCallSink = (e) => appendFileSync(file, JSON.stringify(e) + "\n");
  }
  if (cmd === "mcp") return serveStdio(rc);

  if (cmd === "serve") {
    const port = Number(flag("port") ?? env.PORT ?? 8787);
    const host = flag("host") ?? "127.0.0.1";
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
    let token = flag("token") ?? env.RCX_TOKEN;
    if (!token && !loopback) {
      token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
      console.log(`Generated access token (set RCX_TOKEN to choose your own): ${token}`);
    }
    // Exposed beyond loopback: "learn any URL" must never reach private networks or cloud metadata.
    if (!loopback) rc.net.policy = { blockPrivate: true, ...(rc.net.policy ?? {}) };
    const s = await serve(createHandler(rc, { token, open: loopback }), port, host);
    if (!loopback) console.log("Network policy: private, loopback and cloud-metadata addresses are blocked for outbound requests.");
    console.log(`RightClick X ${VERSION} on ${s.url}\n  dashboard  ${s.url}/\n  MCP        ${s.url}/mcp\n  API        ${s.url}/api/<tool>`);
    if (demoMode) {
      const { startStage } = await import("../demo/stage.ts");
      const stage = await startStage();
      console.log("Demo services up. Learning them one by one; watch the dashboard grow.");
      const steps: Array<[string, () => Promise<unknown>]> = [
        ["Polyglot (OpenAPI)", () => rc.learn({ source: stage.polyglot })],
        ["Atlas (GraphQL)", () => rc.learn({ source: stage.atlas })],
        ["Skycast (MCP)", () => rc.learn({ source: stage.skycast })],
        ["Newsroom (web)", () => rc.learn({ source: stage.newsroom })],
        ["compose: Lisbon weather in Spanish", () => rc.compose({ have: { place: "Lisbon", language: "es" }, want: "text", intent: "weather translated", run: true })],
      ];
      for (const [label, step] of steps) {
        await new Promise((r) => setTimeout(r, 2500));
        await step();
        console.log(`  ✓ ${label}`);
      }
    }
    return new Promise(() => {});
  }

  const rest = argv;
  let out: unknown;
  switch (cmd) {
    case "research":
      out = await dispatch(rc, "context_research", { topic: rest[0], learn: Number(flag("learn") ?? 0) || undefined });
      break;
    case "learn":
      out = await dispatch(rc, "context_learn", { deep: !!flag("deep"), sources: rest });
      break;
    case "forget":
      out = await dispatch(rc, "context_forget", { provider: rest[0] });
      break;
    case "inspect":
      out = await dispatch(rc, "context_inspect", { value: rest.join(" ") });
      break;
    case "actions":
      out = await dispatch(rc, "context_actions", { value: rest.join(" ") });
      break;
    case "explain":
      out = await dispatch(rc, "context_explain", { id: rest[0] });
      break;
    case "run": {
      const verify = flag("verify");
      out = await dispatch(rc, "context_run", { id: rest[0], args: kv(rest.slice(1)), verify: verify ? JSON.parse(verify) : undefined });
      break;
    }
    case "compose": {
      const want = flag("want") ?? "text";
      const intent = flag("intent");
      const run = !!flag("run");
      out = await dispatch(rc, "context_compose", { have: kv(rest), want, intent, run });
      break;
    }
    case "graph": {
      const q = { op: rest[0] ?? "stats", query: flag("query"), id: flag("id"), from: flag("from"), to: flag("to") };
      out = await dispatch(rc, "context_graph", q);
      break;
    }
    case "providers":
      out = await dispatch(rc, "context_providers", {});
      break;
    case "runtime":
      out = await dispatch(rc, "context_runtime", {});
      break;
    case "status":
      out = await dispatch(rc, "context_run_status", { runId: rest[0] });
      break;
    case "watch": {
      let since = rc.graph.cursor;
      for (;;) {
        const w = await rc.watch({ since, waitMs: 30_000 });
        for (const e of w.events) console.log(JSON.stringify(e));
        since = w.cursor;
      }
    }
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      proc.exitCode = 2;
      return;
  }
  console.log(JSON.stringify(out, null, 2));
  await rc.flush();
}

async function connectInstructions(client?: string): Promise<string> {
  const { existsSync } = await import("node:fs");
  const { resolve, delimiter, join } = await import("node:path");
  const script: string = resolve(proc.argv[1]);
  // Prefer the stable PATH entry (e.g. /opt/homebrew/bin/node) over a versioned install path.
  const onPath = String(env.PATH ?? "").split(delimiter).map((d) => join(d, "node")).find((p) => existsSync(p));
  const node: string = onPath ?? proc.execPath;
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  const std = { command: node, args: [script, "mcp"] };
  const blocks: Record<string, string> = {
    "claude-code": `# Claude Code\nclaude mcp add rightclick-x --scope user -- ${node} ${script} mcp`,
    "claude-desktop": `# Claude Desktop: add to claude_desktop_config.json\n${json({ mcpServers: { "rightclick-x": std } })}`,
    cursor: `# Cursor: add to ~/.cursor/mcp.json\n${json({ mcpServers: { "rightclick-x": std } })}`,
    vscode: `# VS Code: add to .vscode/mcp.json\n${json({ servers: { "rightclick-x": { type: "stdio", ...std } } })}`,
    codex: `# Codex: add to ~/.codex/config.toml\n[mcp_servers.rightclick-x]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify([script, "mcp"])}`,
    windsurf: `# Windsurf: add to ~/.codeium/windsurf/mcp_config.json\n${json({ mcpServers: { "rightclick-x": std } })}`,
    remote: `# Any Streamable-HTTP MCP client (deployed instance or \`rcx serve\`)\nURL:    https://<your-deployment>/mcp   (local: http://127.0.0.1:8787/mcp)\nHeader: Authorization: Bearer <RCX_TOKEN>\n${json({ mcpServers: { "rightclick-x": { type: "http", url: "https://<your-deployment>/mcp", headers: { Authorization: "Bearer <RCX_TOKEN>" } } } })}`,
  };
  if (client && blocks[client]) return blocks[client];
  return Object.values(blocks).join("\n\n");
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  proc.exitCode = 1;
});
