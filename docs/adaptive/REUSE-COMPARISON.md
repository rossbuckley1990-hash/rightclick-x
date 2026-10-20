# Model-authored code versus retained capabilities

**Programme PARTIAL; release NO-GO.** This checkpoint implements a stronger executable-code baseline, measures real acquisition/reuse sessions, and fixes a reproduced GraphQL document-boundary defect. It does not establish independent unfamiliar generality, universal containment, or commercial superiority.

Starting revision: `3a1b9e3dad928464ef0283bb651e4003bd6d496e`. Initial comparison freeze: `9036b68`. Corrected product and equal-instruction freeze: `7817a84f730ddce525d7ae60a26ce34951536553`. Final complete model-trial freeze: `218f340803abafa0e9bfe64fac7bd58136256101`. Work remains on `programme/adaptive-capability-plane`; no branch change, merge, push, publication or purchase.

## Implementation and invariant

The coding baseline can now execute general JavaScript, retain actual parameterised code and documentation, and run that code in a fresh process. It imports no RightClick runtime, planner or reflectors. Both arms use the existing credential-free Linux container profile and the same operator public-read transport. Only the bundle is mounted; no network interface, host data, credentials or Docker socket is supplied. A worker thread bounds and accounts for a code call; it is not the security boundary. The outer model tool audit and loopback MCP endpoint retain their trusted-host limitation. This evaluation infrastructure is outside the shipped product.

The product invariant is that a GraphQL call produces exactly one reflected root field with one bounded selection subtree. Previously, `selection="{ id } unapproved { id }"` passed the balanced-brace check and produced `mutation RightClick { approved { id } unapproved { id } }`, despite an execution policy allowing only the approved capability. Both query and mutation fixture calls incorrectly completed. No external mutation was exercised.

The new small parser accepts field names, aliases, commas and nested nonempty selections, and refuses additional root fields, unsupported arguments/directives/fragments, malformed tokens and excessive size/depth. Document construction also validates the operation, root field, argument names and nested type syntax, including stored contract values. Local document errors neither trigger direct-call contract repair nor count as provider reliability failures. The public thirteen-tool interface is unchanged. The supported subset follows the structure of the [GraphQL selection and field grammar](https://spec.graphql.org/September2025/#sec-Selection-Sets); this is not a full schema validator or support for every GraphQL feature.

The evaluation transport additionally checks GraphQL GET/HEAD query parameters for mutations, subscriptions and ambiguous duplicate queries, and correctly identifies GET introspection. An offline baseline proves that the old guard dispatched a mutation-shaped GET to a mock transport. The new negative controls dispatch nothing. HTTP method convention alone is not independent proof of effects; these remain bounded reads from the authorised services, separate from the Actenon-controlled resource experiments.

## Trials and interpretation

The [preregistered plan and amendment](REUSE-COMPARISON-PLAN.md) retain the same exposed RCSB/Crossref tasks: cold `1CRN`, warm `2LYZ`, missing `0000`, warm `1UBQ`. Fresh `gpt-6.1-sol` sessions receive the same advertisements, origins, time/request limits and business outcome. Both arms start empty and inherit only their own state. The baseline may repair and retain its own solution. Separate Python readbacks identify each structure's primary DOI and verify the exact Crossref title/publisher. Results require actual observed provider executions, not an answer from model memory.

Trial 1 completed eight valid sessions. The initial checker falsely rejected all C outcomes because it did not recognise GraphQL GET requests. The [failed score](evidence/reuse-comparison-checker-failure.json) is preserved; GET-positive and wrong-input tests correct that accounting bug. The [corrected score](evidence/reuse-comparison-result.json) verifies all eight outcomes. The C prompt explicitly requested saving a solution, while the D prompt only described that facility. D published no goal. This prompt mismatch prevents a fair inference about goal-retention behaviour.

| Trial 1 measure | Coding baseline C | RightClick D |
|---|---:|---:|
| Correct business outcomes, including missing-input refusal | 4/4 | 4/4 |
| Cold model seconds | 36.9 | 43.0 |
| Warm median model seconds, two inputs | 29.65 | 32.60 |
| Warm median reported tokens | 126,148.5 | 218,073.5 |
| Total model seconds, all four sessions | 114.4 | 129.3 |
| Total reported tokens | 456,808 | 867,731 |
| Provider requests | 15 | 22 |

The baseline initially rejected a title variation on `1UBQ`, then inspected live results, repaired its code and obtained the independently matching publication. Its extra time and requests count. D repeatedly requested an undeclared field and reread the contract after failures. The document syntax fix does not solve that schema-level problem. All model traces, code/state snapshots, raw responses, errors, startup/teardown measurements and reported usage are retained in [trial 1 evidence](evidence/reuse-comparison-attempt1/provenance.json).

Trial 2 used the identical imperative in both prompts to save a parameterised reusable solution after success. It also contained the document and GET-guard fixes, so differences between trials cannot be attributed to one change. It stopped after two sessions because the conservative Code Mode audit mistook `context_compose`'s literal `require: [...]` argument key for an execution primitive. The raw call uses only the authorised tool. A regression preserves that failure; the corrected auditor still rejects actual calls, shorthand/computed keys and forbidden values. The stopped trial was neither silently reclassified nor resumed.

Trial 3 starts both arms empty under the corrected auditor and otherwise unchanged product, prompts, tasks and budgets. All eight sessions finish. The checker initially missed GET variables encoded separately from the query; the [second erroneous score](evidence/reuse-comparison-checker-failure3.json) is retained, with additional positive/wrong-variable controls. The [corrected result](evidence/reuse-comparison-result3.json) establishes every business outcome using the unchanged oracle requirement.

| Trial 3 measure | Coding baseline C | RightClick D |
|---|---:|---:|
| Correct business outcomes, including missing-input refusal | 4/4 | 4/4 |
| Cold model seconds | 34.8 | 65.5 |
| Warm median model seconds, two inputs | 24.15 | 42.40 |
| Warm median reported tokens | 115,432 | 180,605 |
| Total model seconds, all four sessions | 100.1 | 168.4 |
| Total reported tokens | 459,600 | 843,411 |
| Provider requests / tool calls | 15 / 24 | 22 / 26 |
| Median container startup / teardown ms | 218.9 / 96.8 | 341.9 / 98.7 |
| Final retained bytes | 2,617 | 2,234,103 |
| Observed post-session main-process RSS range | 60.7–70.0 MB | 138.8–157.0 MB |

D establishes one saved goal during cold acquisition, then actually invokes it from all three fresh sessions, with **zero warm contract discovery**. Its 69-capability graph remains the same size. The missing input stops after one provider request; C also refuses correctly, after two. D republishes after both successful warm invocations, which adds real work and is counted. On `1UBQ`, a mistaken capability ID in the output `require` list makes one composition search take **16,629.7 ms** before returning unavailable; a corrected call succeeds. The saved-goal invocation itself had already completed correctly. The baseline's second warm task also needs code repair for title variation; its extra requests count. These samples show working fresh reuse, not superior economics: D takes more total time and tokens. The two warm inputs, same-author exposed providers and missing A/B arms cannot close the original commercial/holdout gate.

Across **all 18 sessions**, including the stopped trial, reported usage is **3,085,025 tokens and 608.1 model seconds**. Input totals include cached tokens once. Every model call passes its fresh included-subscription/no-credit guard; final reported primary usage is 76%. No API fallback or paid extra usage is used. Raw per-session metrics and attempts remain available; nothing is dropped as an outlier. Snapshot RSS is not a hard limit or peak-memory measurement.

## Validation and limits

Five new product tests fail on the starting implementation and pass after remediation. Product-freeze validation passes **473 native tests, 35 focused Linux tests, 28 proof checks**, product/harness type checks and all four product builds, with no skipped final tests. The subsequent auditor correction passes **11 focused tests** plus type checking; product source is unchanged. Seven actual-container controls establish saved-code reuse after restart, denied origin/mutation/credential refusal, blocked direct networking and absent host custody within that fixture. Three separate-checker tests include semantic and accounting corruption controls. The earlier Docker-socket denial, restricted-loopback regression failures, harness type error, stopped audit and both erroneous GET scores remain preserved.

The [offline audit](evidence/reuse-comparison-audit.json) passes across **516 hashed files**, all three trial source freezes and all 18 fresh session identities and usage records. It reruns the separate outcome checker and verifies that the stopped trial and baseline failures remain present. A bounded private-key/API-key pattern scan found no matches; this is not proof of absence of every possible secret. All checkers were authored by the implementation agent, so this is independent implementation/checking of retained observations, not independent-author review.

The live evaluation has no protected writes and establishes no new Actenon enforcement claim. Existing native authority proofs remain separately tested historical evidence. No Actenon source or cryptography changed and no core dependency was added. Pinned Airlock supplies a Linux container launcher, not a Darwin hard-memory supervisor; substituting a Linux executable for an authorised native program would change identity and meaning. The native short-allocation hard-memory gate remains **FAIL**. Independent-author review/holdouts, cross-vendor transfer, full deployment route coverage, clean-machine provisioning and unfamiliar human/developer trials remain open.

| Original outcome | Coverage in this increment |
|---|---|
| 1. Generic unfamiliar discovery | Existing generic reflection is used; this is an exposed two-source case, not a new unfamiliar holdout or environmental advertisement evaluation |
| 2. Semantics and verified outcomes | Separate retained public responses confirm all 16 outcomes in the two complete trials; syntactically valid unknown fields still trigger excessive repair |
| 3. Independent restrictions | Local document escape and GET-query guard fixed; independent authority still depends on the separate Actenon/resource boundary, not these checks |
| 4. Fresh-agent reusable capability | Trial 3's model builds a checked goal from empty state; three fresh processes inherit and invoke it on different inputs, without warm discovery; one model/vendor |
| 5. Safe adaptation | Existing adaptation evidence retained; the baseline's title repair is observed, but no new frozen drift comparison is established |
| 6. Superior economics | **Not established**; complete paired development results remain adverse on total time/tokens |
| 7. Regression/security/holdouts | Listed regressions and separate evidence checks pass; sealed unfamiliar cases and independent-author review remain open |
| 8. Simple installation/DX | Compact interface and product dependencies unchanged; cold publication and mistaken constraint ergonomics need work; clean-machine/human evidence remains open |

The next three engineering priorities are: (1) reproduce the 16.6-second mistaken-constraint search and provide early, accurate guidance using existing `require` versus `through` semantics; (2) use sufficient contract evidence to distinguish bad GraphQL fields and absent data from drift, preserving uncertainty rather than adding a provider-specific error rule; (3) make retained output shape and publication state clear enough for a fresh model to reuse the goal without unnecessary reconstruction, then freeze and run independently selected four-arm maintenance/holdout cases. Native hard-memory enforcement and independent review remain explicit release blockers alongside those engineering priorities.

## Reproduction

On the engineering branch with Node, Bun, Python and the cached image available:

```sh
npm run check
npm run build
npm run proof
node --test test/graphql-document-boundary.test.ts test/coding-baseline.test.ts test/public-read-transport.test.ts
python3 -B experiments/living/test-reuse-comparison.py
python3 -B experiments/living/check-reuse-comparison.py verify \
  docs/adaptive/evidence/reuse-comparison-attempt1 \
  docs/adaptive/evidence/reuse-comparison-oracle /tmp/reuse-trial1-checked.json
python3 -B experiments/living/check-reuse-comparison.py verify \
  docs/adaptive/evidence/reuse-comparison-attempt3 \
  docs/adaptive/evidence/reuse-comparison-oracle /tmp/reuse-trial3-checked.json
python3 -B experiments/living/verify-reuse-comparison.py \
  docs/adaptive/evidence/reuse-comparison-manifest.json
```

An actual new comparison requires an empty output directory, local Docker access, bounded public access to the configured origins, the listed included-subscription model and successful fresh no-credit preflights. The runner refuses unfrozen source and never falls back to an API account:

```sh
node experiments/living/reuse-comparison.ts experiments/living/reuse-comparison.json /tmp/rcx-new-reuse-trial
```

This does not install software or buy usage. A rerun is a new retained trial, not a replacement for failed or slow evidence. The current stored oracle can be checked offline; fresh public oracle reads use `check-reuse-comparison.py oracle CONFIG NEW_DIRECTORY`.
