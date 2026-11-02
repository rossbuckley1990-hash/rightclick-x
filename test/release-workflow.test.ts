// H3 (issue #38): the release pipeline's safety is its job ORDER — the first proposal
// created the GitHub release before completing provenance attestation. The checker in
// ci/check-release-workflow.ts enforces the invariants in CI; these tests prove it
// catches the defects it exists to prevent (each mutant below must be rejected) and
// accepts the real workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkReleaseWorkflow } from "../ci/check-release-workflow.ts";

const real = readFileSync(fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)), "utf8");

const codes = (source: string) => checkReleaseWorkflow(source).map((p) => p.invariant);

test("the real release workflow passes every invariant", () => {
  assert.deepEqual(checkReleaseWorkflow(real), []);
});

test("mutant: publishing before attestation is rejected (the original proposal's defect)", () => {
  const mutant = real
    .replace("needs: [gate, attest]", "needs: [gate]")
    .replace(/  attest:\n/, "  attest_unused:\n");
  const problems = codes(mutant);
  assert.ok(problems.includes("jobs"), "a missing attest job must be rejected");
});

test("mutant: publish that no longer needs attest is rejected", () => {
  const mutant = real.replace("needs: [gate, attest]", "needs: [gate]");
  assert.ok(codes(mutant).includes("order"), "publish must depend on attestation completing first");
});

test("mutant: a build that skips the gate is rejected", () => {
  const mutant = real.replace("needs: gate", "needs: []");
  assert.ok(codes(mutant).includes("order"), "build must need gate");
});

test("mutant: the fail-closed register check removed from the gate is rejected", () => {
  const mutant = real.replace("does not explicitly read GO", "does not read the register");
  assert.ok(codes(mutant).includes("gate"), "the gate must fail closed when the register does not explicitly read GO");
});

test("mutant: the register GO check removed from the gate is rejected", () => {
  const mutant = real.replace("| grep -qE 'Release:\\s*GO\\b'; then", "; then");
  assert.ok(codes(mutant).includes("gate"), "the gate must grep the register body for an explicit GO");
});

test("mutant: the tag/version comparison removed is rejected", () => {
  const mutant = real.replace("if (t !== v)", "if (false)");
  assert.ok(codes(mutant).includes("gate"), "the gate must compare the pushed tag against the package.json version");
});

test("mutant: the protected release environment removed is rejected", () => {
  const mutant = real.replace("environment: release", "environment: preview");
  assert.ok(codes(mutant).includes("publish"), "publish must run in the protected release environment");
});

test("mutant: publishing without a draft first is rejected", () => {
  const mutant = real.replace("dist/* --draft --generate-notes", "dist/* --generate-notes");
  assert.ok(codes(mutant).includes("publish"), "the release must be a draft until verified");
});

test("mutant: broad top-level permissions are rejected", () => {
  const mutant = real.replace("permissions: {}", "permissions:\n  contents: write");
  assert.ok(codes(mutant).includes("permissions"), "top-level permissions must stay empty");
});

test("mutant: an extra write scope on a non-publish job is rejected", () => {
  const mutant = real.replace("    permissions:\n      contents: read\n      issues: read", "    permissions:\n      contents: write\n      issues: read");
  assert.ok(codes(mutant).includes("permissions"), "only publish may write contents");
});

test("mutant: npm publish added to the pipeline is rejected", () => {
  const mutant = real.replace("      - name: publish the verified release", "      - run: npm publish\n        env:\n          NPM_TOKEN: x\n      - name: publish the verified release");
  assert.ok(codes(mutant).includes("publish"), "npm publish is an owner decision, not part of this pipeline");
});

test("mutant: extra triggers that arm the pipeline are rejected", () => {
  const mutant = real.replace("    tags: [\"v*\"]", "    tags: [\"v*\"]\n    branches: [main]");
  assert.ok(codes(mutant).includes("trigger"), "a v* tag is the only trigger");
});

test("mutant: checksum verification removed from publish is rejected", () => {
  const mutant = real.replace("sha256sum --check --strict SHA256SUMS.txt", "cat SHA256SUMS.txt");
  assert.ok(codes(mutant).includes("publish"), "artifacts must be checksum-verified before publishing");
});

test("mutant: an unparseable workflow is rejected, not guessed at", () => {
  assert.ok(codes("jobs: [unclosed").includes("parses"));
  assert.ok(codes("").includes("jobs"));
});
