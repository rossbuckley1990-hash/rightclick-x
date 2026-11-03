// RCX_SANDBOX_BWRAP (sandbox override for bwrap outside standard paths): the override is
// probed exactly like the default locations. A path that does not exist, or a binary that
// does not behave as bwrap, must be reported as NO sandbox — never used. Runs the probe in
// a subprocess because hostSandbox() memoises its result per process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SANDBOX = fileURLToPath(new URL("../src/core/sandbox.ts", import.meta.url));

function hostSandboxWith(env: Record<string, string>): { ok: boolean; kind?: string; error?: string } {
  const script = `
    const { hostSandbox } = await import(${JSON.stringify(SANDBOX)});
    const sb = await hostSandbox();
    console.log(JSON.stringify(sb ? { ok: true, kind: sb.kind } : { ok: false }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  assert.equal(r.status, 0, `probe crashed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

test("an override that does not exist is no sandbox (fail closed)", { skip: process.platform !== "linux" }, () => {
  assert.deepEqual(hostSandboxWith({ RCX_SANDBOX_BWRAP: "/nonexistent/bwrap" }), { ok: false });
});

test("an override that is not a working bwrap is no sandbox (fail closed)", { skip: process.platform !== "linux" }, () => {
  // /bin/true exits 0 and prints nothing: the probe demands the exact probe line on stdout.
  assert.deepEqual(hostSandboxWith({ RCX_SANDBOX_BWRAP: "/bin/true" }), { ok: false });
});

test("a non-absolute override is ignored (only absolute paths are honoured)", { skip: process.platform !== "linux" }, () => {
  // "bwrap" alone must not be resolved through PATH: the same fail-closed rule as the defaults.
  assert.deepEqual(hostSandboxWith({ RCX_SANDBOX_BWRAP: "bwrap" }), { ok: false });
});
