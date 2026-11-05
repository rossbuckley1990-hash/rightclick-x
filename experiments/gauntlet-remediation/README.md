# Remediation of the PR #57 acceptance failures

An independent evaluator accepted frozen commit `20bc3a7` (PR #57) and preserved five
counterexamples (CE1–CE5) and several review findings. Its workspace (report, sealed tasks,
scores, transcripts, counterexamples) is outside this repository and was not changed. Every one of
its files hashes the same before and after this work (6,746 files). Those programs and fixtures
are now **known development cases**, not unseen acceptance tests. This is engineering work, not a
re-evaluation: the evaluation's verdicts stand for `20bc3a7`.

## Source identities

| | Commit | Tree |
|---|---|---|
| Evaluated candidate | `20bc3a7ac0c4086e921fba2b284ae55447723a34` | `a0e7e8ba3d483c21ce4262c0cf9eea730d21237f` |
| Fix (all product and test changes) | `23fb754b8cc8b77012d72d9b3e06c634b1783f93` | `422255dd3bb7fd15f8fb018d4b27e0ec0dee9297` |

Later commits on `fix/gauntlet-remediation` add only documentation and this evidence. `src/`,
`bin/` and `test/` are identical to `23fb754`.

## Failure → cause → fix → regression

| ID | At `20bc3a7` | Root cause | Fix | Permanent regression |
|---|---|---|---|---|
| CE2 | `cp a.bin a.bin` (exit 1, nothing printed) with `stdoutAs: artefact` → `completed`, an empty stdout artefact | declared interfaces were learned with `okExit: [0, 1]` with no evidence; artefact mode accepted any code in `okExit`; only the text path refused exit 1 without output | exit-status contract: declared interfaces succeed on exit 0 only; a nonzero code needs recorded `exitSemantics` and is re-checked on every run | `CE2 regression…`, `development case nettle-hash (CE2)…`, `state persisted before this change…` |
| CE3 | `tiffcp a.tif <truncated b.tif> out.tif` → `completed`, a 1-page TIFF returned (page 2 silently missing) | same; outputs were collected and stored regardless of the exit code | a failed run stores and returns nothing; its files are evidence by digest only (`cliValidity.failure`); outputs are stored only after every check | `CE3 regression…`, `development case tiffcp (CE3)…`, `a timed-out run that wrote part of its output…` |
| CE5 / S6 | two processes stored 600 MiB in a 512 MiB store | the bound was an in-process counter | quota from content on disk, under a lock file | `CE5 regression: the total bound holds across restarts…`, `…concurrent writers…` |
| CE5 / S4 | a truncated file at the content address made `put()` succeed, then the artefact was unreadable after restart | non-atomic writes; `EEXIST` trusted the file by its name | temporary file → flush → re-hash → rename, acknowledged only after; an existing file is trusted only if its bytes hash to its name | `CE5 regression: a truncated file…`, `an interrupted write's temporary file…` |
| CE5 / S9 | one process held 240 MiB after reading 4 artefacts | unbounded read cache | 64 MiB LRU cache, revalidated against the file | `the read cache is bounded` |
| R5 | a bare digest read another caller's content | the digest was the read reference | random 128-bit read grants (`sha256:<hex>.<grant>`) tied to one hold; a digest reads nothing; logs and records keep digests only | `authority: a digest, a forged grant…`, `runtime: inline inputs are not retained…` |
| Retention | every input kept indefinitely, no delete path | inline inputs were stored; no holds | inline inputs staged, not stored; holds expire (`RCX_ARTEFACT_RETENTION_DAYS`, default 7); `release` ends one early; sweep deletes unheld content | `retention: holds expire…` |
| CE1 | `sort -n` refused: "option -n needs a value" | `--sort=numeric` was read as a placeholder for every spelling on the line | each spelling gets its own argument; a fixed-value spelling is an alias | `CE1 regression…` |
| CE4 | `dwebp -crop 7 5 12 9` refused: "option "5" is not one this program documents" | at most one value per option | arity from the documented placeholders; `#`, `lzw[:opts]` and dot leaders parsed | `CE4 regression…`, `runtime: a multi-value option reaches the program…` |
| R11 | `--compress-program=PROGRAM` had a read role (a staged file would be executed) | role inferred from the word "file" | program- and directory-valued options are never file roles; program-valued options are never offered | `an option whose value is a program is never offered…` |

Legitimate nonzero exits keep working. Real `diff` (exit 1 when its inputs differ) is learned with
evidence: 10 quiet trials with output, and exit 0 on identical empty inputs. A diff-like run that
writes to standard error is refused (`a diff-like nonzero exit is learned with its evidence…`).

## Before and after, through the public MCP interface

[`reproduce.ts`](reproduce.ts) runs each scenario against `git archive` copies of both commits.
It drives `node bin/rcx.ts mcp` as a host does, with a fresh state for each commit. CE5 uses the
store's own API. Results: [`evidence/reproduce.json`](evidence/reproduce.json), SHA-256
`e4fbd2d41e389deee3118fd077b957854b1a46f9c2e7dc369ec4588bcbf1ee0f`. Host: darwin arm64, Node
v26.12.0.

| Scenario | `20bc3a7` | `23fb754` |
|---|---|---|
| CE1 `sort -n` on 10/9/100 | failed: option -n needs a value | completed: `9 10 100` |
| CE2 `cp a.bin a.bin`, stdout as artefact | **completed**, exit 1, artefact returned | failed, exit 1, no artefact |
| CE3 `tiffcp` with a truncated second input | **completed**, exit 1, 1-page TIFF returned | failed, exit 1, no artefact; partial output kept by digest |
| CE4 `dwebp -crop 1 1 2 2 -ppm -o out.ppm` | failed: option "1" is not one this program documents | completed: `P6 2 2 255` |
| S6: 2 processes × 5 × 60 MiB, 512 MiB bound | 10 stored, 600 MiB on disk | 8 stored, 480 MiB on disk |
| S4: put over a truncated file, then read after restart | 1,000 bytes on disk; read refused (409) | 1,048,576 bytes on disk; read exact |
| R5: read with the bare digest | served | refused: a digest is not a read grant |
| S9: one process reads 4 × 60 MiB | 240 MiB in memory | 60 MiB in memory |

The evaluator's own CE1 and CE4 scripts (unmodified, print-only) were run against both trees:
[`evidence/evaluator-ce1-ce4.txt`](evidence/evaluator-ce1-ce4.txt). Its CE4 script prints only the
first placeholder, so the run-level CE4 row above is what shows the arity. Its CE2, CE3 and store
scripts write into its workspace, so they were not run. The scenarios above reproduce them.

## Test runs on `23fb754`

| Where | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| macOS (sandbox-exec), local | 845 | 845 | 0 | 0 |
| Linux image, bubblewrap (`ci/linux.Dockerfile`, `--privileged`), local | 845 | 801 | 0 | 44 |
| Linux image, no sandbox, local | 845 | 680 | 0 | 165 |

- **New tests:** 23 in all. 21 are in `test/gauntlet-remediation.test.ts`; the other 2 are the
  real-program development cases for `tiffcp` and `nettle-hash`, which skip visibly when the
  program is not installed (as in the Linux image).
- **Changed existing test:** one, the store test in `test/binary-artefacts.test.ts`, for the new
  `put` signature and grant refs. Its assertions are kept, and it adds a check that a digest alone
  reads nothing.

The six required CI checks on the review commit are recorded in the review PR.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| A: no known failed execution can be published as a successful artefact result | **Met for the known cases** (CE2, CE3, timeouts, sandbox limits, missing outputs, legacy state) | regressions above; reproduction CE2/CE3 |
| B: storage cannot exceed its persistent quota through restart or concurrent writes | **Met** for processes sharing one host filesystem with a working lock (`O_EXCL`). Not tested on network filesystems. | S6; concurrent-writer test |
| C: truncated or corrupted content cannot be acknowledged as stored | **Met** | S4; truncated-file and link tests |
| D: documented option semantics preserved, no new unsafe file access | **Met for the tested grammar** | CE1/CE4/R11 tests; host-path checks apply to every value |
| E: confinement and provenance intact | **Met.** The sandbox is unchanged. Provenance keeps digests, and grants are never recorded in it. | full suite incl. confinement tests |
| F: all six required CI jobs pass on the exact review commit | see the review PR | |

## What remains open

- **Provenance omits argv** and which option consumed which file (R8).
- **One principal per runtime.** Grants are bearer capabilities. The runtime's state file keeps the
  results it returned, grants included.
- **Retention.** Expired content is deleted at start-up, under quota pressure or on release, not on
  a timer. An expired grant stops reading at once.
- **Exit semantics** are learned only for programs RightClick could observe on text. Binary programs
  stay declared-only with exit 0 as their only success. That is the Level 2 gap the evaluation
  measured. See [`docs/autonomous-binary-discovery-proposal.md`](../../docs/autonomous-binary-discovery-proposal.md).

## Reproduce

```bash
git archive 20bc3a7 | tar -x -C /tmp/at-20bc3a7 && git archive 23fb754 | tar -x -C /tmp/at-23fb754
```

```bash
node experiments/gauntlet-remediation/reproduce.ts 20bc3a7=/tmp/at-20bc3a7 23fb754=/tmp/at-23fb754
```

```bash
node --test test/gauntlet-remediation.test.ts test/binary-artefacts.test.ts
```
