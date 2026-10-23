# Retained sequential workflow recovery

**Partial engineering milestone; release remains NO-GO.** This continues `programme/adaptive-capability-plane` from `d3ae1e33bc35e21d7df1e0a5950f4f1788bcd699`. Product source is frozen at `07a10f09a052b6b1b6e30ae5a2af23a21709ad7b`. The previous turn made verified progress; this increment extends its HTTP leaf recovery rather than restarting the programme.

## Invariant and implementation

A retained sequential composite can continue its pending HTTP step and its exact remaining steps after restart. Completed effects are not replayed. An interrupted dispatch without a retained result or HTTP continuation remains unresolved; absence of a result never establishes that an effect did not happen.

The SDK host opts in with `workflowRecovery:true` and supplies a Store. This is deliberately explicit because recovery retains bounded inputs and intermediate outputs. The existing thirteen-tool interface remains: `context_run_status` supplies a `resume:<run-id>` selector, and `context_run` consumes it without replacement arguments or predicates.

The implementation adds one bounded execution-state record, not a scheduler or new authority mechanism:

- A composite contract digest, step digests, input values, caller checks, completed outputs and run IDs are retained with a position and phase.
- Before dispatch, the runtime persists a reservation identifying the child run. An accepted HTTP checkpoint links its child to the parent in the same Store snapshot before polling.
- A completed step is checkpointed before another step can dispatch. A storage failure stops progression. A crash after dispatch but before recording its outcome leaves the operation unresolved.
- Recovery uses the original plan. Every retained contract and current operator policy is checked, including after asynchronous checkpoint persistence. It does not rediscover, repair or replan.
- The pending child cannot be separately consumed through the public resume interface while owned by its workflow. Concurrent resumes in one runtime are refused.
- Stored predicates and output requirements still run. Witness independence includes all pinned step providers, even when old receipts have left the bounded buffer. Successful final results and known final refutations remove the checkpoint.
- IDs include UUIDs to avoid reusing an execution identity when a fresh process resets its counter.

The pinned Actenon reconciliation guidance was reread before designing the state transitions. This state does not settle, refund or reconcile native consequential-effect reservations and contains no cryptographic authority implementation. A remaining step still requires current authorization at its execution boundary.

## Supported boundary

This first profile covers direct execution of a **retained, flat sequential composite of at most sixteen leaf steps**, with a pending step in the supported HTTP 202/303 profile. It supports successive pending steps. Each checkpoint is at most 64 KiB, with at most 64 retained workflows and a one-hour recovery window. Recognizable credential-named values, credential-like text, non-JSON values and oversized state are refused rather than silently redacted into different executable inputs.

The opt-in is an SDK host option, not yet CLI installation configuration. Ordinary compose calls and saved goals still use their existing planning paths. Nested composites, fan-out, destructive steps, caller-supplied Net contexts and resumption of pending witnesses are outside this recovery profile. A workflow already waiting on a witness remains unresolved; it does not rerun earlier effects. This does **not** complete whole-workflow recovery across all runtime paths.

Checkpoint data is local, unencrypted host state and can contain business documents or other user data. Name-based credential detection is not a complete secret detector. Host authentication headers, grants and native proofs are not copied into this new record.

FileStore retains its existing atomic rename and per-instance ordering. These tests do not establish power-loss durability, distributed locking, multi-writer safety or exactly-once provider execution. Two independent hosts using the same checkpoint can race; external authority/effect enforcement is still necessary. Unresolved/expired workflows are not evicted to admit new work, so capacity exhaustion requires operator attention. Older writers do not preserve the new workflow state; cross-version migration is not established.

## Reproduced defect and correction

A witness-independence test failed because snapshot restoration loaded providers one at a time and retired a composite before its later-listed dependency arrived. The failure was observed on both native macOS and Linux. The runtime now restores the complete graph snapshot before checking dependencies. Invalid inner composites are retired to a fixed point, including their dependent outer composites. A negative control confirms genuinely changed contracts still retire both.

This is a general snapshot-order correction, not a provider exception. The failed native targeted run (`focused-final.log`, 10/11), Linux run (`linux-final.log`, 94/95) and diagnostic run are preserved. Their filenames are historical, not declarations that they passed. The initial baseline fails both new recovery controls. An initial typecheck also reports an unused test import; later tests use it.

## Evidence and measurements

The controlled three-step regression reads a prepared document, enqueues asynchronous processing at another provider, then writes the returned checksum. A fresh runtime performs only the pending result GET and final POST. Another case encounters two successive pending writes and resumes the same parent twice without replay.

The real HTTP/FileStore test advertises its ordinary OpenAPI contract through a catalog. A disposable client learns it and constructs a controlled retained plan. The test sends SIGKILL after the provider receives a monitor read. A fresh Node process restores the parent and child checkpoints, reads the completed gzip job and publishes its digest once. Separately held gzip bytes decompress to the original document and match the published digest. The original enqueue occurs once. This runs on macOS and the cached Linux image. The test supplies the plan; it is not evidence of newly generalized automatic planning or an independently authored holdout.

| Check | Result |
|---|---|
| Native regression suite | **409/409**, zero skipped; 23.852 seconds |
| Focused Linux suite | **96/96**, zero skipped; 4.283 seconds |
| Workflow controls | **12/12**, including snapshot order, uncertain dispatch, storage failure, changed contracts, policy, expiry, ownership, predicates and concurrency |
| Real process-kill controls | HTTP leaf and workflow both pass within the suites above |
| Typecheck and both bundles | PASS |
| Existing black-box proof | **28/28**, source unchanged during proof |
| Existing Actenon HTTP leaf regression | **9/9**; one effect, four exact proofs and four signed artifacts; four corruptions rejected |
| Retained evidence reconciliation | **PASS**: 136 source files and 90 artifacts |

The existing optional Actenon restart regression and its native checker pass on the same source. The Actenon regression exercises the previously supported HTTP leaf path; it does not establish independent enforcement of this new workflow profile's remaining steps. The code-review tool was unavailable (`unsupported call: tool_searchtool_search_tool`); no independent reviewer ran.

All new scenarios are exposed, same-author development cases. There is no new external-service result, fresh-model trial, sealed holdout or matched economic comparison. The adverse saved-script benchmark and unresolved native hard-memory containment failure remain authoritative.

## Acceptance and next work

This advances original outcomes 2, 4, 5 and 7 within the declared profile: deterministic retention, preserved verification, safe refusal and tested recovery. It makes no new independent-authority, universal-environment, model-independence benchmark or economic claim. The installation and commercial gates remain open.

Next three priorities:

1. Carry the same execution-state discipline through planned/saved-goal execution, fan-out and witnesses while preserving the exact selected plan, network restrictions and every outcome obligation.
2. Exercise remaining workflow steps under native exact-action authority, then freeze before independently selected unfamiliar software and actual fresh-model reuse.
3. Measure acquisition, recovery and maintenance against the strongest equally protected baseline, and use that evidence to simplify installation.

## Reproduction

```sh
npm run typecheck
npm test
npm run build
npm run proof
node --test test/workflow-resume.test.ts test/http-resume-process.test.ts
```

The optional authority regression retains the [Actenon setup and command](../../experiments/actenon/README.md). It requires the pinned local packages and cached image and starts only disposable local resources. Use a new output directory.

Raw evidence and failures are under `docs/adaptive/evidence/workflow-resume/`. The [evidence manifest](evidence/workflow-resume-verification.json) binds the frozen source and recorded artifacts; its [reconciliation result](evidence/workflow-resume-verification-result.json) is retained. Recheck it with the pinned Actenon Python environment:

```sh
/absolute/audit-root/.venv/bin/python experiments/living/verify-workflow-resume.py \
  docs/adaptive/evidence/workflow-resume-verification.json
```

This checks existing evidence without starting a model or provider. It does not turn same-author tests into independent review.
