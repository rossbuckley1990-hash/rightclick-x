// Controlled development client. Only generic reflection, planning and saved
// runtime execution are used; the parent owns all grants and native proofs.
import { createInterface } from "node:readline";
import { RightClick, type PersistedState } from "../../src/runtime.ts";
import { createHandler } from "../../src/interface/http.ts";
import { dispatch } from "../../src/interface/tools.ts";
import { TransportRefused } from "../../src/reflectors/net.ts";

const lines = createInterface({ input: process.stdin });
const pending = new Map<number, (reply: any) => void>();
let seq = 0, configure: (value: any) => void;
const ready = new Promise<any>(resolve => { configure = resolve; });
lines.on("line", line => {
  const value = JSON.parse(line);
  if (value.config) configure(value.config);
  else { pending.get(value.id)?.(value); pending.delete(value.id); }
});
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
async function bridge(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init), id = ++seq;
  const response = new Promise<any>(resolve => pending.set(id, resolve));
  send({ op: "fetch", id, request: { method: request.method, url: request.url,
    headers: Object.fromEntries(request.headers), body: Buffer.from(await request.arrayBuffer()).toString("base64") } });
  const reply = await response;
  // An actual HTTP response preserves its status, including pending/redirects
  // and resource refusals. An issuer refusal has no provider response.
  if (!reply.response) throw new TransportRefused(String(reply.reason ?? "no authorised transport response"));
  return new Response(Buffer.from(reply.response.body, "base64"), { status: reply.response.status, headers: reply.response.headers });
}
const config = await ready;
let state: PersistedState | null = config.state;
const rc = await RightClick.create({ directories: [], fetch: bridge, sandbox: null,
  workflowRecovery: config.phase.startsWith("workflow"),
  ...(config.phase === "pause" || config.phase === "workflow-pause" ? { httpContinuation: { maxRequests: 1 } } : {}),
  environment: config.phase === "discover" ? { catalogs: [config.origin + "/catalog"] } : undefined,
  network: { blockPrivate: false, origins: [config.origin] }, authority: { publish: "checked" },
  store: { load: async () => state, save: async value => { state = value; } } });
const result: Record<string, any> = {};
if (config.phase === "discover") result.research = await rc.research({});
const submit = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST");
if (!submit) throw new Error("no ordinarily reflected job operation");
const args = { label: config.task.label, document: config.task.document };
if (config.phase === "workflow-pause") {
  const publish = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST" &&
    c.inputs.some(p => p.name === "sha256"))!;
  if (!publish) throw new Error("no reflected digest publication");
  const plan: any = await dispatch(rc, "context_compose", { have: { label: { type: "text", value: args.label }, document: { type: "text", value: args.document } },
    want: "hash", through: [submit.id, publish.id], run: true, origins: [config.origin],
    publish: "Delivered document digest", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] });
  const selected = plan.plans.find((p: any) => p.steps.length === 2 && p.steps[0].capability === submit.id && p.steps[1].capability === publish.id);
  if (!selected) throw new Error("no ordinary two-step plan");
  result.plan = selected;
  result.compose = plan;
  if (!plan.executed?.pending?.resumeId) throw new Error("no retained composition");
  result.run = await dispatch(rc, "context_run_status", { runId: plan.executed.pending.resumeId.slice(7) });
} else if (config.phase.startsWith("workflow-resume")) {
  if (config.phase === "workflow-resume-changed") {
    const publish = rc.graph.list().find(c => c.invoke.kind === "http" && c.invoke.method === "POST" &&
      c.inputs.some(p => p.name === "sha256"))!;
    if (publish.invoke.kind === "http") publish.invoke.url += "/changed";
  }
  const retained = rc.runStatus().pendingWorkflows?.find(w => w.pending.resumeId);
  if (!retained) throw new Error("no retained workflow");
  result.run = await rc.run(retained.pending.resumeId!);
} else if (config.phase === "publish") {
  result.compose = await rc.compose({ have: { label: { type: "text", value: args.label }, document: { type: "text", value: args.document } },
    want: "hash", through: [submit.id], run: true, publish: "Compressed document digest",
    verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] });
} else if (config.phase === "generated") {
  const handler = createHandler(rc, { open: true });
  const response = await handler(new Request("https://retained.test/x/compressed-document-digest", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }));
  result.generated = { status: response.status, body: await response.json() };
} else if (config.phase.startsWith("resume")) {
  const retained = rc.runStatus().pendingHttp?.[0];
  if (!retained) throw new Error("no persisted HTTP operation");
  result.run = await rc.run(retained.resumeId);
} else if (config.phase === "warm") {
  result.run = await rc.run("goal:compressed-document-digest", args);
} else {
  result.run = await rc.run(submit.id, args, { verify: [{ op: "matches", path: "sha256", pattern: "^[a-f0-9]{64}$" }] });
}
await rc.flush();
result.measurements = { rssBytes: process.memoryUsage().rss, capabilities: rc.graph.list().length,
  providers: rc.graph.providers.size, node: process.version };
send({ op: "report", phase: config.phase, results: result, state });
lines.close();
process.stdin.destroy();
