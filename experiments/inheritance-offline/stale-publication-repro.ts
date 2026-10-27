// Model-free, read-only-capability reproduction of a stale active runtime.
// A successful exit means the stale invocation was refused; an exit of 1
// means the requested freshness invariant is violated. This is not a model run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../../src/entry/node-host.ts";
import { RightClick } from "../../src/runtime.ts";

const dir = mkdtempSync(join(tmpdir(), "rcx-stale-publication-"));
try {
  const state = join(dir, "state.json");
  const create = () => RightClick.create({ store: new FileStore(state), directories: [] });
  const options = (value: string) => ({ have: { text: { type: "text" as const, value, fixed: true } },
    want: "hash" as const, through: ["builtin:text.sha256"], run: true, publish: "shared" });
  const writer = await create();
  const first = await writer.compose(options("first"));
  assert.equal(first.published?.durable, true, "initial definition was not durably published");
  await writer.flush();
  const stale = await create();
  const replacement = await writer.compose(options("second"));
  assert.equal(replacement.published?.durable, true, "replacement definition was not durably published");
  await writer.flush();

  let outcome: { status?: string; output?: unknown; error?: string };
  try { outcome = await stale.run("goal:shared", {}); }
  catch (error) { outcome = { status: "refused", error: String((error as Error)?.message ?? error) }; }
  const firstHash = createHash("sha256").update("first").digest("hex");
  const wasStale = outcome.status === "completed" && outcome.output === firstHash;
  console.log(JSON.stringify({ initialDurable: true, replacementDurable: true,
    staleInvocationStatus: outcome.status, staleOutputMatchesOldDefinition: wasStale,
    disposition: wasStale ? "FAIL_STALE_DEFINITION_EXECUTED" : "STALE_DEFINITION_NOT_EXECUTED" }));
  if (wasStale || outcome.status === "completed") process.exitCode = 1;
  // Cancel the stale runtime's delayed save before removing the fixture.
  await stale.flush().catch(() => {});
} finally {
  rmSync(dir, { recursive: true, force: true });
}
