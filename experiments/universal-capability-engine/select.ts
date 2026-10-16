// Mechanical, seeded selection of unfamiliar applications (see PREREGISTRATION.md).
//   node experiments/universal-capability-engine/select.ts draw-ac
//   node experiments/universal-capability-engine/select.ts draw-g <frozen-commit>
// The screen runs each candidate's --help / -h / no-args inside the same sandbox profile the
// investigator uses (no network, writes only to a temp dir, no reads under /Users).

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "experiments/universal-capability-engine/evidence";
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- exclusions (categories from the pre-registration)
const CATEGORY: Record<string, RegExp> = {
  "shell/interpreter/compiler/debugger": /^(sh|bash|zsh|csh|tcsh|ksh|dash|fish|python.*|perl.*|ruby.*|irb|php|tclsh.*|wish.*|expect|osascript|node|java.*|jshell|swift.*|cc|c\+\+|gcc.*|g\+\+|clang.*|cpp|ld|lldb|gdb|dtrace|awk|nawk|gawk|sed|bc|dc|m4|lex|flex|yacc|bison|jsc|xcrun|xcodebuild|cmake|pydoc.*|2to3.*|lua.*|scheme|guile|sqlite3|dtruss|instruments|getopt|whereis|which|type|command|alias|hash|builtin|test|\[|printf|echo)$/,
  "changes files or system": /^(rm|mv|cp|ln|chmod|chown|chgrp|chflags|touch|mkdir|rmdir|install|ditto|tar|bsdtar|pax|cpio|zip|unzip|zipcloak|zipnote|zipsplit|gzip|gunzip|zcat|bzip2|bunzip2|xz|unxz|lzma|compress|uncompress|split|csplit|patch|dd|tee|truncate|xattr|defaults|mktemp|mkfifo|mknod|shred|srm|link|unlink|setfile|getfileinfo|bless|asr|newfs.*|fsck.*|mount.*|umount|tmutil|hdiutil|diskutil|pwd_mkdb|vipw|chpass|chsh|chfn|lockf|flock|rsync|sync|purge)$/,
  "network": /^(curl|wget|ssh.*|scp|sftp|ftp|tftp|telnet|nc|ncat|netcat|nslookup|dig|host|ping.*|traceroute.*|netstat|nscurl|networkquality|ldap.*|snmp.*|smb.*|http.*|ipconfig|ifconfig|route|arp|ndp|nettop|tcpdump|mail|mailx|sendmail|talk|write|wall|finger|whois|rpcinfo|showmount|nfsstat|kdestroy|kinit|klist|kpasswd|kswitch|ktutil|ssh-.*|scutil|networksetup|airport|tailscale|ngrok)$/,
  "privilege/account": /^(sudo|su|login|passwd|dscl|dscacheutil|security|sysadminctl|dseditgroup|createhomedir|authopen|newgrp|kextload|kextutil|csrutil|spctl|codesign|profiles|fdesetup)$/,
  "process/system control": /^(kill|killall|pkill|pgrep|shutdown|reboot|halt|launchctl|pmset|caffeinate|renice|nice|nohup|xargs|env|time|timeout|sandbox-exec|taskpolicy|notifyutil|softwareupdate|systemsetup|nvram|bputil|kmutil|powermetrics|sample|spindump|leaks|heap|vmmap|malloc_history|atos|fs_usage|sc_usage|latency|wait4path|run-parts|at|atq|atrm|batch|crontab|script|logger|syslog|mdutil|tccutil|lsappinfo|ditto)$/,
  "interactive/pager": /^(vi|vim|view|vimdiff|vimtutor|ex|nano|pico|emacs.*|less|more|most|top|htop|man|apropos|whatis|info|screen|tmux|telnet|edit|ed|red|mg|lynx|tset|reset|tput|clear|stty|tabs)$/,
  "package/build/vcs": /^(git.*|svn.*|make|gnumake|bsdmake|pkgutil|pkgbuild|productbuild|installer|pip.*|gem|bundle.*|rake|cargo|rustc|go|brew|port|npm|npx|yarn|pod|carthage|lipo|otool|nm|strip|size|libtool|ranlib|ar|dsymutil|xcode-select|actool|ibtool|agvtool|genstrings|iconutil)$/,
  "clipboard/audio/speech/display/UI": /^(pbcopy|pbpaste|say|afplay|afinfo|afconvert|afclip|afhash|afmeasure|afscexpand|open|screencapture|shortcuts|automator|qlmanage|osacompile|osadecompile|osalang|caffeinate|avconvert|mdfind|mdimport|mdutil|cupsfilter|lp|lpr|lpq|lprm|lpstat|cancel|lpoptions|lpinfo|lpadmin|lpmove|speech.*)$/,
  "prints system state": /^(ps|w|who|whoami|uptime|sysctl|df|du|ls|id|printenv|hostname|uname|sw_vers|system_profiler|ioreg|log|last|lastcomm|vm_stat|iostat|lsof|groups|logname|users|locale|tty|pwd|getconf|machine|arch|hostinfo|kextstat|zprint|footprint|memory_pressure|powermetrics|pagesize|date)$/,
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

function category(name: string): string | undefined {
  for (const [c, re] of Object.entries(CATEGORY)) if (re.test(name.toLowerCase())) return c;
  if (NAMES_IN_SOURCE.has(name.toLowerCase())) return "named in RightClick X's source";
  return undefined;
}

// ---------------------------------------------------------------- sandboxed screen
const PROFILE = `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath (param "WORK")) (literal "/dev/null") (literal "/dev/tty"))
(deny file-read* (subpath "/Users"))
(allow file-read* (subpath (param "WORK")))
`;

function sandboxed(bin: string, args: string[], ms = 2000): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  const work = mkdtempSync(join(tmpdir(), "rcx-select-"));
  writeFileSync(join(work, "p.sb"), PROFILE);
  return new Promise((done) => {
    const p = spawn("/usr/bin/sandbox-exec", ["-f", join(work, "p.sb"), "-D", `WORK=${work}`, bin, ...args], { cwd: work, env: { PATH: "/usr/bin:/bin", HOME: work, LANG: "C", TERM: "dumb" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const take = (d: Buffer) => { if (out.length < 20000) out += d.toString(); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    p.stdin.end();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, ms);
    p.on("close", (code) => { clearTimeout(t); rmSync(work, { recursive: true, force: true }); done({ code, out, timedOut }); });
    p.on("error", () => { clearTimeout(t); done({ code: -1, out: "", timedOut: false }); });
  });
}

const looksLikeUsage = (s: string) => /usage|options?:|synopsis|^\s*-{1,2}[a-z]/im.test(s) && /(^|\s)-{1,2}[a-zA-Z]|<[a-z]+>|\[[a-z]/.test(s);

async function screen(name: string) {
  const bin = `/usr/bin/${name}`;
  for (const args of [["--help"], ["-h"], []]) {
    const r = await sandboxed(bin, args);
    if (!r.timedOut && looksLikeUsage(r.out)) return { suitable: true, via: args.join(" ") || "(no args)", usage: r.out.slice(0, 4000) };
  }
  return { suitable: false };
}

function manDescription(name: string): string {
  try {
    const page = execFileSync("man", ["1", name], { encoding: "utf8", env: { ...process.env, MANPAGER: "cat", MANWIDTH: "120" }, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    const m = /NAME\s*\n\s*(.+?)\n\s*\n/s.exec(page.replace(/.\x08/g, ""));
    return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function buildPool() {
  const all = readdirSync("/usr/bin").filter((n) => { try { return statSync(`/usr/bin/${n}`).isFile(); } catch { return false; } }).sort();
  const rows: any[] = [];
  for (const name of all) {
    const hasMan = (() => { try { execFileSync("man", ["-w", "1", name], { stdio: "ignore", timeout: 3000 }); return true; } catch { return false; } })();
    if (!hasMan) { rows.push({ name, excluded: "no section-1 manual page" }); continue; }
    const c = category(name);
    if (c) { rows.push({ name, excluded: c }); continue; }
    rows.push({ name, candidate: true });
  }
  const candidates = rows.filter((r) => r.candidate);
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < candidates.length) {
      const r = candidates[i++];
      Object.assign(r, await screen(r.name));
      if (r.suitable) r.description = manDescription(r.name);
    }
  }));
  return rows;
}

const draw = (seedHex: string, list: string[], k: number) => {
  const pool = [...list].sort();
  const picks: string[] = [];
  let seed = BigInt(`0x${createHash("sha256").update(seedHex).digest("hex")}`);
  for (let j = 0; j < k && pool.length; j++) {
    const idx = Number(seed % BigInt(pool.length));
    picks.push(pool.splice(idx, 1)[0]);
    seed = BigInt(`0x${createHash("sha256").update(seed.toString(16)).digest("hex")}`);
  }
  return picks;
};

const mode = process.argv[2];
if (mode === "draw-ac") {
  const rows = await buildPool();
  const suitable = rows.filter((r) => r.suitable).map((r) => r.name);
  const prereg = execFileSync("git", ["log", "-1", "--format=%H", "--", "experiments/universal-capability-engine/PREREGISTRATION.md"], { encoding: "utf8" }).trim();
  const [A, C] = draw(prereg, suitable, 2);
  const result = { at: new Date().toISOString(), seedFrom: `pre-registration commit ${prereg}`, poolSize: rows.length, candidates: rows.filter((r) => r.candidate).length, suitable, draws: { A, C }, descriptions: Object.fromEntries(rows.filter((r) => r.suitable).map((r) => [r.name, r.description])), rows };
  writeFileSync(`${OUT}/selection-ac.json`, JSON.stringify(result, null, 2));
  console.log(`pool ${rows.length} · candidates ${result.candidates} · suitable ${suitable.length}`);
  console.log(`A = ${A}: ${result.descriptions[A]}\nC = ${C}: ${result.descriptions[C]}`);
} else if (mode === "draw-g") {
  const frozen = process.argv[3];
  if (!frozen) throw new Error("usage: draw-g <frozen-commit>");
  const prev = JSON.parse(readFileSync(`${OUT}/selection-ac.json`, "utf8"));
  const domainOf = (n: string) => String(prev.descriptions[n] ?? "").split(/[-–]/).slice(1).join(" ").toLowerCase().match(/[a-z]+/g)?.slice(0, 3).join(" ") ?? "";
  const avoid = new Set([prev.draws.A, prev.draws.C]);
  const usedDomains = [domainOf(prev.draws.A), domainOf(prev.draws.C)];
  const eligible = prev.suitable.filter((n: string) => !avoid.has(n) && !usedDomains.some((d: string) => d && domainOf(n) === d));
  const G = draw(frozen, eligible, 2);
  // The same seeded sequence, continued: used in order when a draw cannot be investigated
  // (the pre-registered fallback). Its first two entries are G.
  const order = draw(frozen, eligible, 20);
  const result = { at: new Date().toISOString(), seedFrom: `frozen build ${frozen}`, eligible: eligible.length, draws: { G }, order, descriptions: Object.fromEntries(order.map((n: string) => [n, prev.descriptions[n]])) };
  writeFileSync(`${OUT}/selection-g.json`, JSON.stringify(result, null, 2));
  console.log(`G = ${G.map((n: string) => `${n}: ${prev.descriptions[n]}`).join(" | ")}`);
}
