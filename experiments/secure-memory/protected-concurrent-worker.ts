// Separate synthetic runtime actor; sends only booleans and counters via IPC.
import { RightClick } from "../../src/runtime.ts";
import { reflectOpenAPI } from "../../src/reflectors/openapi.ts";
import { FileStore } from "../../src/entry/node-host.ts";

const [statePath] = process.argv.slice(2);
const principal = process.env.RCX_FIXTURE_PRINCIPAL, own = process.env.RCX_FIXTURE_VALUE;
const wrong = process.env.RCX_FIXTURE_WRONG_VALUE;
if (!statePath || !principal || !own || !process.send) throw new Error("missing synthetic worker configuration");
const send = (v: object) => { if (!process.send?.(v)) throw new Error("synthetic worker IPC unavailable"); };
let grant = true, resolutions = 0, providerCalls = 0;
const queue: string[] = [], waiting: Array<{ command: string; resolve: () => void }> = [];
process.on("message", message => {
  if (typeof message !== "string") return;
  if (message === "revoke-now") { grant = false; send({ phase: "revoked-in-flight", principal }); return; }
  const i = waiting.findIndex(x => x.command === message);
  if (i >= 0) waiting.splice(i, 1)[0].resolve(); else queue.push(message);
});
function command(want: string): Promise<void> {
  const i = queue.indexOf(want);
  if (i >= 0) { queue.splice(i, 1); return Promise.resolve(); }
  return new Promise(resolve => waiting.push({ command: want, resolve }));
}
const ref = { kind: "protected-value-ref" as const, version: 1 as const, slot: "shared-slot", purpose: "read", requiredScope: "fixture:read" };
const capability = "openapi:concurrent:check", origin = "https://concurrent.test";
const spec = { openapi: "3.1.0", info: { title: "Concurrent" }, servers: [{ url: origin }], paths: { "/check": { get: {
  operationId: "check", summary: "Concurrent protected check", parameters: [{ name: "x-api-key", in: "header", required: true, schema: { type: "string" } }],
  responses: { "200": { content: { "application/json": { schema: { type: "boolean" } } } } },
} } } };
const host = { principal, allowBooleanOutput: true, async withAuthorizedValue<T>(request: any, consume: (value: string) => Promise<T>): Promise<T> {
  resolutions++;
  if (request.principal !== principal || request.capability !== capability || request.origin !== origin ||
      request.ref?.slot !== ref.slot || request.ref?.requiredScope !== ref.requiredScope || !grant) throw new Error("fixture authority denied");
  const release = command("dispatch");
  send({ phase: "resolver", principal, resolutions });
  await release;
  return consume(wrong ?? own);
} };
const fetcher: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  providerCalls++;
  const ownHeader = req.headers.get("x-api-key") === own;
  const release = command("release");
  send({ phase: "provider", principal, ownHeader, providerCalls });
  await release;
  return Response.json(ownHeader);
};
const rc = await RightClick.create({ store: new FileStore(statePath), directories: [], sandbox: null,
  network: { origins: [origin] }, protectedValues: host, fetch: fetcher });
rc.graph.add(reflectOpenAPI(spec, `${origin}/openapi.json`));
const first = await rc.run(capability, { "x-api-key": ref });
send({ phase: "first", principal, status: first.status, output: first.output, resolutions, providerCalls });
await command("rerun");
const second = await rc.run(capability, { "x-api-key": ref });
await rc.flush();
send({ phase: "revoked", principal, status: second.status, resolutions, providerCalls });
process.disconnect?.();
