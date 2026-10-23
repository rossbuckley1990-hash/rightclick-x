// A confined program must not reach the user's session through IPC. Denying file writes and the
// network is not enough when the profile still lets the program talk to services that act
// for it: the macOS pasteboard and LaunchServices, or a Unix socket the Linux bind mount leaves
// in view (the user's systemd bus, docker.sock, an X server, an SSH agent).
//
// Each test first runs the same probe outside the sandbox. A probe that cannot reach the
// service there proves nothing inside, so that case is skipped rather than counted as a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostSandbox } from "../src/core/sandbox.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const mac = process.platform === "darwin";

function outside(bin: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 5000 });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

test("a confined program cannot read the clipboard", { skip: skip || (!mac && "pasteboard is macOS-only") }, async (t) => {
  // In CI the clipboard is set to a marker first, so the check is decisive there. Elsewhere the
  // user's clipboard is compared in memory and never printed or changed.
  if (process.env.CI) {
    try { execFileSync("/usr/bin/pbcopy", { input: `rcx-clipboard-marker-${process.pid}` }); } catch { /* no pasteboard: inconclusive below */ }
  }
  const before = outside("/usr/bin/pbpaste", []);
  if (before.code !== 0 || !before.out) return t.skip("clipboard empty or unreadable outside the sandbox: inconclusive");
  const inside = await sandbox!.run("/usr/bin/pbpaste", []);
  assert.ok(inside.stdout.trim() !== before.out, "the sandboxed program read the user's clipboard");
});

test("a confined program cannot query LaunchServices, which can open applications outside the sandbox", { skip: skip || (!mac && "LaunchServices is macOS-only") }, async (t) => {
  const control = outside("/usr/bin/lsappinfo", ["front"]);
  if (control.code !== 0 || !control.out.startsWith("ASN:")) return t.skip("LaunchServices unavailable outside the sandbox: inconclusive");
  const inside = await sandbox!.run("/usr/bin/lsappinfo", ["front"]);
  assert.ok(!inside.stdout.trim().startsWith("ASN:"), "the sandboxed program reached LaunchServices");
});

test("a confined program cannot enumerate the user's launchd session", {
  skip: skip || (!mac && "launchd is macOS-only"),
  // Known residual, kept visible: launchd answers domain queries over the bootstrap port, which
  // no client-side SBPL operation denies without breaking every program (process-info* does).
  // It discloses service labels, endpoints, unmanaged processes and the session environment.
  todo: mac && "launchd domain queries are not deniable from the client profile",
}, async (t) => {
  const domain = `gui/${process.getuid!()}`;
  const control = outside("/bin/launchctl", ["print", domain]);
  if (control.code !== 0 || !control.out) return t.skip(`launchctl print ${domain} unavailable outside the sandbox: inconclusive`);
  const inside = await sandbox!.run("/bin/launchctl", ["print", domain]);
  assert.ok(inside.code !== 0 || !inside.stdout.includes(`${domain} = {`), "the sandboxed program enumerated launchd's session services");
});

test("a confined program cannot change the user's launchd environment", { skip: skip || (!mac && "launchd is macOS-only") }, async () => {
  // A variable planted here reaches applications launched later, outside any sandbox.
  const name = `RCX_SANDBOX_PROBE_${process.pid}`;
  try {
    await sandbox!.run("/bin/launchctl", ["setenv", name, "set-from-inside"]);
    assert.equal(outside("/bin/launchctl", ["getenv", name]).out, "", "the sandboxed program set a launchd environment variable");
  } finally {
    outside("/bin/launchctl", ["unsetenv", name]);
  }
});

test("confinement keeps ordinary system lookups working (user and host identity)", { skip }, async () => {
  // The control that makes the denials above meaningful: a profile that broke every program
  // would also pass them.
  for (const [bin, args] of [["/usr/bin/id", ["-un"]], ["/bin/uname", ["-s"]]] as const) {
    const want = outside(bin, [...args]);
    if (want.code !== 0) continue;
    const got = await sandbox!.run(bin, [...args]);
    assert.equal(got.code, 0, `${bin} failed inside the sandbox: ${got.stderr}`);
    assert.equal(got.stdout.trim(), want.out);
  }
});

test("a confined program cannot connect to a Unix socket outside its working directory", { skip }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rcx-ipc-")));
  const path = join(dir, "s.sock");
  let accepted = 0;
  const server = createServer((c) => { accepted++; c.end("rcx-socket-reached\n"); });
  await new Promise<void>((done) => server.listen(path, done));
  try {
    // macOS ships nc; the Linux test image does not, but the runtime's own Node is readable there.
    const r = mac
      ? await sandbox!.run("/usr/bin/nc", ["-U", path])
      : await sandbox!.run(process.execPath, ["-e", `require("net").connect(${JSON.stringify(path)}).on("data", d => { process.stdout.write(d); process.exit(0); }).on("error", e => { console.log(e.code); process.exit(3); })`]);
    assert.equal(accepted, 0, "the sandboxed program connected to a socket outside its working directory");
    assert.ok(!r.stdout.includes("rcx-socket-reached"));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime socket directories are not visible inside the Linux sandbox", { skip: skip || (mac && "Linux bind-mount layout") }, async (t) => {
  // /run holds the user's systemd bus (/run/user/UID/bus) and docker.sock; connecting to either
  // as the same user is enough to start an unconfined process.
  if (!outside("/bin/ls", ["-A", "/run"]).out) return t.skip("host /run is empty: inconclusive");
  const r = await sandbox!.run("/bin/ls", ["-A", "/run"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "", `host /run is visible: ${r.stdout.trim().split("\n").slice(0, 5).join(", ")}`);
});
