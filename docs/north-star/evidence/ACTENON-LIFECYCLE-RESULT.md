# Retained capability lifecycle under independent authority

2026-10-18. **20/20 development checks pass; release remains NO-GO.** This extends
the [bounded integration](ACTENON-INTEGRATION-EXPERIMENT.md) under the unchanged
[lifecycle expectations](ACTENON-LIFECYCLE-PLAN.md). It does not replace the
original model-swap, holdout, economic or independent-review requirements.

## Observed behavior

RightClick discovers the ordinary OpenAPI append operation and a separate
observer's read-only OpenAPI surface. It composes append plus its existing
SHA-256 builtin, verifies journal presence and the fingerprint through the
observer, then retains a composite and publishes a goal. Nine fresh isolated
Node processes carry this state through the declared lifecycle. No issuer key,
grant, proof or provider credential is inherited with the state.

The warm process uses new inputs without reading either provider contract again.
It executes the retained goal and its independent witness. Attempts using an
unapproved input are refused through the composite, generated REST, generated
GraphQL and a second runtime's normal federation interface. The federation test
uses two runtime instances inside one contained process/principal; it does not
establish separate-host or multi-principal federation isolation.

A compatible operation-ID rename preserves the verified goal. Moving the
endpoint proposes a semantic match, but the outside Actenon boundary denies it
under the original operator target bounds, including explicit acknowledgement
and replanning. **Semantic matching does not grant authority.** The trusted host
then explicitly approves the new target, revokes the old grant, installs a new
grant and creates a newly verified goal. The new target's proof references that
new grant. This operator transition is preserved separately from agent requests.

Changing the operation to destructive DELETE is refused before any provider
effect. Removal is refused. On return, the contract is re-read and the retained
goal is independently verified. A final provider mode acknowledges success
without appending anything: the witness refutes the result, and RightClick
reports failure rather than verified success.

The terminal observer sees exactly six effects, in order: `initial`, `warm`,
`peer`, `compatible`, `moved`, `returned`. It verifies 22 signed receipts and
seven signed refusals and rejects all 29 altered artifacts. The observer is a
separate process reading resource-owned data, not an independent human auditor.
Pre-issuance operator-bound refusals are bridge records, not signed Kernel
refusals; complete refusal attestation remains an integration requirement.

## Preserved experiments and remediation

| Run | Result | Finding |
|---|---|---|
| [1](actenon/integration-lifecycle-attempt-1/failure.log) | Failed before observer startup | Syntax defect in the fixture's OpenAPI object; fixed without changing acceptance |
| [2](actenon/integration-lifecycle-attempt-2/failure.log) | Independent witness refuted initial outcome | Experimental bridge signed the full URL but dispatched only its path, dropping query parameters; corrected to dispatch path **and query** |
| [3](actenon/integration-lifecycle-attempt-3/failure.log) | Warm harness stopped | Single-step goals do not create composites; replaced the fixture with a meaningful append-and-fingerprint composition, and strengthened the observer to check both |
| [4](actenon/integration-lifecycle-attempt-4/result.json) | 19/19 | Full lifecycle and route coverage; descriptive check name corrected to identify external authority denial rather than semantic-anchor refusal |
| [5](actenon/integration-lifecycle-attempt-5/result.json) | 20/20 | New target explicitly receives a new operator grant; proof binding checked |
| [Containment regression](actenon/integration-query-regression/result.json) | 29/29 | Prior exact-action, replay, revocation, numeric-IP isolation and reconciliation checks still pass after query correction |
| [Frozen reproduction](actenon/integration-lifecycle-frozen-1/result.json) | 20/20 | Reproduced from exact source commit `9840f2b`; fresh private state, containers and observer |

Every run preserves exact harness sources, hashes, image identity, raw IPC,
provider requests/effects, witness observations and signed native artifacts.
The query-strip failure demonstrates why correct cryptography alone is not
enough: the executor must dispatch exactly what the proof binds. This defect
was in the experimental Python bridge, not RightClick's HTTP executor or
Actenon's cryptographic implementation. No core RightClick or Actenon source
was changed in this stage. Type checking passes for both experimental clients.

## Boundaries and next checkpoint

This is one exposed fixture, with authored provider and observer code. It is
not unfamiliar-software evidence or a real AI/model-swap run. Most lifecycle
changes explicitly refresh the provider contract; only warm reuse demonstrates
zero provider rediscovery. It does not establish automatic detection of every
silent semantic change. The false-acknowledgement test establishes outcome
refusal after observation, not advance prevention of arbitrary provider bugs.

The same source-pinned, trusted-host boundary remains: no production credentials,
no independently deployed resource-owned edge against uncontained host callers,
no multiple independent workers, and no complete outage/downgrade coverage.
Consequential transport finality remains ambiguous until trusted reconciliation;
the lifecycle suite does not automatically reconcile Permit from agent claims.
The prior containment suite demonstrates explicit reconciliation separately.

The original benchmark currently infers execution from MCP tool calls and lacks
the actual investigation telemetry required by the corrected reporter. Fix and
test that evidence path before spending subscription quota on fresh frozen
experiments. Then compare strongest direct/docs/retained-script baselines with
RightClick under equivalent boundaries, complete costs and independent oracles.
There is still no evidence of superior economics, customer demand or simple
released installation. The full North Star acceptance matrix remains binding.
