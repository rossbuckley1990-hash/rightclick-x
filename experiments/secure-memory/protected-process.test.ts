import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "../../src/core/ledger.ts";

const worker = fileURLToPath(new URL("./protected-process-worker.ts", import.meta.url));
const creatorSecret = "creator-fixture-secret-98c153a";
const consumerSecret = "consumer-fixture-secret-84b5d2c";
const lowEntropySecret = "0037";
function run(mode: string, dir: string, artifact: string, credential: string, principal: string, wrongCredential?: string): { value: any; output: string } {
  mkdirSync(dir, { recursive: true });
  const child = spawnSync(process.execPath, [worker, mode, join(dir, "state.json"), artifact], { encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir(), RCX_FIXTURE_VALUE: credential, RCX_FIXTURE_PRINCIPAL: principal,
      ...(wrongCredential ? { RCX_FIXTURE_WRONG_VALUE: wrongCredential } : {}) } });
  const safeError = [credential, wrongCredential].filter((v): v is string => !!v).reduce((s, value) => s.split(value).join("[fixture-value]"), `${child.error ?? ""} ${child.stderr}`);
  assert.equal(child.status, 0, `${mode}: ${safeError}`);
  let value: any;
  try { value = JSON.parse(child.stdout); } catch { throw new Error(`${mode}: fixture returned invalid JSON`); }
  return { value, output: `${child.stdout}\n${child.stderr}` };
}
function contents(dir: string): string {
  return readdirSync(dir).map(name => { const path = join(dir, name); return statSync(path).isDirectory() ? contents(path) : readFileSync(path, "utf8"); }).join("\n");
}
async function assertNoLeak(output: string, secrets: string[]) {
  for (const secret of secrets) {
    // A short candidate may coincidentally occur as a substring of an
    // unrelated random digest, so assert the exact JSON string for it.
    assert.ok(!output.includes(secret.length < 8 ? JSON.stringify(secret) : secret), "fixture credential appeared in a saved artifact, record or process output");
    for (const candidate of [secret, stableStringify(secret), stableStringify({ "x-api-key": secret, item: "b" })]) {
      const digest = await sha256(candidate);
      assert.ok(!output.includes(digest), "a directly guessable digest of a fixture credential was retained");
    }
    const headersHash = await sha256(JSON.stringify({ "x-api-key": secret }));
    assert.ok(!output.includes(headersHash.slice(0, 16)), "a guessable credential-header fingerprint was retained");
  }
}

test("distinct fresh processes inherit a witnessed protected goal using only their own authorized credential", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-protected-process-"));
  try {
    const a = join(dir, "creator"), shared = join(dir, "transfer"), b = join(dir, "consumer");
    mkdirSync(shared); const creatorArtifact = join(shared, "creator-goal.json");
    const created = run("create", a, creatorArtifact, creatorSecret, "creator");
    assert.equal(created.value.status, "completed");
    assert.equal(created.value.verification, "verified");
    assert.equal(created.value.durable, true);
    assert.equal(created.value.allHeadersAreOwn, true);
    assert.equal(created.value.viewHasCredential, false); assert.equal(created.value.viewHasCredentialDigest, false);
    assert.equal(created.value.producerCalls, 1); assert.equal(created.value.witnessCalls, 1);
    await assertNoLeak(`${created.output}\n${contents(a)}\n${contents(shared)}`, [creatorSecret]);

    // The creator's workspace is removed before a receiver starts. Only the
    // portable artifact is transferred; this is not OS-hostile-code isolation.
    mkdirSync(b); const consumerArtifact = join(b, "artifact.json"); copyFileSync(creatorArtifact, consumerArtifact);
    rmSync(a, { recursive: true, force: true }); rmSync(shared, { recursive: true, force: true });
    const denied = run("denied", join(dir, "denied"), consumerArtifact, consumerSecret, "consumer");
    assert.equal(denied.value.discovered, true);
    assert.equal(denied.value.initialResolutions, 0, "import or inspection resolved a protected value");
    assert.notEqual(denied.value.status, "completed"); assert.equal(denied.value.producerCalls, 0);
    assert.equal(denied.value.viewHasCredential, false);
    const policyDenied = run("policy-denied", join(dir, "policy-denied"), consumerArtifact, consumerSecret, "consumer");
    assert.notEqual(policyDenied.value.status, "completed");
    assert.equal(policyDenied.value.resolutions, 0, "execution authority must be checked before resolving a protected value");
    assert.equal(policyDenied.value.producerCalls, 0);

    const inherited = run("inherit", b, consumerArtifact, consumerSecret, "consumer");
    assert.notEqual(inherited.value.pid, created.value.pid);
    assert.equal(inherited.value.initialResolutions, 0, "import must not resolve a credential");
    const safeError = String(inherited.value.error ?? "").split(consumerSecret).join("[fixture-value]").split(creatorSecret).join("[fixture-value]");
    assert.equal(inherited.value.status, "completed", safeError);
    assert.equal(inherited.value.output, true);
    assert.equal(inherited.value.verification, "verified");
    assert.equal(inherited.value.beforeRevoke.producerCalls, 1);
    assert.equal(inherited.value.beforeRevoke.witnessCalls, 1);
    assert.equal(inherited.value.allHeadersAreOwn, true, "consumer did not use its own fixture credential");
    assert.equal(inherited.value.viewHasCredential, false); assert.equal(inherited.value.viewHasCredentialDigest, false);
    assert.notEqual(inherited.value.afterStatus, "completed", "revoked resolution must fail");
    assert.equal(inherited.value.producerCalls, 1, "revocation permitted a second dispatch");
    assert.equal(inherited.value.resolutions, inherited.value.beforeRevoke.resolutions + 1, "revoked invocation did not recheck authorization");
    await assertNoLeak(`${created.output}\n${denied.output}\n${policyDenied.output}\n${inherited.output}\n${contents(dir)}`, [creatorSecret, consumerSecret]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("protected provider echoes and guessable values do not enter persisted records", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-protected-canary-"));
  try {
    const artifact = join(dir, "artifact.json");
    const created = run("create", join(dir, "creator"), artifact, creatorSecret, "creator");
    const echo = run("echo", join(dir, "echo"), artifact, lowEntropySecret, "consumer");
    assert.notEqual(echo.value.status, "completed");
    assert.equal(echo.value.producerCalls, 1, "protected error must not be automatically retried");
    assert.equal(echo.value.viewHasCredential, false); assert.equal(echo.value.viewHasCredentialDigest, false);
    const recovery = run("recovery", join(dir, "recovery"), artifact, consumerSecret, "consumer");
    assert.notEqual(recovery.value.status, "completed");
    assert.equal(recovery.value.resolutions, 0, "unsupported protected recovery must refuse before resolution");
    assert.equal(recovery.value.producerCalls, 0, "unsupported protected recovery dispatched an operation");
    await assertNoLeak(`${created.output}\n${echo.output}\n${contents(dir)}`, [creatorSecret, lowEntropySecret]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("negative control can guess an unkeyed low-entropy receipt digest", async () => {
  const unsafe = await sha256(stableStringify({ "x-api-key": lowEntropySecret, item: "b" }));
  let guessed = false;
  for (let n = 0; n < 100; n++) {
    if (await sha256(stableStringify({ "x-api-key": String(n).padStart(4, "0"), item: "b" })) === unsafe) { guessed = true; break; }
  }
  assert.equal(guessed, true, "the negative control must detect a guessable public digest");
});

test("negative control detects a host that resolves the creator credential for the consumer", { timeout: 30000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-protected-wrong-host-"));
  try {
    const artifact = join(dir, "artifact.json");
    run("create", join(dir, "creator"), artifact, creatorSecret, "creator");
    // Intentionally compromised fixture host is given the creator value only in
    // this negative-control run. A real host is the trusted identity boundary.
    const unsafe = run("unsafe", join(dir, "consumer"), artifact, consumerSecret, "consumer", creatorSecret);
    assert.equal(unsafe.value.allHeadersAreOwn, false, "the fixture failed to detect cross-principal credential substitution");
    assert.notEqual(unsafe.value.verification, "verified", "incorrect credential must not produce the verified outcome");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("negative control detects a host that ignores grant revocation", { timeout: 30000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-protected-wrong-revocation-"));
  try {
    const artifact = join(dir, "artifact.json");
    run("create", join(dir, "creator"), artifact, creatorSecret, "creator");
    // The intentionally defective host ignores the changed grant. A trusted
    // embedding host must actually enforce revocation around consume().
    const unsafe = run("unsafe-revocation", join(dir, "consumer"), artifact, consumerSecret, "consumer");
    assert.equal(unsafe.value.beforeRevoke.producerCalls, 1);
    assert.equal(unsafe.value.producerCalls, 2, "the fixture failed to detect dispatch after revocation");
    assert.equal(unsafe.value.afterStatus, "completed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
