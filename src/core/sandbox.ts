// Confined execution of local programs: the only way RightClick X runs a command-line program.
// No shell parses anything a caller or program supplies (argv only), no network, writes only into
// a fresh temporary directory that is deleted afterwards, no reads under user home directories
// except that directory, a scrubbed environment, and hard limits on wall time, CPU time, memory,
// processes, file size, open files and output. Every run is its own process group, and the whole
// group is terminated when the program exits or exceeds a limit, so nothing it started outlives it.
// Where the OS offers no such sandbox, execution is refused ("unavailable"), never run unconfined.

import { validateFileNames } from "./cli-files.ts";

export interface SandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  /** Resident memory of the whole process group. */
  maxMemoryBytes: number;
  /** Processes alive at once in the run's process group. */
  maxProcesses: number;
  /** Largest file the program may write (RLIMIT_FSIZE). */
  maxFileBytes: number;
}

export type LimitHit = "time" | "cpu" | "memory" | "processes" | "output" | "file-size";

export interface SandboxRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  /** Files present in the working directory afterwards that were not given as inputs. */
  created: string[];
  /** The limit that stopped the run, if any. */
  limit?: LimitHit;
  /** The run's private working directory (already deleted); used to normalise outputs that name it. */
  workDir: string;
}

export const DEFAULT_LIMITS: SandboxLimits = { timeoutMs: 5000, maxOutputBytes: 1_000_000, maxMemoryBytes: 512 * 1024 * 1024, maxProcesses: 64, maxFileBytes: 16 * 1024 * 1024 };

const MAC_PROFILE = `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath (param "WORK")) (literal "/dev/null") (literal "/dev/tty"))
(deny file-read* (subpath "/Users") (subpath "/home") (subpath "/root"))
(allow file-read* (subpath (param "WORK")))
`;

// A constant script: it only sets resource limits, then replaces itself with the program. The
// program and its arguments arrive as positional parameters ("$0" "$@"), never as shell text.
const LIMITS_SCRIPT = 'ulimit -t "$RCX_CPU" 2>/dev/null; ulimit -f "$RCX_FSIZE" 2>/dev/null; ulimit -n 256 2>/dev/null; ulimit -c 0 2>/dev/null; exec "$0" "$@"';

export interface Sandbox {
  kind: "macos-sandbox-exec" | "linux-bwrap";
  /** What this sandbox enforces, stated for evidence and capability cards. */
  enforces: string[];
  /** purpose is host telemetry only; it grants no authority and changes no confinement. */
  run(bin: string, args: string[], opts?: { stdin?: string; files?: Record<string, string>; limits?: Partial<SandboxLimits>; purpose?: "execution" | "investigation" | "revalidation" | "agent-run" }): Promise<SandboxRun>;
}

let probed: Promise<Sandbox | null> | undefined;

/**
 * The sandbox available on this host, or null (then programs are not investigated or run). A
 * sandbox counts only if it actually starts here: bubblewrap without user namespaces (an
 * unprivileged container, a hardened kernel) is reported unavailable, not used.
 */
export function hostSandbox(): Promise<Sandbox | null> {
  return (probed ??= (async () => {
    const g = globalThis as any;
    if (!g.process?.versions?.node) return null;
    const fs = await import("node:fs");
    const candidates: Sandbox[] = [];
    if (g.process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec")) candidates.push(makeSandbox("macos-sandbox-exec"));
    for (const p of ["/usr/bin/bwrap", "/bin/bwrap"]) if (g.process.platform === "linux" && fs.existsSync(p)) candidates.push(makeSandbox("linux-bwrap", p));
    for (const sb of candidates) {
      const r = await sb.run("/bin/echo", ["rcx-sandbox-probe"], { limits: { timeoutMs: 5000 } }).catch(() => null);
      if (r && r.code === 0 && r.stdout.trim() === "rcx-sandbox-probe") return sb;
    }
    return null;
  })());
}

/** Resident memory (bytes) and process count of one process group, or null when ps is unavailable. */
async function groupUsage(pgid: number): Promise<{ rss: number; procs: number } | null> {
  const { execFile } = await import("node:child_process");
  return new Promise((done) => {
    execFile("/bin/ps", ["-A", "-o", "pgid=,rss="], { timeout: 2000 }, (err, out) => {
      if (err) return done(null);
      let rss = 0;
      let procs = 0;
      for (const line of String(out).split("\n")) {
        const [g, r] = line.trim().split(/\s+/).map(Number);
        if (g === pgid) {
          procs++;
          rss += (r || 0) * 1024;
        }
      }
      done({ rss, procs });
    });
  });
}

function makeSandbox(kind: Sandbox["kind"], bwrap = ""): Sandbox {
  return {
    kind,
    enforces: [
      "no network",
      "writes only to a fresh temporary directory",
      "no reads under home directories",
      "scrubbed environment",
      "argv only",
      "wall-time, CPU-time, memory, process-count, file-size, open-file and output limits",
      "the run's whole process group is terminated when it ends",
    ],
    async run(bin, args, opts = {}) {
      const { spawn } = await import("node:child_process");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const limits = { ...DEFAULT_LIMITS, ...opts.limits };
      validateFileNames(Object.keys(opts.files ?? {}));
      const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rcx-sbx-")));
      const given = new Set<string>();
      try {
        for (const [name, content] of Object.entries(opts.files ?? {})) {
          // Exclusive creation also catches filesystem-specific aliases beyond our portable check.
          fs.writeFileSync(path.join(work, name), content, { flag: "wx" });
          given.add(name);
        }
      } catch (error) {
        fs.rmSync(work, { recursive: true, force: true });
        throw new Error(`cannot stage exact input files: ${String(error)} (HTTP 400 equivalent: nothing was run)`);
      }
      const wrapped = ["/bin/sh", "-c", LIMITS_SCRIPT, bin, ...args];
      let argv: string[];
      if (kind === "macos-sandbox-exec") {
        fs.writeFileSync(path.join(work, ".rcx.sb"), MAC_PROFILE);
        given.add(".rcx.sb");
        argv = ["/usr/bin/sandbox-exec", "-f", path.join(work, ".rcx.sb"), "-D", `WORK=${work}`, ...wrapped];
      } else {
        argv = [bwrap, "--ro-bind", "/", "/", "--tmpfs", "/home", "--tmpfs", "/root", "--bind", work, work, "--dev", "/dev", "--proc", "/proc", "--unshare-all", "--die-with-parent", "--chdir", work, ...wrapped];
      }
      const env = {
        PATH: "/usr/bin:/bin",
        HOME: work,
        TMPDIR: work,
        LANG: "C",
        LC_ALL: "C",
        TERM: "dumb",
        RCX_CPU: String(Math.max(1, Math.ceil(limits.timeoutMs / 1000))),
        RCX_FSIZE: String(Math.max(1, Math.floor(limits.maxFileBytes / 1024))),
      };
      const t0 = Date.now();
      return await new Promise<SandboxRun>((done) => {
        const p = spawn(argv[0], argv.slice(1), { cwd: work, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
        let out = Buffer.alloc(0);
        let err = Buffer.alloc(0);
        let truncated = false;
        let limit: LimitHit | undefined;
        let finished = false;
        const killGroup = () => {
          try {
            if (p.pid) process.kill(-p.pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        };
        const stop = (why: LimitHit) => {
          limit ??= why;
          killGroup();
        };
        const take = (which: "out" | "err") => (d: Buffer) => {
          const cur = which === "out" ? out : err;
          if (cur.length + d.length > limits.maxOutputBytes) {
            truncated = true;
            stop("output");
            return;
          }
          if (which === "out") out = Buffer.concat([out, d]);
          else err = Buffer.concat([err, d]);
        };
        p.stdout.on("data", take("out"));
        p.stderr.on("data", take("err"));
        p.stdin.on("error", () => {});
        p.stdin.end(opts.stdin ?? "");
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          stop("time");
        }, limits.timeoutMs);
        // Memory and process count, polled for the whole group (rlimits cannot bound either on
        // macOS). Most runs end before the first poll.
        const monitor = setInterval(async () => {
          if (finished || !p.pid) return;
          const u = await groupUsage(p.pid);
          if (!u || finished) return;
          if (u.rss > limits.maxMemoryBytes) stop("memory");
          else if (u.procs > limits.maxProcesses) stop("processes");
        }, 100);
        // The program exited: whatever it left running in its group goes with it.
        p.on("exit", (_code, signal) => {
          if (signal === "SIGXFSZ") limit ??= "file-size";
          if (signal === "SIGXCPU") limit ??= "cpu";
          killGroup();
        });
        const finish = (code: number | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearInterval(monitor);
          killGroup();
          let created: string[] = [];
          try {
            created = fs.readdirSync(work).filter((f) => !given.has(f));
          } catch {
            /* gone */
          }
          fs.rmSync(work, { recursive: true, force: true });
          done({ code, stdout: out.toString("utf8"), stderr: err.toString("utf8"), timedOut, truncated, durationMs: Date.now() - t0, created, workDir: work, ...(limit ? { limit } : {}) });
        };
        p.on("close", finish);
        p.on("error", () => finish(-1));
      });
    },
  };
}
