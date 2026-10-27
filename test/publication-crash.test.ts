import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { decodeState } from "../src/core/state-format.ts";

const childPath = fileURLToPath(new URL("./fixtures/publication-crash-child.ts", import.meta.url));
function message(child: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => reject(new Error(`child exited early: ${code ?? signal}`));
    child.once("exit", onExit);
    child.once("error", reject);
    child.once("message", value => { child.off("exit", onExit); resolve(value); });
  });
}

for (const barrier of ["before", "after"] as const) {
  test(`process crash ${barrier} publication rename retains correct state and an orphan lock`, { timeout: 20000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), `rcx-publish-crash-${barrier}-`)), file = join(dir, "state.json");
    let child: ChildProcess | undefined;
    try {
      const creator = await RightClick.create({ store: new FileStore(file), directories: [] });
      const published = await creator.compose({ have: { text: { type: "text", value: "old", fixed: true } },
        want: "hash", through: ["builtin:text.sha256"], run: true, publish: "shared" });
      assert.equal(published.published?.durable, true);
      await creator.flush();
      const old = await readFile(file, "utf8");
      const oldGoal = decodeState(JSON.parse(old)).published!.find(g => g.slug === "shared")!;
      assert.equal(oldGoal.fixed?.text, "old");
      child = fork(childPath, [file, barrier], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      assert.equal((await message(child)).event, "ready");
      const blocked = message(child); child.send!("publish");
      assert.equal((await blocked).event, `${barrier}-rename`);
      assert.ok((await stat(`${file}.lock`)).isDirectory(), "publication must own the lock at the barrier");
      const stateAtBarrier = await readFile(file, "utf8");
      const goalAtBarrier = decodeState(JSON.parse(stateAtBarrier)).published!.find(g => g.slug === "shared")!;
      const temporary = (await readdir(dir)).filter(name => name.startsWith("state.json.") && name.endsWith(".tmp"));
      if (barrier === "before") {
        assert.equal(stateAtBarrier, old, "old bytes are still authoritative before rename");
        assert.equal(temporary.length, 1, "new state has been fully staged");
        const staged = decodeState(JSON.parse(await readFile(join(dir, temporary[0]), "utf8")));
        assert.equal(staged.published!.find(g => g.slug === "shared")!.fixed?.text, "new");
      } else {
        assert.equal(goalAtBarrier.fixed?.text, "new");
        assert.notEqual(goalAtBarrier.revision, oldGoal.revision);
        assert.equal(temporary.length, 0, "the staged file was atomically renamed");
      }
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child.kill("SIGKILL"); await exited;
      assert.equal(await readFile(file, "utf8"), stateAtBarrier, "process termination must not create a mixed snapshot");
      assert.ok((await stat(`${file}.lock`)).isDirectory(), "crash leaves the lock in place");
      // A new runtime can inspect the saved snapshot, but cannot execute or
      // overwrite it while the crash leaves the lock unresolved. Nothing is replayed.
      const fresh = await RightClick.create({ store: new FileStore(file), directories: [] });
      const run = await fresh.run("goal:shared", {});
      assert.notEqual(run.status, "completed");
      assert.match(run.error ?? "", /state conflict/);
      assert.equal(run.output, undefined, "an orphan lock must prevent the goal result from escaping");
      assert.deepEqual(run.steps ?? [], [], "no child action may dispatch while outcome is unresolved");
      await assert.rejects(fresh.flush(), /state conflict/);
      assert.equal(await readFile(file, "utf8"), stateAtBarrier);
    } finally {
      if (child?.connected) child.kill("SIGKILL");
      // Disposable test fixture only; production locks are never auto-cleared.
      await rm(dir, { recursive: true, force: true });
    }
  });
}
