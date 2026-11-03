# North Star decision: conditional engineering go; commercial thesis not established

**We have not established that RightClick X generally makes fragile business integrations reliably continue working with less engineering intervention.** We have implemented a bounded recovery capability and demonstrated a specific stateful mechanism with independent outcome checks. The evidence supports continuing a narrow development programme, not selling autonomous integration maintenance as a solved problem.

## What changed and what was actually demonstrated

The library now exposes `RecoveringWorkflow` and a bounded `CodexResponsesFallback` adapter. They reuse the existing planner, operator authority, independent witnesses, FileStore, checkpoints and cooperative goal leases. A model can propose one discovered operation and mappings between identically typed inputs. It cannot supply the answer, change the business oracle, add tools/credentials/egress, or execute generated code. A recovery is published only after the original independent checks pass and persistence succeeds. Ordinary retained execution invokes no model.

The controlled invoice exercise uses separate provider, read-only observer, fault and worker processes, authenticated local HTTP, persistent SQLite records and a persisted runtime. The old REST endpoint and documentation are removed by the fault process. The root advertises a GraphQL mutation with a renamed optional input. A scripted proposal is validated, executes, passes the independent database check and is retained. A fresh worker with no fallback adapter reuses it for a different invoice. Concurrent workers contend through existing state ownership; the database independently enforces request-key uniqueness. Repeated requests create no duplicates. Permission failure and rate limits do not produce verified success. Response loss and a real timeout after commit retain uncertain state, and a cold worker refuses replay.

The misleading-unit control deliberately creates an incorrect monetary amount. The observer rejects it and no repair is published, **but the incorrect invoice already exists**. Detection is not prevention or rollback. This is an important limitation for consequential writes. The current safe wedge must use read-only reconciliation or operator-approved reversible drafts, with provider idempotency and a separately established reconciliation path. No payments or customer credentials were used.

The proposal in this exercise is expressly scripted development material, not a Codex discovery success. The real model adapter has schema, usage, budget and rejection tests but was not exercised against a live model. Fresh process continuity is demonstrated; fresh model-agent continuity is not established.

## Source and historical evidence reconciliation

The original local workspace was clean on `review/workflow-survival-audit` at `4b3d3e2`. GitHub main was verified at `49e8e70494c80de0b09358c59e4e1ee7a96dbdbc`. Six historical investigation commits existed locally but not on that remote branch. Work proceeded in a separate clone on `fix/verified-workflow-recovery`; the original workspace was not edited. Those historical commits remain in this review branch with their authorship and failures preserved. Nothing was merged.

Both 50-case reports, the earlier ten-case audit, SENTINEL sidecar/report, original live demonstration, and PRs [#50](https://github.com/rossbuckley1990-hash/rightclick-x/pull/50) and [#51](https://github.com/rossbuckley1990-hash/rightclick-x/pull/51) were inspected. Exact heads and file digests are frozen in the evidence manifest. The reported 23/19/26 recoveries, 8/11–11/11–11/11 refusals, 5/5/3 false successes and 4,591,410/0/1,801,744 tokens remain historical reports, not a certified comparison.

Material defects in that comparison:

- Arm E branches on the evaluator's verdict for D. That leaks acceptance truth into fallback selection; it is not a deployable hybrid.
- Expected output types influence model-answer parsing. Original Codex streams and precise action traces were not retained by the runner, so model causation cannot be reconstructed from the numeric result alone.
- The scorer counts exceptions and nulls as correct refusals in refusal cases. It also calls refusal prose hallucination and detects only selected hardcoded wrong numbers in semantic cases. Structural wrong answers can become unresolved instead of false successes.
- Usage handling selects one completed turn, reports fixed turn counts, and omits full MCP/client context accounting. Hybrid latency starts after D. Static/codegen baselines use hardcoded inputs or first-path selection and do not establish representative competitors.
- The original “cold restart” demonstration has no durable store, creates another runtime in the same process, and re-learns the provider. Its durable-repair claim is contradicted by its source.
- SENTINEL covers its configured sidecar expectations and adverse controls. Its receipt is not certification of the whole benchmark. The ten-case report and narrative also disagree; neither is promoted as independent performance evidence.

The new evaluator separates business outcomes, refusals, false success, unknown effects and harness failures, and does not expose expected values to an arm. The original runner and reports are preserved unchanged. Independent evaluation still requires an external evaluator, realistic baselines and sealed cases after engineering freeze.

## Silent-corruption findings

The test-only commit `fe60f25` reproduces the five runtime cases against the original affected source. The retained failures include exact plans, bindings, result types and returned values. Original inputs, services and fixture acceptance values are unchanged.

| Case | Historical arm | Returned / fixture expected | Established defect and correction |
|---|---|---|---|
| SEM-02 | D | 25 / 55 | `weight_kg` bound to `weight_lbs`; result was USD with unresolved scale. Preserve dimensions and refuse incompatible/generic quantity routing. |
| SEM-04 | D | 108.25 / 10000 | Gross amount became a generic number despite missing tax/net/currency basis. Retain unresolved monetary semantics and refuse inference. |
| SEM-07 | D | 13.2 / 50 | Gallons became a generic number. Retain volume semantics; unspecified gallon standard remains unsupported. |
| SEM-08 | D and E | 95.37 / 100 | MiB became a generic number. Retain storage scale; no invented reconstruction from rounded values. |
| SEM-09 | D and E | 62.14 / 100 | mph became a generic number. Retain speed scale; no guessed exact original value. |
| SEM-05 | E | 68 / 20 | Historical model answer uses Fahrenheit as Celsius. Original runtime has no discoverable v6 inventory contract and already returns no plan. The model execution cause is **not reproduced**. The new hybrid rejects bare answers and unsupported proposals; temperature types are adverse-tested. |

All five original runtime outputs were explicitly `unverified`; the old harness treated transport completion as a business answer. The new public recovery API requires independent verification and durable publication. This distinction does not excuse the incorrect routing, which is now rejected.

The finite dimensional vocabulary and negative controls extend beyond these examples to mass, distance, temperature, duration, storage, speed, percentages, identifiers, nested objects and arrays. A final adverse test exposed lost quantity metadata under top-level arrays; the failing evidence is retained and the reflector/planner were corrected. There are no new automatic physical conversion rules. Existing money conversions retain their currency/precision restrictions. Provider declarations do not become established semantics merely because a schema says so.

There are also defects in fixture ground truth: SEM-02's changed service ignores weight and always returns 25; converting 10 kg at $2.50/lb does not establish the original flat answer 55. Rounded gallon/MiB/mph values do not uniquely recover exact original values without an explicit precision policy. We preserved those fixtures and refused unsupported inference rather than fit repairs to their answers.

**Phase One's complete historical hybrid-causation gate is not met.** Five runtime mechanisms are reproduced and corrected; numeric candidate rejection in the new API is tested. Original model traces, truthful independent semantics for every fixture, general calendar/timezone/FX/tax-basis equivalence, and prevention of wrong side effects remain unresolved. No universal semantic-correctness claim is made.

## Cost and alternative assessment

PR #50 is a four-arm **GLM development** comparison, not the five-arm Codex benchmark. Its 40 records comprise 35 correct sessions, two B-arm turn-budget failures and three D-arm rate-limit failures. D's measured first-use median is 137,834 tokens versus A's 2,752 (about 50.1×). D's reuse median is 34,576 after excluding rate-limit placeholders, versus A's 1,892.5 and B's 1,448. The 600,200 reported tokens across records are not audited billing; the three zero placeholders do not establish zero cost. There is no measured break-even. The statement that all 37 non-rate-limited sessions succeeded overlooks the two B failures.

PR #51 bounds learned-capability disclosure to 25 and validates compose arguments, reducing avoidable interactions in principle. Its live after-measurement was rate-limited. Its performance improvement remains unestablished. It is stacked on the client-error boundary work and was not blindly merged into this branch. This candidate instead uses a direct library transaction path and bounded model context only when needed. That removes MCP interaction from the controlled path; it does not prove an end-to-end agent cost win.

| Alternative | Established capability from primary documentation | Implication for the proposed wedge |
|---|---|---|
| Composio | Sessions scope connected accounts, tools, authentication and execution state; search/execute/authorize are built in. [Docs](https://docs.composio.dev/reference/v3/api-reference/tool-router) | Discovery and auth are not differentiated value. Relative maintenance and recovery performance are unmeasured. |
| Prismatic embedded integrations | Repeatable customer-configured integrations, connections, low-code/code-native flows and execution tooling. [Docs](https://prismatic.io/docs/integrations/) | Strong adjacent operational product; RightClick X has not demonstrated equivalent delivery breadth or lower support cost. |
| OpenAPI Generator | Many client/server generators for documented API contracts. [Docs](https://openapi-generator.tech/docs/generators/) | Updated-schema regeneration is an existing alternative. Business-semantic equivalence still needs evidence; no comparative superiority was measured here. |
| n8n | Error workflows, execution history, investigation and configurable failure handling. [Docs](https://docs.n8n.io/build/flow-logic/handle-errors-gracefully.md) | Reliability operations already have product alternatives. Added value must be less engineering work after compatible drift. |
| Coding agents | Can investigate and change integrations; historical internal Codex outcomes are imperfectly measured. | More flexible repairs than this alias-only fallback. RightClick X may help retain checked operation knowledge and avoid repeated context, but economic superiority is not established. |

These are documentation-based capability comparisons and engineering inferences, not hands-on competitor benchmarks or claims that alternatives lack unlisted features.

The proposed initial segment is **B2B SaaS finance operations teams reconciling invoice records across a small number of frequently changing accounting/billing APIs, with an authoritative ledger they can independently query**. Start with read-only reconciliation, then separately qualify idempotent draft creation. Exclude payments, tax decisions, FX conversion and autonomous correction of uncertain writes.

Measure customer setup/oracle maintenance time, incidents per connector-month, engineer minutes per drift, time to restored correct results, model/context charges, duplicate/uncertain effects and ongoing support effort. Value is avoided intervention cost minus setup, verifier maintenance, hosting and inference costs. No dollar savings, customer demand, willingness to pay or testimonials have been measured. Customer interviews and a monitored shadow-mode pilot are necessary gates, not existing evidence.

## Decision categories and remaining gates

- **DEMONSTRATED:** five original deterministic semantic failures reproduced and refused after repair; bounded untrusted mapping API; unchanged independent checks; persistence failure refusal; pinned checker rejection; actual stateful REST-to-GraphQL development recovery; fresh-process reuse without the proposal adapter; controlled concurrency; idempotency; preserved response-loss/timeout effects; false-answer rejection and accounting negative controls.
- **CONTRADICTED:** zero internal model inference implies zero agent cost; the historical demo established durable recovered-operation reuse; transport completion proves the business result; an independent-looking benchmark label or SENTINEL receipt certifies the complete programme.
- **NOT ESTABLISHED:** live Codex proposal quality; fresh model-agent reuse; independent hidden-case performance; superiority over representative static/codegen/agent/integration products; full engineering-session token and monetary cost; customer intervention avoided; adoption demand; general protection from bad provider semantics.
- **UNSUPPORTED:** arbitrary generated-code repairs, automatic physical/tax/FX/timezone conversions, universal exactly-once execution, prevention/rollback of a wrong already-committed effect, and verified completion when the required independent observer is unavailable.
- **BLOCKED BY ENVIRONMENT:** live API adapter measurement lacks a provisioned API key and reviewed model/price configuration. No separate evaluator or sealed cases are available in this session. The local runner cannot certify its own independence.

**CONDITIONAL GO** for the narrow engineering mechanism, with release gates: independently attacked semantic/effect controls; provisioned bounded live Codex evaluation; independent frozen five-arm comparison; fresh-agent evidence; review of outstanding security work; and customer-maintenance economics from a real pilot. **No commercial GO and no production-readiness claim.** If realistic maintained integrations or coding agents match outcomes with less total effort/cost, the decision should become NO-GO.

The shortest honest answer to the final question is: **a controlled, reusable recovery mechanism now exists, but the broader reliability and intervention-saving claim remains unproven.**

## Validation and review status

The frozen source in `evidence/source-identities.json` passed **810/810 tests, zero failures, zero skips**, with test concurrency bounded to four. Main, existing harness and invoice-harness typechecks passed; the package built; existing proof checks passed 28/28; existing negative controls passed 6/6. The final stateful run contains 14 recorded events. A 30/30-environment lab run preceded the final nested-field metadata correction and is labelled accordingly. These are local engineering checks, not independent customer reliability measurements.

Failed attempts are preserved: the initial five-case failures on original code; a missing factory in the expanded reproduction harness; the first GraphQL custom-scalar mapping refusal; a SQLite row-prototype assertion mismatch; the newly discovered array semantic leak; and a pre-existing 50ms SSE test timeout during concurrent test workloads. Assertions were not weakened to turn these green. The corrected final source and evidence have separate immutable identities.

Outstanding client-error redaction [#40](https://github.com/rossbuckley1990-hash/rightclick-x/pull/40), body/rate-limit boundaries [#41](https://github.com/rossbuckley1990-hash/rightclick-x/pull/41), release controls [#43](https://github.com/rossbuckley1990-hash/rightclick-x/pull/43) and sandbox IPC work [#8](https://github.com/rossbuckley1990-hash/rightclick-x/pull/8) require their own review. This branch does not certify those broader boundaries. Raw runtime diagnostic objects should remain local; do not expose them to untrusted clients or treat the bounded model accounting receipt as redaction of the entire older runtime.

Accounting addendum: source `aa195ae1346884f3386b03d352d1d4cfd197efae` corrects unmetered MCP context overhead from zero to null. Custom fallback adapters and deterministic MCP provider calls cannot be counted as zero without a transport meter. This source again passes all 810 tests, typecheck, build and a fresh 14-event invoice run. See `evidence/accounting-freeze.json`; the earlier evidence files are preserved. This improves honesty of reporting, not a claim of measured total agent cost.
