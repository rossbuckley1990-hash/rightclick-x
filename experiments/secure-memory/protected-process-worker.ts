// Model-free synthetic actor. Each process receives only its own fixture credential.
import { readFile, writeFile } from "node:fs/promises";
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { sha256, stableStringify } from "../../src/core/ledger.ts";

const [mode, statePath, artifactPath] = process.argv.slice(2);
if (!mode || !statePath || !artifactPath) throw new Error("usage: protected-process-worker MODE STATE ARTIFACT");
const credential = process.env.RCX_FIXTURE_VALUE;
const principal = process.env.RCX_FIXTURE_PRINCIPAL;
if (!credential || !principal) throw new Error("fixture principal and value required");
const wrongCredential = process.env.RCX_FIXTURE_WRONG_VALUE;
const producerOrigin = "https://protected.test", witnessOrigin = "https://witness.test";
const producerId = "openapi:protected:check", witnessId = "openapi:witness:verify";
const ref = { kind: "protected-value-ref" as const, version: 1 as const, slot: "access", purpose: "check", requiredScope: "fixture:read" };
const provider = { openapi: "3.1.0", info: { title: "Protected", version: "1" }, servers: [{ url: producerOrigin }], paths: { "/check": { get: {
  operationId: "check", summary: "Check access", parameters: [
    { name: "x-api-key", in: "header", required: true, schema: { type: "string" } },
    { name: "item", in: "query", required: true, schema: { type: "string" } },
  ], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "boolean" } } } } } } } } };
const witness = { openapi: "3.1.0", info: { title: "Witness", version: "1" }, servers: [{ url: witnessOrigin }], paths: { "/verify": { get: {
  operationId: "verify", summary: "Verify access independently", parameters: [
    { name: "item", in: "query", required: true, schema: { type: "string" } },
    { name: "candidate", in: "query", required: true, schema: { type: "boolean" } },
  ], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } } } };
let grant = mode !== "denied", resolutions = 0, producerCalls = 0, witnessCalls = 0, allHeadersAreOwn = true;
const host = { principal, allowBooleanOutput: true, async withAuthorizedValue<T>(request: any, consume: (value: string) => Promise<T>): Promise<T> {
  resolutions++;
  if (request.principal !== principal || request.capability !== producerId || !/^[a-f0-9]{64}$/.test(request.contract ?? "") || request.origin !== producerOrigin ||
      request.header.toLowerCase() !== "x-api-key" || request.ref?.slot !== ref.slot || request.ref?.requiredScope !== ref.requiredScope || !grant)
    throw new Error("fixture authority denied");
  return consume(mode === "unsafe" ? wrongCredential ?? "" : credential);
} };
const fetcher: typeof fetch = async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (url.pathname === "/openapi.json") return Response.json(url.origin === producerOrigin ? provider : witness);
  if (url.origin === producerOrigin && url.pathname === "/check") {
    producerCalls++;
    const own = request.headers.get("x-api-key") === credential;
    allHeadersAreOwn &&= own;
    // An echo must never leave the protected boundary, even with an innocent key.
    if (mode === "echo") return Response.json({ innocent: request.headers.get("x-api-key") });
    return Response.json(own && ["a", "b"].includes(url.searchParams.get("item") ?? ""));
  }
  if (url.origin === witnessOrigin && url.pathname === "/verify") {
    witnessCalls++;
    return Response.json({ valid: ["a", "b"].includes(url.searchParams.get("item") ?? "") && url.searchParams.get("candidate") === "true" });
  }
  throw new Error("unexpected synthetic request");
};
const rc = await RightClick.create({ store: new FileStore(statePath), directories: [], sandbox: null,
  network: { origins: [producerOrigin, witnessOrigin] }, authority: { publish: "any", shareEvidence: true,
    ...(mode === "policy-denied" ? { execution: { deniedCapabilities: [producerId] } } : {}) },
  protectedValues: host, fetch: fetcher, ...(mode === "recovery" ? { workflowRecovery: true } : {}) } as any);
await rc.learn({ sources: [`${producerOrigin}/openapi.json`, `${witnessOrigin}/openapi.json`] });
await rc.flush();
async function viewEvidence() {
  const serialized = JSON.stringify({ runs: [...rc.runs.values()], activity: rc.activity.snapshot(), graph: rc.graph.list(),
    export: rc.exportKnowledge(), receipts: await rc.verifyReceipts() });
  const digest = await sha256(stableStringify({ "x-api-key": credential, item: "b" }));
  return { viewHasCredential: serialized.includes(credential.length < 8 ? JSON.stringify(credential) : credential), viewHasCredentialDigest: serialized.includes(digest) };
}
if (mode === "create") {
  const r = await rc.compose({ have: { "x-api-key": { type: "id", value: ref }, item: { type: "text", value: "a" } },
    want: "boolean", through: [producerId], run: true, publish: "Protected fixture check", origins: [producerOrigin, witnessOrigin],
    witnesses: [{ capability: witnessId, args: { item: { input: "item" }, candidate: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }] });
  if (!r.published) throw new Error(`fixture publication refused: ${r.publishRefused ?? "unknown"}`);
  await rc.flush();
  const artifact = (rc as any).exportPortableGoal("protected-fixture-check", { "x-api-key": ref }, { approveDefinition: true, portableFixedInputs: [] });
  await writeFile(artifactPath, JSON.stringify(artifact), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ pid: process.pid, status: r.executed?.status, verification: r.executed?.verification.status,
    durable: r.published.durable, producerCalls, witnessCalls, resolutions, allHeadersAreOwn, ...(await viewEvidence()) }));
} else {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const imported = await (rc as any).importPortableGoal(artifact, { approveDefinition: true });
  const initialResolutions = resolutions;
  const result = await rc.run(imported.id, { item: "b" });
  const beforeRevoke = { producerCalls, witnessCalls, resolutions };
  grant = false;
  const after = await rc.run(imported.id, { item: "b" });
  await rc.flush();
  process.stdout.write(JSON.stringify({ pid: process.pid, discovered: !!rc.graph.get(imported.id), initialResolutions,
    status: result.status, output: result.output, verification: result.verification?.status, error: result.error,
    afterStatus: after.status, afterError: after.error, beforeRevoke, producerCalls, witnessCalls, resolutions, allHeadersAreOwn,
    ...(await viewEvidence()) }));
}
