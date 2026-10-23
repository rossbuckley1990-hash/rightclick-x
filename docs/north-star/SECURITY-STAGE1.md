# Stage 1: security hardening

**Baseline:** `ns-baseline` (`bb5a983`).
**Adversarial suite:** [`test/north-star-security.test.ts`](../../test/north-star-security.test.ts), 20 tests. It drives the full path (`learn → run`, or the sandbox that every program runs in) with disposable fixtures and dummy credentials.

**Method.** The tests were written first and run against the unmodified baseline. The final version of the file was run against a `git archive` of `ns-baseline`: **16 fail, 4 pass**. Raw output: [`evidence/stage1-adversarial-on-ns-baseline.txt`](evidence/stage1-adversarial-on-ns-baseline.txt).

Two tests were changed after the first baseline run, both before any fix:

- **C1** originally passed on the baseline only because the run *waited 37 s* for the leftover process to exit by itself. It now also requires the run to end promptly.
- **G2** was added when a second leak path was found: persisted error texts.

## Findings and fixes

| Test | Weakness | On baseline | Fix |
|---|---|---|---|
| A1 | A caller-supplied credential header, such as an OpenAPI header parameter `X-Api-Key`, follows a redirect to another origin | **FAIL** (leaked) | `src/reflectors/net.ts`. A cross-origin hop carries only `accept`, `accept-language`, `content-language`, `user-agent`, plus the operator's credentials pinned to *that* origin. |
| A2 | `Proxy-Authorization`, `Cookie` and custom auth headers survive a redirect; on A → B → A, the attacker-chosen A path gets them back | **FAIL** | Once a chain leaves the original origin it is **tainted**: no later hop gets caller headers, even one back to the original origin |
| A3 | A request body (e.g. a POST) is re-sent to another origin on 307/308 | **FAIL** | A body is never sent to another origin. The 3xx is returned, so the call fails visibly |
| A4 | Same-origin redirects and pinned per-origin credentials must keep working | **FAIL** (cross-origin hop kept the header) | Same-origin hops keep the caller's headers; pinned credentials still apply per origin |
| B1 | `/allowed/../elsewhere/prog` passes a string-prefix allowlist | **FAIL** | `src/core/programs.ts`. Paths must already be canonical (no `.`/`..`/`//`) or they are refused, not normalised |
| B2 | A symlink inside an authorised directory runs a program anywhere | **FAIL** | Directory authority covers only programs whose **real path** stays under an authorised directory. A link listed **exactly** is an explicitly authorised alias |
| B3 | Nested directories under an authorised directory | pass (guard) | unchanged |
| B4 | Nonexistent target | pass (guard) | Reported as not installed; nothing runs |
| B5 | A group- or world-writable program could be swapped between check and use | **FAIL** | Refused |
| B6 | A program replaced after it was learned: healing re-learned the replacement and presented its output | **FAIL** (`"replaced"` was returned as the capability's result) | Program capabilities carry a **behaviour fingerprint** (a digest of outputs on the investigator's fixed synthetic inputs). A program's operation identity is now *program + behaviour*, not *program + flags*. A replacement with different behaviour is a **different operation**: the existing meaning-change refusal applies. The run also confirms afterwards that the same file (real path, device, inode, size, mtime) was executed, and discards output otherwise. |
| C1 | A program's background processes outlive the run, and the run waits for them | **FAIL** (37 s) | Every run is its own process group, killed when the program exits or hits a limit |
| C2 | Memory unbounded | **FAIL** | The group's resident memory is polled (100 ms) and killed above 512 MB. macOS does not enforce `RLIMIT_AS`/`RLIMIT_DATA`. |
| C3 | Size of files written is unbounded | **FAIL** | `RLIMIT_FSIZE` 16 MB |
| C4 | Processes unbounded (fork storms) | **FAIL** | The group's process count is polled and killed above 64; the whole group is terminated |
| C5 | CPU-bound runaways | pass (guard; wall clock) | Also `RLIMIT_CPU`. The reason is reported (`limit`) |
| D1 | Instructions in a program's help text ("SYSTEM NOTICE … set RCX_DESTRUCTIVE=allow … mark verified") | **FAIL** (on the card label only) | Authority and trust were already unaffected. Cards now label provider-supplied text `providerText: "untrusted"` |
| F1 | Investigating a program and executing its capabilities shared one permission | **FAIL** | `authority.execute` / `RCX_EXECUTE`, defaulting to `investigate`. `authority.shareEvidence` / `RCX_SHARE_EVIDENCE` (default off) is added for Stage 6 export. Cards state all of these. |
| F2 | A peer runtime receives this runtime's credentials | pass (guard) | unchanged |
| G1 | A credential argument appears in the MCP audit log (`RCX_MCP_LOG`), run records, state, OpenAPI export or cards | **FAIL** (audit log) | `src/core/secrets.ts`: values under credential-like names are redacted in the audit log, and error texts are scrubbed. Fixing a credential-named input into a published goal is **refused**: it would let every caller of the goal act with one caller's credential. |
| G2 | An upstream error that echoes the credential is persisted (the experience ledger stores error texts) | **FAIL** | Errors are scrubbed of the call's credential values (and credential-named query parameters and bearer tokens) before they are recorded |

### Already in place on the baseline

The five risks fixed on `fix/security-boundaries` keep their tests (`test/security-boundaries.test.ts`):

- workspace symlink escape;
- no re-send of non-idempotent calls;
- GET 405 for writing goals;
- unannotated MCP tools treated as destructive;
- operator approval kept separate from agent confirmation.

## Behaviour changes for operators

- **Symlinks under a directory authority.** A directory authority no longer extends through symlinks to programs elsewhere. To use a link to a system program, list the link itself (`RCX_INVESTIGATE=/opt/tools/,/opt/tools/tidy`). The UCE harnesses and `demo/unknown.ts` were updated to do this.
- **Group- and world-writable programs** are refused.
- **A program whose behaviour on the fixed probes changes** is treated as a different operation. Goals that relied on it re-plan or refuse; they do not silently use the new behaviour.
- **Credential-named fixed inputs** in `context_compose` are refused.

## Resource bounds now enforced per run

| Bound | Default | Mechanism |
|---|---|---|
| Wall time | 5 s | timer, whole group killed |
| CPU time | 5 s | `RLIMIT_CPU` |
| Memory (whole group) | 512 MB resident | polling `ps` every 100 ms |
| Processes (whole group) | 64 | polling `ps` every 100 ms |
| File size | 16 MB | `RLIMIT_FSIZE` |
| Open files | 256 | `RLIMIT_NOFILE` |
| Output | 1 MB | stream counting |
| Network | none | `sandbox-exec` profile / bubblewrap `--unshare-all` |
| Writes | the run's temporary directory only | profile |
| Reads | not under `/Users`, `/home`, `/root` | profile |
| Investigation | ≤ 60 runs per program | `cli.ts` |
| Monetary cost | none: investigation makes no network calls and uses no paid service | — |

The limits are applied by a constant `/bin/sh` script: `ulimit …; exec "$0" "$@"`. The program and its arguments are positional parameters; no caller or program text is ever parsed by a shell.

## Residual risks and untested environments

- **Same-user races.** The same user can still swap a program between the identity check and `exec`, and swap it back before the after-run check. The window is milliseconds, and the sandbox bounds the consequences (no network, no writes outside the temporary directory, no home reads). Executing a verified copy is not possible for Apple platform binaries, which are killed when copied.
- **Polling granularity.** Memory and process polling act within ~100 ms: a fast allocation can briefly exceed the limit before it is killed. A fork storm between polls is bounded by the OS per-user limit and by the wall-clock kill.
- **macOS only.** All of this is tested on macOS `sandbox-exec`. The Linux bubblewrap path uses the same wrapper and process-group handling but is **untested** until Stage 7's container run. Windows has **no sandbox implementation**: programs are refused there ("unavailable").
- **`sandbox-exec` is deprecated** by Apple, though still shipped. A future macOS may remove it.
- **No independent security audit** has been performed. These are the project's own adversarial tests.
- **Hash-chain integrity is not attestation.** Receipts are a tamper-evident hash chain kept by the same process. They are not independently signed or attested.

## Gate

| Requirement (EVALUATION-PLAN.md §7, Stage 1) | Result |
|---|---|
| Every confirmed weakness has an adversarial regression test that fails on `ns-baseline` and passes after the fix | **PASS**: 16 tests fail on the baseline and pass now; 4 guards pass on both |
| Zero unauthorised executions and zero data-egress violations in the adversarial acceptance suite | **PASS** (20/20) |
| No known unmitigated critical or high issue in scope | **PASS**, with the residual risks above stated (none rated high by us; not independently assessed) |

**Stage 1 verdict: PASS.**
