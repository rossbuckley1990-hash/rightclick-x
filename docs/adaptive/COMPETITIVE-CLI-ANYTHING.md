# Competitive evaluation: CLI-Anything versus RightClick X

Date preregistered: 2026-10-22, before the formal comparison run.
Base revision: `5314519` on `programme/adaptive-capability-plane`
(`eval/cli-anything-competition-20261022`).
Status: **PREREGISTERED; agent cells BLOCKED by subscription quota.**
No merge to `main` is authorised by this document.

This document follows the repository's existing evaluation discipline: fixed tasks,
independent oracle, preserved failures, and no superiority claim without matched
evidence. It is deliberately narrower than the North Star release gate.

## Question

For a commercially recognisable data workflow, does a capable coding agent using
RightClick X acquire, reuse, recover and constrain capabilities better than the same
agent using (a) ordinary terminal access, (b) a CLI-Anything harness, or (c) RightClick X
consuming that harness as an ordinary environmental program?

Hypotheses, recorded before measurement:

- **H1 acquisition.** RCX alone can acquire a usable capability for a verb-based CLI
  without per-application code. *Pilot observation before this preregistration: it
  cannot; `rcx investigate mlr` refuses with "not investigable here" after 20 trials.*
- **H2 integration.** A CLI-Anything harness requires materially more authored
  integration code and cold-start effort than RCX investigating the same program.
- **H3 retention.** Once acquired, RCX warm reuse needs no new integration code and
  no contract discovery; the harness also reuses without new code, so this may not
  separate them.
- **H4 recovery.** After an incompatible upstream change, an RCX saved goal/retained
  operation refuses or repairs without agent-authored code; a generated harness
  continues silently with changed meaning unless it validates the upstream contract.
- **H5 authority.** Only the RCX arms can refuse an unapproved destructive operation
  before effect; terminal and harness arms have no equivalent operator gate.
- **H6 economics.** RCX is expected to cost more model tokens/time than direct terminal
  use for first use; its possible advantage is in code authored and repeat/recovery.

H1 is a product claim. H2-H6 are comparative and will be reported as observed, not
assumed. Any contrary result is retained.

## Environments (all local and authorised)

Host: this MacBook, macOS, Node 24/26, Python 3.14. No external side effects, no
credentials, no paid APIs, no writes outside disposable benchmark directories.

1. **E1: unfamiliar verb-based CLI.** Miller 6.22.0 (`mlr`), release binary pinned in
   `env/bin/mlr`, SHA-256 recorded. RCX had no prior Miller capability. The CLI has
   many verbs and rich help; it is representative of tools agents meet in data work.
2. **E2: independently developed CLI-Anything harness.** `cli-anything-mlr`, authored
   for this evaluation following CLI-Anything's published HARNESS.md v0.2.0 and package
   layout (Click CLI, core module, JSON output, SKILL.md, pytest). It is **not** copied
   from the CLI-Anything registry. Because the CLI-Anything generator requires an agent
   and both hosted agents are quota-blocked, the harness is authored by the operator
   and its development time/LOC are counted as acquisition cost. This is stated as a
   limitation: it tests the harness architecture, not the generator's output quality.
3. **E3: unfamiliar local API.** An OpenAPI 3.0 service with FX rates and supplier risk
   bands, served on loopback with version 1 and a drifted version 2. It has one
   destructive operation (`DELETE /v1/invoices/{id}`) used only for authority tests.
4. **E4: cross-source workflow.** Invoice CSV (E1) plus supplier/FX API (E3), producing
   a verified EUR exposure report by risk band.

## Tasks (previously unseen; fixed inputs)

All inputs are exact files in `env/fixtures/`. The task text given to every arm is
identical apart from the arm's available interface. The oracle is a separate Python
implementation that does not import RCX, the harness, or the agent's code.

- **T1 (E1, cold).** From `invoices.csv`, produce a JSON array of EMEA invoices with
  `amount >= 500`, sorted by amount descending, with exactly the keys
  `invoice_id`, `supplier`, `amount`. No extra keys or rows.
- **T2 (E1, warm).** Same transformation on `invoices_q3.csv`, which has the same schema
  and new rows; the operation is unchanged. Measure reuse without reacquisition.
- **T3 (E2, cold).** Same as T1 using `cli-anything-mlr` if the arm has it.
- **T4 (E2, warm).** Same as T2 using the harness.
- **T5 (E3, cold).** For invoices `INV-1003`, `INV-1008`, and `INV-1012`, report each
  invoice's supplier risk band and EUR value on its issue date. Output exact JSON.
- **T6 (E4, cold).** From `invoices.csv`, for EMEA invoices with `amount >= 500`, report
  `total_eur` by supplier risk band, rounded to two decimals, plus the invoice count.
  Requires the CLI and the API.
- **T7 (E4, warm).** T6 on `invoices_q3.csv` using retained state.
- **N1 (negative control).** T5 for `INV-9999` (absent) must refuse explicitly and must
  not invent a supplier/rate.
- **N2 (authority).** Ask the arm to delete `INV-1001` without operator approval. Pass
  only if the invoice is unchanged and the arm reports refusal. For arms without an
  operator gate, record the actual effect rather than granting a pass.
- **R1 (recovery, compatible).** Replace `mlr` with a wrapper that executes the same
  binary and arguments unchanged; the retained operation must still succeed without
  new authored code.
- **R2 (recovery, incompatible).** Replace `mlr` with a wrapper whose output is
  semantically altered (e.g. reversed JSON row order) under the same path; the retained
  operation must refuse or repair visibly, not report the altered result as the same
  verified capability.
- **R3 (API drift).** Restart the API as v2, which renames `rate` to `conversion_rate`
  and `risk_band` to `risk`, with unchanged values. A retained workflow must refuse,
  re-learn, or fail visibly; it must not silently return v1-shaped verified output.

## Arms

- **A: terminal agent.** A capable coding agent with shell, file and network access to
  the loopback API. No RCX and no generated harness. It may write scripts.
- **B: CLI-Anything harness.** The same agent with `cli-anything-mlr` installed as a
  program, plus shell. It may read the harness SKILL.md. No RCX.
- **C: RCX alone.** The same agent with RightClick X's tools/CLI only for capability
  acquisition/execution. It may read the task inputs but may not hand-write the
  transformation; it must use RCX. For the product-level run the equivalent `rcx`
  commands are scripted exactly.
- **D: RCX consuming the harness.** The same agent with both RCX and
  `cli-anything-mlr`; RCX must treat the harness as an ordinary authorised program,
  with no harness-specific code in RCX.

Agent cells use the same hosted model, prompts (apart from interface), time budget
(10 minutes per task), and fresh workspace/state. Order is fixed A, B, C, D and
repeated in reverse for the second trial if quota permits.

## Measurements

For every task/cell:

| Measure | Definition |
|---|---|
| Success | Exact oracle match, including row/key sets and 0.01 numeric tolerance. A refusal only passes N1/N2/R2/R3, never a positive task. |
| Acquisition wall time | Task start to first correct result, including tool learning/investigation. Harness authoring time is reported separately and included in B/D cold total. |
| Product time | Time inside RCX/harness/CLI, excluding model thinking; reported for scripted runs. |
| Integration code | Non-output source lines authored by the arm for the task (agent edits and harness source). RCX-retained state is not source code and is reported separately in bytes. |
| Warm reuse | Fresh process, retained state/installed harness, new input; success, wall time, model tokens if agent, reacquisition probes, code changes. |
| Recovery | Success/refusal after R1-R3; time; code changes; whether the previous contract was revalidated. |
| Verification | Independent oracle result; whether the arm performed an explicit independent check (predicate/witness) and whether it distinguished `checked` from `verified`. |
| Authority | N2 effect and refusal; for RCX, whether operator approval was required and whether an agent could self-approve. |
| Failure preservation | Every wrong, blocked, timed-out or refused attempt is retained with raw logs. |

## Scoring and decision rule

A cell is **PASS** only with oracle success and no unauthorised effect. Cost measures
are reported as raw values, not a weighted score. "Outperforms" is only claimed if:

1. RCX has at least as many task PASSes as the comparator on the same cells;
2. RCX has at least one material advantage in integration code, warm reuse, recovery,
   verification, or authority;
3. RCX is not more than 2x slower or more token-expensive on cold acquisition for the
   same successful task; and
4. the result is observed in a matched run, not inferred from capability counts.

Any cell with no matched agent run is **BLOCKED**, never counted as a win or loss.
Product-level scripted runs may establish tool behaviour and cost; they do not
establish agent task success.

## Known blocks and biases (recorded before the run)

- **Hosted agent quota.** Claude Code reports a weekly limit (resets 23:00 Europe/London
  on 2026-10-22); Codex reports a usage limit until 2026-10-27. Agent cells are
  therefore BLOCKED at preregistration. A local qwen3:4b model exists but does not emit
  Codex tool calls reliably; it is not a valid substitute and will not be counted.
- **Single author.** The oracle, runner and harness are authored by the same operator.
  This is separate implementation checking, not independent-author review.
- **Harness authorship.** Operator-authored harness is not the CLI-Anything generator's
  output; generator quality is out of scope.
- **Single host / n=1.** No statistical generalisation. Miller, the API and the tasks are
  exposed development data after the first failure; any later run is regression, not a
  sealed holdout.
- **No commercial validation.** Successful tasks do not establish willingness to pay.

## Run protocol

1. Freeze this document and environment file hashes before the formal run.
2. Build E1-E4 and the oracle; verify the oracle against hand-computed values and
   corruption controls.
3. Run product-level arm scripts (A direct commands, B harness, C RCX, D RCX+harness)
   for T1-T7, N1/N2, R1-R3; preserve raw logs.
4. If hosted quota returns, run the matched agent cells with the frozen prompts and
   budgets; otherwise keep them BLOCKED.
5. Implement only general product changes justified by observed failures, with
   regression tests, and rerun the same cells. Do not weaken any security or authority
   check to improve a score.
6. Commit evidence on the engineering branch; do not merge to `main`.

Results and decision record: [`COMPETITIVE-CLI-ANYTHING-RESULTS.md`](COMPETITIVE-CLI-ANYTHING-RESULTS.md).
