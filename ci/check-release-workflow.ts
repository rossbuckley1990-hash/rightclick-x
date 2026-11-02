// Release-workflow validation (H3, issue #38). The release pipeline's safety is its JOB
// ORDER: gate (source, version, register GO, protected environment) -> build (checks,
// artifacts, checksums) -> attest (provenance BEFORE any release exists) -> publish
// (protected environment, draft, verify, publish, safe cleanup). A workflow that creates
// the release before attesting — as the first proposal did — is exactly the defect this
// checker exists to prevent. It runs in CI on every change, so a reordering fails the
// build, not just the review.
//
// It parses the workflow with the project's own YAML reader (no new dependencies) and
// asserts the structural invariants. The same assertions are unit-tested against mutated
// workflows in test/release-workflow.test.ts; those mutants must be rejected.

import { parseYaml } from "../src/core/yaml.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

interface Problem {
  readonly invariant: string;
  readonly reason: string;
}

export function checkReleaseWorkflow(source: string): Problem[] {
  const problems: Problem[] = [];
  const fail = (invariant: string, reason: string) => problems.push({ invariant, reason });
  let wf: any;
  try {
    wf = parseYaml(source);
  } catch (e) {
    return [{ invariant: "parses", reason: `the workflow is not valid YAML for the project reader: ${String((e as Error)?.message ?? e)}` }];
  }
  const jobs = wf?.jobs;
  if (!jobs || typeof jobs !== "object") return [{ invariant: "jobs", reason: "no jobs" }];

  // 1. The four jobs exist, in this order.
  for (const name of ["gate", "build", "attest", "publish"]) {
    if (!jobs[name]) fail("jobs", `missing job: ${name}`);
  }
  if (problems.length) return problems;

  // 2. The dependency order enforces the safety sequence.
  const needs = (j: string) => (jobs[j].needs === undefined ? [] : Array.isArray(jobs[j].needs) ? jobs[j].needs : [jobs[j].needs]);
  if (!needs("build").includes("gate")) fail("order", "build must need gate (source, version and policy are verified before anything is built)");
  if (!needs("attest").includes("build")) fail("order", "attest must need build (provenance covers the artifacts that were actually built)");
  if (!needs("publish").includes("attest")) fail("order", "publish must need attest — a release is created only after provenance attestation completes");
  if (!needs("publish").includes("gate")) fail("order", "publish must need gate (the register GO decision cannot be bypassed)");

  // 3. The trigger is a version tag and nothing else.
  const on = wf.on ?? wf.true; // a YAML 1.1 reader may key `on` as boolean true
  const trigger = on?.push?.tags;
  if (!Array.isArray(trigger) || !trigger.some((t: string) => t === "v*")) fail("trigger", "the only trigger is a pushed v* tag");
  if (on?.push?.branches) fail("trigger", "push must trigger on version tags only, not branches");
  if (on?.pull_request || on?.workflow_dispatch || on?.schedule) fail("trigger", "no other triggers may arm the pipeline");

  // 4. Permissions are least-privilege, declared per job (never a broad top-level grant).
  if (wf.permissions && JSON.stringify(wf.permissions) !== "{}") fail("permissions", "top-level permissions must be empty; each job declares its own minimum");
  const jobPermissions: Record<string, string[]> = { gate: ["contents", "issues"], build: ["contents"], attest: ["contents", "id-token", "attestations"], publish: ["contents"] };
  for (const [job, allowed] of Object.entries(jobPermissions)) {
    const p = jobs[job]?.permissions;
    if (!p || typeof p !== "object") { fail("permissions", `${job} must declare its permissions`); continue; }
    for (const scope of Object.keys(p)) if (!allowed.includes(scope)) fail("permissions", `${job} declares unexpected permission scope: ${scope}`);
    if (job === "publish" && p.contents !== "write") fail("permissions", "publish needs contents: write to create the release");
    // contents:write is the release-creating scope: only publish may hold it. attest's
    // id-token/attestations writes are the first-party provenance mechanism, not content.
    if (job !== "publish" && p.contents === "write") fail("permissions", `only publish may write contents (${job} does)`);
  }

  // 5. The gate refuses a NO-GO register and an unprotected release environment. These
  //    match the mechanism (the grep against the register body, the version comparison),
  //    not just the prose of an error message that could survive a removed check.
  // The gate's run text, raw (not JSON-stringified): the grep patterns it uses are the
  // mechanism, and stringification would double their backslashes.
  const gateText = (jobs.gate.steps ?? []).map((s: any) => String(s.run ?? "")).join("\n");
  if (!/grep[^\n]*Release:\\s\*GO/.test(gateText)) fail("gate", "the gate must grep the register body for an explicit GO");
  if (!/NO-GO/.test(gateText)) fail("gate", "the gate must explicitly refuse a NO-GO register");
  if (!/does not explicitly read GO/.test(gateText)) fail("gate", "the gate must fail closed when the register does not explicitly read GO");
  if (!/environments\/release/.test(gateText)) fail("gate", "the gate must verify the release environment is protected");
  if (!/GITHUB_REF_NAME/.test(gateText) || !/if \(t !== v\)/.test(gateText)) fail("gate", "the gate must compare the pushed tag against the package.json version");

  // 6. The build runs the full check suite and checksums its artifacts.
  const buildRun = (jobs.build.steps ?? []).map((s: any) => String(s.run ?? "")).join("\n");
  for (const required of ["npm run typecheck", "npm test", "node proof/run.ts", "SHA256SUMS.txt"]) {
    if (!buildRun.includes(required)) fail("build", `the build must run: ${required}`);
  }

  // 7. The attest job uses the first-party provenance action and holds no write scope.
  const attestSteps: any[] = jobs.attest.steps ?? [];
  if (!attestSteps.some((s) => String(s.uses ?? "").startsWith("actions/attest-build-provenance"))) fail("attest", "provenance must use actions/attest-build-provenance");

  // 8. Publish: protected environment, draft first, verification before publishing, safe cleanup.
  if (jobs.publish.environment !== "release") fail("publish", "publish must run in the protected `release` environment");
  const publishRun = (jobs.publish.steps ?? []).map((s: any) => String(s.run ?? "")).join("\n");
  if (!/create[^\n]*--draft[^\n]*--generate-notes/.test(publishRun)) fail("publish", "the release must be created as a draft first");
  if (!/sha256sum --check/.test(publishRun)) fail("publish", "artifacts must be checksum-verified before publishing");
  if (!/--draft=false/.test(publishRun)) fail("publish", "the draft is published only after verification");
  if (!/gh release delete/.test(publishRun)) fail("publish", "a failed publish must delete its incomplete draft");
  // npm publish is an owner decision and must not appear in any step's commands.
  const everyCommand = (Object.values(jobs) as any[]).flatMap((j) => (j.steps ?? []).flatMap((s: any) => [String(s.run ?? ""), String(s.uses ?? "")])).join("\n");
  if (/npm publish/.test(everyCommand) || /NPM_TOKEN/.test(everyCommand)) fail("publish", "npm publish is not part of this pipeline");

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkReleaseWorkflow(readFileSync(path, "utf8"));
  if (problems.length) {
    for (const p of problems) console.error(`release workflow: [${p.invariant}] ${p.reason}`);
    process.exit(1);
  }
  console.log("release workflow: ordering, permissions, gates and cleanup all verified.");
}
