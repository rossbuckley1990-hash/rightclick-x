# Measured execution and reuse

Status: **development measurement checks pass; competitive evidence unestablished; release NO-GO**. This checkpoint continues the same Adaptive Capability Plane programme and branch after the Actenon feasibility and lifecycle experiments. It does not replace the original acceptance matrix, reclassify historical failures, or establish fresh-model reuse.

## Defects and scoring clarification

The old Domain 1 runner counted any successful candidate `context_run` (including a builtin), and any baseline `run_program` call (including a failed invocation), as target execution. It also lacked the actual investigation count required by the corrected reporter. These proxies could credit an answer produced without the requested target invocation.

Before any new competitive pilot, scoring now requires both the agent's answer to match the existing oracle and a completed, usable invocation of the authorised target with the requested input present and output matching that oracle. Investigation and replay probes cannot satisfy task execution. Identity must be unchanged across the invocation; missing identity, launcher failure codes, timeout, truncation and resource-limit results cannot establish usable execution. All original sample sizes, statistical tests, thresholds, lifecycle cases, safety checks and expanded mission requirements remain binding. This strengthens execution evidence; it does not change the oracle or make historical missing measurements pass.

Input presence is exact content matching across supplied stdin/files/literal arguments, including multiplicity. This demonstrates that input was supplied, not that an arbitrary program causally consumed it. The existing oracle and unfamiliar-input/semantic evaluations are still required. A wrapper around sandbox calls is host measurement, **not an OS execution attestation, an independent author review, or an Actenon proof**.

## Implementation and trust boundary

- A host-only `onInvestigationStart` callback runs immediately before real CLI investigation, after the unchanged-program cache check. Sandbox invocations carry telemetry purpose: execution, investigation or revalidation. These fields confer no authority and change no confinement. They are not MCP parameters or persisted grants.
- The same experimental recorder wraps the same host sandbox for A/B/C/D. It records session/target binding, sequence, invocation identity, exact arguments/input, output and limits. It requires complete lifecycle markers and paired starts/completions. Missing, malformed, interrupted or mismatched observations remain unknown. Baseline `agent-run` calls are counted; baseline RCX investigation counts remain null, not zero.
- The candidate's measured host exposes the existing thirteen tools with one authorised program, no workspace filesystem capability, no network, and no configured discovery directories. Raw oracle and observation files are outside its tool surface. The old runner placed them in the exposed workspace; that was an avoidable measurement-tampering route. This is a bounded local benchmark configuration, not a universal containment claim.
- Each attempt gets an exclusive observation log, raw model stdout/stderr, exit status, exact request, MCP log and per-attempt result. Retries retain previous rows and raw files. The reporter refuses acceptance until retry lifecycle costs are reconciled. Source, model and holdout digest must match on resume. A fresh archive is exported from a resolved commit using argv, and local runner dependencies must match that freeze.
- Missing model usage stays missing. The session environment drops inherited paid API/provider credentials, disables built-in tools and user/project/local settings sources. This does **not** independently establish a zero-charge subscription route, eliminate managed configuration or establish absence of all personal context. Verify those before a real model run. No model inference was made for this checkpoint.

## Observed development checks

[Process smoke](evidence/telemetry/process-attempt-1/summary.json) used four real MCP subprocesses and a disposable `shout` fixture. Baseline: one target invocation with matching supplied input/output. Cold candidate: one investigation, 28 investigation sandbox calls, one target execution. Fresh candidate process loading saved state: zero investigations/probes and one successful execution on new input. A successful builtin-only call: zero target executions. The original thirteen tools remain present; no platform filesystem provider is exposed.

The core test separately exercises cached learning in one process, persisted reuse in a new runtime, and portable-knowledge revalidation. Eight observation/accounting tests cover wrong target, wrong input, wrong output, failed launches, resource limits, identity changes, corrupted/interrupted logs, missing oracle eligibility, duplicate input requirements, missing usage and environment isolation. Reporter controls reject incomplete measurements, altered counts/provenance and unaccounted retries. All synthetic test rows are explicitly synthetic and excluded from economic evidence.

The first full development run passed 235 tests with zero failures/skips. One subsequent reporter control was added; the frozen verification records the final suite count. The experimental-host typecheck initially failed because `NetworkPolicy.blockPrivate` was omitted. The diagnostic is retained in `evidence/telemetry/harness-types-attempt-2.log`; the explicit `blockPrivate: true` fix passes. First process observations are preserved, not overwritten. Frozen results and digests are recorded separately after the source commit.

## Reproduce without a model or network

From the source freeze recorded in `evidence/telemetry/verification.json`:

```sh
npm run typecheck
npm test
node experiments/north-star/measurement-smoke.ts /tmp/rcx-measurement-new-output
npm run build
node ci/adaptive-package-smoke.ts
```

Use a fresh output directory: recorders refuse to overwrite previous attempts. The real sandbox tests require a functioning macOS sandbox-exec or Linux bubblewrap environment. A skipped sandbox test is not a pass. The process smoke fails if no sandbox is available. No subscriptions or API keys are needed for these commands; package install smoke is offline. Dependency installation is not part of these commands.

## Remaining critical path

This instrumented runner has not yet been exercised through a real coding-agent session. Its source-freeze/resume preflight is tested separately; these facts must not be reported as a competitive run. Before new holdouts: verify the no-charge model route and fresh context, preserve equivalent access and controls across arms, audit raw artifacts in a separate checking process, account for all attempts and verification/authority work, and run a development pilot on already exposed targets. Only then freeze and select fresh independent holdouts. Independent-author review, real cross-vendor transfer, multi-platform coverage, customer validation and the full mission gates remain open.
