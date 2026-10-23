# Fail-closed persisted-state compatibility

**Partial milestone; release remains NO-GO.** This continues `programme/adaptive-capability-plane` from `6fa0da732a28c285764ea90578f94da17db4abfb`. Product freeze: `9fb6b24c0c45221f297ed1343033f29c5efeae57`.

## Reproduced problems

The prior composition report correctly left downgrade safety open. This increment tests actual frozen readers instead of assuming that adding a version number is sufficient.

The development fixture retains a composite with `origins: []`. Its sole provider is a counted in-memory response; no real network resource or credential is available. The pre-compose reader `d4c2ac74` ignores the newer restriction, makes one mock provider call and reports completion. The later reader `6fa0da73` enforces it.

Changing only the snapshot's numeric version to `2` prevents both old readers from restoring that operation, but both start with empty state and overwrite the file on flush. The same reset behavior was present in the starting runtime. Read failures were also caught and treated as absence. Unknown continuation profiles and inference-version changes could drop retained execution state.

The initial experiment, three failing regression tests, intermediate failures and a transient command-launch failure are preserved under `evidence/state-compatibility/`.

## Implementation

The shared state codec uses `rightclick-x/runtime-state@2`. The payload declares required execution semantics, including scoped composites and composition/continuation obligations. The current runtime rejects unknown formats, payload versions, declared requirements and operation kinds before restoring the graph. Missing storage is distinct from unreadable, corrupt or unsupported storage.

The encoding includes a deliberate compatibility guard for the tested legacy readers: an outer `version: 1` and a non-array `reflections` marker requiring the new format. This is a version-2 envelope, **not** a valid version-1 snapshot. Those old readers enter graph restoration and stop before any restored operation or flush. A bare `version: 2` was rejected as a design because it silently reset those readers. The current decoder validates the guard, reads the enclosed version-2 payload and applies its required semantics.

File, KV and chunked Durable Object adapters use the same codec. No sidecar, alternate state path, issuer, grant or cryptographic implementation is introduced. FileStore retains its atomic rename and ordered save behavior. A missing chunk now causes the Durable adapter to refuse; previously, deleting the middle of a repeated string could leave valid but shortened JSON.

Known version-1 snapshots remain readable. The next normal save upgrades the encoding. The positive migration test reuses a saved capability on different input without any discovery request. Existing inference migration remains available when no unfinished execution is retained. A changed inference profile with retained HTTP/workflow work stops startup and preserves the checkpoint for a compatible runtime. Unknown or invalid continuation records likewise refuse instead of being silently dropped.

The public `context_*` interface remains thirteen tools. `context_runtime.storage.format` identifies the writer format. Built-in adapters upgrade automatically. Custom persistent adapters should use the exported helpers:

```ts
import { decodeState, encodeState } from "rightclick-x";

// Return null only when the key/file genuinely does not exist.
const state = raw === null ? null : decodeState(JSON.parse(raw));
const encoded = encodeState(nextSnapshot);
```

Raw snapshot objects remain supported by the in-process `Store` interface. Custom adapters that write unwrapped objects do not receive the tested old-reader refusal guard. Directly saving a legacy payload through a built-in adapter is refused; load it through the runtime first. Tools that read state files directly must decode the envelope, rather than assuming `reflections` or `receipts` live at the JSON root. The live proof evaluator was updated accordingly; historical experiment revisions retain their original format and evidence.

## Results

| Final check | Result |
|---|---|
| Full native suite | **425/425**, zero skipped; 34.680 s |
| Focused Linux suite, cached Node 24.22 image | **120/120**, zero skipped; 14.556 s |
| Focused persistence/recovery suite | **39/39** |
| Existing lifecycle proof | **28/28** |
| Typecheck and both bundles | Pass |
| Protected composition regression at the freeze | **30/30** |

The final native compatibility matrix contains nine reader/state pairs. Both frozen legacy revisions refuse the new envelope before startup completes, make zero mock provider calls and preserve every byte. The current reader accepts legacy and current state while enforcing the stored restriction; it refuses the naive version bump with missing requirements without changing the file. The old-reader bypass and both naive-version overwrite controls remain visible in the same matrix.

The separate Python result checker validates the matrix, input hashes and retained restriction. It rejects five corrupted cases: a lost guard, widened origins, an observed call falsely treated as refusal, an overwrite and an omitted reader. This checker does not import runtime or harness code. It remains a same-author implementation, not independent-author review.

The protected workflow regression verifies that the new state payload still carries the exact selected plan across fresh containers. It completes one authorized remaining publication and refuses two others. Native checking verifies 14 exact successful request proofs and 50 signed resource artifacts, rejecting five corrupted evidence copies. The authority implementation and audited Actenon revisions are unchanged.

The [final reconciliation](evidence/state-compatibility-verification-result.json) passes for 143 frozen source files and 132 evidence artifacts. It reruns both separate checkers and checks the retained failures, test totals and source bindings. Independent review did not run: tool discovery returned `unsupported call: tool_searchtool_search_tool`. This limitation is recorded in `evidence/state-compatibility/validation.json`.

Real SIGKILL/FileStore tests for leaf, workflow and ordinary-composition recovery pass on both native and Linux suites using the new encoding. KV and Durable Object tests use local storage doubles; no live cloud deployment is claimed.

The small compatibility fixture grows from 2,204 to 2,428 bytes: 224 bytes of encoding and requirement metadata. In the final native samples, current-reader legacy upgrade takes 13.483 ms and current-format create/run/flush takes 13.393 ms, excluding module import; reported RSS is 63,852,264 and 61,902,472 bytes respectively. These are single controlled observations, not a matched benchmark or evidence of superior economics.

## Boundaries and release assessment

This closes the specific silent-downgrade/reset behavior for the two tested frozen readers and built-in storage encodings. It does not prove every historic or future fork will refuse, or that an old process which already loaded a snapshot can be revoked by changing its file. An arbitrary same-user writer can still alter or replace local data. The guard is compatibility enforcement, not an independent security boundary; protected effects still require independent authority.

There is no new multi-writer/distributed-lock, chunk-update transaction, power-loss, encryption or exactly-once guarantee. A future implementation must declare new required semantics and use a format older compatible readers reject. Active continuation migration across incompatible inference profiles is intentionally unresolved; refusal preserves evidence rather than guessing an outcome. The native hard-memory containment failure remains open.

Original outcome 5 gains bounded compatibility/refusal evidence; outcomes 4, 7 and 8 gain reuse, regression and upgrade evidence. No original broad acceptance gate is marked complete. Fresh-model unfamiliar holdouts, independent authorship/review, the full headline challenge, matched economic advantage and developer/commercial validation remain unestablished. The adverse saved-script economics are unchanged.

Next priorities:

1. Independently selected unfamiliar software and actual fresh-model reuse, including a combined crash/independent-authority case.
2. A matched acquisition/reuse/change benchmark against the strongest equally protected baseline.
3. Release-compatible optional Actenon packaging and unfamiliar-developer installation trials, followed by demand-led expansion of discovery and recovery profiles.

## Reproduce

Run from the reporting checkout: it contains the product freeze’s unchanged implementation plus the checkers and manifest. The local Git object database must contain the two frozen reader revisions; the experiment stops rather than fetching missing source.

```sh
npm run typecheck
npm test
npm run proof
npm run build
node experiments/living/state-compatibility.ts /absolute/new-state-compatibility-evidence
python3 experiments/living/check-state-compatibility.py /absolute/new-state-compatibility-evidence
```

The experiment refuses an existing output directory, exports the two frozen readers from local Git objects into a disposable directory and removes it afterward. It neither switches branches nor fetches source. It uses Node's native TypeScript support and a mock provider.

For the focused Linux suite, the image below must already exist locally:

```sh
docker run --rm --pull never --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m -v "$PWD:/workspace:ro" -w /workspace \
  sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  node --test test/state-format.test.ts test/store-concurrency.test.ts \
  test/workflow-resume.test.ts test/http-resume.test.ts test/http-resume-process.test.ts \
  test/http-pending.test.ts test/http-continuation.test.ts test/transport-refusal.test.ts \
  test/run-drift.test.ts test/outcomes.test.ts test/fan-out.test.ts \
  test/execution-policy.test.ts test/command-input.test.ts
```

Use the audited Python environment and cached image from [the Actenon README](../../experiments/actenon/README.md) for the protected regression:

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workflow.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-protected-state-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-workflow.py \
  /absolute/new-protected-state-evidence
/absolute/audit-root/.venv/bin/python experiments/living/verify-state-compatibility.py \
  docs/adaptive/evidence/state-compatibility-verification.json
```

The final command reconciles the frozen source, retained tests, compatibility observations and native artifacts without invoking a provider or model. It checks evidence consistency, not independent authorship.
