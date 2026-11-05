// The one way a test file gets the host sandbox for its confinement tests.
//
// Confinement assertions must run, never skip, wherever the host is supposed to confine. macOS
// always ships sandbox-exec, and the linux-bubblewrap CI job sets RCX_EXPECT_SANDBOX=1 after it
// proves bubblewrap works. On those hosts a missing sandbox fails the file's guard test, and so the
// run. Other hosts have no sandbox: the linux-no-sandbox job, and Ubuntu runners whose AppArmor
// restricts user namespaces. There the gated tests skip with a stated reason, and the fail-closed
// tests that run on every host check the refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostSandbox, hostSandboxProbeAttempts, type Sandbox } from "../src/core/sandbox.ts";

export const sandboxExpected = process.platform === "darwin" || process.env.RCX_EXPECT_SANDBOX === "1";

export interface SandboxGate {
  /** The host sandbox, or null when this host has none or the file does not apply here. */
  sandbox: Sandbox | null;
  /** The `skip` option for the file's confinement tests: false, or the reason they cannot run here. */
  skip: string | false;
}

/**
 * Probe the host sandbox for this file and register the file's guard test.
 *
 * Await it at the top of the file, before any test is registered. node:test starts running
 * registered tests while the module is still being evaluated. A probe awaited halfway down the file
 * therefore overlaps the tests above it, including ones that block the event loop in spawnSync.
 *
 * `platforms` is for a file whose fixtures are written for particular sandboxes. On other platforms
 * its tests skip as not applicable, which says nothing about this host's sandbox.
 */
export async function sandboxGate(options: { platforms?: readonly NodeJS.Platform[]; reason?: string } = {}): Promise<SandboxGate> {
  if (options.platforms && !options.platforms.includes(process.platform)) {
    return { sandbox: null, skip: `not applicable on ${process.platform}: ${options.reason ?? `written for ${options.platforms.join(", ")} only`}` };
  }
  const sandbox = await hostSandbox();
  const probe = JSON.stringify(hostSandboxProbeAttempts());
  test("host sandbox guard: this file's confinement tests run wherever the host is expected to confine", (t) => {
    t.diagnostic(`host sandbox: ${sandbox ? `${sandbox.kind} (${sandbox.enforces.join("; ")})` : "none"}; expected: ${sandboxExpected}; probe attempts: ${probe}`);
    if (sandboxExpected) {
      assert.ok(sandbox, `${process.platform} with RCX_EXPECT_SANDBOX=${process.env.RCX_EXPECT_SANDBOX ?? ""} must have a working host sandbox; probe attempts: ${probe}`);
    }
  });
  if (sandbox) return { sandbox, skip: false };
  return {
    sandbox,
    skip: sandboxExpected
      ? "host sandbox expected here but unavailable; this file's guard test fails the run"
      : "no host sandbox on this host, and none is expected here (darwin or RCX_EXPECT_SANDBOX=1)",
  };
}
