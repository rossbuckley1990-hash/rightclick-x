# RightClick X vs CLI-Anything: controlled results

Status: scripted cells complete; capable-agent cells **BLOCKED** (subscription quota).
Preregistration: [`COMPETITIVE-CLI-ANYTHING.md`](COMPETITIVE-CLI-ANYTHING.md).
Raw evidence: `evidence/competitive-cli-anything/trials/` (checksums in `trials/SHA256SUMS`).
Final product hashes: `cli.ts 7d074334…`, `runtime.ts a91eb2ba…`, `types.ts 6c07ee7c…`.
No change was made to `main`, and nothing was pushed.

## What ran

One host (macOS, sandbox-exec), one fixture set, one loopback OpenAPI service, Miller 6.22.0
(`976a3ab9…`), and an independently written Python/Click harness (`4899855f…`). Every arm ran
the same T1–T7 inputs and was checked by a separate Python oracle that imports neither RCX nor
the harness. Arm A used a terminal; B used the harness; C used RCX alone; D used RCX with the
harness as an ordinary learned CLI. C/D acquired capabilities by investigation; A/B did not
acquire a capability graph at all.

## Task success

| Cell | A terminal | B harness | C RCX alone | D RCX + harness |
|---|---|---|---|---|
| T1 filter→sort→cut, cold | PASS | — | PASS | — |
| T2 same, warm/new rows | PASS | — | PASS | — |
| T3 harness projection, cold | — | PASS | — | PASS |
| T4 harness projection, warm | — | PASS | — | PASS |
| T5 invoice→supplier→FX | PASS | PASS | PASS | PASS |
| T6 CLI + API exposure, cold | PASS | PASS | PASS | PASS |
| T7 same, warm/new rows | PASS | PASS | PASS | PASS |
| N1 absent invoice refuses | PASS | PASS | PASS | PASS |
| N2 destructive without approval | **FAIL** (deleted) | **FAIL** (`--confirm` self-supplied) | PASS | PASS |
| R1 compatible program replacement | n/a | n/a | PASS | PASS |
| R2 behaviour-altering replacement | n/a | n/a | PASS (refused) | **FAIL** (silent row reversal) |
| R3 API schema drift | n/a | n/a | PASS (visible fail, re-learn, pass) | **FAIL** (reported completed) |

The pre-improvement baseline is preserved in `trials/C-baseline/`. There, C failed T1/T2
because `sort` was not acquired (32-verb cap), and R2 failed because a changed program was
auto-adopted: both the retained and re-learned calls returned reversed rows without an error.
The final C cells above were rerun from a fresh state after the product changes.

C and D's N2 refusal happened before any effect; the operator-approved control then deleted
INV-1001 successfully. A's terminal arm deleted it; B's harness refused without `--confirm`
but accepted a confirmation the caller supplied itself. RCX's operator approval cannot be
granted by a tool call.

## Acquisition and timing

Scripted wall times; model/agent time is excluded and not available for the blocked cells.

| Arm | Cold total | Capability acquisition | Capabilities | Warm total | Warm task times |
|---|---|---|---|---|---|
| A | 383 ms | none (hand-written command/script) | 0 | 248 ms | T2 11 ms, T7 54 ms |
| B | 545 ms | none (hand-written harness) | 0 | 320 ms | T4 64 ms, T7 73 ms |
| C | 2028 ms | **1681 ms**, 79 sandbox runs | **80 new** (74 Miller verbs + 6 API); graph 100 | 298 ms | T2 73 ms, T7 35 ms |
| D | 872 ms | 407 ms, 5 harness runs + API | 9 new (3 harness verbs + 6 API); graph 29 | 355 ms | T4 79 ms, T7 89 ms |

C's acquisition cost is real: raising the verb budget from 32 to 96 increased cold learning
from 940 ms (baseline) to 1681 ms, but acquired 42 more documented verbs and unblocked T1/T2.
Warm reuse required no reacquisition and no code changes in any arm. C's sandbox and process
overhead makes it slower than A on this small fixture; it is not claimed to be faster.

## Integration code authored for the task

Measured source lines; shared trial orchestration is excluded from every arm.

| Arm | Task-specific source | Notes |
|---|---|---|
| A | **103** | 102-line stdlib API script plus one Miller command |
| B | **312** (plus 105 test lines) | 210-line harness implementation, plus the same 102-line API script |
| C | **0** | 80 learned capabilities; retained state 772 KB |
| D | **0 new** | reuses B's 210-line harness; retained state 52 KB |

C/D did not write a filter, sort, cut, FX, aggregation, or HTTP client. The tradeoff is
retained machine state and investigation time rather than authored code. The harness authoring
time was not instrumented; only its lines are reported.

## Recovery and verification

C, final implementation:

- **R1 compatible replacement:** recognized the new bytes, re-ran the previously successful
  filtered call against them, matched the retained receipt's output digest, adopted the new
  contract, and retried. Identical correct output; no new code.
- **R2 altered replacement:** the same revalidation produced a different output digest and the
  run failed visibly with “changed meaning”; the changed contract was **not** adopted. A second
  call refused from cache without executing the program. An explicit `learn` then adopts the
  new behavior — that is a deliberate new contract, not silent drift. The `R2-relearned` record
  therefore still reports altered rows and is retained as a failure; it is exploratory, not a
  preregistered cell.
- **R3 API drift:** the retained v1-shaped call failed on the missing `risk_band` field;
  re-learning the OpenAPI source took 6 ms; the v2-shaped call passed.

D, RCX consuming the harness:

- R1 passed because the harness binary was unchanged and forwarded to the pristine Miller.
- R2 failed silently: replacing Miller changed the harness's output, but the harness binary
  and its declared interface did not change. RCX validates the program it learned, not that
  program's transitive dependencies.
- R3 failed silently: the harness printed `{"error":"supplier ... lacks risk_band"}` on stdout
  and exited 0. RCX recorded a completed, unverified run. A generated CLI's exit-code and
  output-shape contract is a verification boundary RCX cannot infer generically.

RCX labels these runs `unverified` unless the caller supplies predicates or witnesses; the
trial relied on the external oracle. The recovery refusals are the strongest verification
result: they prevent a changed program from being reported as the retained capability.

## Operator authority

N2 is the clearest separation. A had no gate. B's gate is a caller-supplied `--confirm`, which
an agent can satisfy itself. C and D refused the destructive capability because no operator
approval existed, and the invoice was unchanged. An operator-configured approval, created
outside the agent's tool calls, allowed the same operation. The behavioral revalidation added
in this iteration also checks the investigation authority before running a single revalidation
sample, so a revoked program is not probed by the repair path.

## Product changes justified by the evidence

1. **Acquire complete documented verb sets.** `MAX_VERBS` 32 → 96 and `MAX_RUNS` 80 → 160 in
   `src/reflectors/cli.ts`. Miller's 74 verbs are now learned; `sort` (position 53) is no longer
   truncated. Cost: +741 ms cold learning in this fixture.
2. **Revalidate changed CLI bytes before adopting them.** In `src/runtime.ts` `healRun`:
   - require investigation authority;
   - if an identical successful call exists in the receipt chain, execute it once with the new
     bytes and compare the output digest;
   - otherwise replay the capability's stored conformance examples in the sandbox;
   - otherwise refuse, naming the missing evidence;
   - cache refusals per capability + program hash, and do not learn or persist the changed
     program when revalidation fails.
   This preserves compatible replacements (R1) and prevents silent semantic adoption (R2).
   Four regression tests cover compatible, incompatible, documented-only, and receipt-based
   cases; the full suite is 545 passing, typecheck clean.

These are the smallest changes that addressed observed failures. No authority or egress check
was weakened.

## Limits and honest conclusion

- **Agent cells are blocked.** The Claude quota resets at 23:00 Europe/London on 2026-10-22;
  Codex is unavailable until 2026-10-27. No agent success rate, token cost, or acquisition time
  is reported or inferred.
- The scripted arms show that RCX, after the two changes, matches the positive task success of
  both comparators on this workflow, with zero task-specific integration code and a stronger
  operator gate. It does **not** show that a capable agent using RCX is faster or more reliable
  than the same agent with a terminal; cold acquisition is slower and the sample is one fixture.
- D demonstrates the limit of consuming an existing generated CLI: RCX inherits the harness's
  blind spots for transitive dependencies and error-shaped successful output.
- The receipt comparison is conservative for programs whose output contains sandbox paths or
  timestamps; such a program may be refused after replacement even if semantically compatible.
- R2's explicit re-learn adopts changed behavior by design. Users who need the old semantics
  must not approve the new contract.

Decision: the preregistered product-level criteria are met for matched positive tasks
(equal task passes; material advantages in integration code, authority, and recovery), but
superiority over a capable agent remains unproven until the blocked cells run. Do not merge to
`main` before review.

## Artifacts

- `trials/A|cold|warm`, `B|cold|warm`, `C|cold|warm|r1|r2|r3`, `D|cold|warm|r1|r2|r3`:
  `result.json`, raw `arm.log`, `outputs/`, `oracle/`, `runs/`, API logs.
- `trials/C-baseline/`: pre-improvement failures (T1/T2 blocked, R2 silent drift).
- `trials/C-interim/`, `A-interim/`, `B-interim/`, `D-interim/`: intermediate implementation
  runs, retained for audit; not used for the final claims.
- `experiments/competitive-cli-anything/`: harness, API fixture, oracle, and trial driver.
