import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeState } from "../../src/core/state-format.ts";

const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
function run(mode: string, state: string): any {
  const child = spawnSync(process.execPath, [worker, mode, state], {
    encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir() },
  });
  assert.equal(child.status, 0, `${mode}: ${child.error ?? ""} ${child.stderr}`);
  return JSON.parse(child.stdout);
}

test("a separately executed synthetic inheritor restores an artifact and repeats its witness under its own network authority", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-offline-inheritance-"));
  try {
    const first = join(dir, "first.json"), transferred = join(dir, "transferred.json"), denied = join(dir, "denied.json"),
      compatible = join(dir, "compatible.json"), incompatible = join(dir, "incompatible.json"), removed = join(dir, "removed.json");
    const created = run("create", first);
    assert.equal(created.status, "completed");
    assert.equal(created.verification, "verified");
    assert.equal(created.durable, true);
    const state = decodeState(JSON.parse(readFileSync(first, "utf8")));
    const goal = state.published?.find(g => g.slug === "note-lookup");
    assert.ok(goal?.witnesses?.length, "the transferred artifact retains witness obligations");
    copyFileSync(first, transferred);
    copyFileSync(first, denied);
    copyFileSync(first, compatible);
    copyFileSync(first, incompatible);
    copyFileSync(first, removed);
    const reused = run("inherit", transferred);
    assert.notEqual(created.pid, reused.pid);
    assert.equal(reused.discovered, true);
    assert.equal(reused.status, "completed");
    assert.deepEqual(reused.output, { text: "beta note" });
    assert.equal(reused.verification, "verified");
    assert.ok(reused.observed.includes("http://127.0.0.1:39002/check"), "the independent witness was executed again");
    // This is an external oracle run by the test harness, not by RightClick.
    // It checks an independently known SHA-256 without claiming a CLI capability
    // or weakening the runtime's required sandbox for CLI executions.
    const shasum = "/usr/bin/shasum";
    let localOracle: { status: string; program: string; expected?: string; actual?: string };
    if (existsSync(shasum)) {
      const expected = "22788a4990a27df1feecb5a6b478aea0838a12b63cc9bb9833b130a5f388e63f";
      const check = spawnSync(shasum, ["-a", "256"], { input: reused.output.text, encoding: "utf8", timeout: 5000,
        env: { PATH: "/usr/bin:/bin" } });
      assert.equal(check.status, 0, `shasum: ${check.error ?? ""} ${check.stderr}`);
      const actual = check.stdout.trim().split(/\s+/)[0];
      assert.equal(actual, expected, "the inherited value failed the externally computed local oracle");
      localOracle = { status: "matched", program: shasum, expected, actual };
    } else localOracle = { status: "unavailable", program: shasum };
    const without = run("denied", denied);
    assert.notEqual(without.pid, reused.pid);
    assert.notEqual(without.verification, "verified");
    assert.ok(!without.observed.includes("http://127.0.0.1:39002/check"), "the invoker's egress restriction remains authoritative");
    const upgraded = run("compatible", compatible);
    assert.equal(upgraded.status, "completed");
    assert.equal(upgraded.verification, "verified");
    assert.deepEqual(upgraded.output, { text: "beta note" });
    const refuted = run("incompatible", incompatible);
    assert.notEqual(refuted.verification, "verified", "a changed witness that refutes the outcome must not verify it");
    assert.ok(refuted.observed.includes("http://127.0.0.1:39002/check"));
    const withdrawn = run("removed", removed);
    assert.notEqual(withdrawn.verification, "verified", "a missing witness contract must not verify the goal");
    assert.ok(!withdrawn.observed.includes("http://127.0.0.1:39002/check"));
    // Optional evidence output contains only the synthetic fixture and local runtime state.
    const evidence = process.env.RCX_OFFLINE_EVIDENCE;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      for (const [name, file] of [["creator-state.json", first], ["inheritor-state.json", transferred], ["denied-state.json", denied],
        ["compatible-state.json", compatible], ["refuted-state.json", incompatible], ["removed-state.json", removed]]) copyFileSync(file, join(evidence, name));
      writeFileSync(join(evidence, "invocations.json"), JSON.stringify({ created, reused, localOracle, without, upgraded, refuted, withdrawn }, null, 2) + "\n", { mode: 0o600 });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
