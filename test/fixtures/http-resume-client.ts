// Disposable test client. Only an environment catalog is supplied for discovery.
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { dispatch } from "../../src/interface/tools.ts";

const [origin, file, phase] = process.argv.slice(2);
const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file),
  network: { blockPrivate: false, origins: [origin] },
  ...(phase === "start" ? { environment: { catalogs: [origin + "/catalog"], origins: [origin] } } : {}),
});
if (phase === "start") {
  await dispatch(rc, "context_research", {});
  const cap = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST")!;
  const run = await dispatch(rc, "context_run", { id: cap.id, args: { document: "A document retained across a process kill." },
    verify: [{ op: "matches", path: "sha256", pattern: "^[a-f0-9]{64}$" }] });
  console.log(JSON.stringify({ pid: process.pid, run }));
} else {
  const status: any = await dispatch(rc, "context_run_status", {});
  const pending = status.pendingHttp[0];
  if (!pending) throw new Error("no retained HTTP continuation");
  const before = await dispatch(rc, "context_run_status", { runId: pending.runId });
  const run = await dispatch(rc, "context_run", { id: pending.resumeId });
  await rc.flush();
  console.log(JSON.stringify({ pid: process.pid, before, run, receipts: await rc.verifyReceipts() }));
}
await rc.flush();
