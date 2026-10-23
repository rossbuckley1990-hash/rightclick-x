// Disposable test client. Only an environment catalog is supplied for discovery.
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { dispatch } from "../../src/interface/tools.ts";

const [origin, file, phase, mode] = process.argv.slice(2);
const rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file),
  workflowRecovery: mode !== "leaf",
  network: { blockPrivate: false, origins: [origin] },
  ...(phase === "start" ? { environment: { catalogs: [origin + "/catalog"], origins: [origin] } } : {}),
});
if (phase === "start") {
  await dispatch(rc, "context_research", {});
  const cap = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST" && c.invoke.url.endsWith("/enqueue"))!;
  if (mode === "workflow") {
    const publish = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST" && c.invoke.url.endsWith("/publish"))!;
    rc.graph.addCapability({ id: "composite:process-recovery", provider: "composite:process", source: "composite",
      title: "Process recovery", description: "Controlled retained plan", inputs: cap.inputs,
      outputs: [{ name: "", type: "text", required: true }], risk: "write", tags: [],
      invoke: { kind: "composite", steps: [
        { capability: cap.id, bindings: [{ port: "document", from: "$in.document" }] },
        { capability: publish.id, bindings: [{ port: "sha256", from: "0.sha256" }] },
      ], result: "1.confirmed", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] },
    }, { id: "composite:process", source: "composite", origin: "local", title: "Process fixture", learnedAt: new Date().toISOString() });
  }
  const run = mode === "composition" ? await dispatch(rc, "context_compose", {
    have: { document: { type: "text", value: "A document retained across a process kill." } }, want: "text",
    through: [cap.id, rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST" && c.invoke.url.endsWith("/publish"))!.id],
    run: true, publish: "Compressed document", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }], origins: [origin],
  }) : await dispatch(rc, "context_run", { id: mode === "workflow" ? "composite:process-recovery" : cap.id, args: { document: "A document retained across a process kill." },
    verify: mode === "workflow" ? [] : [{ op: "matches", path: "sha256", pattern: "^[a-f0-9]{64}$" }] });
  console.log(JSON.stringify({ pid: process.pid, run }));
} else {
  const status: any = await dispatch(rc, "context_run_status", {});
  const entry = mode !== "leaf" ? status.pendingWorkflows[0] : status.pendingHttp[0];
  const pending = mode !== "leaf" ? { ...entry, resumeId: entry?.pending.resumeId } : entry;
  if (!pending) throw new Error("no retained HTTP continuation");
  const before = await dispatch(rc, "context_run_status", { runId: pending.runId });
  const run = await dispatch(rc, "context_run", { id: pending.resumeId });
  await rc.flush();
  console.log(JSON.stringify({ pid: process.pid, before, run, receipts: await rc.verifyReceipts() }));
}
await rc.flush();
