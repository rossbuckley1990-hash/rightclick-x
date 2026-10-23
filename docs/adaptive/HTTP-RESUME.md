# Explicit HTTP recovery after restart

**Partial milestone; North Star release remains NO-GO.** Work continues on `programme/adaptive-capability-plane`, from `c76f32e973f5dc1d673a731820cee875cdad53d7`. The final product and experiment source is **`d4e8e59c696e9929ba64d761dc24fa56e6d0bc1b`**. Main and other worktrees were not changed. No merge, push, publication, external provider mutation, paid service or model invocation was used.

This extends [protected asynchronous execution](PROTECTED-ASYNC.md). The runtime can now retain and explicitly resume the next read of an accepted HTTP operation after process interruption. It does **not** resume an unfinished parent composition, its remaining steps, publication or witnesses. Those outcomes remain unresolved.

## Implemented invariant

An accepted write is never replayed by recovery. A checkpoint contains the next known monitor/result read, original and candidate contract digests, original predicates, a request counter and expiry. Every resumed read uses the current graph, current operator policy, current network restrictions and current credentials. Contract changes, removed operations, denied authority and exhausted budgets fail closed.

The existing `context_run_status` exposes a `resumeId` such as `resume:run_…`. The caller passes that exact selector as `context_run.id`, omitting inputs, predicates and confirmation. The selector resolves a retained HTTP leaf; it cannot change its inputs or weaken its stored checks. The original thirteen tools remain. Ordinary run arguments and saved-goal behavior remain compatible.

```json
{"id":"resume:run_example"}
```

The initial API draft used an optional `resumeRunId` field alongside an ordinary capability ID. A pinned-baseline experiment demonstrated that an older runtime ignored that unfamiliar option and dispatched the ordinary action again. The final selector is intentionally an unknown capability in older runtimes and is rejected before dispatch. [Recorded compatibility result](evidence/http-resume/legacy-selector.json). The draft option is explicitly rejected by the new interface too.

## Persistence and limits

The existing Store/FileStore gains an optional continuation collection. No new database, scheduler, orchestration framework, authority service or cryptography is introduced.

- At most **64 checkpoints**, each at most **64 KiB**; at most **128 known read targets** and **32 stored predicates** per checkpoint.
- Each operation has a **one-hour recovery window** and at most **32 reserved follow-up attempts** over its lifetime. Existing per-call limits still apply: default four reads / 20 seconds, host maximum eight reads / 30 seconds.
- Progress is saved before waiting. The next attempt is reserved in persisted state before dispatch. Retry-After survives a successful checkpoint and restart.
- Contract and execution policy checks repeat after asynchronous persistence and immediately before dispatch.
- Expired entries retire when allocating a new checkpoint, with a local lifecycle event. Live capacity exhaustion returns pending with `checkpoint-unavailable`; it does not silently poll without retaining state.
- Checkpoints omit the original request body, headers, credentials, grants and native proofs. They retain resource URLs and predicates; comparison values explicitly supplied in predicates can contain user data. This is local host state, not a portable authority artifact.
- Restore performs no automatic execution. Concurrent explicit resumes of the same checkpoint in one runtime are refused. Completion clears its checkpoint and records a receipt linking `resumes` to the original run.
- After restart, status can show the resumed receipt without reconstructing the full output: `outputUnavailable:true` is explicit. Full outputs are not newly retained by this feature.
- A failed checkpoint stops polling. A persistent background save failure is exposed by `context_runtime.storage.status:"failed"`; explicit `flush()` still rejects. It does not become an unhandled timer rejection or trigger execution. A later successful save changes the observed status to `saved`.

FileStore uses its existing per-instance ordered, atomic rename implementation. This proves the tested process-kill recovery, not power-loss durability, multi-writer transactions, a distributed lease or exactly-once provider execution. A crash before the first accepted response is checkpointed can still lose its continuation. A crash after a read is dispatched may require repeating that read under fresh authority. Provider GET side effects, hidden routes and provider-specific finality are not inferred away. Storage I/O itself is not governed by the network polling deadline.

## Evidence

The new controlled scenarios use ordinary catalog/contract discovery and execution. There is no product-specific runtime branch or model-written polling loop.

**Actual process kill:** A local HTTP service advertises a queued compression interface through an RFC 9727 catalog. The client discovers it, submits a document and saves its first monitor read to FileStore. The test sends SIGKILL after the server receives that read. A different Node process restores the file and performs only the monitor and result GETs. The returned digest matches independently held gzip bytes, decompression matches the original document, exactly one enqueue is observed, and the receipt chain remains intact. This passes on native macOS and the cached Linux runtime. The provider is a controlled test service, not independently authored holdout software.

**Independent execution authority:** The existing resource-owned Actenon compression service receives one authorised enqueue. One isolated client stops at its polling budget; a fresh isolated client attempts resume after the operator revokes the grant and remains pending without reaching the resource. A third client resumes successfully after the operator installs a new grant. No resume client rediscovers the contract or resubmits the write. The actual gzip artifact matches the result and original document.

The replacement fixture grant permits writes as well as reads; this experiment establishes that recovery uses only retained reads, not that the replacement grant is limited to reads. The revoked request stops at the issuer and its refusal is unsigned. The four successful resource receipts are signed and verified separately.

Pinned Airlock reconciliation documentation was reviewed before designing recovery: an unknown consequence must remain held; observing a result must not redispatch the original effect or release a reservation by inference. The native proof, revocation, replay and effect machinery is reused unchanged. This runtime read continuation is **not** an Actenon reconciliation decision and never settles/refunds an ambiguous native effect.

The separate Python checker imports native Actenon verification APIs, not RightClick or the harness. It checks the file bytes, raw container reports, received requests, exact proof binding, changed grant identity and signed receipts. It rejects four corrupted copies: an extra write, wrong compressed artifact, modified proof and reset checkpoint counter. This is separate-process/implementation checking by the **same author**, not independent-author review.

| Validation | Result |
|---|---|
| Full native regressions, final freeze | **396/396**, zero skips, 25.868 s |
| Focused Linux, cached image, no network | **88/88**, zero skips, 7.469 s |
| Type checking and both bundles | PASS |
| Existing black-box proof | **28/28**, source unchanged during proof |
| Retained-evidence verifier | **PASS**: 134 source files and 404 artifacts; both native checkers rerun |
| New protected restart experiment | **9/9** |
| Separate native checker | One effect, four exact successful proofs, four signed artifacts; four corruptions rejected |
| Existing protected asynchronous regression | **29/29** on preceding source `1ce3d33`; seven compressed files, 21 accepted exact proofs and 59 signed artifacts checked, five corruptions rejected |

The 29-case regression preceded only the final background-save health correction. Its exact source binding is retained; it is not relabeled as a run on `d4e8e59`. The earlier 36-case resource and 23-case adaptation/federation results remain bound to the prior [protected-async checkpoint](PROTECTED-ASYNC.md).

Final protected run measurements:

| Phase | Fresh-container wall time | RSS |
|---|---:|---:|
| Discovery plus no-grant refusal | 558.982 ms | 65,499,136 bytes |
| Enqueue and bounded pending checkpoint | 936.839 ms | 64,434,176 bytes |
| Resume with revoked grant | 971.550 ms | 64,192,512 bytes |
| Resume with new valid grant | 735.483 ms | 65,253,376 bytes |

All four processes report 24 capabilities / two providers including built-ins. Resumption makes zero metadata requests and zero writes. These are single controlled runs overlapping regression work and include container/IPC/polling costs. They establish no speedup, integration-effort reduction or model-economic advantage. The adverse equal-control saved-script comparison remains authoritative.

## Preserved failures

Raw evidence is under [evidence/http-resume](evidence/http-resume/checker-final3.json):

- `before.log`: both initial restart controls fail on the previous implementation.
- `legacy-selector.json`: the rejected draft option is silently ignored by the old runtime; the final selector fails closed on that same baseline.
- `selector-attempt1.log`: 39/40 pass; a negative-control assertion expected “resume” but received “resumable”. The exact refusal and zero-dispatch behavior were correct; the assertion text was corrected.
- `capacity-before.log`: 9/10 pass; expired checkpoints occupy every slot. Retirement fixes the reproduced failure without evicting live checkpoints.
- `persistence-before.log`: 10/11 pass; persistent save rejection escapes the background timer. Runtime storage health and rejection handling fix it while explicit flush remains fallible.

All intermediate runs, including API-draft experiment snapshots and their checker output, are retained. Exposed providers and scenarios are development cases, excluded from later independent holdouts.

## Acceptance boundary and next work

This advances original outcomes 2–5 and 7 within the supported HTTP profile: truthful outcomes, current authority on recovery, retained deterministic execution and refusal of changed semantics. It improves the existing compact developer interface without adding a tool. It does not complete any broad North Star gate.

The original environment-native discovery evidence, real RCSB/Crossref results, model trials and Actenon feasibility assessment retain their own source and scope. No new external-service or actual-model result is claimed here. Sealed unfamiliar software, independent authorship, model swap, superior economics, the complete seven-act demo and human developer/commercial validation remain open. The native hard-memory containment failure remains unresolved. The headline `demo:capability-plane` command still does not exist.

Next three priorities:

1. Retain the exact unfinished multi-step plan, completed-step evidence and checks so a parent workflow can continue without replaying earlier effects or silently replanning.
2. Freeze that implementation before independently selected, unfamiliar multi-provider dataflow/async holdouts and actual fresh-model reuse.
3. Compare acquisition, interruption recovery and maintenance with the strongest equally protected coding-agent/script baseline, then simplify installation around demonstrated value.

## Reproduce

Use Node and the existing development dependencies for normal tests. The optional protected experiment requires the pinned five-package Actenon environment and cached image described in [its README](../../experiments/actenon/README.md), plus macOS/Docker prerequisites; it is not yet simple released installation.

```sh
npm run typecheck
npm test
npm run build
npm run proof

node --test test/http-resume.test.ts test/http-resume-process.test.ts

/absolute/audit-root/.venv/bin/python experiments/actenon/resume.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-http-resume-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-resume.py \
  /absolute/new-http-resume-evidence

/absolute/audit-root/.venv/bin/python experiments/living/verify-http-resume.py \
  docs/adaptive/evidence/http-resume-verification.json
```

The protected runner refuses an existing evidence directory, checks the Actenon pins, uses disposable local authority and removes private state/containers on exit. The last command checks retained evidence and source integrity without starting a provider or model; its [recorded result](evidence/http-resume-verification-result.json) is retained. It requires the recorded product source. No success is inferred from a missing test, a failed setup or a merely valid proof.
