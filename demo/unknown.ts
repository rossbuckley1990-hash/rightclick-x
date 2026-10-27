// npm run demo:unknown — the Zero-Integration demonstration, live (not a recording).
//
// Every line marked "▶ live" prints what the running system returned. Lines marked "· narration" are
// explanation added by this script. Nothing is pre-recorded, and RightClick X contains no code for
// the program used.
//
//  1. A fresh RightClick X (empty state) runs as an MCP server over stdio.
//  2. The operator authorises one program; RightClick X investigates it in the sandbox (bounded).
//  3. It composes and publishes a capability; this script checks the result with its own code.
//  4. The MCP server is restarted (persistence). A new client, with no knowledge of the program,
//     uses the retained capability on unseen input. With --agent, a fresh Claude Code session does.
//  5. Compatible change: the program is replaced by a wrapper with the same behaviour -> it adapts.
//  6. Incompatible change: same path, different behaviour -> it must refuse, never present a wrong result.
//  7. Removal -> the capability is withdrawn. Restore -> re-established.
//  8. An evidence bundle (JSON) is written to demo/evidence/.
//
//   npm run demo:unknown                       macOS: /usr/bin/tidy; Linux: /usr/bin/expand
//   npm run demo:unknown -- --agent            also let a fresh Claude Code session reuse it
//   npm run demo:unknown -- --conformance      the operator also authorises two exact samples whose
//                                              expected outputs this script records from the original
//                                              program (run directly, outside RightClick X), so a
//                                              compatible change can be revalidated (RCX_CLI_CONFORMANCE)
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const AGENT = process.argv.includes("--agent");
const CONFORMANCE = process.argv.includes("--conformance");
interface Profile { program: string; intent: string; want: string; port: string; samples: [string, string, string]; check: (input: string, out: unknown) => boolean }
const PROFILES: Record<string, Profile> = {
  tidy: {
    program: "/usr/bin/tidy",
    intent: "correct and pretty-print an html document",
    want: "html",
    port: "html",
    samples: [
      `<html><head><title>Ship log</title></head><body><h2>Tuesday</h2>\n<p>Calm sea\n<p>Gulls overhead\n<ul><li>Coffee<li>Rope</ul></body></html>\n`,
      `<html><head><title>Bakery</title></head><body><h2>Orders</h2>\n<p>Rye loaf\n<p>Plain scone\n</body></html>\n`,
      `<html><head><title>Garden</title></head><body><h3>Beds</h3>\n<p>Tomatoes\n<ul><li>Basil<li>Mint</ul></body></html>\n`,
    ],
    check: (input, out) => {
      const VOID = new Set(["br", "img", "meta", "link", "hr", "input", "!doctype"]);
      const balanced = (h: string) => {
        const st: string[] = [];
        for (const x of h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?\s*([a-zA-Z!][\w:-]*)[^>]*?(\/?)>/g)) {
          const n = x[1].toLowerCase();
          if (VOID.has(n) || x[2] === "/") continue;
          if (!x[0].startsWith("</")) st.push(n);
          else if (st.pop() !== n) return false;
        }
        return !st.length;
      };
      const words = (s: string): string[] => s.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
      return typeof out === "string" && balanced(out) && [...new Set(words(input))].every((w) => words(out).includes(w));
    },
  },
  expand: {
    program: "/usr/bin/expand",
    intent: "expand tabs to spaces",
    want: "text",
    port: "input",
    samples: ["name\tage\nalice\t30\n", "id\tcity\tscore\n7\tLima\t88\n", "a\tb\tc\td\n"],
    // The script's own tab expansion (stops every 8 columns).
    check: (input, out) => out === input.split("\n").map((l) => l.split("").reduce((s, ch) => (ch === "\t" ? s + " ".repeat(8 - (s.length % 8)) : s + ch), "")).join("\n"),
  },
};
const profile = process.platform === "darwin" ? PROFILES.tidy : PROFILES.expand;
if (!existsSync(profile.program)) {
  console.log(`· narration: ${profile.program} is not installed here; this demonstration needs it.`);
  process.exit(1);
}
const live = (s: string) => console.log(`▶ live   ${s}`);
const say = (s: string) => console.log(`· narration: ${s}`);
const name = basename(profile.program);
const env = realpathSync(mkdtempSync(join(tmpdir(), "rcx-demo-")));
const BIN = `${env}/bin`;
mkdirSync(BIN);
const bin = `${BIN}/${name}`;
const place = (body?: string) => {
  try {
    unlinkSync(bin);
  } catch {
    /* absent */
  }
  if (body === undefined) symlinkSync(profile.program, bin);
  else {
    writeFileSync(bin, body);
    chmodSync(bin, 0o755);
  }
};
place();
const state = `${env}/state.json`;
const evidence: any = { at: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, program: profile.program, intent: profile.intent, steps: [] };
const record = (step: string, data: unknown) => evidence.steps.push({ step, at: new Date().toISOString(), data });
const serverEnv: Record<string, string | undefined> = { ...process.env, RCX_STATE_FILE: state, RCX_INVESTIGATE: bin, RCX_WORKSPACE: env };
if (CONFORMANCE) {
  // Synthetic inputs, distinct from the task inputs. Expected outputs come from the original
  // program run by this script, before any change: golden outputs, not RightClick X's own.
  const inputs = profile.want === "html"
    ? ["<html><head><title>Sample A</title></head><body><p>one\n<p>two</body></html>\n", "<html><head><title>Sample B</title></head><body><ul><li>x<li>y</ul></body></html>\n"]
    : ["k\tv\n1\t2\n", "a\tbb\tccc\n"];
  const samples = inputs.map((input) => ({ args: { [profile.port]: input }, output: spawnSync(profile.program, [], { input, encoding: "utf8" }).stdout }));
  serverEnv.RCX_CLI_CONFORMANCE = JSON.stringify({ [`cli:${name}:default`]: { samples } });
  evidence.conformance = { capability: `cli:${name}:default`, samples: samples.length, expectedOutputs: "recorded from the original program by this script" };
}

/** A minimal MCP stdio client: how any AI client talks to RightClick X. */
class Client {
  private p;
  private buf = "";
  private n = 1;
  private wait = new Map<number, (m: any) => void>();
  instructions = "";
  constructor() {
    this.p = spawn(process.execPath, [resolve("bin/rcx.ts"), "mcp"], { env: serverEnv, stdio: ["pipe", "pipe", "pipe"] });
    this.p.stdout!.setEncoding("utf8");
    this.p.stdout!.on("data", (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line) {
          const m = JSON.parse(line);
          this.wait.get(m.id)?.(m);
        }
      }
    });
  }
  req(method: string, params: unknown = {}) {
    const id = this.n++;
    return new Promise<any>((done) => {
      this.wait.set(id, done);
      this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async init() {
    const r = await this.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "demo", version: "1" } });
    this.instructions = r.result?.instructions ?? "";
    this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return this;
  }
  async tool(tool: string, args: Record<string, unknown> = {}) {
    const r = await this.req("tools/call", { name: tool, arguments: args });
    const text = r.result?.content?.[0]?.text ?? r.error?.message ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }
  close() {
    this.p.stdin!.end();
  }
}
const [s1, s2, s3] = profile.samples;
const results: Record<string, boolean> = {};

say("A fresh RightClick X with empty state. It has never seen this program and contains no code for it.");
let c = await new Client().init();
const tools = (await c.req("tools/list")).result.tools.map((t: any) => t.name);
live(`MCP tools offered to any AI client: ${tools.length}`);
say(`The operator authorises exactly one program: ${bin}.${CONFORMANCE ? " It also authorises two exact samples with outputs recorded from the original program." : " That is the only setup."}`);
let t0 = Date.now();
const learned = await c.tool("context_learn", { source: `cli:${bin}` });
live(`context_learn -> ${learned.results?.[0]?.probes?.[0]?.detail ?? learned.results?.[0]?.error} (${Date.now() - t0} ms)`);
const caps = (await c.tool("context_graph", { op: "export" })).capabilities.filter((x: any) => x.invoke?.kind === "cli");
for (const cap of caps.slice(0, 4)) live(`  learned ${cap.id}`);
const card = caps[0] ? (await c.tool("context_explain", { id: caps[0].id })).card : null;
for (const e of (card?.verification?.evidence ?? []).slice(0, 4)) live(`  evidence: ${e}`);
live(`  status: ${card?.contract?.status}; invalidated when: ${card?.contract?.invalidatedWhen?.[1]}`);
record("investigate", { probes: learned.results?.[0]?.probes, capabilities: caps.map((x: any) => x.id), card });

say("Ask for an outcome, not a tool. RightClick X plans, runs, and publishes a reusable capability.");
t0 = Date.now();
const built = await c.tool("context_compose", { have: { [profile.port]: { type: profile.want, value: s1 } }, want: profile.want, intent: profile.intent, run: true, publish: "Demo capability", view: { full: true } });
const goalId = built.published?.id ?? "goal:demo-capability";
results.first = profile.check(s1, built.executed?.output);
live(`context_compose -> ${built.executed?.status} via ${(built.executed?.titles ?? []).join(" → ")} (${Date.now() - t0} ms); published ${goalId} [${built.published?.trust}]`);
live(`independent check by this script (not by the program, not by RightClick X): ${results.first ? "PASS" : "FAIL"}`);
record("compose", { status: built.executed?.status, plan: built.executed?.titles, contract: built.executed?.contract, published: built.published, check: results.first });
c.close();

say("The MCP server is restarted. A new client that has never heard of the program connects.");
c = await new Client().init();
live(`the server tells the new session: ${(/Retained IDs[^:]*: (\[[^\n]*?\])/.exec(c.instructions)?.[1] ?? "(nothing)").slice(0, 110)}`);
const reuse = await c.tool("context_run", { id: goalId, args: { [profile.port]: s2 }, view: { full: true } });
results.reuse = profile.check(s2, reuse.output);
live(`context_run ${goalId} on unseen input -> ${reuse.status}; independent check: ${results.reuse ? "PASS" : "FAIL"}`);
record("reuse-after-restart", { status: reuse.status, check: results.reuse });

if (AGENT) {
  const has = spawnSync("claude", ["--version"], { encoding: "utf8" }).status === 0;
  if (!has) say("--agent: no Claude Code CLI on this machine; this step is skipped.");
  else {
    say("A fresh Claude Code session, connected only to RightClick X, is asked to do the task on unseen input.");
    c.close();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-demo-agent-")));
    writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: { "rightclick-x": { command: process.execPath, args: [resolve("bin/rcx.ts"), "mcp"], env: { RCX_STATE_FILE: state, RCX_INVESTIGATE: bin, RCX_WORKSPACE: dir } } } }));
    const prompt = `Use RightClick X (its context_* tools only). Task: ${profile.intent} for this input (JSON string, exact content): ${JSON.stringify(s3)}. Reply with the exact result between a line containing only BEGIN and a line containing only END.`;
    const r = spawnSync("claude", ["-p", prompt, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task", "--output-format", "json", "--max-turns", "15"], { cwd: dir, encoding: "utf8", timeout: 300_000 });
    let reply = "";
    try {
      reply = JSON.parse(r.stdout).result ?? "";
    } catch {
      reply = r.stdout.slice(-500);
    }
    const answer = /^BEGIN\s*$\n?([\s\S]*?)^END\s*$/m.exec(reply)?.[1];
    // The answer block cannot carry the final newline; compare as the script's check expects.
    const normalised = answer === undefined ? undefined : profile.want === "html" ? answer : answer.replace(/\n?$/, "\n");
    results.agent = normalised !== undefined && profile.check(s3, normalised);
    live(`fresh Claude Code session -> ${answer !== undefined ? "answered" : "no answer"}; independent check: ${results.agent ? "PASS" : "FAIL"}`);
    record("fresh-agent", { reply: reply.slice(0, 2000), check: results.agent });
    c = await new Client().init();
  }
}

say("Compatible change: the program is replaced by a different file that behaves the same (a wrapper).");
place(`#!/bin/sh\nexec ${profile.program} "$@"\n`);
const compat = await c.tool("context_run", { id: goalId, args: { [profile.port]: s2 }, view: { full: true } });
results.compatible = compat.status === "completed" && profile.check(s2, compat.output);
live(`context_run -> ${compat.status}; independent check: ${results.compatible ? "PASS" : "FAIL"}`);
record("compatible-change", { status: compat.status, error: compat.error, check: results.compatible });

say("Incompatible change: same path, but now every output line comes back reversed.");
place(`#!/bin/sh\n${profile.program} "$@" | /usr/bin/rev\n`);
const incompat = await c.tool("context_run", { id: goalId, args: { [profile.port]: s2 }, view: { full: true } });
const presentedWrong = incompat.status === "completed" && !profile.check(s2, incompat.output);
results.incompatible = !presentedWrong;
live(`context_run -> ${incompat.status}: ${String(incompat.error ?? "").slice(0, 110)}`);
live(`a wrong result presented as success: ${presentedWrong ? "YES (FAIL)" : "no (PASS)"}`);
record("incompatible-change", { status: incompat.status, error: incompat.error, presentedWrong });

say("The program is removed.");
rmSync(bin, { force: true });
const gone = await c.tool("context_run", { id: goalId, args: { [profile.port]: s2 } });
await c.tool("context_learn", { source: `cli:${bin}` });
const left = (await c.tool("context_graph", { op: "export" })).capabilities.filter((x: any) => x.invoke?.kind === "cli").length;
results.removed = gone.status !== "completed" && left === 0;
live(`context_run -> ${gone.status}; program capabilities left in the graph: ${left}`);
record("removed", { status: gone.status, error: gone.error, capabilitiesLeft: left });

say("The original program comes back; investigation re-establishes the capability.");
place();
await c.tool("context_learn", { source: `cli:${bin}` });
const back = await c.tool("context_run", { id: goalId, args: { [profile.port]: s2 }, view: { full: true } });
results.restored = profile.check(s2, back.output);
live(`context_run -> ${back.status}; independent check: ${results.restored ? "PASS" : "FAIL"}`);
record("restored", { status: back.status, check: results.restored });
c.close();

mkdirSync("demo/evidence", { recursive: true });
const file = `demo/evidence/unknown-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
evidence.results = results;
writeFileSync(file, JSON.stringify(evidence, null, 2));
say(`Evidence bundle: ${file}. Results: ${Object.entries(results).map(([k, v]) => `${k} ${v ? "PASS" : "FAIL"}`).join(", ")}.`);
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
