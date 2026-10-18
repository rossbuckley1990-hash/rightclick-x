# Changed-action safeguard and independent authority

The fresh model recheck at `15928a3` reproduced a changed operation executing after the agent supplied `acknowledgeChange:true`. A weak predicate called the bad output checked; the final model refused. Source review at `6b0961d` additionally finds that planned calls skip the changed-meaning check, and acknowledgement deletes the warning before execution policy or dispatch succeeds. These are concrete local semantic-safeguard defects. They do not show that Actenon's independent boundary was bypassed: the CLI pilot had no such boundary.

Before implementation, the existing audited Kernel `da4b534` and Permit `5290b13` remain clean and source-pinned. Review reconfirms declared edge capabilities, exact intent/proof verification, fail-closed replay/effect ownership before credential acquisition and dispatch, and concrete proof capability selection without widening empty scopes. The existing Actenon lifecycle client already attempts both changed-target acknowledgement and replanning; the external boundary denies them until a separate operator transition. The resource-owned experiment separately covers direct HTTP/shell/socket requests. These are bounded fixtures, not arbitrary CLI containment. No cryptography, issuer, grant format or effect ledger will be copied into RightClick X.

The immediate product change removes caller acknowledgement as a way to clear an incompatible retained identifier, applies refusal to planned execution and composite preflight, and keeps the warning through failed calls/restarts. The thirteen-tool interface stays fixed; the obsolete acknowledgement field is removed from its schema and rejected if supplied. Library callers retain the deprecated optional field for source compatibility, but it cannot clear a warning. Returning to the previously retained operation remains a valid way for revalidation to clear drift. Compatible repair and independently authorised newly discovered operations must continue to work.

Preregistered checks: reproduce direct acknowledgement, internal planned execution, MCP, HTTP, composition, a composite with an earlier effect, policy-denied warning erasure and misleading availability. Count actual provider calls, not only runtime refusal labels. Run regression/typechecks and frozen real-program replay, plus the existing Actenon lifecycle/resource checks where needed to verify interaction with their independent boundary. Preserve all failures. Test reset/re-discovery as an explicit residual route rather than silently treating a local map as security authority.

This does not establish independent execution authority. An agent that controls its runtime/state, resets discovery, chooses a new identity, calls a direct API or uses another tool can evade local semantic bookkeeping. Protected effects must still require a valid exact-action proof at a resource-owned edge or sole credential broker, with operator-controlled policy and no alternate route. Unprotected environments remain outside that claim. Actual outcome verification also remains separate from proof of authority. No release or economic gate is relaxed; results and residual bypass evidence follow after execution.

The first candidate `de32d57` passes 278 native regressions, but fails the unchanged Actenon lifecycle at **11/20** (`evidence/changed-action/actenon-lifecycle-first`). The new local guard blocks both the old identifier and the newly operator-approved target, so the subsequent goal never publishes. The original signed artifacts and complete failed run are retained. This is an availability regression, not a successful authority integration.

The remediation separates a discovered changed operation into a deterministic fresh identity before replacing the provider graph. The old identifier remains quarantined. Execution experience and exact capability allowlists do not transfer; no grants or proofs are minted by discovery. Rereading an unchanged contract must preserve the fresh identity and its valid compositions. Old saved anchors may follow a unique equivalent operation, but may not evade known contradictory observations by selecting the fresh identity of that changed operation. Existing compatible renamed/nested REST repair remains required. Title/type matching for otherwise unfamiliar renamed contracts remains a heuristic: external exact-action authority and outcome verification are still required; this is not general semantic equivalence proof.

The first identity-remediation regression run passes **280/281** and preserves a failure caused by over-restricting an existing compatible nested REST repair. The refinement excludes known changed lineage from heuristic repair without changing that test's completion requirement. Thirteen focused checks are also run against the original `6b0961d` source, with raw failures preserved. Additional checks cover stable replacement identity, fresh operator allowlists, retained compositions and same-title substitution after a rename. `experiments/north-star/changed-meaning-reset.ts` explicitly exercises an unprotected fresh identity, direct API request and reset/re-discovery; these routes must remain reported as outside containment, not scored as protected refusals.

Frozen product `abfc295` passes 283 native regressions and the unchanged Actenon lifecycle at **19/20**. The remaining original assertion requires the retained goal's error to come from the external authority boundary. It now refuses earlier with a known changed-operation error. All six expected effects, the fresh operator-grant transition, subsequent removal/return, independent outcome checks and both explicit/replanned external denials pass. That original 19/20 run is retained unchanged. The lifecycle harness is then strengthened: require the precise earlier semantic refusal, require actual independent-authority denial for both fresh routes (previously only their failed status was required), count exactly those two POST requests, check distinct operation identity, and require the old changed identifier to remain refused after fresh operator approval. This adds three checks while preserving all effect, proof, replay and verification obligations. It is a documented error-layer change, not an acceptance threshold reduction.

## Verified checkpoint

Product and regression source is `abfc295714df4de6c3f71fccb49e9beec0d4e976`; the strengthened lifecycle harness is `edab7162d85420edfb140131d52020e47d8bdf9e`, with identical product source. The optional integration remains an experiment using native source-pinned Actenon APIs, not a core dependency or a released installation path.

| Evidence | Result |
|---|---|
| Thirteen new checks against original `6b0961d` | 0/13 pass, 13 expected failures, zero skips |
| Native macOS regressions | 283/283, zero skips |
| Frozen Linux changed-meaning, drift, migration, disclosure and execution-policy checks | 41/41, zero skips; cached image, network disabled, source read-only |
| Typecheck | Pass |
| Unchanged real `json_xs` fresh-process lifecycle | 19/19 requirements; ten correct task executions, nine required refusals; six original and four continuity corruption controls rejected |
| Black-box MCP/REST proof | 28/28, product hashes unchanged |
| Offline package/install/thirteen tools/uninstall | Pass; 410,616-byte package |
| Strengthened Actenon lifecycle | 23/23; six expected journal effects, fresh grant for changed target; old identifier still refused |
| Separate lifecycle checker | 22 historical exact-request proof signatures/hashes and 29 linked signed receipt/refusal artifacts verified; all 29 altered artifacts and four record corruptions refused |
| Unchanged resource-owned Actenon experiment | 36/36; separate checker verifies 45 signed artifacts, three durable journal-prefix commitments and direct API/shell/socket refusals |

All result and failed-attempt files are bound by `evidence/changed-action-verification.json`. The first uncommitted identity candidate also has an explicitly labelled post-run patch reconstruction; replay reproduces its single compatible-repair failure (31/32 focused checks), without pretending it was a pre-run source freeze. The lifecycle and resource checkers use native Actenon cryptographic APIs in separate processes. They share the implementation author. The available security-review skill requires a specialised reviewer not exposed in this environment; no independent review was run. Neither separate-process checking nor passing signatures establishes independent-author certification.

The unprotected diagnostic records **zero writes** after an old-id acknowledgement attempt, followed by **three successful writes** through a fresh identity, a direct API call and reset/re-discovery. These are intentionally exposed local fixture effects, not unauthorised external operations. The result demonstrates why no local map or capability naming convention is a security boundary. It also prevents falsely claiming that these changes solve the uncontained model pilot's authority problem. Model choice of a fresh operation still needs independent exact-action enforcement at the resource or sole broker. Existing title/type repair heuristics remain hypotheses, not proof that two different targets have identical semantics.

No new live-model sessions or economics result is claimed. The prior D warm median of 17.2 seconds remains slower than A 12.2 and B 10.4, with its recorded sleep-related timing caveat. The new graph adds a separate descriptor only for observed changed operations; its disclosure, state and maintenance costs must count in later comparisons. This checkpoint establishes bounded reliability and authority-preserving compatibility, not the required material competitive advantage. Release **NO-GO**. Original holdout, model/vendor transfer, independent review, released optional installation and human commercial gates remain open.

## Reproduction

Export product `abfc295` to a new directory; do not switch or reset the programme branch. Include `experiments/north-star/changed-meaning-reset.ts` for the diagnostic below. Run the ordinary regression/typecheck, proof and offline package commands described in [disclosure reproduction](DISCLOSURE.md#reproduction), substituting this product revision. The Linux check uses the same cached immutable image and sandbox prerequisites, with the five test files listed above. These results do not imply a portable registry-only Actenon install.

For real-program lifecycle replay, use the unchanged [sample-coverage procedure](CLI-SAMPLE-COVERAGE.md#reproduction), this product revision and the preserved `cli-migration/before-final` version-22 seed. Use a new output directory; both lifecycle and continuity checkers must pass. The reset diagnostic runs directly from the product export:

```sh
node experiments/north-star/changed-meaning-reset.ts
```

Export the experiment directory from `edab716` alongside the product. With the pinned audit environment from the [feasibility assessment](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md) and the recorded cached Linux image, run the following from that checkout using new output paths:

```sh
python experiments/actenon/lifecycle.py --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 --output NEW_LIFECYCLE_DIR
python experiments/actenon/resource-experiment.py --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 --output NEW_RESOURCE_DIR
python experiments/actenon/check-changed-lifecycle.py NEW_LIFECYCLE_DIR
python experiments/actenon/check-resource.py NEW_RESOURCE_DIR
```

The new separate checker is frozen at `3c6088cafc36eb85c90e1e092c5c16493b405033` (its exact file hash is in the verification manifest), rather than the earlier experiment freeze. That commit contains the same product and strengthened harness, so it can also be used as one combined reproduction checkout. These harnesses check Git provenance and pinned Actenon sources; use the committed checkout for them or retain the corresponding Git history alongside an export. The target services and grants are disposable fixtures. No push, merge, publication, purchase, outreach or live account operation is required. Next resume the original unfamiliar multi-step/maintenance challenge when its independently selected evaluation route is available; continue generic usability work in the meantime, without additional single-target security fixtures standing in for commercial evidence.
