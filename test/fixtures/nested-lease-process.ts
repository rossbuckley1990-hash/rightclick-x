import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { FileStore } from "../../src/entry/node-host.ts";

const [file, mode] = process.argv.slice(2);
const store = new FileStore(file);
const state = await store.load();
if (!state) throw new Error("missing fixture state");
const send = (event: string, data: Record<string, unknown> = {}) => process.send?.({ event, ...data });
const nextMessage = () => new Promise<string>(resolve => process.once("message", value => resolve(String(value))));
function barrier() { let open!: () => void; const promise = new Promise<void>(r => { open = r; }); return { promise, open }; }
if (mode === "writer") {
  send("ready");
  await nextMessage();
  try { await store.save(state); send("done", { result: "saved" }); }
  catch (error) { send("done", { result: "refused", error: (error as Error).message }); }
  process.disconnect();
} else {
  const renameStarted = barrier(), releaseRename = barrier(), nestedStarted = barrier(), releaseNested = barrier();
  const rename = fs.rename, rmdir = fs.rmdir;
  let rmdirBeforeNested = false, nestedFinished = false, scope: { active: boolean } | undefined;
  fs.rename = async (...args) => { renameStarted.open(); await releaseRename.promise; return rename(...args); };
  fs.rmdir = async (...args) => { if (!nestedFinished) rmdirBeforeNested = true; return rmdir(...args); };
  syncBuiltinESMExports();
  let nested!: Promise<void>;
  const outer = store.withGoalLease([], async () => {
    scope = (store as any).leaseContext.getStore();
    nested = store.withGoalLease([], async () => {
      nestedStarted.open();
      await releaseNested.promise;
      // This save is initiated by an admitted nested invocation *after* its
      // parent callback returned. It must remain within the owner's lease.
      await store.save(state);
    });
    await nestedStarted.promise;
  });
  // Wait for the explicit cleanup state, rather than guessing a duration. A
  // setImmediate only yields to the owner; it is not the barrier condition.
  while (!scope || scope.active) await new Promise<void>(resolve => setImmediate(resolve));
  send("parent-returned", { rmdirBeforeNested });
  if (await nextMessage() !== "release-nested") throw new Error("bad command");
  releaseNested.open();
  // Either the nested owner's save has reached rename under the lease, or the
  // implementation refused it. The parent observes both outcomes explicitly.
  const outcome = await Promise.race([
    renameStarted.promise.then(() => "save-started"),
    nested.then(() => "nested-finished", error => `nested-refused:${(error as Error).message}`),
  ]);
  send("nested-save", { outcome });
  if (outcome === "save-started") {
    if (await nextMessage() !== "release-save") throw new Error("bad command");
    releaseRename.open();
  }
  try { await nested; nestedFinished = true; await outer; send("done", { result: "completed" }); }
  catch (error) { nestedFinished = true; await outer.catch(() => {}); send("done", { result: "failed", error: (error as Error).message }); }
  fs.rename = rename; fs.rmdir = rmdir; syncBuiltinESMExports(); process.disconnect();
}
