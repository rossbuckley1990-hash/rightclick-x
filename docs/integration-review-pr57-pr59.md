# Integration review: PR #57 with its remediation, PR #59

This is the security and correctness review done before PR #59 (the remediation) is integrated
into PR #57 (binary-native artefacts), and before that combined branch is proposed for main. It
does not change the independent evaluation of PR #57 at `20bc3a7`, or any of its scores. Its
counterexamples stay development cases.

**Independence.** The session that wrote PR #57 and PR #59 also wrote this review. The review
read the source adversarially, line by line, and then ran a separate fresh-context pass over the PR
diff. Even so, this is an author's review, not an independent one. The independent evidence for
`20bc3a7` is the acceptance evaluation outside this repository.

## PR dependency graph (verified 2026-11-05)

```
main 9abbb51 ── #57 feature/binary-native-artefacts (20bc3a7, 4 commits)
            │      └── #59 fix/gauntlet-remediation (based on 20bc3a7)
            ├── #56 fix/host-sandbox-probe-transient-failures (0f26383, 1 commit)
            └── #58 fix/checkpoint-expiry-test-clock-race (699b2ed, 1 commit)
```

- **The base.** All four PRs branch from `9abbb51`, and main has not moved since.
- **#59 depends on #57.** #59's merge base with #57 is #57's tip, `20bc3a7`.
- **Conflicts.** There are no textual conflicts in any order:
  - #57+#59 and #56 overlap on 7 files and merge cleanly either way, to the same tree;
  - #58 shares no file with the others.
- **Order.** #57 (with #59) and #56 are independent, and #58 is independent of both. #56 changes
  how confinement tests are skipped. The new tests from #57 and #59 use their own skip guard, so
  they are unaffected either way. Whichever lands second should run the full suite on the combined
  tree.

## Findings, and what was done

These were found in the remediation head `b8cabb0`, after its six CI checks had passed. Every one
is fixed in the review-fix commit on PR #59, with a regression test, except where noted.

| # | Severity | Finding | Evidence | Fix | Regression |
|---|---|---|---|---|---|
| 1 | High | **Breaking a stale lock let two processes hold the store lock.** The old code moved the lock aside to check it and put it back with `link`. While the path was empty, a third process could take the lock. The quota check and the holds updates were then unprotected, so gate B failed whenever a crash left a lock. | Stress: 8 processes × 150 rounds with crash-style locks planted. `b8cabb0`: **14 overlapping critical sections**, in 4 of 6 runs. Fixed: **0 in 6 runs**. | Only the holder removes a lock. A stale lock is broken under a separate exclusive `.lock.break`, which re-reads the lock and removes it only if it is still the same file (content and inode). | `the store lock stays exclusive while locks left by crashed writers are broken` |
| 2 | High (compatibility) | **Retained contracts from before exit semantics were never learned again.** If a program's bytes are unchanged, `investigate` reuses what is already learned. Main persisted `okExit [0,1]` without evidence, for declared interfaces and for observed programs such as diff. After integration such a capability refuses exit 1 permanently. The remedy its error message gives (learn again) did nothing, and so did the automatic repair. | A `cmpx` wrapper over `/usr/bin/diff` with main-era state: the run failed, repair reported "no contract change", and re-learning left the evidence empty. | A retained contract that lists a nonzero success code without its evidence is not reused, so it is investigated afresh. | `a contract retained from before exit semantics is investigated again…` |
| 3 | Medium (security) | **An option value could carry an excluded option.** A value item was checked for host paths and file roles only. Wherever the contract wrongly gives an option a value, as CE1 did with sort's `-n`, `["-n", "--compress-program=sh"]` passes validation. sort then reads the second item as an option and runs the program it names. Arity read from documentation widens this to *n* items. The sandbox still confines the run, but the allow-list and the R11 exclusion are bypassed. | Static, from the code path and CE1's contract. | A separate value that begins with `-` is refused unless it is a number or `-`. The attached forms (`--key=-x`, `-k-x`) are unambiguous and stay accepted. | `an option value that looks like an option is refused…`; one existing assertion changed (below) |
| 4 | Medium | **Lock liveness was judged by pid across PID namespaces.** A lock held by a live process in another container sharing the store read as dead, and was broken at once. | `process.kill(pid, 0)` sees only the caller's PID namespace. | Locks record host and PID namespace. A pid is judged only within its own scope. A foreign or unrecorded lock is abandoned only after 120 s. | `a lock from another host or pid namespace is never broken by its pid…` |
| 5 | Medium (security, macOS) | **Collected outputs were read by path after `lstat`.** A process that escaped the group kill (on macOS, a child that calls `setsid()`) could swap the file for a link between the check and the read. RightClick, not the sandbox, would then read the host file the link names. | Not reproduced. A direct hard link to a read-denied host file is refused by Seatbelt (`Operation not permitted`), which was probed and confirmed. Linux is unaffected: bubblewrap uses a PID namespace with `--die-with-parent`. | Opened with `O_NOFOLLOW` and `O_NONBLOCK`, `fstat`-checked to be the same regular file, and read through the descriptor. Growth during the read is refused. | `collected outputs: a FIFO is refused without blocking…` (the race is closed by construction) |
| 6 | Low | **The quota ignored metadata.** Holds files were not counted, so many tiny artefacts could grow the store past its bound. | A 4,096-byte store accepted content plus holds totalling 4,114 bytes. | Holds and temporary files count, and each put charges the hold it adds. A sweep during a put re-inspects the address (the re-check is mutation-tested). | `metadata counts against the bound…`, `re-storing content whose holds expired…` |
| 7 | Low | The investigation summary reported every exit code seen as "ok exit". | Static. | It reports the codes seen and the success codes separately. | — |
| 8 | Low | The retention error said "between 0 and 3650" but refuses 0. | Static. | The message now says what the check enforces. | — |
| 9 | Efficiency | Every put rescans the store directory. | Static. | **Not changed.** It is bounded by the quota, and the scan runs under the lock. | — |
| 10 | Simplification | The temporary-file sweep used pids it does not need: every temporary file is written under the lock. | Static. | Every temporary file a sweep sees is removed. | `an interrupted write's temporary file is recovered…` |

**Changed existing test (deliberately).** One assertion in the option-grammar test expected
`["-k", "-v"]` to be refused as "not a staged input file". It is now refused earlier, because
`-v` looks like an option. The refusal is the same; only its reason is stricter.

**Diagnostic only.** The UTF-8 locale import test now says which capability was refused and why.
It failed once in two full bubblewrap runs with "partly-accepted", and passed in 5 isolated runs
and in the second full run. Its path (`importKnowledge` → `replayExamples`) is not touched by these
fixes. It stays under observation in CI.

### Areas reviewed with no defect found

- **Exit classification.** A nonzero code needs recorded `exitSemantics`, and each run is
  re-checked for a diagnostic and for output. Codes are numeric, so lookups cannot reach object
  prototype keys.
- **Partial-file publication.** Every check runs before any `put`. A failed store releases what was
  stored. A failed run returns no output and keeps digests only.
- **Atomic writes.** Temporary file, `fsync`, re-read and hash, rename, directory `fsync`. An
  existing file is trusted only after it hashes to its name. Symlinks are refused at both store and
  collection.
- **Read grants.** 128 random bits, compared in constant time. A digest alone is refused. A grant
  is tied to one hold, is never logged (`redact`), and is never written into provenance.
- **Expiry and release.** Expiry is checked on every read, and release deletes unheld content.
- **Run holders.** Every run has its own `runId`, so a holder is never shared between runs.
- **Multi-value options and host paths.** Every value of a multi-value option is checked. Host
  paths are refused for every option value.
- **Program- and directory-valued options.** They are never offered (R11).
- **Text path.** Unchanged in substance: the same envelope, UTF-8 and line-type checks, with
  failure evidence added.

## R8: a bounded invocation record (design; not implemented here)

**What a run record holds today.** A receipt holds:

- the capability id;
- `inputDigest`, the digest of the caller's arguments;
- `cliValidity.artefacts`: the program path and digest, input and output digests, and the stdout
  digest;
- `exitStatus`.

**What it cannot show.** It cannot show the exact argv, which option consumed which staged file,
or which contract produced the argv. The contract can be re-learned later, so the record cannot be
re-derived from current state.

**Proposed: `cliValidity.invocation`, version 1, bounded to 16 KiB serialised:**

| Field | Content | Sensitive values |
|---|---|---|
| `program` | real path, SHA-256, size, and the identity checked before and after the run | none |
| `contract` | capability id and the SHA-256 of the stable-serialised `invoke` used (without examples or continuity) | none |
| `argv` | at most 256 items, in order, each one of the kinds below | see each kind |
| `argv`: `flag` | the spelling, which is a documented flag | none |
| `argv`: `value` | the flag it belongs to and the value. The value is plaintext only when it is at most 64 characters, matches `^[\w.,:=+-]*$`, and neither the flag nor the port name matches the existing `SENSITIVE` pattern. Otherwise it is `{sha256, bytes}`. | digested |
| `argv`: `file` | role (`read` or `write`), the flag or `operand` that consumed it, the staged name and the content SHA-256 | the name is caller-chosen, and is digested when sensitive |
| `argv`: `literal` | `{sha256, bytes}` only | always digested |
| `stdin` | `{sha256, bytes}` or absent | digested |
| `environment` | environment digest, locale profile, sandbox kind, and the sandbox policy digest | none |
| `authority` | runtime id, principal (`"local-single"`), and whether operator approval or retry authority applied | none |
| `exit`, `outcome` | the existing `exitStatus` and `outcome` | none |
| `verification` | status and witness ids | none |

**Rules.**

- The record is produced from the exact argv passed to `sandbox.run`, not reconstructed.
- Oversized records are refused before the run starts, never truncated silently.
- Digests are SHA-256 of exact bytes, so a holder of the original value can confirm it.
- No read grant ever appears.

**Release decision.** R8 does not weaken confinement, authority or outcome checks. It limits what
an audit can reconstruct afterwards. For the intended single-principal scope it is **not a release
blocker**, and it is listed as a remaining risk. It is needed before composed binary workflows can
claim complete provenance, so it belongs with the composition work.

## The authority boundary, and what multi-user operation would need

**Today: one principal per runtime.**

- **The runtime serves one caller identity.** That is the MCP stdio client, or the single bearer
  token of `serve`.
- **Holding a grant is permission to read.** Read grants are bearer capabilities: anyone holding
  `sha256:<hex>.<grant>` can read that content until its hold expires or is released. Anyone who
  can read `<state>.artefacts/` (mode 0700, files 0600) or the state file (0600), which keeps the
  results it returned, can read everything. The boundary is therefore the operating-system account
  that owns the state directory.
- **What is never permission.** A digest, a path or a guessed name never reads anything. Grants are
  128-bit random values and are compared in constant time.

**What secure multi-user operation would require (not implemented, and not proposed for this
integration):**

1. Authenticated principals at the interface, with a principal id on every run.
2. Holds owned by a principal. A read requires both the grant and the same principal, so a leaked
   grant is useless to anyone else.
3. Per-principal quotas and retention, and per-principal directories or store partitions.
4. State and receipt stores partitioned per principal, so results, and the grants inside them, are
   never shared through one state file.
5. Capability and goal authority (`RCX_EXECUTE`, approvals) scoped per principal, with audit.
6. Cross-principal sharing as an explicit, logged grant re-issue, never as passing the bearer
   value around.

**Release decision.** In the single-principal scope the boundary is coherent and documented, so
it is **not a release blocker**. Using the runtime as a shared multi-user service would be unsafe
today, and the documentation says so.

## Remaining release risks

- **R8:** argv and per-option file provenance are not recorded (design above).
- **One principal per runtime:** see above.
- **Lock residuals:**
  - a breaker that stalls for over 10 s between its re-check and the removal;
  - a dead holder's pid reused by an unrelated live process, which blocks the store (fail-closed)
    until the lock file is removed;
  - network filesystems, which were not tested.
- **The macOS sandbox lets a process outlive its run** if it leaves the process group. This is
  pre-existing and unchanged. The artefact path is closed by reading through a descriptor, but such
  a process keeps running with the sandbox's permissions.
- **Exit semantics are learned only for programs observed on text.** Binary programs remain
  declared-only, with exit 0 as their only success. That is the Level 2 gap.
- **A flaky locale import test,** above.
