# Public multi-provider capability: development evidence

**PARTIAL; not the final Living Challenge or a commercial win.** Generic GraphQL discovery and OpenAPI reflection now create a reusable structure-to-primary-publication workflow. Separate public readbacks agree for the corrected first input and a different-input fresh-process invocation. The intermediate wrong answer remains preserved.

The unchanged initial task configuration names RCSB GraphQL and Crossref's OpenAPI document, supplies structure `1CRN`, and asks for its primary citation DOI, title and publisher. It supplies no operation IDs, hardcoded DOI, output mappings or provider-specific reflector. These are exposed development targets; RCSB was used in earlier science work. They are not independently selected holdouts.

| Attempt | Product source | Runtime result | Separate outcome result |
|---|---|---|---|
| 1 | `6177681` | Required result absent; no retained capability | Failure preserved |
| 2 | `f6fab0b` | Two providers execute; presence predicates pass; capability retained as **checked** | **FAIL**: dataset DOI `10.2210/pdb1crn/pdb` instead of the primary paper |
| 3 | `bfdfe03` | Two providers execute; capability retained as **checked** | **PASS**: `10.1073/pnas.81.19.6014`, exact title and publisher match |
| Fresh-process reuse | `3fa530b`, retained attempt-3 state | New input `4HHB`; two producing-provider requests, no introspection or contract fetch | **PASS**: `10.1016/0022-2836(84)90472-8`, exact title and publisher match |

The wrong attempt is a substantive semantic failure. Passing presence predicates did not establish the requested primary-publication identity. The product did not call it independently verified; that distinction does not make the wrong answer acceptable.

## General changes and their limits

GraphQL declared fields now retain scalar semantic types. Up to 64 additional identifier leaves can become candidate joins without changing the default query. Scalar leaves are considered before list fanouts so earlier list relationships do not exhaust this bound. Qualified DOI names infer the DOI scheme without matching incidental substrings or overriding numeric/URI types.

When a plan uses an unselected declared field, execution projects it and retains the actual projected steps. Required output information survives both saved-goal and static-composite reuse; missing required output refuses execution/publication. This fixes the previous loss of projections and requirements across reuse. Inference version is 27; knowledge format remains 2 and the public thirteen-tool interface is unchanged.

The corrected first public plan chose `pubmed.rcsb_pubmed_doi`. The separate oracle confirms its value for these two inputs; lexical/scalar preference is still not a general proof that an identifier is the intended resource. No application-specific source branch was added. Bounds can omit fields, nested list cases remain limited, and old goals cannot recover requirements that were never saved.

Seven focused regressions cover scalar/list joins, direct final-field projection, argument-requiring field exclusion, suffix negatives, retained requirements and bounded scalar coverage. Baseline failures, an initial fixture syntax error, intermediate reuse failures and a TypeScript test correction are retained. The final focused combined set passed **16/16**. The `bfdfe03` full suite was **314/315**, with the unchanged memory-bound failure; the later environment candidate passed **351/351** without resolving that reproduced escape.

## Evidence and measurements

The [generic driver](../../experiments/living/public-discovery.ts) restricts requests to two origins, GET/HEAD or declared GraphQL queries, with 24-request and response-count budgets and per-origin spacing. It retains source/configuration provenance, full public responses and hashes, actual calls, state and activity. The response-size accounting happens after a response is read; it is not a streaming total-memory bound.

The [separate Python checker](../../experiments/living/check-public-citation.py) selects expected identity from a fresh RCSB REST record using the caller's structure ID, then reads Crossref using that expected DOI. Candidate answers do not select the oracle URL. It checks one publication, DOI, exact title and publisher. This is a separate implementation/readback by the same author, using the same underlying metadata sources. It is not independent-author review or an organisational attestation.

Fresh-process reuse made **2** execution requests, received **11,339 bytes** and took **21,747 ms** including runtime load, network and persistence. The separate oracle made two additional reads; its time is not included in that number. No model was called, so there is no fresh-agent/model-cost result. There is no matched baseline or economic advantage measured here. The runtime still reports **checked**; external readback evidence has not been integrated as a live dashboard witness.

Raw evidence, including failures: [living-public](evidence/living-public/). The latest [engineering verification manifest](evidence/environment-discovery-verification.json) covers these artifacts alongside the environment implementation.

Reproduce against the live read-only providers, with new output directories:

```sh
node experiments/living/public-discovery.ts experiments/living/public-citation.json NEW_DISCOVERY_DIRECTORY
python3 experiments/living/check-public-citation.py NEW_DISCOVERY_DIRECTORY NEW_ORACLE_DIRECTORY
node experiments/living/public-discovery.ts experiments/living/public-citation-reuse.json NEW_REUSE_DIRECTORY NEW_DISCOVERY_DIRECTORY/state.json
python3 experiments/living/check-public-citation.py NEW_REUSE_DIRECTORY NEW_REUSE_ORACLE_DIRECTORY
```

Provider changes or outages may alter the result. Preserve failures. Live cross-vendor reuse, sealed new software, misleading-identity controls beyond these exposed cases, integrated authority/evidence UI, the complete seven-act challenge and fair economic comparison remain required.
