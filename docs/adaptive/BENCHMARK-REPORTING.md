# Benchmark reporting correction

Status: implementation **PASS on synthetic regression cases**; competitive evidence **FAIL/PARTIAL**; release **NO-GO**. This corrects accounting, not product results. The original North Star gates and the stronger Adaptive Capability Plane targets remain unchanged.

The previous report could pass generalisation without second-domain or safety evidence. The reuse pass expression read a nonexistent field. Competitive comparisons could pass with an incomplete lifecycle. A synthetic reproduction of those defects is retained in [reporter-before.json](evidence/reporter-before.json).

The corrected reporter requires the holdout manifest, covers the intended task matrix, pairs by program and step, rejects duplicates, and ranks baselines on common feasible tasks. Quota responses are exclusions, with missing observations still visible. Missing costs never become zero. It refuses to overwrite either source records or any existing report.

The first-versus-reuse significance calculation now pairs one first-use observation with the median of that program's three reuse tasks. The previous calculation duplicated first-use costs and could compare rows from different programs. This is an explicit statistical correction, made before a new freeze; it changes the unit of analysis to avoid pseudo-replication. It does not change the required p<0.05 threshold or the cost/correctness gates.

Actual `investigationsStarted` telemetry is required for zero re-investigation; a tool name alone cannot distinguish real work from an unchanged-program no-op. Historical rows lack that telemetry, so this is unknown. The current experiment runner still needs to collect it before a new benchmark.

A separate observer JSON can supply safety counts. It must have `commit`, `benchmarkSha256`, `domain2Sha256`, `coveredSessions` (all observed candidate rows, named `domain1|D|program|step` or `domain2|D|task`), `wrongLabelledVerified`, and `unauthorisedExecutions`. The reporter checks exact artifact binding and coverage. These fields do not establish the observer's independence or correctness; its raw observations must be audited. No such observer evidence has been manufactured for historical sessions.

Reproduce the historical correction with a new output path:

```sh
node experiments/north-star/report.ts \
  docs/adaptive/evidence/imported-benchmark-ns-freeze-1-raw.json \
  docs/north-star/evidence/holdout-ns-freeze-1.json \
  --domain2 docs/north-star/evidence/domain2-ns-freeze-1.json \
  --out /tmp/rcx-corrected-report.json
node --test test/benchmark-accounting.test.ts test/benchmark-report.test.ts
```

The [corrected report](evidence/historical-corrected-gates-v1.json) retains 167 observed sessions and excludes 89 blocked sessions. On the 20 common feasible tasks, A succeeds on 11, B on 12, C on 12 and D on 3. B is strongest by correctness and then reported cost. Candidate reuse has no observed cost saving against B. All three original gates fail an observed condition, with additional missing evidence. The intended sample is incomplete; this is neither a new holdout nor a statistically sufficient commercial result. Identical inputs also appear in historical feasible tasks, so unseen-input reuse cannot be asserted for all tasks.

The tests contain an explicitly synthetic positive control plus missing-domain, observer-binding, quota, incomplete-lifecycle, duplicate, wrong-answer, repeated-input, re-investigation, order-invariance, missing-cost, unpaired-cost and overwrite controls. Synthetic rows are test data only, never product performance evidence.

Next: preserve this checkpoint; audit the requested Actenon repositories before adding security/proof machinery. Then instrument the measured execution paths and freeze a fair new development pilot before selecting untouched holdouts. No feature work is justified by the corrected report alone.
