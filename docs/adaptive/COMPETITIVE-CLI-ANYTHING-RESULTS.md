# RightClick X vs CLI-Anything: controlled results

The first report below describes commit `c4f4196`; the [validity follow-up](#transitive-validity-follow-up-2026-10-22) supersedes its recovery and publication status, not its preserved raw trials.

Status at the first checkpoint: scripted cells complete; capable-agent cells **BLOCKED** (subscription quota).
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
- R3 failed silently: the harness printed `{"error":"supplier ... lacks risk_band"}` on stdout.
  **Correction, 2026-10-22:** the process exited **1**, not 0 as originally reported; RCX's
  declared-subcommand contract accepted both 0 and 1 and recorded a completed, unverified run.
  The raw process check is retained in `evidence/competitive-cli-anything/frozen-process-exit.json`.
  True exit-zero application errors are separate controls in the follow-up validity evaluation.

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

Correction to the original decision: these results do **not** establish that the preregistered
superiority criteria are met. Positive scripted task parity and selected integration/authority
advantages do not discharge the cold-cost, independent-agent, generator-provenance or recovery
gates. This is evidence of improved RCX functionality, not superiority over CLI-Anything or
capable coding agents. Do not merge to `main` before review.

## Artifacts

- `trials/A|cold|warm`, `B|cold|warm`, `C|cold|warm|r1|r2|r3`, `D|cold|warm|r1|r2|r3`:
  `result.json`, raw `arm.log`, `outputs/`, `oracle/`, `runs/`, API logs.
- `trials/C-baseline/`: pre-improvement failures (T1/T2 blocked, R2 silent drift).
- `trials/C-interim/`, `A-interim/`, `B-interim/`, `D-interim/`: intermediate implementation
  runs, retained for audit; not used for the final claims.
- `experiments/competitive-cli-anything/`: harness, API fixture, oracle, and trial driver.

## Transitive validity follow-up, 2026-10-22

This iteration starts from `c4f4196` on `eval/cli-anything-competition-20261022`.
It implements conservative local validity checks, not complete dependency discovery or
automatic semantic adaptation. All original comparison evidence remains intact; the audit
verified all 207 entries in the original trial checksum manifest.

### Frozen reproduction and correction

`validity-frozen/D/` reproduces R2's reversed rows and R3's completed application failure
before product changes. `frozen-process-exit.json` establishes that the original R3 harness
exits **1**. The defect was RCX's unobserved `[0,1]` success convention for declared
subcommands, not an exit-zero harness. Separate native-process tests exercise genuine
exit-zero error envelopes.

`validity-corrected-first/` and `validity-final/` retain intermediate evaluated candidates,
including refusals and errors; their product hashes distinguish them from subsequent fixes.
The first full regression output (`validity-regressions-first.txt`) has three failures;
none was removed. The next candidate passed 589 tests, with no skips, plus typechecking.
After engineering-review fixes, `validity-regressions-reviewed.txt` records **593 passing,
zero failing, zero skipped** tests: all 545 existing tests plus 48 new controls. Product and
harness typechecks, all four build targets, and the 28-check independent proof also pass;
reviewed logs and proof JSON are preserved separately from earlier candidates. A separate
strict check of the trial/audit tools exposed the existing trial driver's untyped failure
return; erased TypeScript annotations fixed it without changing execution or scoring.
Both the initial diagnostic and passing recheck are retained.

### Mechanism and authority

- Learning retains a local, always-partial observation of explicit PATH directories and
  literal shebang interpreters, with separate primary-executable hash checking. PATH order,
  read/deny/write declarations, network policy and sandbox limits are digest-bound.
- Each observation is bounded to 16 explicit directories, 64 names/evidence entries,
  32 MiB per candidate and 64 MiB total reads. Default `/bin` and `/usr/bin` directories
  are not scanned; a direct interpreter there can still be observed. Logical and resolved
  deny paths are checked before reads; executable contents are hashed, not retained.
- Before/after execution observations detect retained-candidate changes. Output is withheld
  if a change is detected during execution. These are not atomic tracing, and do not undo
  an effect that already occurred. Known static CLI dependencies and checker contracts are
  preflighted before an earlier workflow effect.
- Declared subcommands now accept only exit zero. Experimentally observed conventions, such
  as real `diff` exit one, remain supported. Conservative top-level JSON error envelopes fail
  independently of exit status, even when stdout is nominally text. Neither an accepted
  process exit nor absence of a recognized envelope establishes application correctness.
- Runs and hash-chained receipts retain `cliValidity`: partial coverage, observed/expected
  digests, process exit and application interpretation. Independent witness obligations
  remain separate, pinned, persisted and enforced after restart or explicit relearning.
- Caller-input receipt replay requires an explicit operator retry grant. Help-derived read
  labels are not idempotence evidence. Synthetic examples can be replayed only under a
  no-network/no-write-root sandbox or explicit retry authority. Saved goals do not inherit
  replay permission merely from a read label.
- Repair keeps the retained environment constraint through conformance replay and refreshed
  discovery; it cannot silently turn a changed dependency into its new baseline. Missing or
  rebuilt independent CLI checkers are rejected before producers, without repairing the check.
- Exported knowledge and supplied reflection specs cannot transfer local environment pins or
  continuity aliases. Import establishes local evidence under local authority. Persisted
  evidence declares `cli-validity@1`; older readers fail closed. Legacy unpinned CLI state
  remains explicitly `unrecorded`, not retroactively verified.

No application name or application-specific error signature was added to product logic.
No credentials, operator approvals, network policy or sandbox permissions are learned from
this evidence. No Mac security settings, VM images or bulk clones were used.

### Original workflow outcomes and regressions

The new C/D runs retain passing cold and warm positive tasks, absent-invoice refusals,
unapproved-deletion refusals and the separately operator-approved fixture control.
D R2 now refuses a changed transitive executable before dispatch. D R3 fails visibly with
`processExit: 1`, `application: reported-error`, and no replay.

**R1 is an availability regression in both C and D.** D refuses even a compatible dependency
replacement. C's retained documented operation also refuses the rebuilt primary unless the
operator has granted retry authority; explicit relearning then works, but is not automatic
recovery. The older driver incorrectly counted that fallback as a C R1 pass. Its original
output is preserved, and the corrected scoring requires the retained call itself to succeed,
as the preregistration says. No refusal is relabelled as compatible-recovery success.

C R2 still refuses the retained operation. Its exploratory explicit-relearn call still emits
altered rows without an internal semantic oracle; that **failure remains in the evidence**.
C R3 still requires visible failure, explicit API relearning and a v2-shaped caller workflow.
This is partial adaptation, not autonomous end-to-end recovery.

### Independent workflows and negative controls

The new native sandbox tests use real system gzip for compressed-log aggregation and real
SQLite for a read-only inventory query, behind ordinary disposable CLI dispatchers. Each
exercises unchanged reuse, compatible/incompatible/removed dependencies, byte-identical
primary dispatchers, persistent refusal after FileStore restart, and explicit relearning
with unchanged output predicates. These are product regressions, not independent-author
holdouts or a generated-harness competition.

Controls cover hidden configuration changing plausible output without changing the digest;
true exit-zero errors; nested business error fields and ordinary text; real nonzero `diff`;
revoked execution/investigation authority, unavailable sandbox and execution-policy denial;
unknown side effects with and without explicit retry authority; post-dispatch dependency
replacement; and unavailable/changed/independently refuting witnesses across saved goals.
A hidden change can still return a **completed, unverified** direct result. Saved result
predicates and witnesses must reject it; weaker caller predicates cannot replace those checks.

### Costs and limitations

The final `validity-reviewed` runs used fresh C/D state and separate work directories, sequentially,
without concurrent test-suite execution. All ten phases record runtime hash `b75aefdfe49e1ebb…`;
`validity-audit-reviewed.json` contains the full product hash map and phase results.

| Arm | Cold total | Acquisition | Declared capabilities | Warm total | Warm task times |
|---|---|---|---|---|---|
| C RCX alone | 2291 ms | 1875 ms | 80 | 377 ms | T2 135 ms, T7 54 ms |
| D RCX + harness | 1123 ms | 403 ms | 9 | 410 ms | T4 113 ms, T7 116 ms |

The original C/D acquisition times were 1681/407 ms and warm totals 298/355 ms. The intermediate
`validity-final` candidate measured acquisition at 2541/452 ms and warm totals 434/429 ms. These
are single-host observations, not controlled causal estimates of fingerprint overhead. No agent
timing or token estimate is inferred. Counts are declared operations, not verified behaviors.

Fingerprinting adds repeated filesystem reads: direct calls observe before and after, and
compositions also preflight. Bounds apply per observation, not to the aggregate of an entire
workflow. There is no stat-only cache claiming to prove unchanged contents. Reviewed retained
state sizes were C 805,852 bytes and D 60,208 bytes. C/D still authored no task-specific
integration code; test fixtures, orchestration and audit code are evaluation infrastructure.

The observer does not discover libraries, imports, hidden configuration, remote services,
credentials, arbitrary absolute dependencies or interpreter chains. Oversized/unavailable
entries and omitted directories are explicitly incomplete; equal digests do not establish
equality of their contents. An unrelated executable in the same declared PATH can cause a
conservative refusal. Byte-identical replacements and between-snapshot changes may be invisible.
Conventional error envelopes can false-positive on business data and miss other error schemas.
Independent outcome checks remain mandatory for semantic assurance.

### Review and publication gates

A read-only engineering review found four gaps in the intermediate candidate: read-labelled
saved-goal replay, dependency adoption during repair, late rejection of a missing/rebuilt
checker, and lossless-JSON errors masking text-output error envelopes. The implementation was
corrected and regression controls pass in the 593-test suite, including explicit-grant controls,
real replay-time helper replacement, zero-subprocess checker refusal, and unsafe-number/duplicate-key
error envelopes. This is not specialist security clearance: the dedicated security-review agent
was unavailable, and independent review remains required.

The audit fetched canonical main `f5d593d` and adaptive branch `42c46e0`. Before this iteration's
commit, the feature branch was 222 commits ahead/15 behind main and two commits ahead of the
adaptive branch. The main merge-base diff already spans 11,417 files, mostly inherited
programme/evidence history; it is not the size of this new feature. The reviewed incremental
working inventory was about 29.8 MB (including the two earlier unpublished commits), with no
file over 10 MiB and no credential-like filenames. The largest files are 1.29 MB proof JSONs.
No local venv, installed binary, VM image or generated bundle is intended for publication.
Previously ignored raw comparison logs are explicitly included rather than silently omitted.

The already-published adaptive history retains its earlier nonzero-finding audit and
classifications in `GITHUB-CHECKPOINT.md`. Default-rule, redacted Gitleaks scans of the two
unpublished commits, product source, tests and trial tools found no leaks. The final evidence
scan returned **12 generic-key findings**, all in the before/after source maps of the two proof
JSONs. `validity-publication-audit.json` verifies every value against the actual source SHA-256
and both proof maps: **12 source-hash false positives, zero unresolved findings**. The exit-one
scan and redacted findings are retained without suppression or a zero-finding claim.
The first history scan actually scanned zero commits because of the system Git license shim;
that misleading exit-zero output is preserved, not counted as a clean audit. A retry using the
working CommandLineTools Git scanned both commits successfully. Audit inventories are timestamped
snapshots; later audit outputs and the checksum manifest add small files to the publication.

The documentation check still fails on **300 pre-existing archived README links**. Frozen
archives and the checker are unchanged; this remains a CI failure. Linux execution and the
full official CLI-Anything/capable-agent comparison were not rerun in this iteration.

Publication is authorized only as this isolated feature branch and a **draft PR against main**.
It overlaps open PR #2 (`programme/adaptive-capability-plane`) and must not be merged until
its tests, security changes, main-only changes and adaptive overlap have been reviewed.
The result demonstrates a narrower, more honest validity boundary—not superiority over
CLI-Anything or capable coding agents, and not release readiness.
