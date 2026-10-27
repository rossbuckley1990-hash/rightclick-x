import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFINED_POLICY, DEFAULT_LIMITS, hostSandbox, macProfile, makeSandbox, type SandboxLimits, type SandboxPolicy } from "../src/core/sandbox.ts";

const ROOT = "/Users/conformance/project";
const limitKeys = Object.keys(DEFAULT_LIMITS) as (keyof SandboxLimits)[];

function declaredPolicy(): SandboxPolicy {
  return {
    readRoots: [ROOT],
    readDenyRoots: [`${ROOT}/blocked`, `${ROOT}/future`],
    readDenyPending: [`${ROOT}/future`],
    writeRoots: [`${ROOT}/writable`],
    pathDirs: [`${ROOT}/bin`, `${ROOT}/blocked/bin`, "/usr/bin"],
    network: true,
    limits: { ...DEFAULT_LIMITS, timeoutMs: 10_000, maxOutputBytes: 128, maxFileBytes: 32 * 1024 * 1024 },
  };
}

for (const kind of ["macos-sandbox-exec", "linux-bwrap"] as const) {
  for (const factor of [0.5, 1, 2]) {
    test(`${kind} revalidation caps every limit without widening tighter limits (${factor}x)`, () => {
      const policy = declaredPolicy();
      for (const key of limitKeys) policy.limits[key] = DEFAULT_LIMITS[key] * factor;
      const before = structuredClone(policy);
      for (const roots of [policy.readRoots, policy.readDenyRoots, policy.readDenyPending!, policy.writeRoots, policy.pathDirs]) Object.freeze(roots);
      Object.freeze(policy.limits);
      Object.freeze(policy);
      const original = makeSandbox(kind, policy, "/usr/bin/bwrap");
      const enforces = [...original.enforces];
      const narrow = original.forRevalidation;
      assert.ok(narrow);
      const sandbox = narrow();
      const limits = { ...DEFAULT_LIMITS };
      for (const key of limitKeys) {
        limits[key] = Math.min(before.limits[key], DEFAULT_LIMITS[key]);
        assert.ok(sandbox.policy.limits[key] <= before.limits[key], key);
        assert.ok(sandbox.policy.limits[key] <= DEFAULT_LIMITS[key], key);
      }
      assert.notEqual(sandbox, original);
      assert.notEqual(sandbox.policy, policy);
      assert.notEqual(sandbox.policy.limits, policy.limits);
      assert.equal(sandbox.kind, kind);
      assert.deepEqual(sandbox.policy, { ...before, network: false, writeRoots: [], limits });
      assert.deepEqual(original.policy, before);
      assert.deepEqual(original.enforces, enforces);
      assert.equal(sandbox.enforces[0], "no network");
      assert.equal(sandbox.enforces[1], "writes only to a fresh temporary directory");
      assert.equal(sandbox.enforces[2], original.enforces[2]);
      assert.equal(sandbox.enforces[3], `PATH limited to ${before.pathDirs.join(":")}`);
      assert.ok(sandbox.enforces.includes(`wall-time ${limits.timeoutMs}ms, CPU-time, per-file ${Math.round(limits.maxFileBytes / (1024 * 1024))}MB, open-file and output limits`));
      assert.ok(sandbox.forRevalidation);
      assert.deepEqual(sandbox.forRevalidation().policy, sandbox.policy);
    });
  }
}

test("an already confined sandbox stays confined and unchanged", () => {
  const before = structuredClone(CONFINED_POLICY);
  const original = makeSandbox("macos-sandbox-exec", CONFINED_POLICY);
  assert.ok(original.forRevalidation);
  const sandbox = original.forRevalidation();
  assert.deepEqual(sandbox.policy, before);
  assert.deepEqual(sandbox.enforces, original.enforces);
  assert.deepEqual(CONFINED_POLICY, before);
});

test("the narrowed macOS profile denies network and preserves read barriers and ancestor restrictions", () => {
  const original = makeSandbox("macos-sandbox-exec", declaredPolicy());
  assert.ok(original.forRevalidation);
  const sandbox = original.forRevalidation();
  const before = macProfile(original.policy, "/tmp/conformance-work");
  const after = macProfile(sandbox.policy, "/tmp/conformance-work");
  assert.equal(after.text, before.text
    .replace("(allow default)\n", "(allow default)\n(deny network*)\n")
    .replace('(allow file-write* (subpath (param "WRITE0")))\n', ""));
  assert.deepEqual(after.params, before.params.filter(p => !p.startsWith("WRITE")));
  assert.ok(!after.params.some(p => p.startsWith("ANC") && (p.endsWith(`=${ROOT}/blocked`) || p.endsWith(`=${ROOT}/blocked/bin`))));
  assert.match(sandbox.enforces[2], /never readable:.*blocked.*future/);
  assert.match(sandbox.enforces[2], /declared before they existed, enforced from creation/);
  assert.equal(sandbox.policy.limits.timeoutMs, DEFAULT_LIMITS.timeoutMs);
  assert.equal(sandbox.policy.limits.maxOutputBytes, 128);
  assert.equal(sandbox.policy.limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes);
});

const native = await hostSandbox();
const local = { skip: native ? false : "native host sandbox unavailable", timeout: 30_000 };
const bwrap = existsSync("/usr/bin/bwrap") ? "/usr/bin/bwrap" : "/bin/bwrap";

function fixture(t: TestContext) {
  assert.ok(native);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rcx-sandbox-conformance-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const readRoot = join(root, "read");
  const pathDir = join(readRoot, "bin");
  const denied = join(readRoot, "blocked");
  const pending = join(readRoot, "future");
  const writable = join(root, "writable");
  for (const dir of [pathDir, denied, writable]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(readRoot, "visible.txt"), "readable\n");
  writeFileSync(join(denied, "secret.txt"), "CONCEALED\n");
  writeFileSync(join(pathDir, "conformance-tool"), '#!/bin/sh\nprintf "%s\\n" "$PATH"\n/bin/cat "$1"\n', { mode: 0o755 });
  const original = makeSandbox(native.kind, {
    ...CONFINED_POLICY,
    readRoots: [readRoot], readDenyRoots: [denied, pending], readDenyPending: [pending],
    writeRoots: [writable], pathDirs: [pathDir], network: true,
    limits: { ...DEFAULT_LIMITS, timeoutMs: 10_000, maxMemoryBytes: 256 * 1024 * 1024 },
  }, bwrap);
  assert.ok(original.forRevalidation);
  const sandbox = original.forRevalidation();
  mkdirSync(pending);
  writeFileSync(join(pending, "secret.txt"), "CONCEALED-LATER\n");
  return { original, sandbox, readRoot, pathDir, denied, pending, writable };
}

test("native revalidation denies declared-root writes but permits private temporary input/output", local, async t => {
  const { original, sandbox, writable } = fixture(t);
  const before = structuredClone(original.policy);
  const target = join(writable, "marker.txt");
  const writeArgs = (file: string, value: string) => ["-c", 'printf "%s" "$2" > "$1"', "write", file, value];
  const allowed = await original.run("/bin/sh", writeArgs(target, "before"));
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(allowed.limit, undefined);
  assert.equal(readFileSync(target, "utf8"), "before");
  const newTarget = join(writable, "new.txt");
  for (const file of [target, newTarget]) {
    const denied = await sandbox.run("/bin/sh", writeArgs(file, "forbidden"));
    assert.notEqual(denied.code, 0);
    assert.equal(denied.limit, undefined);
    assert.match(denied.stderr, /Operation not permitted|Permission denied|Read-only file system/i);
  }
  assert.equal(readFileSync(target, "utf8"), "before");
  assert.equal(existsSync(newTarget), false);
  for (const sb of [original, sandbox]) {
    const io = await sb.run("/bin/sh", ["-c", "/bin/cat input.txt > output.txt && /bin/cat >> output.txt && /bin/cat output.txt"], {
      files: { "input.txt": "input\n" }, stdin: "stdin\n",
    });
    assert.equal(io.code, 0, io.stderr);
    assert.equal(io.limit, undefined);
    assert.equal(io.stdout, "input\nstdin\n");
    assert.deepEqual(io.created, ["output.txt"]);
    assert.equal(existsSync(io.workDir), false);
  }
  const stillAllowed = await original.run("/bin/sh", writeArgs(target, "after"));
  assert.equal(stillAllowed.code, 0, stillAllowed.stderr);
  assert.equal(readFileSync(target, "utf8"), "after");
  assert.deepEqual(original.policy, before);
});

test("native revalidation retains read/PATH barriers and disables network without making requests", local, async t => {
  const { original, sandbox, readRoot, pathDir, denied, pending } = fixture(t);
  assert.equal(original.policy.network, true);
  assert.equal(sandbox.policy.network, false);
  assert.equal(sandbox.enforces[0], "no network");
  for (const sb of [original, sandbox]) {
    const visible = await sb.run("conformance-tool", [join(readRoot, "visible.txt")]);
    assert.equal(visible.code, 0, visible.stderr);
    assert.equal(visible.limit, undefined);
    assert.equal(visible.stdout, `${pathDir}\nreadable\n`);
    for (const dir of [denied, pending]) {
      const hidden = await sb.run("/bin/cat", [join(dir, "secret.txt")]);
      assert.notEqual(hidden.code, 0);
      assert.equal(hidden.limit, undefined);
      assert.equal(hidden.stdout, "");
      assert.match(hidden.stderr, /Operation not permitted|Permission denied|No such file or directory/i);
    }
    const missing = await sb.run("cat", []);
    assert.equal(missing.code, 127, "the restricted PATH must not gain system directories");
    assert.equal(missing.limit, undefined);
  }
  if (sandbox.kind === "macos-sandbox-exec") {
    const profile = await sandbox.run("/bin/cat", [".rcx.sb"]);
    assert.equal(profile.code, 0, profile.stderr);
    assert.match(profile.stdout, /\(deny network\*\)/);
    assert.ok(!profile.stdout.includes('(param "WRITE'));
  } else {
    const before = await original.run("/usr/bin/readlink", ["/proc/self/ns/net"]);
    const after = await sandbox.run("/usr/bin/readlink", ["/proc/self/ns/net"]);
    assert.equal(before.code, 0, before.stderr);
    assert.equal(after.code, 0, after.stderr);
    assert.match(before.stdout, /^net:\[\d+\]\n$/);
    assert.match(after.stdout, /^net:\[\d+\]\n$/);
    assert.notEqual(after.stdout, before.stdout, "revalidation must unshare the network namespace");
  }
});

test("native revalidation enforces a tighter output budget and normal caller overrides still work", local, async () => {
  assert.ok(native);
  const original = makeSandbox(native.kind, { ...CONFINED_POLICY, limits: { ...DEFAULT_LIMITS, maxOutputBytes: 8 } }, bwrap);
  assert.ok(original.forRevalidation);
  const sandbox = original.forRevalidation();
  for (const sb of [original, sandbox]) {
    const limited = await sb.run("/bin/echo", ["0123456789abcdef"]);
    assert.equal(limited.limit, "output");
    assert.equal(limited.truncated, true);
  }
  const overridden = await original.run("/bin/echo", ["0123456789abcdef"], { limits: { maxOutputBytes: 64 } });
  assert.equal(overridden.code, 0, overridden.stderr);
  assert.equal(overridden.limit, undefined);
  assert.equal(overridden.stdout, "0123456789abcdef\n");
  assert.equal(original.policy.limits.maxOutputBytes, 8);
  assert.equal(sandbox.policy.limits.maxOutputBytes, 8);
});
