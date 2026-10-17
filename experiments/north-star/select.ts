// Holdout selection after the freeze (EVALUATION-PLAN.md §2–3).
//   node experiments/north-star/select.ts <freeze-tag>
// 1. Pool: executables in the system and Homebrew directories, minus the development set, the
//    mechanical exclusion categories (copied from experiments/universal-capability-engine/select.ts)
//    and anything named in RightClick X's source.
// 2. Order: a shuffle seeded by the frozen commit hash.
// 3. An independent evaluator (a separate Claude Code session: Opus, no tools, no repository, run
//    in an empty directory) screens candidates in that order and writes the tasks.
// 4. Every reference invocation runs on the real program in the sandbox (the oracle); invalid
//    tasks are replaced by the evaluator once, before any arm runs.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostSandbox } from "../../src/core/sandbox.ts";
import { OUT, oracle, type Task } from "./common.ts";

const TAG = process.argv[2];
if (!TAG) throw new Error("usage: select.ts <freeze-tag> [--pilot dev,programs]");
// Pilot mode (harness debugging before the freeze): only development-set programs, written to a
// separate file; never a holdout.
const PILOT = process.argv.includes("--pilot") ? process.argv[process.argv.indexOf("--pilot") + 1].split(",") : null;
const COMMIT = execFileSync("git", ["rev-parse", `${TAG}^{commit}`], { encoding: "utf8" }).trim();
const DEV = new Set<string>(JSON.parse(readFileSync(`${OUT}/development-set.json`, "utf8")).programs);
const DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin"];
const WANT_PROGRAMS = process.argv.includes("--pilot") ? process.argv[process.argv.indexOf("--pilot") + 1].split(",").length : 10;
const MAX_SCREENED = 80;
const MIN_TASKS = process.argv.includes("--pilot") ? 1 : 40;

const CATEGORY: Record<string, RegExp> = {
  "shell/interpreter/compiler/debugger": /^(sh|bash|zsh|csh|tcsh|ksh|dash|fish|python.*|perl.*|ruby.*|irb|php|tclsh.*|wish.*|expect|osascript|node|java.*|jshell|swift.*|cc|c\+\+|gcc.*|g\+\+|clang.*|cpp|ld|lldb|gdb|dtrace|awk|nawk|gawk|sed|gsed|bc|dc|m4|lex|flex|yacc|bison|jsc|xcrun|xcodebuild|cmake|pydoc.*|2to3.*|lua.*|scheme|guile|sqlite3|dtruss|instruments|getopt|whereis|which|type|command|alias|hash|builtin|test|\[|printf|echo|jq|yq|gojq|mlr|gnuplot|R|Rscript|julia|deno|bun|npm|npx|pnpm|yarn|corepack|tsc|esbuild)$/,
  "changes files or system": /^(rm|mv|cp|ln|chmod|chown|chgrp|chflags|touch|mkdir|rmdir|install|ditto|tar|bsdtar|gtar|pax|cpio|zip|unzip|zipcloak|zipnote|zipsplit|gzip|gunzip|zcat|bzip2|bunzip2|xz|unxz|lzma|compress|uncompress|split|csplit|patch|dd|tee|truncate|xattr|defaults|mktemp|mkfifo|mknod|shred|srm|link|unlink|setfile|getfileinfo|bless|asr|newfs.*|fsck.*|mount.*|umount|tmutil|hdiutil|diskutil|pwd_mkdb|vipw|chpass|chsh|chfn|lockf|flock|rsync|sync|purge|zstd|unzstd|lz4|brotli)$/,
  "network": /^(curl|wget|ssh.*|scp|sftp|ftp|tftp|telnet|nc|ncat|netcat|nslookup|dig|host|ping.*|traceroute.*|netstat|nscurl|networkquality|ldap.*|snmp.*|smb.*|http.*|ipconfig|ifconfig|route|arp|ndp|nettop|tcpdump|mail|mailx|sendmail|talk|write|wall|finger|whois|rpcinfo|showmount|nfsstat|kdestroy|kinit|klist|kpasswd|kswitch|ktutil|ssh-.*|scutil|networksetup|airport|tailscale|ngrok|gh|git-.*|aws|gcloud|az|docker.*|kubectl|colima|wrangler|ollama)$/,
  "privilege/account": /^(sudo|su|login|passwd|dscl|dscacheutil|security|sysadminctl|dseditgroup|createhomedir|authopen|newgrp|kextload|kextutil|csrutil|spctl|codesign|profiles|fdesetup)$/,
  "process/system control": /^(kill|killall|pkill|pgrep|shutdown|reboot|halt|launchctl|pmset|caffeinate|renice|nice|nohup|xargs|env|time|timeout|gtimeout|sandbox-exec|taskpolicy|notifyutil|softwareupdate|systemsetup|nvram|bputil|kmutil|powermetrics|sample|spindump|leaks|heap|vmmap|malloc_history|atos|fs_usage|sc_usage|latency|wait4path|run-parts|at|atq|atrm|batch|crontab|script|logger|syslog|mdutil|tccutil|lsappinfo|parallel|watch|brew|mas)$/,
  "interactive/pager": /^(vi|vim|nvim|view|vimdiff|vimtutor|ex|nano|pico|emacs.*|less|more|most|top|htop|btop|man|apropos|whatis|info|screen|tmux|telnet|edit|ed|red|mg|lynx|tset|reset|tput|clear|stty|tabs|fzf)$/,
  "package/build/vcs": /^(git.*|svn.*|make|gmake|gnumake|bsdmake|pkgutil|pkgbuild|productbuild|installer|pip.*|gem|bundle.*|rake|cargo|rustc|rustup|go|gofmt|port|pod|carthage|lipo|otool|nm|strip|size|libtool|ranlib|ar|dsymutil|xcode-select|actool|ibtool|agvtool|genstrings|iconutil|meson|ninja|autoconf|automake|pkg-config)$/,
  "clipboard/audio/speech/display/UI": /^(pbcopy|pbpaste|say|afplay|afinfo|afconvert|afclip|afhash|afmeasure|afscexpand|open|screencapture|shortcuts|automator|qlmanage|osacompile|osadecompile|osalang|avconvert|mdfind|mdimport|cupsfilter|lp|lpr|lpq|lprm|lpstat|cancel|lpoptions|lpinfo|lpadmin|lpmove|speech.*|ffmpeg|ffprobe|magick|convert)$/,
  "prints system state": /^(ps|w|who|whoami|uptime|sysctl|df|du|ls|id|printenv|hostname|uname|sw_vers|system_profiler|ioreg|log|last|lastcomm|vm_stat|iostat|lsof|groups|logname|users|locale|tty|pwd|getconf|machine|arch|hostinfo|kextstat|zprint|footprint|memory_pressure|pagesize|date|claude|codex)$/,
};
const NAMES_IN_SOURCE = (() => {
  const words = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|json)$/.test(e.name)) for (const w of readFileSync(p, "utf8").match(/[A-Za-z0-9_+-]+/g) ?? []) words.add(w.toLowerCase());
    }
  };
  walk("src");
  walk("bin");
  return words;
})();

function pool(): Array<{ name: string; path: string; excluded?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; path: string; excluded?: string }> = [];
  for (const d of DIRS) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d).sort()) {
      if (seen.has(name)) continue;
      const p = join(d, name);
      try {
        const st = statSync(p);
        if (!st.isFile() || !(st.mode & 0o111)) continue;
      } catch {
        continue;
      }
      seen.add(name);
      const cat = Object.entries(CATEGORY).find(([, re]) => re.test(name))?.[0];
      const excluded = DEV.has(name) ? "development set" : cat ?? (NAMES_IN_SOURCE.has(name.toLowerCase()) ? "named in RightClick X's source" : undefined);
      // The path as users invoke it (a link keeps its name as argv[0]); arms link to the same path.
      out.push({ name, path: p, ...(excluded ? { excluded } : {}) });
    }
  }
  return out;
}

async function docsFor(name: string, path: string): Promise<string> {
  const sb = (await hostSandbox())!;
  const man = await sb.run("/usr/bin/man", ["-P", "cat", name], { limits: { timeoutMs: 4000 } });
  let text = man.code === 0 ? man.stdout.replace(/.\x08/g, "") : "";
  if (!text.trim()) {
    for (const a of [["--help"], ["-h"]]) {
      const r = await sb.run(path, a, { limits: { timeoutMs: 2000 } });
      const t = `${r.stdout}\n${r.stderr}`.trim();
      if (t.length > text.length) text = t;
    }
  }
  // NAME, SYNOPSIS, DESCRIPTION and OPTIONS carry what a task writer needs; cap the size.
  return text.replace(/\n{3,}/g, "\n\n").slice(0, 7000);
}

function evaluator(prompt: string): Promise<{ text: string; raw: string; seconds: number }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ns-evaluator-")));
  writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: {} }));
  const t0 = performance.now();
  return new Promise((done) => {
    const p = spawn("claude", ["-p", prompt, "--model", "opus", "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--disallowedTools", "Bash,Read,Write,Edit,MultiEdit,WebFetch,WebSearch,Glob,Grep,Task,Agent,NotebookEdit,TodoWrite", "--output-format", "json", "--max-turns", "3"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      let text = out;
      try {
        text = String(JSON.parse(out).result ?? "");
      } catch {
        /* raw */
      }
      done({ text, raw: out.slice(0, 200_000), seconds: Math.round((performance.now() - t0) / 1000) });
    });
  });
}

const RULES = `You are an independent evaluator for a software benchmark. You have no tools and no other context: judge only from the documentation given. Reply with JSON only (no prose, no code fences).

ELIGIBILITY. A program is eligible only if, by its documentation, ALL hold:
1. It transforms, analyses or reports on data given on standard input or as file operands, and writes the result to standard output.
2. It needs no network, root privileges, hardware, GUI, running daemon, user account or interactive input.
3. It changes no files except temporary ones.
4. Its output is deterministic for the same input (no dates, random values, process or machine state).
5. Four distinct, useful tasks with small plain-text inputs can be written for it (no binary files, archives, images or special formats you cannot write as plain text).

TASKS. For each eligible program write exactly 4 feasible tasks and 1 infeasible task.
- "request": what a user wants, in plain words, as a user would ask it. Do NOT write option syntax, flags or command lines. The request must be achievable with this program alone.
- "input": {"stdin": "..."} and/or {"files": {"name.txt": "..."}}; plain UTF-8 text, at most 20 lines. Tasks needing two inputs use two files.
- "reference": {"argv": [...]}: the arguments (without the program name) that produce the correct result; file inputs are referred to by the names you gave. Use only options in the documentation shown.
- "compare": one of "exact", "trim", "whitespace", "lines-unordered", "contains-all" (then also "expect": [strings that must all appear]). Choose the least strict mode under which only a correct result passes.
- The 4 feasible tasks should need different options or behaviours of the program where it has them.
- The infeasible task: a plausible request this program cannot do; give "request" and "input" only.

FORMAT: {"programs":[{"name":"<name>","eligible":true|false,"reason":"<one sentence>","tasks":[{"kind":"feasible"|"infeasible","request":"...","input":{...},"reference":{"argv":[...]},"compare":"...","expect":[...]}]}]}
Programs that are not eligible get "tasks": [].`;

const parse = (text: string): any => {
  const m = /\{[\s\S]*\}/.exec(text);
  return m ? JSON.parse(m[0]) : null;
};

const ev: any = { tag: TAG, commit: COMMIT, at: new Date().toISOString(), rules: RULES, model: "opus (Claude Code -p)", pool: {}, order: [], screened: [], programs: [], evaluatorCalls: [] };
const all = pool();
if (PILOT && PILOT.some((n) => !DEV.has(n))) throw new Error(`pilot programs must come from the development set: ${PILOT.filter((n) => !DEV.has(n)).join(", ")}`);
const eligiblePool = PILOT ? all.filter((p) => PILOT.includes(p.name)) : all.filter((p) => !p.excluded);
ev.pool = { total: all.length, excluded: Object.fromEntries([...new Set(all.map((p) => p.excluded).filter(Boolean))].map((r) => [r, all.filter((p) => p.excluded === r).length])), candidates: eligiblePool.length };
const order = [...eligiblePool].sort((a, b) => createHash("sha256").update(`${COMMIT}:${a.name}`).digest("hex").localeCompare(createHash("sha256").update(`${COMMIT}:${b.name}`).digest("hex")));
ev.order = order.slice(0, MAX_SCREENED).map((p) => p.name);
const save = () => writeFileSync(PILOT ? `${OUT}/pilot-${TAG}.json` : `${OUT}/holdout-${TAG}.json`, JSON.stringify(ev, null, 2));

let next = 0;
const validTasks = () => ev.programs.reduce((n: number, p: any) => n + p.tasks.filter((t: Task) => t.kind === "feasible" && t.valid).length, 0);
while ((ev.programs.length < WANT_PROGRAMS || validTasks() < MIN_TASKS) && next < Math.min(order.length, MAX_SCREENED)) {
  const batch = order.slice(next, next + 6);
  next += batch.length;
  const docs = await Promise.all(batch.map(async (p) => ({ ...p, docs: await docsFor(p.name, p.path) })));
  const prompt = `${RULES}\n\n${docs.map((d) => `===== PROGRAM: ${d.name} =====\n${d.docs || "(no documentation available)"}`).join("\n\n")}`;
  const r = await evaluator(prompt);
  ev.evaluatorCalls.push({ purpose: "screen", programs: batch.map((p) => p.name), seconds: r.seconds, reply: r.text });
  let j: any;
  try {
    j = parse(r.text);
  } catch (e) {
    ev.evaluatorCalls[ev.evaluatorCalls.length - 1].parseError = String(e);
  }
  for (const p of batch) {
    const d = j?.programs?.find((x: any) => x.name === p.name);
    ev.screened.push({ name: p.name, eligible: !!d?.eligible, reason: d?.reason ?? "no decision returned" });
    if (!d?.eligible) continue;
    // Enough programs and tasks already: later eligible ones are recorded as screened, not used.
    if (ev.programs.length >= WANT_PROGRAMS && validTasks() >= MIN_TASKS) continue;
    const tasks: Task[] = [];
    for (const [i, t] of (d.tasks ?? []).entries()) tasks.push(await oracle(p.path, { id: `${p.name}#${i + 1}`, program: p.name, kind: t.kind === "infeasible" ? "infeasible" : "feasible", request: String(t.request ?? ""), input: t.input ?? {}, ...(t.reference ? { reference: { argv: (t.reference.argv ?? []).map(String) } } : {}), ...(t.compare ? { compare: t.compare } : {}), ...(t.expect ? { expect: t.expect.map(String) } : {}) }));
    // One replacement round for invalid feasible tasks, before any arm runs.
    const invalid = tasks.filter((t) => t.kind === "feasible" && !t.valid);
    if (invalid.length) {
      const fix = await evaluator(`${RULES}\n\nSome tasks you wrote for ${p.name} could not be used because running their reference invocation failed. Write ${invalid.length} replacement feasible task(s) (same JSON task format, as {"tasks":[...]}), different from these:\n${invalid.map((t) => `- ${JSON.stringify({ request: t.request, reference: t.reference })}: ${t.invalidReason}`).join("\n")}\n\n===== PROGRAM: ${p.name} =====\n${docs.find((x) => x.name === p.name)!.docs}`);
      ev.evaluatorCalls.push({ purpose: `replace ${invalid.length} invalid task(s) for ${p.name}`, seconds: fix.seconds, reply: fix.text });
      let fj: any;
      try {
        fj = parse(fix.text);
      } catch {
        fj = null;
      }
      for (const [k, t] of (fj?.tasks ?? []).slice(0, invalid.length).entries()) {
        const repl = await oracle(p.path, { id: `${p.name}#r${k + 1}`, program: p.name, kind: "feasible", request: String(t.request ?? ""), input: t.input ?? {}, ...(t.reference ? { reference: { argv: (t.reference.argv ?? []).map(String) } } : {}), ...(t.compare ? { compare: t.compare } : {}), ...(t.expect ? { expect: t.expect.map(String) } : {}) });
        tasks.push(repl);
      }
    }
    const feasible = tasks.filter((t) => t.kind === "feasible" && t.valid).slice(0, 4);
    const infeasible = tasks.filter((t) => t.kind === "infeasible").slice(0, 1);
    ev.programs.push({ name: p.name, path: p.path, docs: docs.find((x) => x.name === p.name)!.docs, tasks: [...feasible, ...infeasible], discarded: tasks.filter((t) => !feasible.includes(t) && !infeasible.includes(t)) });
    save();
  }
  save();
}
ev.summary = { screened: ev.screened.length, eligible: ev.screened.filter((s: any) => s.eligible).length, programs: ev.programs.length, feasibleTasks: validTasks(), infeasibleTasks: ev.programs.reduce((n: number, p: any) => n + p.tasks.filter((t: Task) => t.kind === "infeasible").length, 0) };
save();
console.log(JSON.stringify(ev.summary));
