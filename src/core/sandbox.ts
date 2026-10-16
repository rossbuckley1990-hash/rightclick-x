// Confined execution of local programs: the only way RightClick X runs a command-line program.
// No shell (argv only), no network, writes only into a fresh temporary directory that is
// deleted afterwards, no reads under user home directories except that directory, a scrubbed
// environment, and hard limits on time and output. Where the OS offers no such sandbox,
// execution is refused ("unavailable"), never run unconfined.

export interface SandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  /** Files present in the working directory afterwards that were not given as inputs. */
  created: string[];
}

export const DEFAULT_LIMITS: SandboxLimits = { timeoutMs: 5000, maxOutputBytes: 1_000_000 };

const MAC_PROFILE = `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath (param "WORK")) (literal "/dev/null") (literal "/dev/tty"))
(deny file-read* (subpath "/Users") (subpath "/home") (subpath "/root"))
(allow file-read* (subpath (param "WORK")))
`;

export interface Sandbox {
  kind: "macos-sandbox-exec" | "linux-bwrap";
  run(bin: string, args: string[], opts?: { stdin?: string; files?: Record<string, string>; limits?: Partial<SandboxLimits> }): Promise<SandboxRun>;
}

/** The sandbox available on this host, or null (then programs are not investigated or run). */
export async function hostSandbox(): Promise<Sandbox | null> {
  const g = globalThis as any;
  if (!g.process?.versions?.node) return null;
  const fs = await import("node:fs");
  if (g.process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec")) return makeSandbox("macos-sandbox-exec");
  // Linux: bubblewrap. Implemented but not exercised on the development machine (macOS).
  for (const p of ["/usr/bin/bwrap", "/bin/bwrap"]) if (g.process.platform === "linux" && fs.existsSync(p)) return makeSandbox("linux-bwrap", p);
  return null;
}

function makeSandbox(kind: Sandbox["kind"], bwrap = ""): Sandbox {
  return {
    kind,
    async run(bin, args, opts = {}) {
      const { spawn } = await import("node:child_process");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const limits = { ...DEFAULT_LIMITS, ...opts.limits };
      const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rcx-sbx-")));
      const given = new Set<string>();
      for (const [name, content] of Object.entries(opts.files ?? {})) {
        const safe = path.basename(name);
        fs.writeFileSync(path.join(work, safe), content);
        given.add(safe);
      }
      let argv: string[];
      if (kind === "macos-sandbox-exec") {
        fs.writeFileSync(path.join(work, ".rcx.sb"), MAC_PROFILE);
        given.add(".rcx.sb");
        argv = ["/usr/bin/sandbox-exec", "-f", path.join(work, ".rcx.sb"), "-D", `WORK=${work}`, bin, ...args];
      } else {
        argv = [bwrap, "--ro-bind", "/", "/", "--tmpfs", "/home", "--tmpfs", "/root", "--bind", work, work, "--dev", "/dev", "--proc", "/proc", "--unshare-all", "--die-with-parent", "--chdir", work, bin, ...args];
      }
      const t0 = Date.now();
      return await new Promise<SandboxRun>((done) => {
        const p = spawn(argv[0], argv.slice(1), { cwd: work, env: { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, LANG: "C", LC_ALL: "C", TERM: "dumb" }, stdio: ["pipe", "pipe", "pipe"] });
        let out = Buffer.alloc(0);
        let err = Buffer.alloc(0);
        let truncated = false;
        const take = (which: "out" | "err") => (d: Buffer) => {
          const cur = which === "out" ? out : err;
          if (cur.length + d.length > limits.maxOutputBytes) {
            truncated = true;
            p.kill("SIGKILL");
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
          p.kill("SIGKILL");
        }, limits.timeoutMs);
        const finish = (code: number | null) => {
          clearTimeout(timer);
          let created: string[] = [];
          try {
            created = fs.readdirSync(work).filter((f) => !given.has(f));
          } catch {
            /* gone */
          }
          fs.rmSync(work, { recursive: true, force: true });
          done({ code, stdout: out.toString("utf8"), stderr: err.toString("utf8"), timedOut, truncated, durationMs: Date.now() - t0, created });
        };
        p.on("close", finish);
        p.on("error", () => finish(-1));
      });
    },
  };
}
