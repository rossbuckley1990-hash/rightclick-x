# Isolated reconciliation preparation — 20 October 2026

**Candidate prepared for review; main unchanged. Release remains NO-GO.** No push, remote merge, release, paid operation, folder removal or history rewriting was performed.

Candidate: `/Users/ross/src/rightclick-x-reconcile`, branch `integration/github-source-of-truth`. Tested product/configuration revision: `69ad90ea8e0afb6b7a093e94db9609ec0f0286b6`. The subsequent evidence commit does not change product code. Use `git rev-parse HEAD` for the complete candidate revision.

## Preservation and source of truth

The private directory `/Users/ross/src/rcx-preservation-20261020` is mode 0700. It contains verified bundles for both original repositories, full Git metadata archives (including reflogs and unreachable objects), binary staged/unstaged patches, and a working-file archive covering all 11 original worktrees. All **24,787 entries** were read back and matched against hashes, symlink targets and modes. Re-inventory after integration found **zero original-file changes**; every original HEAD, branch and porcelain status also matched. Installed `node_modules` caches were excluded; Git metadata was archived separately. This verifies archive contents, not a full disaster-recovery restore drill.

**Never publish that backup directory.** It deliberately preserves ignored credentials and private state. Only non-secret verification metadata is copied here. See [preservation check](preservation-check.json) and [provenance](provenance.json).

Four preservation refs now anchor local main, the earlier discovery draft, the measurement draft and the original SSE correction. Original branches and stashes were not altered. No failed experiment was removed or rewritten.

| Original checkout | Branch / HEAD | Disposition |
|---|---|---|
| `/Users/ross/src/rightclick-x` | `main` / `2666ad2` | Unchanged, clean; recommended primary checkout after approved GitHub integration. |
| `/Users/ross/src/rightclick-x-main-discovery` | `integration/universal-discovery-main` / `2666ad2` | Unchanged; candidate starting point. |
| `/Users/ross/src/rightclick-x-adaptive` | `programme/adaptive-capability-plane` / `42c46e0` | Unchanged; nine modified sources, seven untracked files and ignored logs preserved. |
| `/Users/ross/src/rightclick-x-security` | `fix/security-boundaries` / `9e76f00` | Unchanged; integrated into candidate with the MCP conflict resolved conservatively. |
| `/Users/ross/src/rightclick-x-sse-integration` | `feature/generic-sse-discovery-recovery` / `6b22a59` | Unchanged; discovery work already represented by the narrow starting branch. |
| `/Users/ross/src/rightclick-x-uce` | `feature/universal-capability-engine` / `0c3b3aa` | Unchanged; history is already an ancestor of adaptive. |
| `/Users/ross/src/rightclick-x-north-star` | `programme/rightclick-x-north-star` / `03d5bf7` | Unchanged; 11 modified evidence files preserved. |
| `/Users/ross/src/rightclick-x/.claude/worktrees/gallant-mendel-7f183f` | `Ross/gallant-mendel-7f183f` / `1e191f8` | Unchanged; history already an ancestor of adaptive. |
| `/private/tmp/rcx-adaptive-baseline-03d5bf7` | detached / `03d5bf7` | Unchanged; ten modified evidence files preserved. |
| `/Users/ross/Desktop/RCX-Showcase/rightclick-x` | `main` / `3709415` | Unchanged; eight modified and 1,159 untracked files preserved. Experimental environment, not canonical engineering. |
| `/private/tmp/first-customer-execution/product` | `feature/real-customer-capability-recovery` / `5265ecd` | Unchanged; original SSE correction retained. |

Fresh fetch confirmed GitHub `main` at `4d51590a3974c3b5348a38a3011fcc51200cdfca`, security at `9e76f0078b0dcf439c45c31f8a424b84a959d7a7`, and adaptive at `42c46e092fbccd8304ec89623c496691ebf37749`. Fetch changed no working-tree files. Local main remains three commits ahead and five behind GitHub main; this preparation deliberately does not resolve that by moving main.

## Integration choices and North Star value

1. Started from the narrowly verified discovery integration at `2666ad2`. It contains bounded MCP SSE parsing, response deadlines and cancellation, GraphQL fallback and YAML contract support. Its existing regression evidence is retained.
2. Local merge `b35638f` incorporates GitHub main's five missing experiment commits, preserving ancestry and both secret-file ignore rules. Those commits contain no core runtime changes.
3. Local merge `40735fa` adds the security branch's workspace symlink checks, destructive operator approval, suppression of ambiguous write retries, and POST-only generated endpoints for writing goals. These are prerequisites for discovering executable capabilities without automatically granting destructive authority.
4. The sole source conflict was MCP annotation precedence. The final file is byte-identical to the verified discovery baseline: a destructive hint takes precedence over a contradictory read-only hint. Both existing end-to-end regression tests still assert zero tool execution.
5. Commit `69ad90e` adds product CI for macOS and Linux, and disables the historical `alien-cloud` job with an unconditional false guard. That experiment exposes a token and interpolates dispatch input into shell code; its recipe and history are preserved for separate review. No workflow was dispatched.

No vendor adapter or new application-specific runtime code was added. No Actenon cryptographic or authority machinery was copied. **This is a compatibility and preservation milestone, not new generalisation research.** The complete adaptive programme remains the most feature-rich verified implementation; this smaller candidate is a reviewable main-derived foundation, not its replacement.

## Verification

All runtime/test files match the product manifest. Native checks used macOS ARM64, Node 26.12.0 and Bun 1.3.14. Linux checks used cached image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`, Node 24.22.0 ARM64, with no network, no capabilities, read-only source/Git/dependencies, and disposable writable execution files.

| Check | macOS | Linux |
|---|---:|---:|
| Full regression | 153 passed, 0 failed, 0 skipped | 153 passed, 0 failed, 0 skipped |
| Frozen discovery acceptance | 24/24 | 24/24 |
| MCP lifecycle proof | 28/28 | 28/28 |
| Semantic/security negative controls | 6/6 | 6/6 |
| TypeScript check | Pass | Pass |
| Node and browser builds | Both pass | Not rebuilt: cached image has no Bun |
| Built CLI and browser-entry smoke | Pass | Pass, using host-built portable bundles |

Workflow YAML parses and the disabled-cloud guard was checked. GitHub-hosted CI and actionlint have **not** run. Linux uses an already-installed dependency tree mounted read-only; clean `npm ci` and clean-machine packaging remain future checks. No live model or external provider was used.

The whitespace check remains nonzero: `git diff --check` on the imported security history reports ten trailing-whitespace lines in its original failed-test transcript. That transcript is intentionally preserved byte-for-byte. New verbatim command logs likewise retain trailing or terminal blank lines; logs are not normalized to satisfy a formatting check. Product source/test and new harness/document whitespace checks pass. See [retained failure](historical-evidence-whitespace.log). The earlier audit also found 300 broken archived README links in adaptive; this candidate does not purport to fix that separate programme gate.

Gitleaks 8.30.1 also returned its findings exit code: 41 candidate-history findings and 12 final-evidence findings. Every flagged original line was inspected and classified as a SHA-256 file-manifest entry; zero remain unclassified. The new reconciliation harness has zero findings. The earlier 11-finding evidence scan is retained too. This is not an overall zero-findings result or comprehensive credential clearance. Redacted scanner reports remain in the private preservation directory; [public metadata](secret-scan-summary.json) contains no matched values. No private backup or unrelated untracked material was staged.

The proof's business-result checks use a separate fixture witness, but the suite is controlled and same-author. It is **not independent human review or a newly blinded unfamiliar-software holdout**. Historical 3/12 generalisation is unchanged; the mandoc/od semantic failure and GitHub SBOM asynchronous-composition gap are not closed here. No improvement over the strong coding-agent economics baseline is claimed.

## Remaining blockers and next engineering slices

- Adaptive has 221 commits absent GitHub main, release NO-GO evidence, and unfinished response-link changes. Neither PR #2 nor that working tree was blanket-merged. Its full final response-link regression, old-reader compatibility, independent holdout and review remain required.
- The narrow candidate retains the documented concurrent `FileStore.save` race. Review and port the existing adaptive persistence correction with its concurrency controls before relying on reusable-capability durability. Do not invent a second implementation.
- Operator capability approval is not cryptographic exact-action authority. Credential ownership, direct API/shell alternatives, generated endpoints, federation, post-check symlink races and complete boundary coverage remain limitations. The security merge does not establish universal containment or provider-independent exactly-once execution.
- The historical `switchover-probe` workflow is manual and asserts an old frozen runtime. It is not a product CI gate and will intentionally reject this changed runtime; do not relax its freeze to manufacture an experiment success.
- GitHub main has no protection/rulesets according to the audit. New product CI must run on an approved PR and reviews must be required before main becomes the authoritative integrated baseline.

The next three North Star increments are: (1) transfer the existing tested persistence fix needed for durable capability inheritance; (2) reconcile adaptive's authorised environment-source/lifecycle substrate with the now-integrated bounded protocol discovery; (3) finish the preserved response-link and asynchronous dataflow work, then test frozen implementation against independently authored unfamiliar providers. Inspect existing adaptive/Actenon evidence before any additional boundary design. These are future scoped changes, not completed work in this candidate.

## Reproduction and subsequent approvals

Read-only validation of committed evidence and source attribution:

```sh
cd /Users/ross/src/rightclick-x-reconcile
python3 experiments/reconciliation/verify.py
git diff --exit-code 69ad90ea8e0afb6b7a093e94db9609ec0f0286b6 HEAD -- src bin test demo proof package.json package-lock.json tsconfig.json .github/workflows .gitignore
```

For fresh checks, use a disposable feature worktree so the proof and negative-control commands cannot overwrite retained historical result files:

```sh
git worktree add --detach /private/tmp/rcx-reconciliation-check integration/github-source-of-truth
cd /private/tmp/rcx-reconciliation-check
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
node experiments/sse-discovery/acceptance.mjs . /private/tmp/rcx-reconciliation-acceptance.json
node proof/run.ts 20261018
node experiments/open-world/negative-controls.ts
npm run build
node dist/rcx.mjs version
node --input-type=module -e "await import('./dist/edge.js')"
```

The exact offline Linux command is retained in `linux-container.command.json`; its small driver is `experiments/reconciliation/linux-check.sh`. Adjust the explicit mount paths and numeric user for another machine. The cached image is a local asset, not a published reproducibility dependency; the CI workflow documents equivalent standard Node/Bun checks.

**Not executed; requires further approval:** push this branch and create a review PR using the prepared description:

```sh
git -C /Users/ross/src/rightclick-x-reconcile push --set-upstream origin integration/github-source-of-truth
gh pr create --repo rossbuckley1990-hash/rightclick-x --base main --head integration/github-source-of-truth --title 'Reconcile bounded discovery and operator security safeguards' --body-file /Users/ross/src/rightclick-x-reconcile/docs/reconciliation/20261020/PR.md
```

After review, passing remote CI and explicit merge approval, use a normal merge preserving ancestry. Re-fetch and confirm the primary checkout is clean and not being edited; then `git -C /Users/ross/src/rightclick-x merge --ff-only origin/main` can synchronise it. A squash merge would not preserve the local main ancestry. Keep all other worktrees and private archives until their unique work is reconciled. No archive/removal is authorised by this preparation.
