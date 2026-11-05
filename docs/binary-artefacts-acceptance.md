# Independent acceptance for binary-native artefacts: evaluator handoff

The previous independent result stands: **general-purpose acquisition NO-GO** (RightClick 2/6
acquisitions and 6/12 clean reuses, against 6/6 and 12/12 for a hardened saved-script agent). This
change is engineering work against the root causes that evaluation exposed. Nothing in this
repository overturns that result. Only a new independent evaluation can.

## What is frozen

The source candidate is the head commit of the review PR that adds this file. Its commit SHA and
tree hash are recorded in the PR description and must be checked before starting:

```bash
git rev-parse <commit>^{tree}      # must equal the tree hash in the PR
```

Any source change after the freeze voids the evaluation.

## Rules carried over (binding)

- **The evaluator is independent.** It must not be the session that built this change, nor the one
  that ran the earlier evaluation (both share authorship history). Arms run as fresh agent sessions.
- **Programs are new.** Choose them after the freeze. None may appear in the repository
  (`git grep -ilw <name> <commit>` must be empty), so the six development cases (gpgv, tiffdump,
  qt-faststart, msguniq, ocsptool, zipmerge) are excluded. Prefer programs with binary inputs, real
  file operands, auxiliary files (keys, certificates, dictionaries) and binary or structured
  outputs, since those are what this change claims to handle.
- **Same oracle discipline.** Tasks, expected results, the independent oracle, ordinary-change
  scenarios, budgets and decision thresholds are sealed and hashed before any arm sees a task.
  Validate the oracle against reference answers and corrupted answers first (the earlier
  evaluation found two of its own oracle and harness defects this way).
- **Parity.** The saved-script competitor gets equivalent permissions and must build the same
  safeguards (confinement, identity pinning, regression checks, environment-change detection,
  independent verification, a README for fresh agents). Safeguards are tested, not taken from a
  README.
- **Harness check.** Drive the frozen MCP server exactly as a host does, and close its stdin so it
  saves state (the earlier evaluation voided a run because its client killed the server first).
- **Separate correct execution from correct outcome.** A run completing is not the answer being
  right. Score outcomes against the sealed oracle, and record which outputs a run record attests to
  (`cliValidity.artefacts`) as against answers an agent derived by other means.

## Measures and verdicts

Measure acquisition success, fresh-agent reuse correctness, refusals (false and correct), silent
errors, full model tokens by category, wall time, and engineering effort, for both arms, with
repetitions to estimate variance. Reuse the earlier preregistered decision rules (TCO at 20 uses,
silent-error comparison) unless the evaluator replaces them **before** sealing.

## Engineering verdict at handoff

**Engineering GO for independent acceptance**, provided the review PR's six required CI jobs pass
on the frozen head. All seven root causes are reproduced and fixed generically, with no
program-specific code. All six development cases pass end to end, and the existing suite passes,
apart from three tests changed deliberately (listed in the PR).

**Product verdict: unchanged, NO-GO,** until the independent evaluation above is run. Safety
parity remains NOT ESTABLISHED (the adversarial scenarios were never run), and commercial
validation remains NOT ESTABLISHED.
