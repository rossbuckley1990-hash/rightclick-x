# Sufficient capability disclosure

This checkpoint follows the unfavorable [Codex development comparison](CODEX-DEVELOPMENT-RESULT.md). It does not rescore that benchmark or change any acceptance gate.

A read-only analysis of its 32 retained traces finds 191,022 bytes of visible tool text across the three warm RightClick sessions, versus 3,667 / 2,641 / 9,010 for direct / docs / saved skills. The RightClick catalogue occupies 73,860 bytes; 39,996 bytes are copies of the shared description prefix beyond its first occurrence. Explanation envelopes occupy 63,177 bytes. Eight compose responses in those sessions have no execution; the discovery/evidence defects behind those failures were addressed in the intervening checkpoints. These are UTF-8 bytes from recorded tool text, not tokens, causal timing attribution or projected savings. All original agent scores and costs remain unchanged. See `evidence/disclosure/diagnostic-before.json` and `experiments/north-star/analyze-disclosure.py`.

## Change and frozen comparison protocol

Keep the same thirteen tools and all execution, authority, predicate, witness and output-view behavior. Shorten initialization to routing guidance and a bounded list of complete retained IDs and authorised discovery paths. Omitted entries are explicitly counted and available through graph search or research. Provider names/text remain untrusted data. The original full `retainedSummary()` remains available to library callers.

Default `context_explain` returns an execution-facing explanation. It preserves the full capability and invocation except synthetic examples and local continuity records, plus typed ports/options, restrictions, authority, evidence grade and claims, preconditions, stored checks, assumptions, dependencies, execution plan, side effects, failure/invalidity conditions, limitations, counterexamples, reproduction procedure and provenance. Pending changed-meaning warnings remain visible and are never acknowledged by disclosure. Raw samples, graph neighbours and history remain accessible with `detail:"full"`; the response supplies that exact retrieval call. CLI users can request `rcx explain <id> --full`. `RightClick.explain()` stays unchanged for library consumers. MCP text uses compact valid JSON while retaining the existing equivalent structured payload; whitespace inside values is preserved. Consumers that parse the old default explanation shape must request full detail; this is an explicit interface change, not transparent compatibility.

Before claiming improvement, freeze source/harness and use the same retained version-25 real `json_xs` seed state for old/new read-only MCP handler captures. No native sandbox, target execution, network, investigation or store save is permitted. Check every preserved execution field against full detail and require old/new full detail to remain equal. Report serialized JSON frame bytes for initialization, tool list and explanations; this is not a transport or live-model capture. A thirteen-copy prefix projection is labelled as a projection from observed historical client behavior, not a new client run. Reject four corruptions: changed invocation/options, missing authority, changed verification obligation and elevated evidence grade.

Run full regression/typechecks, the existing deterministic MCP/REST proof and offline package/thirteen-tool/uninstall checks. These presentation changes do not establish a model cost or latency win. A later fair live-agent comparison must retain all acquisition, failed attempts, verification and reuse costs and the original strongest-baseline thresholds.

## Preserved attempts and limits

The initial startup-index test repeatedly planned and published 25 goals and remained live after 3m18s. Only its verified disposable PIDs were stopped; the partial log and termination record remain. It is not a completed baseline suite. The index test now seeds extra retained entries from one valid goal instead of repeatedly invoking the planner; this tests disclosure, not large-graph planning performance. The subsequent [publication investigation](PUBLICATION-PERFORMANCE.md) did not reproduce the stall; the exact abandoned draft is unavailable. A separately measured planner optimisation improves bounded development timings without closing this historical observation or establishing agent economics.

The first patched wire test compared a JSON payload with a JavaScript object containing an `undefined` property. The assertion now compares the actual serializable wire representations and checks a value containing quotes, a newline and Unicode. The failing log is retained; no product execution requirement was reduced. A subsequent restricted-host regression run executed 204 tests and skipped 66 native sandbox tests; it is preserved and does not count as full acceptance. The native run below executes all 270.

## Frozen result

Product, tests and comparison scripts are frozen at `59706d435f3854881184d25820bd4342203bab70`, on the existing programme branch. Baseline source is `f47b76274a6227ff11bd976488cb630c62881294`. Both captures load the identical retained version-25 `json_xs` state from the prior migration experiment. That is one exposed development target with three CLI capabilities and one saved goal. Both perform zero investigations, network callbacks, executions or saves; their graphs remain unchanged.

| Serialized JSON measure | Before | After | Change |
|---|---:|---:|---:|
| Four default explanation frames | 72,084 bytes | 41,848 bytes | 41.9% smaller |
| Initialization frame | 1,487 bytes | 711 bytes | 52.2% smaller |
| Initialization instruction text | 1,250 bytes | 490 bytes | 60.8% smaller |
| Thirteen-tool list frame | 16,909 bytes | 17,091 bytes | 182 bytes larger |

The same-author, separate Python checker verifies source hashes, unchanged full detail, equivalent JSON text/structured content, all retained invocation/port contracts, authority, execution restrictions, evidence and verification obligations. It rejects four corrupted responses: changed invocation arguments, missing authority, weakened verification and elevated evidence grade. This does not establish independently authored review or new semantic correctness. The projection for a client copying initialization instructions thirteen times is 16,250 → 6,370 bytes; no new client trace was captured, so this is only a projection. Baseline and candidate responses remain available in full.

| Validation | Result |
|---|---|
| Final four disclosure tests against old source | 4 expected failures, zero skips; new explanation contract, pending change warning, compact JSON and bounded startup index |
| Native macOS regression | 270/270, zero skips |
| Cached Linux disclosure/interface/output-view suite | 18/18, zero skips; network disabled, source read-only |
| Frozen deterministic MCP/REST proof | 28/28 |
| Product/test and comparison-script typechecks | Pass |
| Offline build/install/thirteen tools/uninstall | Pass; package 408,096 bytes |
| Bundled CLI default/full retrieval | Pass with isolated empty state |

The original 32-session agent benchmark is unchanged and still unfavorable. Byte reductions are a bounded disclosure improvement, not model tokens, latency, total lifecycle economics or proof of the required twofold advantage. This source still needs a fair fresh-agent comparison that includes discovery, full-detail retrieval when needed, verification, failures, publication, reuse and maintenance. Startup prioritizes recently saved goals; large catalogues may require graph search, whose extra calls must count. The observed slow repeated goal publication remains open.

## Reproduction

Export the two commits into separate new directories; neither command changes the working branch. The replay needs `src` and `package.json`. Full proof/build/package checks also need `bin`, `test`, `proof`, `ci`, `demo`, `README.md` and `LICENSE`.

```sh
mkdir /tmp/disclosure-before /tmp/disclosure-after
git archive f47b762 src package.json | tar -x -C /tmp/disclosure-before
git archive 59706d4 src bin test proof ci demo package.json README.md LICENSE | tar -x -C /tmp/disclosure-after
node experiments/north-star/disclosure-replay.ts /tmp/disclosure-before f47b762 docs/adaptive/evidence/cli-migration/after-final/seed.state.json /tmp/disclosure-before.json
node experiments/north-star/disclosure-replay.ts /tmp/disclosure-after 59706d4 docs/adaptive/evidence/cli-migration/after-final/seed.state.json /tmp/disclosure-after.json
python3 experiments/north-star/check-disclosure.py /tmp/disclosure-before.json /tmp/disclosure-after.json
```

Use new output paths: replay refuses overwrites. Run `npm run typecheck` and `npm test` with native sandbox support. The frozen export's existing commands are `node proof/run.ts 20261018`, `npm run build` and `node ci/adaptive-package-smoke.ts`. Proof uses only local disposable loopback services. Package smoke uses an empty cache and offline install/uninstall. Targeted Linux uses cached image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`, `--network none --privileged`, a read-only export mount, and `node --test test/disclosure.test.ts test/interface.test.ts test/output-views.test.ts`; privilege enables the container's native sandbox, and does not represent a production containment boundary.

Raw captures, logs and preserved failures are under `evidence/disclosure/`; `evidence/disclosure-verification.json` records their hashes and source checks. Release **NO-GO**; independent-author review, unfamiliar holdouts, fresh vendor/model transfer, comparative economics and human commercial gates remain open. No live model session, paid service, publication or outreach was performed in this checkpoint.
