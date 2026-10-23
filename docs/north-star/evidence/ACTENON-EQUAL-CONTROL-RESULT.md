# Equal-control comparison: correct reuse, additional RightClick overhead

**Result: the saved script is faster in this bounded runtime measurement. No commercial advantage is established.** Full mission PARTIAL; release NO-GO. The [preregistered design](ACTENON-EQUAL-CONTROL-PLAN.md) and source freeze `5500f25` precede the run. No thresholds, samples or failed results were removed after seeing the outcome.

Both arms produced **42/42 correct effects** in total, passed every independent journal observation and refused all six duplicate/out-of-bounds/revoked-grant controls without another effect. All **40 warm operations** reused their contracts with zero contract fetches, in fresh contained processes. Both arms used the same grant, protected resource, native proof/replay/effect-claim/settlement path, container restrictions and independent observer. The baseline had no unprotected shortcut.

| Warm measurement, 20 samples per arm | C: saved script | D: RightClick | D/C |
|---|---:|---:|---:|
| Client median | 19.67 ms | 26.80 ms | 1.36× |
| Client p95 | 21.74 ms | 30.05 ms | — |
| Full container-lifecycle median | 202.48 ms | 225.76 ms | 1.11× |
| Full container-lifecycle p95 | 225.32 ms | 232.45 ms | — |
| Broker median, summed per warm operation | 6.55 ms | 6.78 ms | — |
| Serialized retained state, median | 97 bytes | 21,928 bytes | — |
| Built client | 3,738 bytes | 310,179 bytes | — |

RightClick adds roughly **7.13 ms** median client time and **23.28 ms** median full container lifecycle in this run. These are observations on the recorded machine/image, not production latency promises. State sizes have different contents: RightClick retains its graph, experience and local receipt history, while the script retains only the two resolved URLs and input name. Both have the same externally retained signed resource receipts and observer records. These byte counts are not model-context size, token cost or authored lifecycle effort.

The single cold call per arm measured 38.77 ms client / 383.37 ms container for C and 36.37 ms / 268.74 ms for D. C ran first against a cold shared service; one sample per arm cannot establish an acquisition advantage. Pair order for the remaining 20 pairs was randomized with fixed seed 472901 before execution. No timing significance, agent economics or competitive gate is claimed.

## What ran and what was checked

The baseline is separately built JavaScript using standard HTTP, JSON and SHA-256. It derives the sole write and observer endpoints from the same public OpenAPI documents on cold use, then saves the resolved contract. RightClick learns through its existing OpenAPI reflector and retains ordinary capability state. Each warm client process receives its own saved state and a new equal-length input. Both execute the write, hash the returned label and call the separately running read-only observer. The task wrapper supplies that verification obligation in both arms; this does not measure autonomous model selection or inheritance of a published verified goal.

The clients share only a credential-free IPC transport and use separate bundles. Every container is network-disabled, read-only, unprivileged uid 10000, capability-dropped and given only its own read-only client mount. Native Actenon code remains outside those containers; the unchanged resource-owned service is the only business-effect writer. The operator's label set is fixed independently of discovery. Read access is restricted to public contracts and exact observer queries. Revocation is checked with still-in-bounds labels, so those refusals cannot be mistaken for an out-of-bounds control.

The issuer and resource processes remain trusted processes on the same host/user, as in the earlier fixture. They are not demonstrated isolated from a compromised host or from each other. This comparison establishes equivalent controls for its two contained clients, not arbitrary-environment containment.

The [raw artifact set](actenon/equal-control-attempt1/result.json) includes all 48 process transcripts and container configurations, actual broker requests/timings, measurements, grants/transitions, provider journal, observer records, native proofs/receipts and source/image provenance. A [separate checker](../../../experiments/actenon/check-reuse-comparison.py), importing no experiment or RightClick implementation, checks:

- all 42 exact labels, digests, unique effects and warm zero-discovery paths;
- native proof signatures and action-hash binding, each COMMITTED receipt's exact journal-prefix hash and durable native store state;
- all 42 signed receipt bindings and rejection of 42 altered signed artifacts;
- matching client/host request records, exact reasons for six refusals and the same container restrictions;
- raw-sample median/p95 calculations and reported ratios.

Additional negative controls reject an unsigned receipt alteration and an invented timing advantage. The first positive checker output is retained alongside the strengthened binding check. This is separate-process and separate-implementation verification by the same author, not independent-author review or certification. [Verification and artifact hashes](actenon/equal-control-verification.json) bind the recorded results.

The first TypeScript check failed because a temporary config outside the repository could not locate Node's type definitions. The failed log is retained; setting its explicit type-root path made all three clients typecheck without source changes. The end-to-end measured experiment passed on its first execution. Product, entrypoint and existing regression-test source are unchanged from the prior 248-test/28-proof checkpoint; those suites were not redundantly rerun for experiment-only files.

## Decision and reproduction

Do not expand the integration on a claim of faster retained execution. This experiment gives no such evidence: the simple saved script retained the same contract and outcome obligations with less runtime overhead. Prioritize independently demonstrated acquisition, safe adaptation or maintenance savings and the real-model comparison. The quota-blocked subscription pilot remains frozen and cannot be replaced by this deterministic measurement. There is no software-change phase, fresh holdout, billing observation, human usability trial or cross-vendor model swap here.

Using the already audited pinned Python environment and cached image:

```sh
npx --no-install tsc -p tsconfig.actenon.json
/absolute/audit-root/.venv/bin/python experiments/actenon/compare-reuse.py --output /absolute/new-comparison-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-reuse-comparison.py /absolute/new-comparison-evidence
```

The output directory must not exist. No image pulls, model calls, production effects, remote Git operations or spending occur. The scripts require the same macOS/private-tmp/Docker development environment as the earlier resource-owned fixture; they are not a released optional integration installer. All original and expanded mission gates remain binding.
