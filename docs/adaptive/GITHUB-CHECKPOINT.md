# Engineering branch checkpoint for GitHub

On 20 October 2026 the operator explicitly authorised committing and pushing worthwhile work. The selected scope is the existing `programme/adaptive-capability-plane` branch, including implementation, regressions, reproducible experiments, failed trials and the original NO-GO assessments. Main, releases and other worktrees remain separate. This checkpoint is prepared for review and backup, not a release or a claim that the North Star is complete.

The [latest engineering report](RETAINED-RESULT.md) records product freeze `64bbb1a24ab5bf8adb449d8371981e426752de58` and the subsequent evidence commit `df9c192240bd58ae39d80433b1b466281597d3dc`. It passes 508 native tests, 79 focused Linux tests and 28 proof checks, typecheck/builds and the committed 83-file evidence audit. No product code changed during push preparation.

GitHub main was fetched at `4d51590a3974c3b5348a38a3011fcc51200cdfca`; its history is preserved. The initial unpublished object inventory covers 7,312 blobs / 1,147,818,822 uncompressed bytes, with no file over 50 MiB. A supplementary scan after the evidence commit covers 7,338 blobs / 1,149,544,567 bytes. Most volume is retained experiment evidence. The branch's only workflow runs on main pushes and pull requests; this engineering-branch push does not invoke those jobs. No merge, release, deployment or paid service is part of this action.

## Sensitive-material review

[Review record](evidence/github-checkpoint-2026-10-20/review.json), [history findings](evidence/github-checkpoint-2026-10-20/gitleaks-history-redacted.json), [classification](evidence/github-checkpoint-2026-10-20/gitleaks-history-review.json) and [supplementary scan](evidence/github-checkpoint-2026-10-20/sensitive-patterns.json) retain the bounded checks. Gitleaks 8.30.1 used its default rules, default decoding, no custom configuration/ignore file and `--ignore-gitleaks-allow`; output is redacted. It reports 217 scanned commits in the original 219-commit branch range and 511 generic-key findings, rather than a zero-finding pass. Review against original committed files classifies all 511:

- 410 are SHA-256 file-digest map entries.
- 100 are public `rpk_` replay identifiers in retained local Actenon receipts/refusals. The audited kernel's `actenon/replay/service.py` derives them from a SHA-256 digest of proof/action metadata; they are not signing keys or bearer execution proofs.
- One is the public package description text `grants/approvals/ledger/attenuate`.

The separate scan of the final evidence commit reports four more source-file digests. The supplementary unique-blob patterns find eight deliberate credential-URL controls on `.test` domains and four occurrences of the literal privacy-test credential. No live credentials or private keys were identified, and no credential-like filenames were tracked. This is same-author heuristic review, not a guarantee that all possible sensitive information is absent. No global allowlist, historical rewrite or evidence deletion was used.

Reproduce the main scan with a new output path:

```sh
gitleaks git . \
  --log-opts='4d51590a3974c3b5348a38a3011fcc51200cdfca..64bbb1a24ab5bf8adb449d8371981e426752de58' \
  --redact --no-banner --no-color --ignore-gitleaks-allow \
  --report-format json --report-path /tmp/rcx-new-history-scan.json
```

Exit status 1 is expected for the recorded findings and requires review; it is not silently relabelled as a clean scanner result. The additional evidence commit is scanned with `--log-opts='64bbb1a..df9c192'` and the same options.

## Documentation check remains failing

The [preparation check](evidence/github-checkpoint-2026-10-20/doc-links-before.log) found 301 broken relative links: 300 in immutable copies of archived source READMEs, plus one older North Star report pointing to a nonexistent benchmark document. The live report now links to actual retained selection/results and the subsequent accounting correction, and distinguishes model selection from independent-author review. The [final check](evidence/github-checkpoint-2026-10-20/doc-links-final.log) still reports 300 archived README links. Their frozen bytes and the checker are unchanged. This is a known documentation/CI failure, not a passing check or grounds to weaken acceptance.

Release remains **NO-GO**, including the unresolved native hard-memory boundary, independent-author/holdout and economic gates. See the [release assessment](RELEASE-READINESS.md) for the full limitations. Pushing the engineering history does not promote any gate.
