// npm run demo:unknown — a live demonstration, not a recording.
//
// Every line marked "▶ live" is printed from what the running system actually returned.
// Lines marked "· narration" are explanation added by this script. Nothing is pre-recorded.
//
// 1. A fresh RightClick X (empty graph) runs as an MCP server over stdio.
// 2. An unfamiliar program is introduced: the operator registers one directory holding it.
// 3. RightClick X investigates it in the host sandbox and shows the evidence.
// 4. It composes a new capability from it, runs it on new input, and publishes it.
// 5. The result is checked by this script's own code (never by the program itself).
// 6. A second, separate MCP client (no knowledge of the program) finds and uses the capability.
// 7. The program is removed: the capability disappears. Restored: it is re-established.
// 8. An evidence bundle (JSON) is written to demo/evidence/.
//
//   npm run demo:unknown                 (uses /usr/bin/tidy, an HTML corrector, if present)
//   npm run demo:unknown -- /path/to/program "intent words" want-type
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const program = process.argv[2] ?? "/usr/bin/tidy";
const intent = process.argv[3] ?? "correct and pretty-print an html document";
const want = process.argv[4] ?? "html";
if (!existsSync(program)) {
  console.log(`· narration: ${program} is not installed here; pass a program path: npm run demo:unknown -- /path/to/program "intent" want-type`);
  process.exit(1);
}
const live = (s: string) => console.log(`▶ live   ${s}`);
const say = (s: string) => console.log(`· narration: ${s}`);
const name = basename(program);
const env = realpathSync(mkdtempSync(join(tmpdir(), "rcx-demo-")));
const BIN = `${env}/bin`;
mkdirSync(BIN);
symlinkSync(program, `${BIN}/${name}`);
const evidence: any = { at: new Date().toISOString(), program, intent, want, steps: [] };
const record = (step: string, data: unknown) => evidence.steps.push({ step, at: new Date().toISOString(), data });

/** A minimal MCP stdio client: this is how any AI client talks to RightClick X. */
class Client {
  private p;
  private buf = "";
  private n = 1;
  private wait = new Map<number, (m: any) => void>();
  constructor(state: string) {
    this.p = spawn(process.execPath, [resolve("bin/rcx.ts"), "mcp"], { env: { ...process.env, RCX_STATE_FILE: state, RCX_INVESTIGATE: `${BIN}/${name}`, RCX_WORKSPACE: env }, stdio: ["pipe", "pipe", "pipe"] });
    this.p.stdout!.setEncoding("utf8");
    this.p.stdout!.on("data", (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        this.wait.get(m.id)?.(m);
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
    await this.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "demo", version: "1" } });
    this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return this;
  }
  async tool(name: string, args: Record<string, unknown> = {}) {
    const r = await this.req("tools/call", { name, arguments: args });
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

const VOID = new Set(["br", "img", "meta", "link", "hr", "input", "!doctype"]);
const balanced = (h: string) => { const st: string[] = []; for (const x of h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?\s*([a-zA-Z!][\w:-]*)[^>]*?(\/?)>/g)) { const n = x[1].toLowerCase(); if (VOID.has(n) || x[2] === "/") continue; if (!x[0].startsWith("</")) st.push(n); else if (st.pop() !== n) return false; } return !st.length; };
const words = (s: string): string[] => s.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const independentCheck = (input: string, out: unknown) => (want === "html" ? typeof out === "string" && balanced(out) && [...new Set(words(input))].every((w) => words(out).includes(w)) : out !== undefined && out !== null);
const sample = want === "html" ? `<html><head><title>Ship log</title></head><body><h2>Tuesday</h2>\n<p>Calm sea\n<p>Gulls overhead\n<ul><li>Coffee<li>Rope</ul></body></html>\n` : "Hello world\n";
const sample2 = want === "html" ? `<html><head><title>Bakery</title></head><body><h2>Orders</h2>\n<p>Rye loaf\n<p>Plain scone\n</body></html>\n` : "Second input\n";

say("RightClick X starts with an empty graph. It has never seen this program and contains no code for it.");
const state = `${env}/state.json`;
let c = await new Client(state).init();
const tools = (await c.req("tools/list")).result.tools.map((t: any) => t.name);
live(`MCP tools offered to any AI client: ${tools.length} (${tools.join(", ")})`);
record("tools", tools);

say(`The operator registers one directory holding ${name}. That is the only setup.`);
let t0 = Date.now();
const learned = await c.tool("context_learn", { source: `cli:${BIN}/${name}` });
live(`context_learn cli:${name} -> ${learned.results?.[0]?.probes?.[0]?.detail ?? learned.results?.[0]?.error} (${Date.now() - t0} ms)`);
const caps = (await c.tool("context_graph", { op: "export" })).capabilities.filter((x: any) => x.provider === `cli:${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
for (const cap of caps.slice(0, 4)) live(`  learned ${cap.id}: ${cap.title}`);
const card = caps[0] ? (await c.tool("context_explain", { id: caps[0].id })).card : null;
if (card) for (const e of (card.verification?.evidence ?? []).slice(0, 5)) live(`  evidence: ${e}`);
record("investigate", { probes: learned.results?.[0]?.probes, capabilities: caps.map((x: any) => x.id), card });

say("Ask for an outcome, not a tool. RightClick X plans with what the program can do, runs it, and saves it.");
t0 = Date.now();
const built = await c.tool("context_compose", { have: { [want === "html" ? "html" : "input"]: { type: want === "html" ? "html" : "text", value: sample } }, want, intent, run: true, publish: "Demo capability", view: { full: true } });
live(`context_compose -> ${built.executed?.status} via ${(built.executed?.titles ?? []).join(" → ")} (${Date.now() - t0} ms); published ${built.published?.id ?? "nothing"} (${built.published?.trust ?? "-"})`);
const ok1 = independentCheck(sample, built.executed?.output);
live(`independent check by this script (not the program): ${ok1 ? "PASS" : "FAIL"}`);
record("compose", { status: built.executed?.status, plan: built.executed?.titles, published: built.published, check: ok1 });
c.close();

say("A different client, in a new process, with no knowledge of the program, finds the capability and uses it on new input.");
c = await new Client(state).init();
const found = await c.tool("context_graph", { op: "search", query: intent, limit: 5 });
live(`context_graph search "${intent}" -> ${(found ?? []).slice(0, 3).map((x: any) => x.id).join(", ")}`);
const reuse = await c.tool("context_run", { id: built.published?.id ?? "goal:demo-capability", args: { [want === "html" ? "html" : "input"]: sample2 }, view: { full: true } });
const ok2 = independentCheck(sample2, reuse.output);
live(`context_run ${built.published?.id} on new input -> ${reuse.status}; independent check: ${ok2 ? "PASS" : "FAIL"}`);
record("reuse", { status: reuse.status, check: ok2 });

say(`Now the program is removed from the registered directory.`);
rmSync(`${BIN}/${name}`);
const gone = await c.tool("context_run", { id: built.published?.id ?? "goal:demo-capability", args: { [want === "html" ? "html" : "input"]: sample2 } });
const left = (await c.tool("context_graph", { op: "export" })).capabilities.filter((x: any) => x.provider.startsWith(`cli:`)).length;
live(`context_run -> ${gone.status}: ${String(gone.error ?? "").slice(0, 120)}`);
live(`program capabilities left in the graph: ${left}`);
record("withdraw", { status: gone.status, error: gone.error, capabilitiesLeft: left });

say("The program comes back; investigation re-establishes the capability.");
symlinkSync(program, `${BIN}/${name}`);
await c.tool("context_learn", { source: `cli:${BIN}/${name}` });
const back = await c.tool("context_run", { id: built.published?.id ?? "goal:demo-capability", args: { [want === "html" ? "html" : "input"]: sample2 }, view: { full: true } });
const ok3 = independentCheck(sample2, back.output);
live(`context_run -> ${back.status}; independent check: ${ok3 ? "PASS" : "FAIL"}`);
record("restore", { status: back.status, check: ok3 });
c.close();

mkdirSync("demo/evidence", { recursive: true });
const file = `demo/evidence/unknown-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(evidence, null, 2));
say(`Evidence bundle: ${file}. No application-specific integration was written: the program was introduced as a path, and everything above came from investigation.`);
process.exit(ok1 && ok2 && ok3 && left === 0 ? 0 : 1);
