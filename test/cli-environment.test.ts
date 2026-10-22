import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { observeCliEnvironment, validCliEnvironment, type CliEnvironment } from "../src/core/cli-environment.ts";
import { CONFINED_POLICY, type SandboxPolicy } from "../src/core/sandbox.ts";

async function fixture(t: TestContext, parent = tmpdir()) {
  const root = await realpath(await mkdtemp(join(parent, "rcx-cli-environment-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pathDir = join(root, "path");
  await mkdir(pathDir);
  const executable = async (path: string, bytes = "executable bytes\n") => {
    await writeFile(path, bytes);
    await chmod(path, 0o755);
    return path;
  };
  const bin = await executable(join(root, "primary"), "primary bytes\n");
  const policy: SandboxPolicy = {
    ...CONFINED_POLICY, readRoots: [root], readDenyRoots: [], writeRoots: [],
    pathDirs: [pathDir, "/usr/bin", "/bin"], limits: { ...CONFINED_POLICY.limits },
  };
  const observe = () => observeCliEnvironment(bin, policy);
  return { root, bin, pathDir, policy, executable, observe };
}
const at = (e: CliEnvironment, path: string) => e.entries.find(entry => entry.path === path);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("unchanged snapshots are deterministic, sorted, partial and structurally valid", async t => {
  const f = await fixture(t);
  const z = await f.executable(join(f.pathDir, "z"), "last\n");
  const a = await f.executable(join(f.pathDir, "a"), "first\n");
  const before = await f.observe();
  assert.deepEqual(before, await f.observe());
  assert.equal(before.version, 1);
  assert.equal(before.coverage, "partial");
  assert.ok(validCliEnvironment(before));
  assert.deepEqual(before.entries, [
    { path: a, real: a, state: "observed", sha256: hash("first\n") },
    { path: z, real: z, state: "observed", sha256: hash("last\n") },
  ]);
  assert.match(before.limitations.join(" "), /Libraries, imports, configuration, credentials, services/);
  assert.match(before.limitations.join(" "), /not atomic execution tracing/);
  assert.ok(!JSON.stringify(before).includes("first\\n"), "contents are not retained in evidence");
});

test("byte changes and atomic replacement with new bytes change the digest", async t => {
  const f = await fixture(t);
  const helper = await f.executable(join(f.pathDir, "helper"), "one\n");
  const before = await f.observe();
  await writeFile(helper, "two\n");
  const changed = await f.observe();
  assert.notEqual(before.digest, changed.digest);
  assert.equal(at(changed, helper)?.sha256, hash("two\n"));
  const replacement = await f.executable(join(f.root, "replacement"), "three\n");
  await rename(replacement, helper);
  const replaced = await f.observe();
  assert.notEqual(changed.digest, replaced.digest);
  assert.equal(at(replaced, helper)?.sha256, hash("three\n"));
  const identical = await f.executable(join(f.root, "identical"), "three\n");
  await rename(identical, helper);
  assert.equal(replaced.digest, (await f.observe()).digest, "this is a content fingerprint, not inode/event tracking");
});

test("executable additions, removals and loss of executable mode change evidence", async t => {
  const f = await fixture(t);
  const empty = await f.observe();
  const helper = await f.executable(join(f.pathDir, "helper"));
  const added = await f.observe();
  assert.notEqual(empty.digest, added.digest);
  await chmod(helper, 0o644);
  const nonExecutable = await f.observe();
  assert.equal(at(nonExecutable, helper), undefined);
  assert.equal(nonExecutable.digest, empty.digest);
  await chmod(helper, 0o755);
  assert.equal((await f.observe()).digest, added.digest);
  await unlink(helper);
  assert.equal((await f.observe()).digest, empty.digest);
});

test("PATH order and all confinement declarations are digest-bound", async t => {
  const f = await fixture(t);
  const second = join(f.root, "second");
  await mkdir(second);
  await f.executable(join(f.pathDir, "tool"));
  await f.executable(join(second, "tool"));
  f.policy.pathDirs.unshift(second);
  const before = await f.observe();
  f.policy.pathDirs.reverse();
  const reordered = await f.observe();
  assert.deepEqual(before.entries, reordered.entries);
  assert.notEqual(before.digest, reordered.digest);
  for (const patch of [
    { readRoots: [] }, { readDenyRoots: [join(f.root, "not-created")] },
    { readDenyPending: [join(f.root, "not-created")] }, { writeRoots: [f.root] },
    { network: true }, { limits: { ...f.policy.limits, timeoutMs: 1234 } },
  ]) {
    const changed = await observeCliEnvironment(f.bin, { ...f.policy, ...patch });
    assert.notEqual(reordered.digest, changed.digest, JSON.stringify(patch));
  }
});

test("primary logical path, real target and symlink aliases are excluded", async t => {
  const f = await fixture(t);
  const primaryTarget = await f.executable(join(f.pathDir, "primary-target"), "primary v1\n");
  const primaryLink = join(f.pathDir, "primary-link");
  const alias = join(f.pathDir, "alias");
  await symlink(primaryTarget, primaryLink);
  await symlink(primaryTarget, alias);
  const observe = () => observeCliEnvironment(primaryLink, f.policy);
  const before = await observe();
  assert.deepEqual(before.entries, []);
  await writeFile(primaryTarget, "primary v2\n");
  assert.equal(before.digest, (await observe()).digest);
});

test("direct literal shebang interpreters are included without executing or parsing options", async t => {
  const f = await fixture(t);
  const interpreter = await f.executable(join(f.root, "interpreter"), "interpreter v1\n");
  const untouched = join(f.root, "must-not-exist");
  await writeFile(f.bin, `#!${interpreter} --flag $(touch ${untouched})\nnot executed\n`);
  const before = await f.observe();
  assert.equal(at(before, interpreter)?.sha256, hash("interpreter v1\n"));
  assert.equal(at(before, f.bin), undefined);
  await assert.rejects(open(untouched), { code: "ENOENT" });
  await writeFile(interpreter, "interpreter v2\n");
  assert.notEqual(before.digest, (await f.observe()).digest);
});

test("PATH scripts expose direct interpreters, not recursive interpreter chains", async t => {
  const f = await fixture(t);
  const chain = await f.executable(join(f.root, "chain"));
  const interpreter = await f.executable(join(f.root, "interpreter"), `#!${chain}\n`);
  await f.executable(join(f.pathDir, "script"), `#!${interpreter}\n`);
  const evidence = await f.observe();
  assert.equal(at(evidence, interpreter)?.state, "observed");
  assert.equal(at(evidence, chain), undefined);
});

test("/usr/bin/env does not cause PATH argument guessing or ungranted reads", async t => {
  const f = await fixture(t);
  const hidden = await f.executable(join(f.root, "hidden-interpreter"));
  await writeFile(f.bin, `#!/usr/bin/env -S ${hidden} --option\n`);
  f.policy.readDenyRoots = ["/usr/bin/env"];
  const evidence = await f.observe();
  assert.equal(at(evidence, "/usr/bin/env")?.state, "unavailable");
  assert.equal(at(evidence, hidden), undefined);
  assert.match(evidence.limitations.join(" "), /no interpreter options.*env PATH guessing/);
});

test("safe symlinks are hashed and retargeting to identical bytes changes the real-path evidence", async t => {
  const f = await fixture(t);
  const a = await f.executable(join(f.root, "target-a"));
  const b = await f.executable(join(f.root, "target-b"));
  const link = join(f.pathDir, "link");
  await symlink(a, link);
  const before = await f.observe();
  assert.equal(at(before, link)?.real, a);
  await unlink(link);
  await symlink(b, link);
  const after = await f.observe();
  assert.equal(at(after, link)?.real, b);
  assert.equal(at(before, link)?.sha256, at(after, link)?.sha256);
  assert.notEqual(before.digest, after.digest);
});

test("logical deny roots and resolved symlink targets are checked before content reads", async t => {
  const f = await fixture(t);
  const denied = join(f.root, "denied");
  await mkdir(denied);
  const secret = await f.executable(join(denied, "secret"), "secret v1\n");
  const visible = await f.executable(join(f.root, "visible"));
  const escape = join(f.pathDir, "escape");
  const logical = join(f.pathDir, "logical-denied");
  await symlink(secret, escape);
  await symlink(visible, logical);
  f.policy.readDenyRoots = [denied, logical];
  const before = await f.observe();
  assert.equal(at(before, escape)?.state, "unavailable");
  assert.equal(at(before, escape)?.sha256, undefined);
  assert.equal(at(before, logical)?.state, "unavailable");
  assert.equal(at(before, logical)?.sha256, undefined);
  await writeFile(secret, "secret v2\n");
  await writeFile(visible, "visible v2\n");
  assert.deepEqual(before, await f.observe(), "denied contents do not affect the fingerprint");
  f.policy.pathDirs.unshift(denied);
  const deniedDirectory = await f.observe();
  assert.equal(at(deniedDirectory, denied)?.state, "unavailable");
  assert.equal(at(deniedDirectory, secret), undefined);
});

test("PATH directory symlinks respect both logical and resolved deny roots", async t => {
  const f = await fixture(t);
  const actual = join(f.root, "actual");
  await mkdir(actual);
  await f.executable(join(actual, "tool"));
  const alias = join(f.root, "alias-directory");
  await symlink(actual, alias);
  f.policy.pathDirs = [alias];
  const visible = await f.observe();
  assert.equal(at(visible, join(alias, "tool"))?.state, "observed");
  assert.equal(at(visible, join(alias, "tool"))?.real, join(actual, "tool"));
  for (const denied of [actual, alias]) {
    f.policy.readDenyRoots = [denied];
    const evidence = await f.observe();
    assert.equal(at(evidence, alias)?.state, "unavailable");
    assert.equal(evidence.entries.length, 1);
    assert.ok(validCliEnvironment(evidence));
  }
});

test("home reads require a read root, not a PATH or write grant; boundaries are component-wise", async t => {
  // A disposable tree under the real home is needed to exercise the actual home barrier.
  const f = await fixture(t, homedir());
  const primary = await fixture(t);
  const helper = await f.executable(join(f.pathDir, "helper"));
  const policy = { ...f.policy, readRoots: [primary.root], writeRoots: [f.root] };
  const denied = await observeCliEnvironment(primary.bin, policy);
  assert.equal(at(denied, f.pathDir)?.state, "unavailable");
  assert.equal(at(denied, helper), undefined);
  policy.readRoots.push(f.pathDir);
  const allowed = await observeCliEnvironment(primary.bin, policy);
  assert.equal(at(allowed, helper)?.state, "observed");
  const sibling = `${f.pathDir}-sibling`;
  await mkdir(sibling);
  const siblingTool = await f.executable(join(sibling, "tool"));
  const link = join(f.pathDir, "escape-home");
  await symlink(siblingTool, link);
  const escaped = await observeCliEnvironment(primary.bin, policy);
  assert.equal(at(escaped, link)?.state, "unavailable");
  assert.equal(at(escaped, link)?.sha256, undefined);
});

test("non-home PATH directories remain readable without pretending readRoots is a global allowlist", async t => {
  const f = await fixture(t);
  const helper = await f.executable(join(f.pathDir, "helper"));
  f.policy.readRoots = [];
  assert.equal(at(await f.observe(), helper)?.state, "observed");
});

test("missing directories, dangling candidates and missing interpreters are unavailable", async t => {
  const f = await fixture(t);
  const missingDir = join(f.root, "missing-dir");
  const missingInterpreter = join(f.root, "missing-interpreter");
  const dangling = join(f.pathDir, "dangling");
  await symlink(join(f.root, "missing-target"), dangling);
  await writeFile(f.bin, `#!${missingInterpreter}\n`);
  f.policy.pathDirs.push(missingDir);
  const evidence = await f.observe();
  for (const path of [missingDir, missingInterpreter, dangling]) {
    assert.equal(at(evidence, path)?.state, "unavailable");
    assert.equal(at(evidence, path)?.sha256, undefined);
  }
  await unlink(f.bin);
  const missingPrimary = await f.observe();
  assert.match(missingPrimary.limitations.join(" "), /Primary target unavailable/);
  assert.equal(at(missingPrimary, f.pathDir)?.state, "unavailable");
  assert.equal(at(missingPrimary, f.bin), undefined);
});

test("readRoots are not scanned recursively and hidden files outside PATH are not claimed", async t => {
  const f = await fixture(t);
  const hidden = await f.executable(join(f.root, ".hidden-tool"));
  const nested = join(f.pathDir, "nested");
  await mkdir(nested);
  const nestedTool = await f.executable(join(nested, "tool"));
  const credential = join(f.pathDir, ".credential");
  await writeFile(credential, "not executable\n", { mode: 0o600 });
  const before = await f.observe();
  assert.deepEqual(before.entries, []);
  await writeFile(hidden, "hidden change\n");
  await writeFile(nestedTool, "nested change\n");
  await writeFile(credential, "credential change\n");
  assert.equal(before.digest, (await f.observe()).digest);
});

async function sparseExecutable(path: string, size: number) {
  const fd = await open(path, "w", 0o755);
  try { await fd.truncate(size); } finally { await fd.close(); }
}

test("overlarge files are bounded without hashing and becoming small is observed", async t => {
  const f = await fixture(t);
  const large = join(f.pathDir, "large");
  await sparseExecutable(large, 32 * 1024 * 1024 + 1);
  const before = await f.observe();
  assert.equal(at(before, large)?.state, "bounded");
  assert.equal(at(before, large)?.sha256, undefined);
  assert.match(before.limitations.join(" "), /32 MiB.*64 MiB/);
  await writeFile(large, "small now\n");
  const after = await f.observe();
  assert.equal(at(after, large)?.sha256, hash("small now\n"));
  assert.notEqual(before.digest, after.digest);
});

test("the total read budget is shared across candidates and the primary header", async t => {
  const f = await fixture(t);
  // Empty primary avoids spending header bytes so two exact-limit files fit.
  await writeFile(f.bin, "");
  for (const name of ["a", "b", "c"]) await sparseExecutable(join(f.pathDir, name), 32 * 1024 * 1024);
  const evidence = await f.observe();
  assert.equal(at(evidence, join(f.pathDir, "a"))?.state, "observed");
  assert.equal(at(evidence, join(f.pathDir, "b"))?.state, "observed");
  assert.equal(at(evidence, join(f.pathDir, "c"))?.state, "bounded");
  assert.equal(evidence.entries.filter(e => e.sha256).length, 2);
  await writeFile(f.bin, "x");
  const withHeader = await f.observe();
  assert.equal(at(withHeader, join(f.pathDir, "b"))?.state, "bounded");
});

test("the listing budget counts non-executable names and is shared across directories", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 64; i++) await writeFile(join(f.pathDir, `data-${i}`), "data\n");
  const second = join(f.root, "second");
  await mkdir(second);
  const tool = await f.executable(join(second, "tool"));
  f.policy.pathDirs.push(second);
  const evidence = await f.observe();
  assert.equal(at(evidence, tool), undefined);
  assert.deepEqual(evidence.entries, [{ path: second, real: second, state: "bounded" }]);
  assert.ok(validCliEnvironment(evidence));
});

test("oversized listings are discarded deterministically", async t => {
  const f = await fixture(t);
  for (let i = 64; i >= 0; i--) await f.executable(join(f.pathDir, `tool-${i}`));
  const before = await f.observe();
  assert.deepEqual(before.entries, [{ path: f.pathDir, real: f.pathDir, state: "bounded" }]);
  assert.deepEqual(before, await f.observe());
  assert.match(before.limitations.join(" "), /incomplete listings are discarded/);
  await writeFile(join(f.pathDir, "tool-64"), "unseen change\n");
  assert.equal(before.digest, (await f.observe()).digest);
  assert.match(before.limitations.join(" "), /Equal digests do not establish unchanged omitted/);
  await unlink(join(f.pathDir, "tool-64"));
  const fitsListing = await f.observe();
  assert.ok(fitsListing.entries.length <= 64);
  assert.ok(fitsListing.entries.some(e => e.state === "bounded"), "the evidence cap has an overflow marker");
  assert.notEqual(before.digest, fitsListing.digest);
});

test("only sixteen explicit directories are eligible and defaults are never scanned", async t => {
  const f = await fixture(t);
  f.policy.pathDirs = ["/bin", "/usr/bin"];
  const tools: string[] = [];
  for (let i = 0; i < 18; i++) {
    const dir = join(f.root, `directory-${i}`);
    await mkdir(dir);
    tools.push(await f.executable(join(dir, "tool")));
    f.policy.pathDirs.push(dir);
  }
  const evidence = await f.observe();
  assert.equal(evidence.entries.filter(e => e.state === "observed").length, 16);
  assert.equal(at(evidence, tools[16]), undefined);
  assert.equal(at(evidence, join(f.root, "directory-16"))?.state, "bounded");
  assert.ok(evidence.entries.every(e => e.path.startsWith(f.root)));
  assert.match(evidence.limitations.join(" "), /first 16 explicit PATH directories/);
});

test("overlong and relative shebangs stay explicitly incomplete", async t => {
  const f = await fixture(t);
  await writeFile(f.bin, `#!/${"x".repeat(5000)}\n`);
  const long = await f.observe();
  assert.match(long.limitations.join(" "), /Shebang bounded/);
  assert.deepEqual(long.entries, []);
  await writeFile(f.bin, "#!relative-interpreter --flag\n");
  assert.match((await f.observe()).limitations.join(" "), /relative or malformed shebang/);
});

test("validator rejects malformed or falsely complete evidence", async t => {
  const f = await fixture(t);
  await f.executable(join(f.pathDir, "helper"));
  const good = await f.observe();
  const bad: unknown[] = [null, [], {}, { ...good, version: 2 }, { ...good, coverage: "complete" },
    { ...good, digest: "bad" }, { ...good, limitations: [] }, { ...good, limitations: [1] },
    { ...good, entries: [null] }, { ...good, entries: Array(65).fill(good.entries[0]) },
    { ...good, entries: Array(1) }, { ...good, limitations: Array(1) },
    { ...good, entries: [good.entries[0], good.entries[0]] }];
  for (const patch of [{ path: "relative" }, { real: 1 }, { sha256: "bad" }, { sha256: undefined },
    { real: undefined }, { state: "complete" }, { state: "bounded" }, { state: "unavailable" }]) {
    bad.push({ ...good, entries: [{ ...good.entries[0], ...patch }] });
  }
  for (const value of bad) assert.equal(validCliEnvironment(value), false, JSON.stringify(value));
  const unknown: unknown = good;
  if (!validCliEnvironment(unknown)) assert.fail("valid evidence rejected");
  const narrowed: CliEnvironment = unknown;
  assert.equal(narrowed.digest, good.digest);
});
