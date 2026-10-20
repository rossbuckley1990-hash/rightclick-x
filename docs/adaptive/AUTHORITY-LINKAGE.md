# Native decisions correlated with runtime requests

**Bounded milestone PASS; programme PARTIAL; release NO-GO.** Historical native Actenon artifacts can now be associated with observed RightClick executions through an explicitly trusted operator transport. Native signatures authenticate the exact action and gate attempt. The operator log supplies the runtime association. Neither establishes current permission.

Starting revision: `9d60f86945ee87371bf1182d47ad3496d003e408`. Product/initial trial freeze: `b6a3f3b`. Corrected live freeze: `451ec1ef345586250461d9eaff25fcf5ce855d08`. Final engineering/auditor freeze: `01a30782737cc511bdf8b68dacf88817bab186ef`. Branch remains `programme/adaptive-capability-plane`; no branch switch, merge, push or publication.

The previous transport could not identify the runtime execution behind a native decision. Matching timestamps, bodies or proof IDs would have been unsafe: exposed signed replay evidence contains an original success and replay refusal with the same proof, action hash and wire, but different native gate request IDs. Baseline tests reproduce absent runtime context. Actenon's source and three existing outcome-attestation tests were audited before implementation.

`FetchLike` now accepts optional, immutable, out-of-band context: runtime epoch, owning leaf run, owning capability and a fresh ID for each actual request. Discovery has no execution owner. Redirects, negotiation retries and asynchronous monitor requests get distinct request IDs; their capability field describes the owning execution, not the monitor's action. Explicit per-call context preserves concurrent calls and cached MCP sessions. No HTTP authority parameter, credential, grant, proof or retained knowledge is added. Existing two-argument transports remain compatible.

The controlled protected resource adds native artifact-digest and gate-request references to its response. The operator transport records these references with the exact request and runtime context. The optional adapter verifies native signatures, issuer, pinned resource key/origin, signed method/target/headers/body and gate request ID before projecting a link. It rejects ambiguous and duplicate associations. Runtime UI projection additionally requires a retained execution observation in the current epoch with the matching owning capability. Restart or history eviction removes the association. Unknown references stay unlinked; incomplete configured logs fail closed.

No Actenon cryptography was copied or changed, and no dependency was added to the core runtime. The [optional adapter instructions](../../integrations/actenon/README.md) describe its bounded log format and trust assumptions. The public thirteen-tool interface is unchanged.

**Failure preserved:** the first live trial's operator wrote the correlation journal under `boundary/issuer/`, while the adapter read an empty file under `boundary/`. Resource effects and adaptation completed, but no links appeared; the separate checker rejected the trial. Its driver exit code was zero, which is not counted as experiment success. The path correction was committed before a complete second trial. A prior MCP regression fixture also failed because it omitted the protocol's read-only annotation; the runtime conservatively required destructive approval. The fixture was corrected without changing that policy. All raw failures remain in the evidence directory.

The corrected trial runs the existing combined system: real public RCSB/Crossref discovery and composition, a newly advertised protected compression service, explicit exact operator approvals, asynchronous completion, grant revocation, compatible rename/nested output, changed-target refusal, withdrawal and return. It preserves two reusable goal contracts and three stopped workflows whose resume attempts dispatch nothing.

| Measured result | Evidence |
|---|---:|
| Mediated requests / runtime tool calls | 38 / 22 |
| Successful native exact proofs / signed artifacts | 12 / 14 |
| Artifacts linked to actual runtime requests | 12 across 3 owning executions |
| Direct no-proof artifacts correctly unlinked | 2 |
| Issuer refusals / unexpected protected effects | 6 / 0 |
| Actual gzip artifacts / lifecycle views | 3 / 7 |
| Final runtime RSS / compact retained state | 201,646,080 B / 2,239,603 B |
| Model calls / paid usage in this increment | 0 / 0 |

A separate implementation checks native signatures, actual gzip contents, response references, exact wire requests, runtime observations and the absence of unexpected effects. A fresh public readback independently selects `1CRN`'s primary DOI, `10.1073/pnas.81.19.6014`, then confirms the exact title and publisher. It uses separate requests to the same underlying metadata sources. This is not an independent organisation's attestation.

All **461 native product tests**, **103 focused Linux tests**, **28 existing proof checks**, **30 protected workflow controls**, type checking and all four builds pass. There are no skipped final tests. The optional adapter passes **12 legacy controls** and **17 association controls**, including real signed replay evidence. Separate checkers reject **nine association corruptions**, **seven adaptation corruptions** and **five protected-workflow corruptions**. The earlier fresh-model adaptation evidence still passes its unchanged obligations with the extended checker. Current models were not rerun; historical same-vendor model evidence is not presented as a new combined model-and-linkage trial.

Five alternating fresh-process pairs against the starting source measure 1,000 checked in-memory HTTP executions after 100 warmups. After all live processes finished, baseline median is **124.943 ms**, current **128.608 ms**: **2.93% higher**, about 3.67 microseconds per execution in this synthetic workload. Each executes exactly 1,100 requests and holds graph size at 21; only current transports receive contexts. An earlier concurrent-load sample appeared faster and is retained rather than selected as the result. These small samples do not establish production latency or economic superiority.

Five cold native-reader pairs measure a linked-feed median of **255.233 ms**, within the existing 2.5-second subprocess limit. The projected 14-artifact feed grows from 6,000 to 9,376 bytes with 12 associations. Cold startup, cache and host-load variation dominate this small sample; no speedup is claimed. This work improves explainability and auditability, not demonstrated coding-agent economics.

| Original outcome | Coverage at this checkpoint |
|---|---|
| 1. Discover unfamiliar authorised capabilities | Existing generic discovery path exercised; independent unfamiliar holdout remains open |
| 2. Establish semantics and verify outcomes | Separate public readback and actual artifact checking pass within these exposed cases |
| 3. Independently enforce restrictions | Existing native exact-action boundary passes; new operator correlation improves attribution, not containment |
| 4. Reuse across fresh agents/models | Prior fresh-process and same-vendor model evidence retained; no new model trial or cross-vendor claim |
| 5. Safe adaptation | Compatible changes work; changed targets, revocation and withdrawal refuse in this session |
| 6. Superior economics | Unestablished; prior adverse/mixed strong-agent and saved-script comparisons remain binding |
| 7. Regression/security/semantic/holdout evaluation | Listed regressions pass; independent-author review and sealed unfamiliar holdouts remain open |
| 8. Simple installation and developer experience | Backward-compatible optional adapter; clean-machine native provisioning and unfamiliar-developer trial remain open |

The runtime/transport/log are trusted for local identity. A compromised runtime or operator can lie about that identity; signatures do not cure it. This profile covers mediated HTTP requests at one controlled resource, not shell/local-program effects, downstream federation, every alternative tool or every deployed resource. Pre-dispatch issuer refusals have no resource attestation; lost responses have no response association. Standalone artifacts and a bounded log do not prove complete history. Authority, business success and local policy remain separate. The historical native short-allocation hard-memory test remains **FAIL**, despite the passing general suite.

The independent review connector again returned `unsupported call: tool_searchtool_search_tool`; no independent-author review occurred. All checkers here were written by the implementation agent. This limitation and the original security, holdout, economics, custody and human/DX gates prevent release. No acceptance criterion was weakened.

Reproduce the offline audit from the engineering freeze plus committed evidence:

```sh
cd /Users/ross/src/rightclick-x-adaptive
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/verify-authority-linkage.py \
  docs/adaptive/evidence/authority-linkage/manifest.json
node --test test/transport-context.test.ts test/http-continuation.test.ts test/authority-evidence.test.ts
/Users/ross/src/actenon-audit/.venv/bin/python -B experiments/living/test-authority-links.py
```

For a new live trial, provision the separately pinned Actenon environment and cached Linux image first, then use a new output directory:

```sh
node experiments/living/living-session.ts \
  experiments/living/public-citation-authority.json /private/tmp/rcx-authority-new \
  sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  /Users/ross/src/actenon-audit/.venv/bin/python
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/check-adaptation.py /private/tmp/rcx-authority-new
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/check-public-citation.py /private/tmp/rcx-authority-new /private/tmp/rcx-authority-oracle-new
```

The live command makes bounded public metadata reads and disposable local effects; it makes no model call. Keep any failures. All recorded local processes are terminal, temporary UI tabs are closed and private fixture keys were removed by the existing cleanup. The screenshot and raw evidence are retained under [authority-linkage](evidence/authority-linkage/).

Next priorities: obtain independent unfamiliar-provider evaluation/review; resolve the native memory failure without lowering its acceptance threshold; and run matched acquisition/reuse/maintenance comparisons plus unfamiliar-developer installation trials. Continue useful engineering while the review connector is unavailable. The original goal remains active.
