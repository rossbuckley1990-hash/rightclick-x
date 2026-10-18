# Repeated publication and planner work

**Bounded improvement; historical stall not reproduced; North Star release remains NO-GO.** This checkpoint reduces repeated computation inside one planner invocation. It does not establish superior coding-agent economics or close the original three-minute publication observation.

The subsequent Living Capability Plane mission update is additive. This completed performance investigation is preserved before dashboard work, on `programme/adaptive-capability-plane` throughout.

## Source and experiment

- Baseline product: `43aa913ed7d6b29e09eaafd79b635c94e8aab2cc`.
- Workload freeze: `0f69bfa` (`planner-replay.mjs` and exploratory diagnostic).
- Product freeze: `f0bb7d31e05d4883a615ed7c9c5329004c5b2661`.
- Separate Python checker: `4ec8b91`. Reproduction driver: `114d501`; the driver codifies the recorded shell-invoked Python loop after measurement, while the worker and product were frozen beforehand.
- Environment: macOS 26.4.1 arm64, Node 26.12.0, npm 11.20.0, Bun 1.3.14, Python 3.14.6. Linux uses the previously cached image recorded below. No model calls, external provider traffic or purchases.

Only `src/core/planner.ts` changes product behavior internally. It memoizes parsed value names and intent bonuses within one search, computes consumed steps and covered intent once per search node, normalizes port names outside the value loop, and memoizes ignored-input counts during ranking. Metadata does not survive a planning call. Search budgets, candidate order, bindings, ranking rules, outcome checks, authority checks and Actenon implementations are unchanged.

## What the original slowdown establishes

The [disclosure checkpoint](DISCLOSURE.md) preserved a test stopped after 3m18s while repeatedly publishing 25 goals. Its exact abandoned draft was not retained. The reconstruction here uses the current test's weather/translation request and 25 distinct publication names; it is not claimed to reproduce identical historical code.

The profiled reconstruction completed all 25 publications in **4.34 seconds**, with no nested saved-goal calls. A public `crystallize:false` variant completed in **2.60 seconds**, reaching one nested goal; nested execution can itself crystallize a successful pipeline under existing behavior. Neither reproduced the stall. Both traces, per-publication CPU profiles and parent termination records remain in `evidence/publication-performance/diagnostic-*`. Profiling adds overhead and these two exploratory runs are not before/after timing evidence. The first harness was not frozen before use; its default behavior is retained in the later diagnostic freeze. The historical observation remains unresolved, not fixed by assertion.

Profiles showed repeated binding/name work. The subsequent unprofiled comparison evaluates the narrow optimisation with exact plan equivalence and real runtime publication/reuse in the existing in-memory demo services.

## Frozen results

Six fresh-process before/after pairs alternate arm order. Each process has a 55-second parent timeout. No attempts timed out or were removed. Each planning replay evaluates 256 seeded queries over 64 development graphs; 209 queries return nonempty plans. The cases include risk/origin restrictions, exclusions, anchors, fan-out shapes, enums, optional ports and graph/ledger mutations between calls. They are exposed synthetic cases, not unfamiliar-software holdouts.

**All 1,536 paired plan comparisons are exactly equal**, including ordered steps, bindings, result, costs, scores and satisfaction records. This is regression equivalence, not proof that every baseline plan is semantically correct.

Each publication replay learns the existing demo services, publishes 25 goals with stored predicates, flushes and reloads retained state, then invokes all 25 saved goals. Across both arms and six pairs, **600/600 outputs match the fixed fixture oracle**. Every result remains **predicate checked**, never independently verified. State reload is within the worker process; this experiment does not claim fresh AI or cross-model reuse. The separate checker also checks reused-run receipt digests and rejects altered bindings, wrong output, false verified grades and missing publications.

| Measured work per replay | Baseline median | Candidate median | Median paired speedup |
|---|---:|---:|---:|
| 256 planner calls, summed | 102.5 ms | 82.6 ms | 1.36× |
| 25 publications, summed | 1,967.6 ms | 1,196.6 ms | 1.46× |
| 25 retained goal calls, summed | 345.6 ms | 213.5 ms | 1.58× |
| Fixture lifecycle after manifest creation | 2,435.0 ms | 1,529.4 ms | 1.40× |

Median paired ratios differ from ratios of the arm medians. Lifecycle timing includes runtime/import setup, demo learning, publication, persistence and reload/reuse; it excludes process launch and source/hash preflight. Process wall times are also retained separately. These are ordinary desktop measurements, with substantial variability: isolated planner paired ratios range **0.46–2.78×**, including a slower candidate pair; lifecycle ratios range **1.24–2.09×**. Six pairs and a toy workload do not establish statistical generality, a live-model saving or the required commercial threshold. Previous unfavorable coding-agent and equally protected saved-script comparisons remain authoritative.

## Validation and preserved setup failures

The final validation results and artifact hashes are recorded in [the verification manifest](evidence/publication-performance-verification.json). All original thresholds remain binding.

- Focused planning regressions: 37/37, zero skips.
- Typecheck: PASS. Complete native suite on the fully configured export: **290/291, one failure, zero skips**. The unchanged `C2 sandbox: memory use is bounded` probe printed `done` instead of being stopped. Separate focused runs of the same test pass on both baseline and candidate (one test each). This is an unresolved intermittent resource-limit failure, not an accepted full-suite pass; source comparison confirms the optimisation did not change the sandbox or test. Do not infer a root cause from a later pass.
- Targeted Linux planning, authority, changed-meaning and disclosure regressions: 66/66, zero skips.
- Frozen black-box proof: 28/28.
- Unchanged Actenon lifecycle: 23/23. The separate native checker verifies 22 exact-request proofs and 29 linked signed artifacts, rejects 29 altered artifacts and four record corruption controls. This retains the earlier bounded enforcement scope; it adds no new containment or release-compatibility claim.
- Complete offline installed CLI workflow: five correct real-program outputs, 47 packaged source files checked, 21 command records, unchanged retained reflections, operator refusal, thirteen tools and uninstall. Package: 414,004 bytes; SHA-256 `043eae3d265d83e6d3f19d937c5644d070726338a70b76a765d6117ea40f96e2`. Results remain unverified at runtime and are separately checked by the fixture oracle.

Preserved setup failures are not product failures or completed passing suites:

1. The initial exported test tree omitted `experiments/`, causing five module-load failures (262/267 pass). Logs and exit status remain.
2. A subsequent export preflight refused `proof/results/latest.json`, which the proof run had regenerated. The actual new proof result is retained, and generated `proof/results/` is explicitly excluded from source identity checks.
3. With experiment modules restored, the next test run still lacked the declared TypeScript dev dependency. Its module-load failure remains. The final setup links the already-installed dependency tree without downloads or dependency changes.
4. The initial package smoke passed runtime/tool/uninstall checks, but the export omitted README/LICENSE. That incomplete artifact and its limitation record are retained. The accepted package reruns the established source-verifying installed workflow with both exact frozen files present.

No product code or acceptance test was changed to resolve these setup errors. No failed attempt was deleted or relabelled as a pass. These checkers are separate implementations/processes by the same author; they do not satisfy independent-author review.

The separate memory-limit failure above is **not** one of the setup errors. It remains a security/release blocker until diagnosed and remediated. Its full failing log and the passing isolated before/after diagnostics are retained together.

## Reproduction

Use this repository with the listed Git history, an installed declared development dependency tree, Node supporting TypeScript erasure, Python, Bun, and native sandbox support for native program tests. No API key or paid model is needed. Export into new directories:

```sh
mkdir /tmp/rcx-planning-before /tmp/rcx-planning-after
git archive 43aa913 src bin test demo experiments ci proof package.json package-lock.json tsconfig.json README.md LICENSE | tar -x -C /tmp/rcx-planning-before
git archive f0bb7d3 src bin test demo experiments ci proof package.json package-lock.json tsconfig.json README.md LICENSE | tar -x -C /tmp/rcx-planning-after
python3 experiments/north-star/run-planner-pairs.py /tmp/rcx-planning-before 43aa913 /tmp/rcx-planning-after f0bb7d3 /tmp/rcx-planning-pairs
python3 experiments/north-star/check-planner-replay.py /tmp/rcx-planning-pairs
```

The frozen worker refuses mismatched product bytes or an uncommitted worker. The driver refuses an existing output directory. Use the complete product checkout with its installed dependencies for `npm run typecheck`, `npm test` and `npm run proof`; keep generated proof results separate from source checks. The existing `cli-input-package.mjs`/`check-cli-input-package.py` procedures in [CLI inputs](CLI-STRUCTURED-INPUT.md) apply to the candidate revision. The existing Actenon lifecycle/checker commands in [changed-action evidence](CHANGED-ACTION.md) run against this product with the same audited source pins and cached image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`.

The next work follows the additive Living Capability Plane mission: audit the current dashboard, replace misleading graph-scale claims with sourced metrics, then build a real lifecycle/evidence vertical slice. The independent unfamiliar challenge, real-model economics, independent review and commercial human gates remain required.
