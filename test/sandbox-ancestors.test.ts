// A declared read root has to be *reachable*, not merely readable.
//
// SBPL `subpath` re-allows the root but not the directories above it, and realpath()
// stats every component from `/`. Programs that resolve their own location at startup
// therefore die with EPERM before running a line — which is how every host interpreter
// under a home directory behaves, so an operator declaration silently appears ignored.
// The fix grants stat on ancestors only; these tests hold that line in both directions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFINED_POLICY, DEFAULT_LIMITS, macProfile, type SandboxPolicy } from "../src/core/sandbox.ts";

function policy(over: Partial<SandboxPolicy>): SandboxPolicy {
  return { ...CONFINED_POLICY, limits: DEFAULT_LIMITS, ...over };
}

const ROOT = "/Users/u/Documents/2026/proj";

test("ancestors of a declared root get stat, never listing or reading", () => {
  const { text, params } = macProfile(policy({ readRoots: [ROOT] }), "/tmp/w");
  const line = text.split("\n").find((l) => l.startsWith("(allow file-read-metadata"));
  assert.ok(line, "no ancestor metadata rule was emitted");
  // Metadata only: file-read* would also grant readdir and file contents.
  assert.ok(!line.includes("file-read*"), "ancestors were widened beyond metadata");
  const anc = params.filter((p) => p.startsWith("ANC"));
  for (const ancestor of ["/Users", "/Users/u", "/Users/u/Documents", "/Users/u/Documents/2026"]) {
    assert.ok(anc.some((p) => p.endsWith(`=${ancestor}`)), `${ancestor} was not granted metadata`);
  }
  // The root itself is already allowed in full; only its strict ancestors are listed.
  assert.ok(!anc.some((p) => p.endsWith(`=${ROOT}`)), "the root is not an ancestor of itself");
  // Nothing outside a denied home tree needs the rule, so nothing else is named.
  assert.equal(anc.length, 4, `unexpected ancestor grants: ${anc.join(" ")}`);
  // Last-match-wins only helps if the metadata rule follows the blanket home denial.
  assert.ok(text.indexOf("file-read-metadata") > text.indexOf('(deny file-read* (subpath "/Users")'));
});

test("no ancestor rule is emitted when nothing under a home directory is declared", () => {
  const { text } = macProfile(CONFINED_POLICY, join(tmpdir(), "w"));
  const line = text.split("\n").find((l) => l.startsWith("(allow file-read-metadata"));
  assert.equal(line, undefined, "the confined profile must not touch home ancestors");
});

test("an ancestor inside a barrier stays denied", () => {
  // PATH directories are declared independently of read roots, so one can name a path
  // inside a barrier. Resolution metadata must not punch through it.
  const { text, params } = macProfile(
    policy({ readRoots: [ROOT], readDenyRoots: [`${ROOT}/data`], pathDirs: [`${ROOT}/data/bin`, "/usr/bin"] }),
    "/tmp/w",
  );
  const anc = params.filter((p) => p.startsWith("ANC"));
  assert.ok(!anc.some((p) => p.endsWith(`=${ROOT}/data`)), "a read-deny root was granted metadata");
  assert.ok(!anc.some((p) => p.endsWith(`=${ROOT}/data/bin`)), "a path inside a read-deny root was granted metadata");
  assert.ok(anc.some((p) => p.endsWith("=/Users/u")), "unbarred ancestors were lost");
  assert.ok(text.includes(`(deny file-read* (subpath (param "READDENY0")))`));
});

const canKernel = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");

test("the kernel accepts the generated profile and preserves both properties", { skip: canKernel ? false : "no sandbox-exec" }, () => {
  const work = mkdtempSync(join(tmpdir(), "rcx-anc-work-"));
  // The bug only reproduces under a denied home ancestor, so the fixture has to live there.
  const home = homedir();
  const root = join(home, ".rcx-ancestor-fixture");
  const deep = join(root, "a", "b");
  const secret = join(deep, "private");
  mkdirSync(secret, { recursive: true });
  writeFileSync(join(deep, "visible.txt"), "readable");
  writeFileSync(join(secret, "labels.json"), "CONCEALED");
  const { text, params } = macProfile(
    policy({ readRoots: [root], readDenyRoots: [secret], pathDirs: ["/usr/bin", "/bin"] }),
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
    // The ancestor realpath() has to stat: above the declared root, so denied before the fix.
    const ancestor = run("/usr/bin/stat", "-f", "%N", home);
    assert.equal(ancestor.status, 0, `ancestor stat denied: ${ancestor.stderr}`);
    // Contents of the declared root, and the barrier inside it.
    assert.match(run("/bin/cat", join(deep, "visible.txt")).stdout, /readable/);
    const denied = run("/bin/cat", join(secret, "labels.json"));
    assert.notEqual(denied.status, 0, "the read-deny root became readable");
    assert.match(denied.stderr, /Operation not permitted/);
    // Stat is not listing: the home tree still cannot be enumerated.
    const listing = run("/bin/ls", home);
    assert.notEqual(listing.status, 0, "the home directory became listable");
    assert.match(listing.stderr, /Operation not permitted/);
    assert.ok(!listing.stdout.includes(".rcx-ancestor-fixture"), "the fixture name leaked through ls");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
