// Exposed development fixture. Provider operations are learned through normal
// contracts; no hand-written RightClick provider adapter is installed.
import { createInterface } from "node:readline";
import { RightClick, type PersistedState } from "../../src/runtime.ts";
import { createHandler } from "../../src/interface/http.ts";
import type { OutcomeWitness } from "../../src/core/verify.ts";

const lines = createInterface({ input: process.stdin });
const pending = new Map<number, (reply: any) => void>();
let seq = 0;
let configure: (value: any) => void;
const ready = new Promise<any>((resolve) => { configure = resolve; });
lines.on("line", (line) => {
  const value = JSON.parse(line);
  if (value.config) configure(value.config);
  else { pending.get(value.id)?.(value); pending.delete(value.id); }
});
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
async function bridge(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const id = ++seq;
  const response = new Promise<any>((resolve) => pending.set(id, resolve));
  send({ op: "fetch", id, request: { method: request.method, url: request.url,
    headers: Object.fromEntries(request.headers), body: Buffer.from(await request.arrayBuffer()).toString("base64") } });
  const reply = await response;
  if (!reply.ok) throw new Error(`independent authority refused: ${reply.reason}`);
  return new Response(Buffer.from(reply.response.body, "base64"), { status: reply.response.status, headers: reply.response.headers });
}
const config = await ready;
let state: PersistedState | null = config.state;
const rc = await RightClick.create({ directories: [], fetch: bridge, authority: { publish: "verified" },
  store: { load: async () => state, save: async (value) => { state = value; } } });
const result: Record<string, any> = {};
const attempt = async (work: () => Promise<any>) => {
  try { return await work(); } catch (error) { return { error: String(error) }; }
};
const sources = [config.origin + "/openapi.json", config.task.observer + "/openapi.json"];
if (config.phase === "initial") result.learned = await rc.learn({ sources });
else if (!["warm", "ack-only"].includes(config.phase)) result.learned = await rc.learn({ source: sources[0] });
const operation = rc.graph.list().find((c) => c.invoke.kind === "http" && c.invoke.method === "POST");
const fingerprint = rc.graph.list().find((c) => c.invoke.kind === "builtin" && c.invoke.fn === "text.sha256");
const witness = rc.graph.list().find((c) => c.invoke.kind === "http" && c.invoke.url.startsWith(config.task.observer) && c.inputs.some((p) => p.name === "label"));
const witnesses: OutcomeWitness[] = witness ? [{ capability: witness.id,
  args: { label: { input: "label" }, candidate: { output: "" } }, verify: [{ op: "equals", path: "present", value: true }] }] : [];
const goal = config.task.goal ?? "goal:record-label";
if (config.phase === "initial" || config.phase === "approved-move") {
  if (!operation || !witness || !fingerprint) throw new Error("missing normally discovered operation, fingerprint or observer");
  result.compose = await rc.compose({ have: { label: { type: "text", value: config.task.label } }, want: "hash",
    through: [operation.id, fingerprint.id], intent: "append entry and fingerprint label", witnesses, run: true,
    publish: config.phase === "initial" ? "Record label" : "Record moved label" });
} else {
  result.run = await attempt(() => rc.run(goal, { label: config.task.label }, { confirm: true }));
}
if (config.phase === "warm") {
  const handler = createHandler(rc, { open: true });
  const composite = rc.graph.list().find((c) => c.invoke.kind === "composite");
  if (!composite) throw new Error("verified composition was not retained");
  result.deniedComposite = await attempt(() => rc.run(composite.id, { label: "unapproved" }, { confirm: true }));
  result.deniedREST = await (await handler(new Request("https://retained.peer/x/record-label", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "unapproved" }),
  }))).json();
  result.deniedGraphQL = await (await handler(new Request("https://retained.peer/graphql", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: 'mutation { recordLabel(label: "unapproved") { result ok } }' }),
  }))).json();
  // A distinct runtime follows the existing federation path. Both runtimes are
  // in the same contained principal; this is not a multi-host isolation claim.
  const peer = await RightClick.create({ directories: [], fetch: async (input, init) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === "https://retained.peer" ? handler(request) : bridge(request);
  } });
  result.federation = await peer.learn({ source: "https://retained.peer/" });
  const inherited = peer.graph.list().find((c) => c.source === "peer" && c.id.endsWith(goal));
  if (!inherited) throw new Error("peer graph did not expose the retained goal");
  result.peerAllowed = await peer.run(inherited.id, { label: "peer" }, { confirm: true });
  result.peerDenied = await peer.run(inherited.id, { label: "unapproved" }, { confirm: true });
}
if (config.phase === "moved") {
  if (!operation) throw new Error("changed target not discovered");
  result.explicitChangedTarget = await attempt(() => rc.run(operation.id, { label: "moved" }, { confirm: true, acknowledgeChange: true }));
  if (!fingerprint) throw new Error("missing fingerprint operation");
  result.replanChangedTarget = await attempt(() => rc.compose({ have: { label: { type: "text", value: "moved" } }, want: "hash",
    through: [operation.id, fingerprint.id], witnesses, run: true, confirm: true }));
}
await rc.flush();
send({ op: "report", phase: config.phase, results: result, state });
lines.close();
process.stdin.destroy();
