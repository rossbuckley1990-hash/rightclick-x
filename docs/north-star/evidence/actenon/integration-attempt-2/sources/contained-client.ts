// Development experiment only. Generic HTTP bridge; no provider names or keys.
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { RightClick, type PersistedState } from "../../src/runtime.ts";
import { createHandler } from "../../src/interface/http.ts";

const lines = createInterface({ input: process.stdin });
const pending = new Map<number, (value: any) => void>();
let sequence = 0;
let configure: (value: any) => void;
const configuration = new Promise<any>((resolve) => { configure = resolve; });
lines.on("line", (line) => {
  const value = JSON.parse(line);
  if (value.config) configure(value.config);
  else { pending.get(value.id)?.(value); pending.delete(value.id); }
});
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
async function rpc(op: string, value: object = {}) {
  const id = ++sequence;
  const result = new Promise<any>((resolve) => pending.set(id, resolve));
  send({ id, op, ...value });
  const reply = await result;
  if (!reply.ok) throw new Error(`independent authority refused: ${reply.reason}`);
  return reply;
}
async function bridge(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const reply = await rpc("fetch", { request: {
    url: request.url, method: request.method,
    headers: Object.fromEntries(request.headers),
    body: Buffer.from(await request.arrayBuffer()).toString("base64"),
  } });
  return new Response(Buffer.from(reply.response.body, "base64"), {
    status: reply.response.status, headers: reply.response.headers,
  });
}
const config = await configuration;
let saved: PersistedState | null = config.state ?? null;
const rc = await RightClick.create({ directories: [], fetch: bridge, store: {
  load: async () => saved, save: async (state) => { saved = state; },
} }); // Deliberately no local execution restriction: the outside edge must enforce.
const results: Record<string, unknown> = {};
const attempt = async (f: () => Promise<any>) => {
  try { return await f(); } catch (error) { return { error: String(error) }; }
};
if (config.phase === "discover") {
  await rc.learn({ source: config.origin + "/openapi.json" });
}
const write = rc.graph.list().find((c) => c.invoke.kind === "http" && c.invoke.method === "POST");
if (!write) throw new Error("ordinary OpenAPI discovery did not yield a write capability");
results.capability = { id: write.id, inputs: write.inputs };
results.run = await attempt(() => rc.run(write.id, { label: "approved" }, { confirm: true }));
if (config.phase === "execute") {
  results.duplicate = await attempt(() => rc.run(write.id, { label: "approved" }, { confirm: true }));
  results.changedBody = await attempt(() => rc.run(write.id, { label: "unapproved" }, { confirm: true }));
  const api = createHandler(rc, { open: true });
  results.generatedAPI = await (await api(new Request("http://local/api/run", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: write.id, args: { label: "unapproved" }, confirm: true }),
  }))).text();
  results.lostResponse = await attempt(() => rc.run(write.id, { label: "lost" }, { confirm: true }));
  results.lostRetry = await attempt(() => rc.run(write.id, { label: "lost" }, { confirm: true }));
  results.rawBroker = await attempt(() => bridge(config.origin + "/other", { method: "POST", body: "{}" }));
  results.changedMethod = await attempt(() => bridge(config.origin + "/entries", { method: "DELETE" }));
  results.selfGrant = await attempt(() => rpc("grant", { allow: ["*"] }));
  results.directAPI = await attempt(() => fetch(config.origin + "/entries", {
    method: "POST", body: '{"label":"bypass"}', signal: AbortSignal.timeout(1500),
  }).then((r) => ({ status: r.status })));
  const shell = spawnSync("/bin/sh", ["-c", 'node -e \'fetch(process.argv[1], {method:"POST",body:"bypass",signal:AbortSignal.timeout(1500)}).then(()=>process.exit(0)).catch(()=>process.exit(23))\' "$1"', "probe", config.origin + "/entries"], { timeout: 3000, encoding: "utf8" });
  results.shell = { status: shell.status, error: shell.error?.message };
  results.secretEnvironment = Object.keys(process.env).filter((k) => /TOKEN|SECRET|PASSWORD|ACTENON|RCX_AUTH|API_KEY/.test(k));
  results.dockerSocket = existsSync("/var/run/docker.sock");
  results.trustedState = existsSync("/input/authority.db");
  try { writeFileSync("/input/tamper", "x"); results.readOnlyInput = false; }
  catch { results.readOnlyInput = true; }
}
await rc.flush();
send({ op: "report", phase: config.phase, results, state: saved });
lines.close();
process.stdin.destroy();
