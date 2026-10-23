import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/interface/http.ts";
import { authorityEvidenceReader, type AuthorityEvidenceSource } from "../src/interface/authority-evidence.ts";
import { RightClick } from "../src/runtime.ts";
import { MemoryStore } from "./helpers.ts";
import { dashboardMetrics, capabilityState } from "../src/interface/dashboard-state.ts";

const record = () => ({ artifactType: "receipt" as const, artifactDigest: "a".repeat(64), actionDigest: "b".repeat(64), targetDigest: "c".repeat(64),
  principal: "isolated-agent", operation: "http.post", outcome: "executed" as const, reason: null,
  occurredAt: "2026-01-01T00:00:00Z" });
const batch = () => ({ version: 1 as const, verifiedAt: new Date().toISOString(), records: [record()] });
const source = (read: AuthorityEvidenceSource["read"]): AuthorityEvidenceSource => ({
  name: "Native verifier", boundary: "Protected resource", trustAnchor: "d".repeat(64), read,
});

test("historical evidence is authenticated, projected and never becomes execution authority or persisted knowledge", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ directories: [], sandbox: null, store,
    authority: { execution: { allowedRisks: [] } } });
  await rc.flush();
  const before = structuredClone(store.state), graph = rc.exportGraph();
  let reads = 0;
  const handler = createHandler(rc, { token: "fixture-only", authorityEvidence: source(async () => {
    reads++;
    return { ...batch(), rawProof: "secret", records: [{ ...record(), body: "private body", credential: "secret" }] };
  }) });
  const request = (method = "GET") => new Request("https://runtime.test/api/authority-evidence",
    { method, headers: { authorization: "Bearer fixture-only" } });
  assert.equal((await handler(new Request(request().url))).status, 401);
  assert.equal(reads, 0);
  const evidence: any = await (await handler(request())).json();
  assert.equal(evidence.status, "available");
  assert.equal(evidence.currentAuthority, "unknown");
  assert.equal(evidence.runtimeLinkage, "not-established");
  assert.deepEqual(evidence.records, [record()]);
  assert.doesNotMatch(JSON.stringify(evidence), /private body|secret|rawProof|credential/);
  assert.equal((await handler(request("POST"))).status, 404);
  assert.equal(reads, 1);
  assert.equal(dashboardMetrics(rc).authorised.value, null);
  assert.equal(capabilityState(rc, "builtin:text.sha256").states.authority.state, "unknown");
  assert.equal((await rc.run("builtin:text.sha256", { text: "blocked" })).status, "failed");
  assert.deepEqual(rc.exportGraph(), graph);
  assert.equal((before as any).authorityEvidence, undefined);
  await rc.flush();
  assert.doesNotMatch(JSON.stringify(store.state), /Protected resource|isolated-agent|private body|dddddddddddd/);
});

test("absence, failed verifier, stale batches and malformed records remain unknown with no stale success fallback", async () => {
  const absent = await authorityEvidenceReader()();
  assert.equal(absent.status, "not-configured");
  for (const mutation of [
    (value: any) => { value.version = 99; },
    (value: any) => { value.verifiedAt = "2020-01-01T00:00:00Z"; },
    (value: any) => { value.verifiedAt = "2100-01-01T00:00:00Z"; },
    (value: any) => { value.records[0].outcome = "authorised"; },
    (value: any) => { value.records[0].artifactType = "permission"; },
    (value: any) => { value.records[0].actionDigest = "raw secret"; },
    (value: any) => { value.records[0].occurredAt = "2100-01-01T00:00:00Z"; },
    (value: any) => { value.records.push(value.records[0]); },
    (value: any) => { value.records = Array(101).fill(record()); },
    (value: any) => { value.records[0].principal = "<img onerror=alert(1)>"; },
  ]) {
    const value = batch(); mutation(value);
    const result = await authorityEvidenceReader(source(async () => value))();
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.records, []);
  }
  let fail = false;
  const read = authorityEvidenceReader(source(async () => { if (fail) throw new Error("secret error"); return batch(); }));
  assert.equal((await read()).status, "available");
  fail = true;
  assert.equal((await read()).status, "unavailable");
  assert.doesNotMatch(JSON.stringify(await read()), /secret error/);
});

test("an unresponsive verifier is bounded to one in-flight call and never blocks runtime tools", async () => {
  let reads = 0, signal: AbortSignal | undefined, resolve!: (value: any) => void;
  const src = { ...source(async s => { reads++; signal = s; return new Promise<any>(yes => { resolve = yes; }); }), timeoutMs: 5 };
  const rc = await RightClick.create({ directories: [], sandbox: null });
  const handler = createHandler(rc, { open: true, authorityEvidence: src });
  const call = async () => (await handler(new Request("https://runtime.test/api/authority-evidence"))).json() as Promise<any>;
  assert.equal((await call()).status, "unavailable");
  assert.equal(signal?.aborted, true);
  assert.equal((await call()).status, "unavailable");
  assert.equal(reads, 1);
  const tools = await (await handler(new Request("https://runtime.test/api/tools"))).json() as unknown[];
  assert.equal(tools.length, 13);
  resolve(batch());
});

test("operator evidence configuration is not an agent or provider-controlled endpoint", async () => {
  assert.throws(() => authorityEvidenceReader({ ...source(async () => batch()), trustAnchor: "self-declared" }));
  assert.throws(() => authorityEvidenceReader({ ...source(async () => batch()), timeoutMs: 100_000 }));
  const rc = await RightClick.create({ directories: [], sandbox: null });
  (rc.graph as any).authorityEvidence = batch();
  const handler = createHandler(rc, { open: true });
  const result: any = await (await handler(new Request("https://runtime.test/api/authority-evidence"))).json();
  assert.equal(result.status, "not-configured");
});

test("operator correlation requires a current-epoch retained run, stays projected and grants nothing", async () => {
  const rc = await RightClick.create({ directories: [], sandbox: null });
  const run = await rc.run("builtin:text.sha256", { text: "known observation" });
  const link = { kind: "operator-correlated", runtimeId: rc.activity.epoch, runId: run.runId,
    capabilityId: run.capability, requestId: crypto.randomUUID() };
  let candidate: any = { ...link, ignoredPrivateBody: "private" };
  const handler = createHandler(rc, { open: true, authorityEvidence: source(async () =>
    ({ ...batch(), records: [{ ...record(), runtimeLink: candidate }] })) });
  const read = async () => (await handler(new Request("https://runtime.test/api/authority-evidence"))).json() as Promise<any>;
  const valid = await read();
  assert.equal(valid.runtimeLinkage, "operator-correlated");
  assert.deepEqual(valid.records[0].runtimeLink, link);
  assert.equal(valid.currentAuthority, "unknown");
  assert.equal(dashboardMetrics(rc).authorised.value, null);
  assert.doesNotMatch(JSON.stringify(valid), /ignoredPrivateBody|private/);
  for (const patch of [{ runtimeId: crypto.randomUUID() }, { runId: "unknown" }, { capabilityId: "unknown" }]) {
    candidate = { ...link, ...patch };
    const result = await read();
    assert.equal(result.status, "available");
    assert.equal(result.runtimeLinkage, "not-established");
    assert.equal(result.records[0].runtimeLink, undefined);
  }
  for (const patch of [{ kind: "signed-runtime-identity" }, { requestId: "not-a-request" }, { runId: "" }]) {
    candidate = { ...link, ...patch };
    assert.equal((await read()).status, "unavailable");
  }
  candidate = link;
  for (let i = 0; i < 501; i++) rc.activity.append({ kind: "control", status: "done" });
  assert.equal((await read()).runtimeLinkage, "not-established");
});
