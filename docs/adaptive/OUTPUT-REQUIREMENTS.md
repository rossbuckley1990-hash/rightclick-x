# Output requirements: bounded search correction

Starting source: `d4eef5ffc6ad94a87ac70a2116c2bff0e622184d`. Initial implementation freeze: `90e453a85ac743740d67dab236250ebc8b748bde`. Corrected engineering freeze: `be84f20f9282a79c86de7b285e465c36739513e7`, on the existing `programme/adaptive-capability-plane` branch. No branch replacement, remote mutation, new model usage or provider request was needed.

The prior [matched model comparison](REUSE-COMPARISON.md) exposed a 16,629.7 ms unsuccessful composition call: the model supplied a saved capability ID in `require`, whose meaning is required output information. Operation constraints belong in `through`. The same retained state and request reproduced offline in 20,576.8 ms. The runtime correctly refused execution, but spent time enumerating incomplete plans and gave little guidance.

## General change and invariant

Composition now checks whether every required term could occur in the current graph's declared result fields or output ports under the existing satisfaction rule. If a term is absent everywhere, no currently established plan can supply it. That necessary-condition check skips the futile search and reports exactly which information lacks evidence. It does not infer that undiscovered software lacks the information. Explicit acquisition still runs within its existing policy and recomputes the check after learning.

The check includes blocked capabilities and unselected GraphQL fields, so a possible policy refusal or projection still receives the normal planner analysis. Metadata presence does not establish usable inputs, compatible identities, a common result, permission or a verified outcome. No constraint is dropped, moved into `through` or widened. A field may legitimately carry words that also form a capability ID; that case remains accepted. The graph is checked anew on each call, including after a provider changes.

The public interface remains thirteen tools with the same schemas. `require` guidance now explicitly names `through` for operation constraints. For a requirement absent from all current metadata, `plans` is now empty instead of listing incomplete candidates; `outcome` remains unavailable. The public low-level `plan()` API is unchanged. Product changes are confined to the existing satisfaction module, runtime composition and tool description: 34 added / 6 removed lines across three files. No provider-specific source, dependency, cryptography or Actenon component was added or changed.

## Preserved failure and correction

Two new regression expectations fail on the starting source and pass after the initial implementation. Subsequent review found that `resultFields` strips `[]` in declarations but retains literal brackets in its scalar-leaf fallback. The first preflight therefore incorrectly rejected a term in an output named `parcel[]mass`. The added regression passes on the starting source and fails on the first candidate. Both logs remain in [the evidence directory](evidence/output-requirements/). The corrected preflight includes literal output-port names as well as normalised declared fields. Forty-seven focused tests pass after correction.

## Measurement and validation

The [predeclared experiment](OUTPUT-REQUIREMENTS-PLAN.md) uses six sequential fresh-process replays per freeze, in baseline/candidate, candidate/baseline, baseline/candidate order. Sources are immutable Git archives; request and graph come from the retained real-model call. Fetch is replaced by a throwing observer. Timing measures `compose`, after runtime creation; RSS is one post-call process snapshot, not peak memory or a hard bound. The workload is exposed development evidence, not an unfamiliar holdout. The original reproduction and both six-replay batches are retained, including the superseded candidate.

| Corrected frozen comparison | Starting source | Corrected source |
|---|---:|---:|
| Compose milliseconds, three fresh processes | 18,004.1 / 19,828.1 / 18,822.6 | 92.6 / 84.8 / 100.7 |
| Median compose milliseconds | 18,822.6 | 92.6 |
| Network requests / executions / publications | 0 / 0 / 0 | 0 / 0 / 0 |
| Capabilities before / after each replay | 69 / 69 | 69 / 69 |
| Listed incomplete plans | 5 | 0 |
| Outcome on every replay | unavailable | unavailable |

The final comparison removes this specific search cost; it does not retrofit a model-time/token improvement into the prior live trial. The first frozen comparison also passed its six refusal checks (medians 17,777.3 versus 75.0 ms), but preceded the literal-name correction. All **13** offline replays, including the initial reproduction and both frozen batches, remain counted. No new model or external service result is claimed.

Final validation on corrected product freeze `be84f20` passes **480 native tests, 81 focused Linux tests and 28 proof checks**, with **zero failing, cancelled or skipped final tests**. Product and replay-harness type checks and all four product builds pass. Three checker tests include nine corrupted-result controls and an extra-unaccounted-attempt control. Before correction, the full native/Linux/proof runs passed 479/80/28; the subsequently added literal-name regression still failed, and those earlier passes were not substituted for corrected validation. Raw logs, both proof artifacts, two starting-regression failures and the initial candidate's failure remain retained.

The separate Python checker reconstructs both source hashes and the original fixture from Git, verifies all six process records, exact requests, graph sizes and refusal invariants, and rejects accounting/effect/source corruptions. The [evidence manifest](evidence/output-requirements-manifest.json) and [audit](evidence/output-requirements-audit.json) cover the retained files and rerun both pair checks and the corruption tests. These are distinct implementations by the same author, not independent-author review. They cannot prove properties outside the retained experiment or detect a deliberately fabricated entire evidence set.

## Acceptance coverage and remaining limits

| Original outcome | Evidence from this increment |
|---|---|
| 1. Generic discovery | Controlled acquisition still discovers and learns a missing contract; no new discovery protocol or sealed target |
| 2. Semantics and verified outcomes | Unknown information remains unavailable; known metadata does not clear generic joins; existing post-execution and projection checks pass in focused validation |
| 3. Independent authority | Existing policy diagnosis is preserved; no new independent enforcement or route-coverage claim |
| 4. Fresh reuse | Replays use a real retained graph; no new live model-transfer result |
| 5. Adaptation | Adding/removing output evidence changes the decision without stale cached coverage |
| 6. Economics | Removes one measured futile-search cost; prior adverse total model-time/token comparison still stands |
| 7. Regression and holdouts | New regressions, negative controls and reproducible source comparison; independent-author holdouts/review remain open |
| 8. Developer experience | More useful constraint guidance through the same compact interface; no unfamiliar-human or clean-machine installation result |

This check does not optimise searches where metadata mentions the information but no permitted, semantically valid plan can produce it. Its scan has a cost proportional to the examined field/term metadata; valid-request overhead has not been separately benchmarked here. The baseline's incomplete diagnostic plans are intentionally omitted only when the necessary condition fails. A capability ID that no longer exists may not receive the ID-specific hint, but its requirement is still preserved.

Release remains **NO-GO**. Native Darwin short-allocation hard-memory containment remains a demonstrated failure. Independent-author review/holdouts, qualifying four-arm economics, cross-vendor transfer, full deployed authority coverage and clean-machine/human/commercial gates remain unmet. Current native test success cannot close the historical hard-memory failure. The optional source-pinned Actenon trust boundaries and audit limitations remain unchanged.

Next: (1) distinguish contract-backed GraphQL request errors from actual drift without provider-specific rules; (2) expose retained result shape and publication status clearly enough to reduce unnecessary fresh-agent reconstruction; (3) freeze the improved runtime for independently selected four-arm unfamiliar and maintenance evaluation. No acceptance threshold is reduced.

## Reproduction

From the repository, with its existing local dependencies and Git history:

```sh
node --test test/output-requirements.test.ts test/goal-satisfaction.test.ts test/planning-refusal.test.ts
npm run check
npm run build
npm run proof
python3 -B experiments/living/check-output-requirements.py docs/adaptive/evidence/output-requirements/paired-final
python3 -B experiments/living/test-output-requirements-checker.py
python3 -B experiments/living/verify-output-requirements.py docs/adaptive/evidence/output-requirements-manifest.json
python3 -B experiments/living/compare-output-requirements.py \
  d4eef5ffc6ad94a87ac70a2116c2bff0e622184d \
  be84f20f9282a79c86de7b285e465c36739513e7 \
  /tmp/rcx-new-output-requirements
```

The new output directory must not exist. The replay runner archives source without changing the branch, launches six fresh Node processes and refuses to overwrite evidence. It makes no model/provider calls. Native regression/proof needs ordinary local loopback access. Linux validation uses the already cached Node 24 image with no network, a read-only repository and explicit resource limits; no image is downloaded. The previous reuse comparison's manifest remains frozen at `d4eef5f`; reproduce that historical manifest from its revision, since its listed living plan/matrix/readiness files advance with this increment.
