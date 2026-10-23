# Living dashboard and retained lifecycle observations

**PARTIAL; release NO-GO.** Product freeze: `7d5de67e68b7088eda5ed3e1da9bc2edb534edb3`, following first candidate `c2fe20237a5885616c95cb95713545472d9f9603`. Experiment/checker freeze: `8862c58`. This continues the same programme branch and the [additive mission](LIVING-CAPABILITY-PLAN.md). No original threshold, failed result or acceptance gate is replaced.

The embedded dashboard now has five runtime-backed views: provider clusters and paginated operation search; capability intelligence; retained-composition history; local authority/consequence assessment; and execution evidence. The interface uses text nodes for provider-controlled content, no external dependency, no random graph placement and no continuously running force simulation. It polls authenticated read-only endpoints every five seconds while visible. The public HTML contains no runtime data. The thirteen MCP tools and legacy `/api/viz` fields remain available.

## State and evidence

Each capability has six independent dimensions with its source, limits and evidence references:

- Discovery reports the presence of a current descriptor.
- Executability reports local blocking, a required plan, or unassessed availability. It does not probe a service or infer available credentials.
- Authority remains **unknown**: this dashboard has no attached independent exact-action decision feed. Local policy success, discovery, publication and witness success never turn it into a grant.
- Assurance describes the latest retained execution: unchecked, predicate-checked, witness-checked, failed or refused. Stored publication trust alone supplies no evidence. A witness result belongs to that historical run and is not an external organisational attestation.
- Reusability distinguishes a retained goal contract, retained static pipeline, descriptor alone and unavailable operation. This does not claim novel utility or actual fresh-agent reuse.
- Validity compares recorded dependency descriptors with the current graph, reporting missing/changed dependencies, changed operation, unassessed history, or matching descriptors. Matching descriptors are not proof of unchanged remote behaviour.

`ActivityLog` retains at most 500 local observations, with at most 128 references per field and an 8,192-character shared string budget per observation. It records actual composition/execution requests and terminal outcomes, existing learning/retention/drift/retirement events, and runtime starts. Run IDs, receipt hashes, dependency change detectors, predicate counts and witness-run references are retained. Raw arguments, responses, predicates and errors are excluded from this additional history; identifiers are retained metadata. Existing runtime records and stores have their own older data-retention behaviour, which this change does not redefine.

The history has a new epoch for each runtime instance, a persisted sequence, explicit overflow/reset signals, bounded paging and copy-on-read records. Loading saved descriptors does not fabricate new learning events. Old state without activity loads with assurance unassessed. Withdrawal now retains IDs even for operations never executed; large withdrawals explicitly truncate at the history bound. The UI keeps 100 observations and at most 30 retained-composition events, renders at most 200 provider clusters and 25 operation rows, and exposes historical details rather than replaying a success animation.

Observations never participate in grant validation, planning or execution selection. The existing Actenon implementation is not copied, made mandatory or replaced. See the [source feasibility assessment](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md). The retained-abilities list is historical and currently requires opening an item to see current validity; inline dates and current-status markers remain a UX gap. Signed independent decisions, full causal traces for every failed/replanned attempt, witness-output inspection with appropriate data handling, and the live protected challenge remain future work.

## Verification and preserved failures

The first candidate passed **301/301 native tests**, zero skips, typecheck and **28/28** actual `npm run proof` checks. The final withdrawal-ID correction passes **302/302 native tests**, zero skips, **24/24 focused Linux checks**, typecheck and **28/28 proof checks**. Both Node and edge bundles build successfully. Final results are recorded in the [evidence manifest](evidence/living-lifecycle-verification.json) and logs. All tests run from clean Git exports with the existing installed development dependencies, not an edited working copy. No test was relaxed. The prior intermittent sandbox memory-limit failure remains open despite passing later suites; no sandbox code or resource-limit test changed here.

Seven lifecycle tests cover real multi-provider fixture execution, exact output predicates, no raw execution-data persistence, receipt/run linkage, misleading publication trust, old stores, restart, dependency change, withdrawal, unexecuted-operation tombstones, refusals, history overflow, malformed cursors, copy-on-read, authentication, bounded search and absence of execution during dashboard reads. Existing outcome tests also check that actual witness success appears with unknown authority, and a later false result displaces past assurance.

Preserved development failures:

1. Initial typecheck exposed an existing omitted `contract` property in the public plan-result type. The result already carried the property; its type annotation now reflects it.
2. The first lifecycle test used `contains: "Lima"`, but the existing weather fixture returns the Spanish weather sentence without the city name. Its real predicate failure is retained in `focused-attempt1.log`. The corrected test asserts the **entire exact fixture sentence**, not a weaker predicate. The initial request was not separately source-frozen; this description records that limitation.
3. The first browser fixture was launched without a PTY, so stdin controls were closed. Its successful UI composition and activity were preserved; the exact process was stopped, then the fixture was replayed in a PTY. A shell URL quoting error prevented the first curl read; the quoted read succeeded before shutdown. No execution result was fabricated to fill the setup failure.
4. Browser read-only inspection did not support `document.getAnimations`; no reduced-motion emulation result is claimed. Static checks establish the reduced-motion CSS and absence of application animation loops. Responsive DOM/keyboard observations are described below.

## Actual browser observations

The development fixture routes all provider traffic through the existing in-memory demo services. It is explicitly labelled **not a holdout** and is not the required unfamiliar public-provider challenge.

Through the actual form, the browser composed geocoding → forecast → translation for Lima in Spanish, checked the complete output and retained `goal:observed-weather`. Three producing providers ran, three receipts were created, the history reported `checked`, and aggregate authority remained unknown. The capability appeared in New abilities and its six states were inspectable. Reinitialising the runtime from stored state kept the original history; withdrawing Skycast retired the static pipeline and changed the saved goal's validity to `dependencies-changed`. Historical assurance remained labelled as historical.

A provider/operation title containing an image/onerror payload appeared as text: the DOM contained zero images and the page title stayed unchanged. Search, authority navigation and source disclosure were exercised with Enter. At a requested 390×844 viewport, the measured document width and scroll width were both 390; the navigation scrolled within its own 815-pixel content width. Screenshots and accessibility snapshots are retained. This is bounded manual browser evidence, not a full accessibility conformance audit or a large-graph rendering benchmark.

A simulated 503 outage displayed the last successful refresh time and an explicit stale-state warning; recovery restored the connected state. Browser console inspection returned no errors/warnings. The test tab was closed, viewport override reset, exact disposable servers stopped, and connection refusal verified. No real account, paid model or protected production resource was used.

## Separate checking and performance

The final existing Actenon lifecycle replay passes **23/23** bounded checks. Its native checker verifies 22 exact-request proofs and 29 linked signed artifacts; all 29 altered artifacts and four additional negative controls are rejected. This preserves the existing fixture scope, not universal containment or production authority integration.

A fresh Node process loads the saved fixture state with deny-all execution and a transport that throws if called. It confirms the retained observation, changed dependency and unknown authority with zero executions. A separate Python implementation checks the 19-observation history, three receipt hashes, run links, persistence and withdrawal consistency. It rejects four deliberately corrupted controls: grant inflation, receipt tampering, a missing execution and lost withdrawal. This is a **same-author, post-hoc consistency check**, not independent-author review, independent business truth, an authority proof or a sealed evaluation.

A deterministic synthetic API benchmark at 100 / 1,000 / 10,000 added descriptors confirms bounded results without execution. At 10,020 total descriptors, the measured cold overview was 74.11 ms, cached overview 0.17 ms, first 50-row page 0.67 ms, second page 0.57 ms and a full descriptor search 0.92 ms on this Apple M5/Node 26 host. The 50-row response was approximately 149 kB because it includes source/limitation text. These are individual development measurements of API construction, excluding transport and browser rendering. They establish no statistical latency distribution, coding-agent advantage or lifecycle cost advantage. More compact list responses and large-graph browser measurements remain useful next work.

## Reproduction

From the product freeze (with normal existing Node development dependencies):

```sh
npm run typecheck
npm test
npm run proof
node --test test/living-lifecycle.test.ts test/dashboard-state.test.ts test/outcomes.test.ts
node experiments/living/measure-dashboard.ts /tmp/rcx-dashboard-scale.json
node experiments/living/browser-fixture.ts /tmp/rcx-living-browser-evidence
```

Run the last command in a terminal that keeps stdin open. Open its printed loopback URL. Use the Compose form with `{"place":"Lima","language":"es"}`, output `text`, intent `weather translated`, retained name `Observed weather`, and predicate `[{"op":"equals","value":"Se esperan nublado cielos con una máxima de 19°C y una suave brisa hoy."}]`. Inspect New abilities. Enter `restart`, `withdraw`, `hostile-label`, `fault`, `recover`, `save`, and finally `stop` at the fixture terminal as needed; these commands are fixture controls, not product endpoints. The history and state are saved into the chosen evidence directory. `reload-observations.ts` accepts that saved state and a new output file; `check-observations.py` checks this checkpoint's recorded evidence directory.

This command is a development fixture, not `npm run demo:capability-plane`. The supported one-command headline demonstration, actual independently controlled outcome/boundary evidence, seven-act public-provider challenge, fresh model transfer, complete economics and human commercial validation remain unmet. The next safe checkpoint is the optional Actenon observation interface and challenge integration, alongside diagnosis of the unresolved native memory failure. Keep release **NO-GO** until the original and additive acceptance criteria are actually established.
