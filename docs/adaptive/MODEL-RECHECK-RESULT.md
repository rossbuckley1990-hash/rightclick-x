# Fresh-model recheck after remediation

**No qualifying economic advantage. Release remains NO-GO.** All four arms returned correct outputs for all four feasible tasks. RightClick retained discovery across three fresh sessions with zero investigations or revalidation probes, and compatible repair now succeeded through a saved goal. It remained slower and used more reported warm tokens than the direct and documentation baselines.

The [preregistered recheck](MODEL-RECHECK.md) uses freeze `15928a3`, product source `59706d4`, Codex CLI 0.159.3 and `gpt-6.1-sol` at low effort. The 32 completed sessions retain the original tasks, prompts, oracles and D/A/B/C order. This is one exposed target, not a holdout, different-vendor transfer or Actenon integration evaluation. An intervening laptop sleep separates D from the resumed baseline sessions; service/load differences and fixed ordering mean these are descriptive observations, not causal estimates or a fair population timing result.

| Arm | Feasible outputs | Prescribed cases | Cold time | Warm median | Warm median reported tokens |
|---|---:|---:|---:|---:|---:|
| A: direct | 4/4 | 8/8 | 11.6 s | 12.2 s | 47,883 |
| B: documentation | 4/4 | 7/8 | 10.1 s | 10.4 s | 50,837 |
| C: saved skills | 4/4 | 7/8 | 19.6 s | 21.6 s | 99,266 |
| D: RightClick | 4/4 | 8/8 | 24.4 s | 17.2 s | 146,491 |

Each warm median contains three different tasks. D is 1.41× slower than A, which also satisfies all eight prescribed cases, and 1.65× slower than B. Its observed warm time is 25.5% below the earlier pilot's 23.1 seconds; simultaneous product changes, model variability and the sleep gap prevent attributing that difference to disclosure alone. Neither this result nor the earlier unfavorable comparison meets the original strongest-baseline advantage threshold.

B and C each repaired the reversed-output wrapper and returned the correct independently observed value. Their remaining scorer failure is the prescribed refusal requirement, not a wrong value. Preserve both facts: all original scores remain unchanged, and the reversible-wrapper criterion cannot demonstrate a factual reliability advantage over those recovered answers. No completed arm returned a wrong final value in this recheck.

## What improved, and what remains unsafe

The three warm D sessions use 4/4/5 MCP calls, with no investigation or revalidation. They inherit the CLI graph and publish working task-specific goals; they do not all execute the same saved task goal. All three warm compose responses execute successfully, versus eight nonexecuting compose responses in the earlier pilot. One warm session tries an invalid output-format value, receives a refusal, then corrects its request; that extra call and execution remain counted.

The compatible-change session calls the retained pretty-print goal and gets the correct result after automatic investigation and repair. It does not manually call `context_learn`. The incompatible-change session's saved goal refuses its changed required operation, and a direct call also refuses pending changed meaning. The model then supplies `acknowledgeChange:true`; the runtime executes the altered operation and labels reversed output `checked` under a weak whitespace predicate. The model refuses the final answer. No output is labeled independently `verified`, but final-agent refusal still does not establish independently enforced semantic refusal or operator-authorised exact-action execution. See the retained `lifecycle-semantic-audit.json`.

The actual three warm sessions expose 167,244 UTF-8 tool-text bytes versus 191,022 previously, a 12.4% reduction. Catalogue text falls 73,860 → 51,718 bytes and repeated prefix copies 39,996 → 19,452. Explanation traffic grows 63,177 → 78,498 bytes: this model inspects both invocation and stdout capabilities in every warm session. These actual client records temper the [41.9% same-state explanation-frame reduction](DISCLOSURE.md); call selection and saved state matter. Bytes are not tokens or prices, and no narrower favorable measure substitutes for full lifecycle economics.

## Interrupted attempt, verification and resource use

The first A cold attempt spans host clamshell sleep from 07:19 to 09:14 London time. Its native formatter returns the correct output in 44 ms, but the model produces no completed turn or final answer. The 600-second timeout callback runs after sleep, recording 6,937.8 seconds. That interval is invalid model-service latency and remains separately retained. Its last recovered token-count snapshot is 15,723; final usage is unknown. The failed attempt's oracle setup additionally takes 0.0489 seconds. The exact same frozen run resumes after a new no-spend preflight, without rerunning the eight completed D sessions.

The 32 completed sessions report **2,852,563 tokens** and **515.8 seconds**, plus about 1.69 seconds of host oracle setup. Cached input is counted once. The interrupted snapshot and all earlier failed/completed pilot costs remain additional; a complete all-attempt token total cannot be claimed. No API-equivalent prices or monetary savings are inferred.

The original raw checker intentionally rejects unreconciled retries. A separate reconciliation script validates the stopped snapshot, unchanged completed D rows, timeout lifecycle, partial usage and replacement identity. It writes an explicitly labelled completed-session view for the unchanged checker; the original results and `previousAttempts` remain intact. The checker then validates all 32 completed records. A control that hides the interruption is rejected. Three other copied-evidence controls reject altered task output with an updated digest, inflated tokens and concealed I/O. All model code is parsed as data, never executed by these checks. This is same-author verification, not independent-author review.

All three actual exported builds match 79 frozen product/host source files. The product remains byte-identical to the disclosure freeze, whose 270 native regressions, 18 targeted Linux tests, 28 black-box checks and offline package checks retain their recorded source identity. Postflight reports 54% allowance used (52% before), ordinary subscription usage available and zero credits. Authentication stays pinned to ChatGPT, with API/provider environment variables excluded. No credit purchase/reset, API fallback, Claude call, push, merge, publication or outreach occurs.

## Reproduction and next gate

The exact commands and no-spend constraints remain in the [plan](MODEL-RECHECK.md). Use a new manifest/output path bound to `15928a3`; model behavior is nondeterministic. The raw checker is unchanged from that freeze. Subsequent analysis uses `check-codex-controls.py`, `summarize-model-recheck.py` and `analyze-disclosure.py`, whose exact versions are retained with this report. Analysis resolves records by attempt ID inside the supplied evidence root rather than relying on this machine's absolute paths. The special `reconcile-codex-sleep.py` is intentionally limited to the documented interruption, not a generic exemption for failed attempts. Original raw evidence, the completed-session view and accounting live under `evidence/model-recheck-15928a3/`; hashes are in `evidence/model-recheck-verification.json`.

Stop treating smaller metadata or additional exposed single-program reruns as evidence of the North Star. Next prioritize the demonstrated changed-meaning authority gap, using the already audited independent Actenon boundaries rather than agent acknowledgement, and an unfamiliar multi-step reuse/maintenance challenge against strong coding agents. Keep discovery permission separate from authority and examine every claimed alternate execution route. Fresh independent holdouts, cross-vendor inheritance, independent-author review and human developer/commercial gates remain unmet.
