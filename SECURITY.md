# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, via GitHub's private vulnerability reporting for this repository (Security → Report a vulnerability). Do not open a public issue.

Include:

- what you did;
- what happened;
- what you expected;
- the commit you tested.

We aim to acknowledge reports within five working days. We will credit reporters who want credit.

This is a small open-source project with no bug bounty. **No independent security audit has been performed.**

## What RightClick X enforces, and where

All of these are enforced in code outside the language model:

- **Discovery.** It learns only what the operator points it at, under a network policy (private and metadata addresses blocked; egress allowlists). It investigates only local programs the operator authorises (`RCX_INVESTIGATE`).
- **Execution.**
  - Local programs run only in the host sandbox (macOS `sandbox-exec`, Linux bubblewrap). There is no network, writes go only to a temporary directory, and home directories cannot be read.
  - Limits apply to time, CPU, memory, processes, file size and output, and the whole process group is terminated.
  - Destructive operations need operator approval (`RCX_APPROVE`) plus the caller's confirmation.
  - State-changing calls that may have taken effect are never re-sent automatically.
- **Credentials** are pinned to their origin. A caller's headers never follow a redirect to another origin. Credentials are redacted from audit logs and persisted errors, and cannot be fixed into published goals.
- **Publication and evidence sharing** are operator authorities (`authority.publish`, `RCX_SHARE_EVIDENCE`).

The full record, the adversarial tests and the residual risks are in [docs/north-star/SECURITY-STAGE1.md](docs/north-star/SECURITY-STAGE1.md).

## Known limits

- A process running as the same user can race to replace a program between its identity check and execution. Changes are detected after the run, and the sandbox bounds the effect.
- Memory and process limits are enforced by polling every 100 ms.
- `sandbox-exec` is deprecated by Apple, although it still ships.
- Windows has no sandbox implementation, so programs are never run there.
- Receipts form a tamper-evident hash chain kept by the same process. They are not independent attestation.
