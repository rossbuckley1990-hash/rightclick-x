import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("./portable-process-worker.ts", import.meta.url));
function run(mode: string, state: string, artifact: string): any {
  const child = spawnSync(process.execPath, [worker, mode, state, artifact], { encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir() } });
  assert.equal(child.status, 0, `${mode}: ${child.error ?? ""} ${child.stderr}`);
  return JSON.parse(child.stdout);
}

test("a host-approved ordinary portable goal is imported in a separate process and repeats its witness", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-portable-process-"));
  try {
    const artifact = join(dir, "artifact.json");
    const created = run("create", join(dir, "creator.json"), artifact);
    assert.equal(created.status, "completed");
    assert.equal(created.verification, "verified");
    assert.equal(created.durable, true);
    assert.equal(created.graphHasMetadataCanary, true, "the negative-control provider description must actually be present in the source graph");
    assert.equal(created.artifactHasMetadataCanary, false, "unapproved provider description crossed the portable artifact boundary");
    const serialized = readFileSync(artifact, "utf8");
    assert.ok(!serialized.includes("synthetic-metadata-canary-4927"));
    const denied = run("denied", join(dir, "denied.json"), artifact);
    assert.notEqual(denied.pid, created.pid);
    assert.equal(denied.discovered, true, "discovery does not itself grant execution authority");
    assert.notEqual(denied.status, "completed");
    assert.ok(!denied.observed.includes("https://notes.test/notes/b"), "denied consumer dispatched the producer");
    const inherited = run("inherit", join(dir, "inheritor.json"), artifact);
    assert.notEqual(inherited.pid, created.pid);
    assert.equal(inherited.discovered, true);
    assert.equal(inherited.trust, "unverified", "historical trust must not transfer");
    assert.equal(inherited.status, "completed", inherited.error);
    assert.deepEqual(inherited.output, { text: "beta note" });
    assert.equal(inherited.verification, "verified");
    assert.ok(inherited.observed.includes("https://checker.test/check"), "saved witness must run again");
    // Protected A/B credential resolution is deliberately not claimed by this test.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
