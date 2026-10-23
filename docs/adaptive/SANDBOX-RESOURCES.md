# Sandbox resource diagnosis and partial correction

**PARTIAL; hard native memory gate FAIL; release NO-GO.** The observer-loss defect is corrected, but a bounded native allocation still exceeds its configured memory budget and completes. No failed acceptance criterion has been relaxed. The programme remains on `programme/adaptive-capability-plane`.

Product: `997580d7b912086094599dae36e93e369d1035a3`. Original product bytes are retained at `f44df208b0480fbb63d3c62734aa8c9b8649b17c`; that revision also freezes the five observer regressions before the correction. The final platform-aware test revision is `4738a9a09c0d2947c34af3b1d101194e76b3420c`, with identical product bytes. Diagnostic sources were frozen incrementally at `2092f97`, `fefccfe`, `3e6fde2`, `f44df20`, `997580d` and `ae466c4`; the separate Python checker is `b140cd6`. The [source/artifact manifest](evidence/sandbox-memory-verification.json) binds the [evidence](evidence/sandbox-memory/).

## What failed

The earlier complete native regression failure at planner revision `f0bb7d3` remains preserved in [the publication investigation](PUBLICATION-PERFORMANCE.md). Its unchanged C2 test allocated 900 MiB, printed `done`, and failed the memory assertion. Later focused and full passing runs did not explain it.

The new C fixture makes only one bounded allocation, touches its pages, optionally holds it for three seconds, and reports its own kernel peak RSS. The v2 fixture also reads its macOS resident and footprint counters. Maximum allocation is 900 MiB, with no network, file writes or subprocesses. These are exposed development diagnostics, not unfamiliar-software holdouts.

| Observation | Baseline | Candidate |
|---|---|---|
| 16 MiB allocation / 64 MiB budget | Completes | Completes |
| 128 MiB allocation, no hold / 64 MiB budget | Completes above budget; traced run has no resource polls | Still completes above budget; 47 ms traced run, sampled RSS only 4,014,080 bytes, reported peak 135,610,368 bytes |
| 128 MiB allocation, 3 s hold / 64 MiB budget | Memory watchdog stops it | Memory watchdog stops it |
| 900 MiB allocation, 3 s hold / 512 MiB budget | One untraced and one traced run complete above recorded peak budget; another later run is stopped | This run is stopped; does not invalidate the earlier escapes |
| Injected resource observer error | Harmless workload completes without refusal | Availability or workload result is refused |

In the traced baseline 900 MiB run, the kernel peak was 554,614,784 bytes. Thirty-one successful observations saw at most 510,918,656 bytes, below the 536,870,912-byte budget; sampled RSS then fell. The trace contains no observer error. This establishes that sampled current RSS missed an observed peak. It does **not** establish the precise mechanism of the RSS decline or the exact cause of the historical Perl test failure. Resident memory is not an allocation/total-footprint measurement. The newer footprint probe's 900 MiB case was stopped before it could report final counters.

Separately, standard per-process data/address-space limit attempts at 64 MiB failed with `EINVAL` before either the 16 or 128 MiB allocation ran. All four failures are retained. This is not proof that every limit value fails, nor that a per-process rlimit could supply an aggregate descendant boundary. No such workaround was added to production.

## Correction and its limits

The resource observer starts immediately, permits only one in-flight `ps` call, rejects empty/malformed snapshots, and treats observation errors as `limit: "supervision"`. Finalization waits for a pending observation. When supervision is lost, stdout is withheld and the result has a nonzero code, even if the child already exited. The benchmark recorder recognizes this as a complete refused observation, never usable execution. Tests cover all five cases plus recorder interpretation.

This fixes failure handling and overlapping observations. It does not turn sampling into a kernel memory/process boundary or undo effects that happened before failure. The source, capability evidence description and security policy now state that limitation. No grant, credential, cryptographic implementation, inference version, MCP tool, execution route or Actenon dependency was added.

The existing C2 acceptance test is byte-for-byte unchanged. Its name is broader than the single workload it actually tests. Passing it does not supersede the recorded short-allocation escape. Native hard aggregate memory/process containment remains unestablished, and the corresponding security/release gate remains failed.

## Actenon reuse assessment

The existing [Actenon feasibility audit](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md) was revisited before selecting a resource-control direction. At pinned Airlock `f998a100748950e05004d22a403c159f1552d686`, `launch_protected` uses immutable-image, network-disabled, read-only Linux containers with dropped capabilities, no-new-privileges, a process limit, CPU limit and `--memory 1g`. Its supervisor/credential/proof boundaries remain independent of RightClick X. Its implementation and tests refuse unavailable protected execution rather than falling back to cooperative local mode. No native Darwin resource supervisor was established by this audit. [Pinned implementation](https://github.com/Actenon/actenon-airlock/blob/f998a100748950e05004d22a403c159f1552d686/src/actenon_airlock/protected.py), [pinned tests](https://github.com/Actenon/actenon-airlock/blob/f998a100748950e05004d22a403c159f1552d686/tests/test_protected.py).

A separate primitive experiment used the already cached Linux image, no host mount or credentials, a non-root user, no network, read-only root, dropped capabilities and a 64 MiB memory limit. It explicitly set combined memory/swap to the same value. Docker documents that this disables swap; Airlock's inspected fixed arguments do not set that option, so this is **not** a measurement of Airlock's full deployed configuration. [Docker resource-limit documentation](https://docs.docker.com/engine/containers/resource_constraints/).

The container itself read `memory.max=67108864` and `memory.swap.max=0`. The 16 MiB allocation completed with exit 0 and `OOMKilled=false`. The 128 MiB allocation exited 137, `OOMKilled=true`, and produced no completion output. Exact container IDs were removed afterward. Recorded start/wait/inspection/log time was about 0.21–0.30 s, excluding creation and removal; it is not comparable to the native launch measurement or a commercial benchmark.

This demonstrates an available kernel primitive suitable for a bounded Linux execution profile. It is not an Airlock integration test, proof of all bypass coverage, or support for macOS-native binaries. An optional Linux/container profile should reuse existing Actenon boundaries rather than copy its crypto. It must identify the exact executable/image/environment and deny unsupported substitutions; native software must not silently be replaced by a different Linux program. A hard-bound policy cannot safely fall back to the sampled native route. Native platform compatibility, resource/process escape coverage, version-compatible installation and all authority requirements remain open.

## Verification and cost

| Check | Result |
|---|---|
| Frozen five observer regressions on original source | **0/5 pass**, all failures preserved |
| First candidate focused observer/recorder checks | 13/13 pass; typecheck pass |
| Frozen candidate complete `npm test` | **308/308**, zero skips, 35.85 s test-runner duration |
| `npm run typecheck`, `npm run proof`, `npm run build` | Pass; **28/28** proof checks; Node and edge bundles produced |
| First focused Linux run | **33/34**, zero skips; platform-specific test count error preserved |
| Final focused Linux run | **34/34**, zero skips |
| Final native observer/recorder run | **14/14**, zero skips |
| Separate Python evidence consistency checks | 26 pass; three corrupted-record controls rejected; same author, post-hoc, not the required independent final evaluator |

The Linux assertion initially expected exactly one availability probe. Linux checks both installed `/usr/bin/bwrap` and `/bin/bwrap` paths; both correctly refused under observer failure. The assertion now counts installed candidates. The requirement remains that only bounded availability probes run and no workload is dispatched. Product bytes did not change for this correction.

The Linux regression container used the cached image, network disabled, a read-only source mount and privileged mode solely to permit nested bubblewrap. That test configuration is not a proposed agent boundary. The separate memory primitive experiment used an unprivileged container without host mounts. Both require a trusted host/Docker operator; neither establishes containment from that operator.

Three paired samples each ran 30 sequential harmless echo calls per revision, alternating before/after order. Every output was exact. Baseline medians were **9.05, 8.58, 8.87 ms**; candidate medians were **14.06, 14.52, 19.10 ms**. Added paired median time was **5.01–10.24 ms** (1.55–2.15× elapsed time). This is the measured cost of this bounded launch path, including waiting for observation; it is not model economics. The initial three-pair attempt overlapped the Linux suite and is preserved separately, excluded from this isolated comparison. No baseline result or overhead is hidden.

## Reproduction

Use Node >=22.18 and installed development dependencies. The recorded native host was macOS 26.4.1 arm64 / Node 26.12.0. Native confinement and process observation must be available; refusal or skipped tests in another environment is not a pass. Use a fresh output directory. Do not overwrite the recorded artifacts.

```sh
npm test
npm run typecheck
npm run proof
npm run build
clang -O2 -Wall -Wextra experiments/sandbox/memory-probe.c -o /private/tmp/rcx-memory-probe-reproduction
mkdir /private/tmp/rcx-resource-reproduction
RCX_RESOURCE_TRACE=/private/tmp/rcx-resource-reproduction/trace node --import ./experiments/sandbox/trace-resources.mjs experiments/sandbox/probe-memory.ts /private/tmp/rcx-memory-probe-reproduction /private/tmp/rcx-resource-reproduction/probes.json
node --test test/sandbox-observer.test.ts test/north-star-observation.test.ts
python3 experiments/sandbox/check-evidence.py docs/adaptive/evidence/sandbox-memory
```

`measure-invocation.ts SOURCE_ROOT NEW_OUTPUT` measures a frozen revision's sandbox through the same driver. The source SHA is recorded in every sample. `probe-rlimits.ts COMPILED_PROBE NEW_OUTPUT` reproduces the bounded native rlimit feasibility diagnostic. `container-memory.py CACHED_IMAGE_DIGEST NEW_DIRECTORY` runs the two disposable controls without pulling an image. Exact commands, host/compiler metadata, source pins, raw traces, failures, proof JSON and checksums are retained under the evidence directory. Timing-sensitive sampling escapes may vary; a passing rerun cannot refute the preserved failure.

## Next checkpoint

Keep the hard resource gate failed. Evaluate a supported optional Linux execution profile using audited boundaries, with unavailable/unsupported execution refused and no native fallback for a hard-bound requirement. Do not spend the programme on speculative native supervision: continue the original Living Challenge with read-only public providers and isolated protected resources at the next safe checkpoint. Independent evaluator/author, unfamiliar holdouts, fresh-model challenge, one-command demonstration, full economics and human validation remain unmet. The commercial recommendation is still **NO-GO**.
