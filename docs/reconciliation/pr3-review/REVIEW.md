# PR #3 review and corrections

The original PR head `492da01d2891995685cb7b363c9cdcf3e571193c` passed its CI but was **not ready to merge**. Manual source review plus executable adversarial controls found four defects in the security-sensitive paths touched by this integration:

| Severity | Finding | Correction |
|---|---|---|
| P1 | MCP session recovery could resend a state-changing tool beneath the runtime's retry guard, including when a 504 response body merely mentioned HTTP 404. | Retry safety is supplied explicitly by runtime/operator policy; reconnect matches a typed transport status, never provider text. |
| P1 | HTTP 4xx and arbitrary error strings were treated as proof that a write had not committed. A controlled provider committed then failed, causing a second effect during repair. | Removed the unsupported non-commit inference. Reads and operator-declared side-effect-free operations remain retryable. Ambiguous writes fail without replay. |
| P1 | Repair could execute a replacement destructive capability using approval granted only to its former capability ID. | Reapply both execution approval and retry policy to the actual replacement before dispatch. |
| P1 | A 303 followed by another redirect could resurrect the original POST/body and transmit it to a different origin. | Carry forward the current method/body across every hop; a discarded body stays discarded. Origin credentials and body-related header handling remain enforced. |

Corrected product commit: `0bb6184` (full identity in `provenance.json`). No cryptographic authority code or Actenon dependency was added. Existing Actenon feasibility findings were consulted: local safeguards do not replace an independently enforced resource boundary or prove universal containment.

The final **12 review controls** run against the frozen original PR produce **3 passes and 9 failures**, reproduced by `experiments/reconciliation/review-baseline.py`. The corrected product passes all 12, including read-only reconnect and explicitly authorised recovery. These are engineering regressions designed from review findings, **not the historical 3/12 unfamiliar-software holdout**, whose result remains unchanged.

Final local checks: **165/165** full regressions, zero failures/skips; **24/24** frozen discovery checks; **28/28** MCP lifecycle checks; TypeScript and both Node/browser builds pass. The final lifecycle source manifest matches the corrected source. Fresh GitHub CI is required on the pushed correction before merge. This manual review is not an independent security certification.

Failure evidence is retained: initial fixture syntax failure; the original eight-case 2/8 result; final original-head 3/12 result; an overly conservative composite policy causing one existing recovery failure; and a fetch-adapter invocation change causing regression/acceptance failures. Corrections preserve the original tests and acceptance criteria. Composite progress now uses the runtime's failed-capability identity instead of parsing provider text; repeated ambiguous identities fail conservatively. The initial GET invocation preserves existing adapter semantics.

No remaining merge blocker was found within this reviewed integration scope. The FileStore race, independent holdout, full execution-boundary coverage, stronger semantic inference and commercial economics remain North Star/release blockers. Main and the other worktrees are unchanged at this review checkpoint. Earlier reconciliation reports/manifests remain historical evidence for their original revisions and are not rewritten to claim these fixes were already present.

Reproduce current evidence integrity with `python3 experiments/reconciliation/verify-review.py`. Run `npm test`, `npm run typecheck`, and `npm run build` for fresh local checks. Run `python3 experiments/reconciliation/review-baseline.py` to reproduce the original-head failures; exit 1 is expected and must not be relabelled a pass.
