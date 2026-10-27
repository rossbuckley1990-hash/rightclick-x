import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "../src/entry/node-host.ts";
import type { PersistedState } from "../src/runtime.ts";

const worker = fileURLToPath(new URL("./fixtures/nested-lease-process.ts", import.meta.url));
function event(child: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => { cleanup(); resolve(message); };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`worker exited early: ${code}`)); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    child.once("message", onMessage); child.once("exit", onExit); child.once("error", onError);
  });
}
function spawn(file: string, mode: string) { return fork(worker, [file, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] }); }

test("nested owner and its later save retain the file lock across processes without deadlock", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-nested-lease-")), file = join(dir, "state.json");
  const children: ChildProcess[] = [];
  try {
    const state: PersistedState = { version: 2, requirements: [], reflections: [], ledger: {}, receipts: [], published: [] };
    const seed = new FileStore(file); await seed.load(); await seed.save(state);
    const owner = spawn(file, "owner"); children.push(owner);
    const returned = await event(owner);
    assert.equal(returned.event, "parent-returned");
    assert.equal(returned.rmdirBeforeNested, false, "outer cleanup must not remove the lock while nested work is admitted");
    async function competingSave(expected: "refused" | "saved") {
      const rival = spawn(file, "writer"); children.push(rival);
      assert.equal((await event(rival)).event, "ready");
      const result = event(rival); rival.send!("save"); const actual = await result;
      assert.equal(actual.result, expected, JSON.stringify(actual));
      if (expected === "refused") assert.match(actual.error, /lock/);
    }
    await competingSave("refused");
    const nestedSave = event(owner); owner.send!("release-nested");
    const started = await nestedSave;
    assert.equal(started.outcome, "save-started", `admitted nested invocation must retain authority to save: ${JSON.stringify(started)}`);
    await competingSave("refused");
    const finished = event(owner); owner.send!("release-save");
    assert.equal((await finished).result, "completed");
    await competingSave("saved");
  } finally {
    for (const child of children) if (child.connected) child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
