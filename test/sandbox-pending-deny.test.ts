// A barrier has to be declarable before the data it conceals exists.
//
// `RCX_SANDBOX_READ_DENY` used to refuse any path that was not already there, which left
// an operator protecting a generated dataset two choices: manufacture an empty directory
// out-of-band, or write the data first and add the barrier afterwards. The second is the
// one that gets taken under time pressure, and it is the one that leaves a held-out
// answer key readable during exactly the window in which reading it invalidates the
// result. These tests hold the fixed behaviour in both directions — pending deny roots
// resolve and are enforced, and the refusals that made the old rule fail closed still do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFINED_POLICY, DEFAULT_LIMITS, macProfile, pendingDenyRoot, type SandboxPolicy } from "../src/core/sandbox.ts";

function policy(over: Partial<SandboxPolicy>): SandboxPolicy {
  return { ...CONFINED_POLICY, limits: DEFAULT_LIMITS, ...over };
}

// ------------------------------------------- resolution, with no filesystem involved

test("a pending deny root resolves against the longest ancestor that exists", () => {
  const known: Record<string, string> = { "/data": "/data", "/data/proj": "/data/proj" };
  const realpath = (p: string) => {
    if (!(p in known)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    return known[p]!;
  };
  assert.equal(pendingDenyRoot(realpath, "/data/proj/holdout/labels"), "/data/proj/holdout/labels");
  // Only the missing tail is kept literally; everything above is resolved.
  assert.equal(pendingDenyRoot(realpath, "/data/proj/a/b/c"), "/data/proj/a/b/c");
});

test("a symlinked prefix is canonicalised, so the barrier names the real path", () => {
  // The point of routing the existing prefix through realpath: a deny root written
  // against a symlinked project path would otherwise name a path the kernel never
  // compares against, and the barrier would silently exclude nothing.
  const realpath = (p: string) => (p === "/link/proj" ? "/real/proj" : (() => { throw new Error("ENOENT"); })());
  assert.equal(pendingDenyRoot(realpath, "/link/proj/labels"), "/real/proj/labels");
});

test("a deny root with no existing ancestor is refused, not resolved to nothing", () => {
  const realpath = () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  assert.throws(() => pendingDenyRoot(realpath, "/nowhere/a/b"), /no ancestor of \/nowhere\/a\/b exists/);
});

// --------------------------------------------------- the declaration path, end to end

const SANDBOX = fileURLToPath(new URL("../src/core/sandbox.ts", import.meta.url));

function declare(env: Record<string, string>) {
  const script = `
    const { sandboxPolicy, hostSandbox } = await import(${JSON.stringify(SANDBOX)});
    try {
      const p = await sandboxPolicy();
      const sb = await hostSandbox();
      console.log(JSON.stringify({
        ok: true,
        readDenyRoots: p.readDenyRoots,
        readDenyPending: p.readDenyPending ?? [],
        enforces: sb ? sb.enforces : [],
      }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: String(e.message) }));
    }`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  assert.equal(r.status, 0, `probe crashed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as {
    ok: boolean;
    readDenyRoots: string[];
    readDenyPending: string[];
    enforces: string[];
    error?: string;
  };
}

const canKernel = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
const fixture = join(homedir(), ".rcx-pending-deny-fixture");

test("a pending deny root inside a read root is accepted and reported as pending", () => {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(fixture, { recursive: true });
  try {
    const out = declare({
      RCX_SANDBOX_READ: fixture,
      RCX_SANDBOX_READ_DENY: `${fixture}/holdout3/labels`,
    });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.readDenyRoots, [`${realpathSync(fixture)}/holdout3/labels`]);
    assert.deepEqual(out.readDenyPending, out.readDenyRoots, "a pending root was not marked pending");
    // What a capability card is allowed to say about it.
    const line = out.enforces.find((l) => l.includes("never readable"));
    assert.ok(line, `no barrier statement in enforces: ${JSON.stringify(out.enforces)}`);
    assert.match(line!, /declared before they existed, enforced from creation/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a pending deny root outside every read root is still refused", () => {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(fixture, { recursive: true });
  try {
    const out = declare({
      RCX_SANDBOX_READ: fixture,
      RCX_SANDBOX_READ_DENY: join(homedir(), ".rcx-somewhere-else", "labels"),
    });
    assert.equal(out.ok, false, "a barrier that excludes nothing was accepted");
    assert.match(out.error!, /is not inside any RCX_SANDBOX_READ root/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("an existing deny root is not reported as pending", () => {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(join(fixture, "labels"), { recursive: true });
  try {
    const out = declare({ RCX_SANDBOX_READ: fixture, RCX_SANDBOX_READ_DENY: `${fixture}/labels` });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.readDenyPending, [], "an existing root was called pending");
    const line = out.enforces.find((l) => l.includes("never readable"));
    assert.ok(line && !line.includes("declared before they existed"), line);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- what the kernel does

test("data written after the barrier was declared is denied by it", { skip: canKernel ? false : "no sandbox-exec" }, () => {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "visible.txt"), "readable");
  const root = realpathSync(fixture);
  // Resolved while `answers` is absent — the situation the old rule refused outright.
  const denied = pendingDenyRoot(realpathSync, join(root, "answers"));
  const work = mkdtempSync(join(tmpdir(), "rcx-pending-work-"));
  const { text, params } = macProfile(
    policy({ readRoots: [root], readDenyRoots: [denied], pathDirs: ["/usr/bin", "/bin"] }),
    work,
  );
  const profile = join(work, ".rcx.sb");
  writeFileSync(profile, text);
  const run = (...argv: string[]) =>
    spawnSync(
      "/usr/bin/sandbox-exec",
      ["-f", profile, "-D", `WORK=${work}`, ...params.flatMap((p) => ["-D", p]), ...argv],
      { cwd: work, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: work } },
    );
  try {
    assert.match(run("/bin/cat", join(root, "visible.txt")).stdout, /readable/);
    // The concealed data arrives after the profile was generated, which is the whole
    // point: the barrier precedes the bytes rather than chasing them.
    mkdirSync(join(root, "answers"), { recursive: true });
    writeFileSync(join(root, "answers", "labels.json"), "CONCEALED");
    const read = run("/bin/cat", join(root, "answers", "labels.json"));
    assert.notEqual(read.status, 0, "a pending deny root did not deny the data created under it");
    assert.match(read.stderr, /Operation not permitted/);
    assert.ok(!read.stdout.includes("CONCEALED"));
    // Denied means not listable either, or the file names alone still leak.
    const listing = run("/bin/ls", join(root, "answers"));
    assert.notEqual(listing.status, 0, "the barrier left the directory listable");
    assert.match(listing.stderr, /Operation not permitted/);
    // The barrier is scoped: a sibling directory of the denied one stays readable.
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, "public", "notes.txt"), "open");
    assert.match(run("/bin/cat", join(root, "public", "notes.txt")).stdout, /open/);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});
