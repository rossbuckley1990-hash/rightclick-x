# GraphQL discovery, request validity and outcome errors

Starting source: `990ea9f321dec2f5716386db729efc3d7f8ee9b6`. Initial implementation freeze: `02ae9a500c864ee28043dce7bced991dc381fe02`. Response-envelope correction: `7848c3c158421c5070e18b69b2be761f0fe6cfa9`. Final engineering source: **`d1f21d0116b75710784078ecc39b4e42043996ff`**, on the existing `programme/adaptive-capability-plane` branch. This continues the original programme; the branch, previous evidence and acceptance thresholds are preserved.

The [matched reuse comparison](REUSE-COMPARISON.md) exposed a request for a field on the wrong GraphQL type. The runtime sent it, misclassified its failure as possible drift, probed the endpoint again and downloaded the same 648,326-byte schema. Its provider reliability ledger also counted the caller's mistake as a provider failure. Separate controlled tests reproduced acceptance of partial GraphQL errors as successful results. The [experiment plan](GRAPHQL-CONTRACT-PLAN.md) specifies the invariant and comparison before implementation.

## General changes

The existing GraphQL reflector now retains a compact selection schema once per provider. Validation checks the existing bounded selection vocabulary against the exact endpoint, root, returned type, fields, leaf/object structure and required nested arguments. Known contradictory selections fail before dispatch, do not penalise provider reliability and do not trigger repair, substitute plans or publication. Missing or truncated evidence remains unknown. Explicit contract relearning still permits newly advertised fields. This is structural evidence; it establishes neither semantic identity nor authority.

The runtime now preserves typed `graphqlFailure` evidence through direct execution, composed plans, fan-out, saved goals, retained workflows, published REST/GraphQL results and outcome witnesses. Partial or null `data` accompanied by execution errors cannot satisfy verification predicates or initiate automatic replay. Malformed error envelopes and success envelopes missing the requested root also fail. Data-free request errors on a locally supported request retain the existing bounded drift investigation, including the existing restrictions on retrying possible effects. A failure after earlier steps is not evidence that those steps had no effect.

Fields with provider defaults are usable even when their declared argument type is non-null. Omitted root arguments are left absent on the wire, allowing provider defaults; supplied arguments are still typed variables, and truly required missing inputs still refuse locally. No generated arbitrary code is involved.

A public-service failure then exposed a second generic gap: depth-limited global introspection could truncate list-wrapper references before naming their element type. Discovery now requests missing references through shallower, targeted introspection at the same authorised endpoint. It matches observed type, field and argument names, preserves every known wrapper/name prefix, and accepts only complete compatible references. It issues at most two additional requests, up to sixteen observed types per request, prioritising query/mutation roots. Unresolved root signatures are omitted from executable capabilities and recorded as `graphqlIncomplete` provider metadata. Conflicting evidence is never used to guess a type.

These changes use the existing discovery path, graph, runtime and evidence interfaces: **242 added / 30 removed source lines across six files**, no production dependency, provider-specific branch or new tool. The compact thirteen-tool interface remains intact. GraphQL result failure metadata is additive. Actenon cryptography, grants and execution boundaries are unchanged; the [pinned feasibility assessment](../north-star/evidence/ACTENON-INTEGRATION-FEASIBILITY.md) remains authoritative. Discovery and local validation grant no execution authority.

The protocol basis is the GraphQL specification's [scoped field selection](https://spec.graphql.org/September2025/#sec-Field-Selections), [leaf selection](https://spec.graphql.org/September2025/#sec-Leaf-Field-Selections) and [request/execution error](https://spec.graphql.org/September2025/#sec-Errors) rules. These rules support the structural checks, not business correctness or containment.

## Frozen comparison and public evidence

Each comparison uses immutable Git archives, the actual retained public schema, original model requests and original provider responses. Three fresh-process pairs run in baseline/candidate, candidate/baseline, baseline/candidate order. Fetch is an offline fixture observer. The initial reproduction and all three six-replay batches remain retained: **19 replays**, including superseded freezes. There were no new model calls. Timing measures local replay work, not live network latency or total agent economics.

| Final frozen comparison | Starting source | Final source |
|---|---:|---:|
| Invalid-request milliseconds, three fresh processes | 123.658 / 122.391 / 131.758 | 4.279 / 4.470 / 5.998 |
| Median milliseconds | 123.658 | 4.470 |
| Provider calls per invalid request | 3 | 0 |
| Response bytes per invalid request | 648,866 | 0 |
| Invalid calls after retained-state restart | 3 | 0 |
| Corrected request | completed, 1 call | completed, 1 call |
| Graph capabilities before / after | 49 / 49 | 49 / 49 |
| Serialised learned-state bytes | 1,950,946 | 2,063,266 |

The corrected output equals the actual retained server response in every replay. The shared selection schema adds 112,000 bytes; total retained state grows 112,320 bytes (5.76%). Graph growth is zero. The earlier comparisons also pass their accounting checks but precede the final discovery fix. This removes a specific reliability and integration-maintenance cost; it does not reverse the prior adverse strong coding-agent comparison or establish a commercial economic win. Peak memory and advertisement-to-usability latency were not measured in this slice.

The bounded external check uses the public [Countries GraphQL service](https://github.com/trevorblades/countries). Only its endpoint and read-only transport policy are supplied; the harness chooses an optional-input query alphabetically and derives two selectable fields from learned metadata. No operation-specific runtime code or manual schema is supplied.

1. The first trial fails after three requests. Deeper introspection receives HTTP 413; the shallow response truncates return types, so no eligible executable query appears. Raw responses remain in `evidence/graphql-contract/public/`.
2. After the generic fix, targeted introspection succeeds, but the harness incorrectly excludes list-wrapped scalar fields. That four-request failed trial and its exact reconstructed harness are retained in `public-attempt2/` and `public-attempt2-harness.txt`. Correcting that field filter requires no additional product change.
3. The final trial passes with seven requests and 23,657 response bytes: four discovery reads, one execution, one fresh-runtime execution and one direct invalid-document server control. The runtime discovers `continents`, obtains seven `code`/`name` rows, refuses an undeclared field with **zero dispatch**, and repeats the valid query with **zero rediscovery**. The independently implemented server rejects the same invalid document. All three trials total **14 requests / 63,243 response bytes**.

The final public result remains explicitly **unverified** for business correctness. A separate checker compares runtime outputs against recorded server responses, not another business source. This is a fresh runtime instance with retained state, not a new AI model or process. The public target became development evidence when its first failure was investigated; it is excluded from sealed holdouts. No protected writes, credentials or paid infrastructure were used.

## Regression and reproducibility

Final validation on `d1f21d0` passes **501 native tests, 94 focused Linux tests and 28 proof checks**, with zero final failures, cancellations or skips. Product typecheck, strict replay/live-harness typecheck and all four builds pass. The controlled proof still covers complete multi-provider discovery, composition, independent synthetic outcome checking, saved reuse and protocol drift. Its fixtures and checker are authored within this programme; they are not independent-author holdouts.

The new tests cover unrelated controlled schemas, nested objects, lists, interfaces/unions, aliases, defaults, required arguments, endpoint-scoped and missing evidence, mutation partial errors, malformed responses, fresh-state reuse, generated interfaces, witness failures, real drift and bounded type-reference completion. Earlier validation at `7848c3c` passed 496 native / 89 Linux / 28 proof; it is not substituted for the final run.

All development failures are retained. The corrected starting regression has four failing expectations. Later tests expose one defaulted nested-field omission, one omitted-root-default error, one malformed-response false success and three incomplete-reference failures. The initial composed fixture lacked its supplied selection; a corrected fixture reproduces the intended failures. An alias-matching mock also produced a test failure and was corrected. The standalone harness typecheck was first invoked without the project's strict mode and produced narrowing/type errors; the corrected strict invocation passes without source changes. Logs distinguish these harness mistakes from product defects.

The [manifest](evidence/graphql-contract-manifest.json) binds sources, tests, harnesses, reports and evidence by SHA-256. The [audit](evidence/graphql-contract-audit.json) checks immutable source hashes, original requests/responses, graph size, traffic, provider-ledger treatment, byte counts, process records, failed-trial retention and final regression/proof totals. Four checker tests include sixteen altered-result controls and two extra-unaccounted-trial controls. The checker is a separate Python implementation by the same author; independent-author review remains open. Hashes cannot establish truthful authorship of an entirely fabricated evidence set.

## North-star coverage and limits

| Requirement | Contribution and remaining scope |
|---|---|
| Environment-native discovery | Existing discovery now completes depth-truncated GraphQL signatures. This check starts from an authorised endpoint; no new advertisement protocol or unrestricted scanning. |
| Executable semantics and outcomes | Contract-scoped selection, defaults and response-error handling improve genuine executability. Structural validity and server agreement do not prove arbitrary semantic compatibility or business success. |
| Independent authority | Existing policy/Actenon boundaries remain unchanged. No new protected-route or whole-host containment claim. |
| Reusable capability knowledge | Selection evidence survives state reload; public warm execution needs no discovery. No new cross-vendor model result. |
| Adaptation | Explicit relearning admits new fields; locally valid data-free drift still uses existing repair. Incompatible references and execution errors fail honestly. |
| Superior economics | Removes three calls and 648,866 response bytes for the retained invalid request. Broad agent-time/token and maintenance superiority remain unestablished. |
| Regression, security and holdouts | Full regression, Linux and controlled proof pass; negative controls and real failure retention improve evidence. Independent-author sealed evaluation remains open. |
| Simple developer experience | Same compact interface, more accurate failure reasons, no new dependency. Clean-machine and unfamiliar-human installation gates remain open. |

Selection validation deliberately supports the existing bounded subtree language, not all GraphQL syntax: no arguments, directives or fragments inside custom selections; no complete variable/input coercion or merged-subtree conflict analysis. The schema index is omitted beyond 4,096 types or 65,536 fields; absent evidence remains unknown. Targeted completion has fixed request/type/depth bounds and may leave complex or inaccessible signatures unavailable. It does not discover subscriptions or hidden software. Older readers may ignore additive selection metadata; universal historical-reader safety is not established by this change.

Release remains **NO-GO**. The demonstrated native Darwin short-allocation hard-memory escape is still unresolved. Passing current tests does not close it. Independent-author review/holdouts, qualifying four-arm economics, cross-vendor transfer, full deployed authority coverage, clean-machine/human trials and commercial gates remain unmet. The original [acceptance matrix](ACCEPTANCE-MATRIX.md), [living plan](LIVING-CAPABILITY-PLAN.md) and [release assessment](RELEASE-READINESS.md) retain their criteria.

Next three changes: (1) expose retained result shape and publication status clearly enough to reduce fresh-agent reconstruction; (2) investigate the native hard-memory boundary without treating sampled RSS enforcement as a hard guarantee; (3) freeze a corrected end-to-end system for independently selected four-arm unfamiliar and maintenance evaluation, retaining all acquisition and change costs.

## Reproduce

Use the final engineering source and its existing dependencies. The evidence-only commit containing this report can also be used; its product source is identical to `d1f21d0`.

```sh
node --test test/graphql-contract.test.ts test/graphql-type-references.test.ts test/graphql-projection-join.test.ts
npm run check
npm run build
npm run proof
python3 -B experiments/living/check-graphql-contract.py docs/adaptive/evidence/graphql-contract/paired-complete
python3 -B experiments/living/check-graphql-contract.py docs/adaptive/evidence/graphql-contract/public-attempt3 public
python3 -B experiments/living/test-graphql-contract-checker.py
python3 -B experiments/living/verify-graphql-contract.py docs/adaptive/evidence/graphql-contract-manifest.json
python3 -B experiments/living/compare-graphql-contract.py \
  990ea9f321dec2f5716386db729efc3d7f8ee9b6 \
  d1f21d0116b75710784078ecc39b4e42043996ff \
  /tmp/rcx-new-graphql-pairs
```

Replay output directories must not exist; the runner archives source without switching branches and makes no external/model calls. Native regression and proof need ordinary local loopback/sandbox access. `proof` writes its customary `proof/results/latest.json`; this increment's artifacts are preserved separately. Linux validation uses the cached Node 24 image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`, no network, a read-only checkout, unprivileged user, dropped capabilities, no-new-privileges, two CPUs and 512 MiB memory/tmpfs limits. Its 94-test list is the GraphQL contract/type-reference/document-boundary/projection-join, run-drift, transport-refusal, missing-data, goal-satisfaction, state-format, planning-refusal and runtime files.

An optional new public read-only trial is `node experiments/living/live-graphql-contract.ts /tmp/rcx-new-graphql-public`; it contacts the documented public endpoint, enforces eight requests and response limits, refuses credentials and never overwrites previous evidence. Future service changes may produce a preserved failure. Prior manifests remain frozen at their historical revisions because living reports and source continue to advance. Nothing was pushed, merged, published or purchased.
