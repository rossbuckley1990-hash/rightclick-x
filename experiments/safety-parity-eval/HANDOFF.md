# Safety-parity evaluation: independent evaluator handoff

This is a design only. Nothing has been run. This directory chooses no programs, tasks or
failures: the independent evaluator chooses all of them after the source freeze below.

**Question.** Does RightClick X (automatic capability acquisition plus its reusable safety
controls) deliver materially more value than a competent agent that builds and maintains
equivalent saved scripts, with equivalent permissions and safeguards, over repeated use?

The question is not whether RightClick beats an unhardened script. The earlier proof's
saved-script and wrapper arms had no hash pinning, sandbox or output verification. That
comparison shows what those safeguards catch. It says nothing about value against a
competitor that has them (see [prior evidence](#prior-evidence-and-its-limits)).

## 1. Frozen source and evidence

| Item | Identifier |
|---|---|
| Source freeze commit | `7c852f4588d564ac72ae73ca8e406f6492bde01b` (branch `review/autonomous-capability-acquisition`, PR #54) |
| Source freeze tree | `54c8500ff793cef405e865c38ddcf67fe7dd3479` |
| `src/` tree at freeze | `1b8b7dcd68048b870d824c2d9fecf712be392607` |
| `test/` tree at freeze | `65fe4ff9dd14b981ed25bcc1672e6445079a6d06` |
| `experiments/north-star-acquisition/evidence/competitive-proof.json` (original, unmodified) | sha256 `faacbf7da087d5460175e2c9e679e71e7e9b32e24e386aaff760c764ccd6ea56` |
| `experiments/north-star-acquisition/evidence/competitive-proof.cost-audit.json` | sha256 `93d0ede1280cddab1f5909132a226ee28a539ec09aaef17f8944cb97c4d66259` |
| `experiments/north-star-acquisition/cost-audit.ts` (regenerates the audit) | sha256 `e15c5c3245bbbc7bd6b659ee164f93adc717fa8480f40de0dd9d0b450f4279aa` |
| `experiments/north-star-acquisition/competitive-proof.ts` | sha256 `5915b6381b1b41e2d6c89c850210542018aa7cc83c18b3693e612c2ef2c5b34d` |

Check the freeze before starting:

```bash
git rev-parse 7c852f4588d564ac72ae73ca8e406f6492bde01b^{tree}   # must print 54c8500f…
git diff --stat 7c852f4588d564ac72ae73ca8e406f6492bde01b HEAD    # must list only experiments/safety-parity-eval/
node experiments/north-star-acquisition/cost-audit.ts | shasum -a 256   # must print 93d0ede1…
```

Any source change after the freeze voids the evaluation. Restart it against a new freeze.

## 2. Roles and contamination controls

- **Evaluator.** Independent of RightClick's authors, human or AI. Chooses and seals every
  program, task, oracle and failure injection after the freeze. Owns the oracle and the
  scoring.
- **Arm operators.** Start each agent session, follow the protocol and log every minute of
  human effort. They see a task only when it is issued.
- **RightClick authors** (including agents that work on this repository) never see the
  sealed material before results are published, and cannot change the frozen source.
- **Sealing.** Before the first run, the evaluator publishes the sha256 of the sealed
  selection file (programs, tasks, oracles, injection schedule, decision thresholds) and
  reveals the file only with the results.
- **Novelty check.** `git grep -il <program> 7c852f4588d564ac72ae73ca8e406f6492bde01b`
  must be empty for every chosen program. This rules out idn2, jq, lychee, sort and anything
  else the repository already exercises. Tasks must not reuse any input from the repository's
  fixtures or evidence.

## 3. Arms and parity

Both arms get the same machine image, OS user, programs on `PATH`, filesystem roots, network
policy, model (exact model id), model settings, and per-session token and time caps.

- **Arm R: RightClick X** at the frozen commit. The agent works through RightClick's tools
  (`learn`, `compose`, `run`, publish) with the stated authority settings. Shell access is
  limited to what RightClick itself is given, so the agent cannot route round it.
- **Arm S: competent saved-script agent.** Shell, a persistent workspace and the same
  programs. Its instructions require it to build, and it is free to build however it likes
  with standard tools (not RightClick's source):
  1. persistent reusable scripts, with a README a fresh agent can follow;
  2. filesystem and network confinement (for example `sandbox-exec` or `bwrap`);
  3. executable hash pinning that refuses to run on a mismatch;
  4. behavioural regression fixtures, re-run when the program or environment changes;
  5. independent output verification (a check not derived from the script's own output);
  6. fresh-agent reuse: each reuse starts a new session holding only the saved artefacts.
- **Arm 0 (optional floor):** direct shell, no reuse. Used only to show the cost of not
  saving anything.

**Parity gate.** Before the reuse phase, the evaluator probes both arms with the same
safeguard checks: a changed binary, a network attempt, a write outside the workspace, and a
fixture that no longer reproduces. A safeguard the S agent was asked for but did not deliver
is recorded as an S-arm defect and setup cost. The evaluator does not repair it. The report
lists every safeguard as either *requested and delivered* or *requested and not delivered*.
None may be *not requested*.

## 4. Evaluator-chosen material (after the freeze, sealed)

- **Programs:** at least 6 CLI programs from different families (text, data, network-free
  conversion, archive, media metadata, and so on), none mentioned in the repository.
- **Tasks:** at least 3 instances per program, each with an oracle output computed
  independently of either arm.
- **Failure injections:** a sealed schedule interleaved with the reuses, including at least:
  - a binary replaced by one that exits 0 with corrupted output;
  - a legitimate upgrade that changes behaviour;
  - a legitimate upgrade that does not change behaviour (measures false refusals);
  - a locale or environment change;
  - a missing library or a removed program;
  - edge inputs: empty, very large, non-ASCII, option-like strings.

## 5. Procedure

1. **Setup.** Prepare the image for each arm. Log human minutes and any agent sessions.
2. **Acquisition.** One fresh agent session per arm per program: "make this reusable for
   tasks like …" (task text from the sealed set).
3. **Reuse.** At least 10 reuses per program, each in a fresh session holding only the saved
   artefacts, with injections applied on the sealed schedule.
4. **Maintenance.** After each legitimate upgrade, restore a correct working state. Log agent
   and human effort separately.
5. **Repetitions.** At least 3 independent repetitions of steps 2–4 per arm, so every figure
   has a variance.

## 6. What to record, per run and per arm

Keep every category separate. Never merge one into another.

| Measure | Definition |
|---|---|
| Task success | Output equals the oracle. |
| Correct refusal | Refused, with a stated reason, where the sealed schedule says refusal is correct. |
| Silent error | Reported success with output ≠ oracle, or ran where refusal was correct. **Primary safety outcome.** |
| False refusal | Refused although the program and environment are unchanged or legitimately equivalent. |
| Loud failure | Failed visibly without a proper refusal (crash, timeout). |
| Human engineering minutes | Stopwatch-logged, split into setup, intervention and maintenance. |
| Setup cost | Steps 1–2: agent tokens, agent-session time and human minutes. |
| Maintenance cost | Step 4, per upgrade event. |
| Agent tokens | From the provider's usage records, per session: uncached input, cache write, cache read and output, reported separately. |
| Agent-session time | Wall clock from session start to completion. |
| Runtime-only latency | Time of the program or capability call alone. Never compared with session time. |
| Modelled API cost | Tokens × a named price sheet for the named model. Labelled as modelled. |
| Actual bill | From the provider's billing export, if obtainable; otherwise `null`. Never estimated. |
| Total cost of ownership over M uses | setup + acquisition + Σ reuse + maintenance, plus human minutes × a stated hourly rate. Report the rate separately so readers can substitute their own. Report M = 1, 5 and 20 from measurements; mark any larger M as an extrapolation. |

## 7. Decision rule (pre-registered: fix the thresholds before sealing)

Suggested defaults; the evaluator may replace them before sealing, not after:

- **RightClick delivers materially more value** if, across all repetitions, either
  - its silent errors are no higher than S's **and** its TCO at M = 20 is at least 25% lower; or
  - its silent errors are strictly lower **and** its TCO at M = 20 is no more than 10% higher.
- **S delivers more value** under the same rules with the arms swapped.
- **Otherwise: not demonstrated.** No advantage is claimed for either arm.

Report each safeguard's catches and false refusals per arm, whatever the verdict.

## Prior evidence and its limits

Do not use these as results. They are the reason this evaluation is needed.

- `competitive-proof.json` and its cost audit: the saved-script and wrapper arms were
  deliberately unhardened. One session per arm and phase. The author chose the tasks and
  programs. On the happy path RightClick costs more per reuse than the saved script ($0.0227
  vs $0.0119 modelled, 15.5 s vs 9 s agent-session time, 34.7 ms vs 11.2 ms runtime), so it
  never breaks even against it. No actual bills were recorded. The audit corrects a
  misstated $0.0252 per-reuse figure and two double-rounded values.
- PR #50 (GLM development comparison on unfamiliar HTTP APIs): correctness tied, and
  RightClick X used 10–49× more tokens.

## 8. Engineering GO/NO-GO

**Conditional GO** for handing to independent evaluators. It holds only if all six GitHub CI
jobs (`ci`: macos, linux-bubblewrap, linux-no-sandbox, package; `product-ci`: verify on
macos-15 and ubuntu-24.04) pass on the commit that adds this file. Outside this directory
that commit's tree is identical to the freeze. The run IDs are recorded on its pull request.
Any failed job means NO-GO.

Locally at the freeze:

| Run | Tests | Pass | Skipped (with reasons) | Fail |
|---|---|---|---|---|
| macOS | 803 | 803 | 0 | 0 |
| Linux, no sandbox | 803 | 660 | 143 | 0 |
| Linux, bubblewrap | 803 | 768 | 35 | 0 |

Both typechecks and the link check are clean. Known caveats, not blockers:
- the macOS memory-bound test (`C2`) is sampled, not a hard kernel limit, and failed once
  under heavy load (it passed 3/3 alone and in a full rerun);
- the real-`idn2` test's earlier failure on GitHub's macOS runner is not yet explained (the
  test now logs diagnostics).

This verdict covers engineering readiness only. It is never a claim of commercial readiness
or of economic advantage: the prior evidence shows no advantage over saved scripts.
