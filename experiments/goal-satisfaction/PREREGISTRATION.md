# Goal satisfaction: pre-registration

Written and committed **before** any implementation of the goal-satisfaction model, and before RightClick X is run on the holdout environment. Branch `Ross/gallant-mendel-7f183f`, on top of `141c61a`. Not merged into `main`.

## Question

Can RightClick X, without anchors, discover and execute a multi-provider workflow that nobody programmed, and independently establish that the requested outcome was achieved?

## What is already known (dev set; it shaped the design)

From `experiments/life-science/IDENTIFIER-LINKS.md` and an offline re-trace on `lifesci-fanout-2`:

1. **Type compatibility is taken for satisfaction.** With `want: json`, every single lookup is type-compatible. Ranking then uses intent words in step *titles*. A plan that extends a kept plan is dropped when it adds no title word, whether or not its result carries the requested information. That is how `Get UniProt entry by accession → Entry (each)` loses to the one-step record lookup.
2. **The requested information may not even be fetched.** RCSB `entry`'s default GraphQL selection is the first 25 fields of the type. `exptl`, `rcsb_entry_info` and `refine` are never selected, so no entry-level resolution exists anywhere in the graph. The only "resolution" fields are EM-only (`em_diffraction_shell.high_resolution`).
3. **Information inside arrays of objects is invisible.** OpenAPI outputs stop at arrays (Proteins `gnCoordinate[].genomicLocation.chromosome` is not a port). Identifier evidence ignores values two array levels deep (UniProt `results[].uniProtKBCrossReferences[]`).
4. **Q04/Q05 have no list to fan out from.** RCSB's default `entry` response carries no polymer-entity UniProt ids.

## Model to build (summary; the design note follows the implementation)

- The caller may state **required output information** (`require`: terms such as `"resolution"`). It is part of the goal, like `intent`. It never names a capability or provider.
- A plan is judged on what its **result** carries (the fields its contract declares under the result path), and on how each of its joins is supported:
  - **caller**: the caller's own value;
  - **evidence**: a learned identifier scheme;
  - **declared**: a specific declared type;
  - **generic**: `text`/`json`/`number` plumbing.
- Statuses:
  - **established**: all required information is present in the result's fields, and there is no generic join;
  - **unverified**: the information is there, but a join is generic;
  - **incomplete**: required information is missing.
- Plan length and fan-out earn nothing by themselves.
- When nothing is established, `compose` returns an explicit `unavailable` outcome and runs nothing. After a run, the output is checked for every required term.
- Supporting general mechanisms: contract-declared nested fields; goal-directed projection of declared-but-unselected GraphQL fields; identifier evidence up to two array levels.
- Unchanged: fan-out bounds, egress policy, confirmations, verification predicates and receipts.

## Environments (frozen)

- **Dev.** The six life-science sources of `experiments/life-science/phase-a.ts`. On each build the state is built by `phase-a.ts` (learn plus the 5 pre-registered smokes), then `links.ts` (replay of the 77 Phase B `context_run` calls). Tasks run on the resulting `links-replay/state.json`.
- **Holdout.** Software supply chain, unrelated to biology and not used for any implementation decision:
  - **HA**: ecosyste.ms advisories, contract `https://advisories.ecosyste.ms/docs/api/v1/openapi.yaml`;
  - **HB**: OSV, contract `https://raw.githubusercontent.com/google/osv.dev/master/docs/osv_service_v1.swagger.json`.

  Before this commit the only contact was fetching both contracts and reading HA's operation list, to choose the task. RightClick X has not been run on them.

Every process uses `polite-fetch.ts`: read-only, at most 1 request per second per host, every request logged.

## Builds

- **Baseline:** tag `lifesci-fanout-2` (`1143e3d`).
- **Candidate:** the first freeze tag `lifesci-satisfy-1`. Any later general fix gets a new tag (`-2`, …) and the **complete** evaluation is repeated. Earlier runs are kept.

Both builds receive identical calls. The baseline ignores `require`.

## Tasks

All tasks are run by `context_compose` with `run: true`, `limit: 25` and `maxSteps: 3`. There are no anchors, no `through` and no capability names.

| id | have | want | intent | require |
|---|---|---|---|---|
| Q03 | `{accession: "P41159"}` | json | protein structure entries resolution | `["resolution"]` |
| Q04 | `{entry_id: "4HHB"}` | json | gene name | `["gene name"]` |
| Q05 | `{entry_id: "6M0J"}` | json | organism scientific name | `["organism scientific name"]` |
| Q07 | `{accession: "P68871"}` | json | ontology term parents | `["label"]` |
| Q08 | `{accession: "P38398"}` | json | genomic coordinates | `["chromosome", "ensembl gene"]` |
| Q08g | `{gene: "BRCA1", taxid: "9606"}` | json | genomic coordinates | `["chromosome", "ensembl gene"]` |
| H1 (holdout) | `{purl: "pkg:npm/lodash@4.17.20"}` | json | vulnerability summary | `["summary"]` |

**Negative controls:** a correct result is an explicit `unavailable`/`incomplete` outcome with nothing presented as established.

| id | environment | have | intent | require | why no answer should exist |
|---|---|---|---|---|---|
| N1 | holdout, learn only, **no evidence runs** | as H1 | as H1 | `["summary"]` | without evidence, nothing links advisory identifiers to OSV ids except generic plumbing |
| N2 | dev | `{accession: "P41159"}` | protein melting point | `["melting point"]` | no source carries it |
| N3 | dev | `{comp_id: "MK1"}` | gene name | `["gene name"]` | a chemical component has no gene; any route is a false join |

**Holdout evidence seeding** (the analogue of Phase A smokes), run after N1 and before H1, on inputs different from H1:

- HS1: HA `lookupAdvisories` with `purl: "pkg:npm/minimist@1.2.5"`.
- HS2: HB `GET /v1/vulns/{id}` with HS1's identifiers taken in output order (first advisory first). It tries at most 3 identifiers and stops at the first completed call.

Capabilities are located by invoked path, as `phase-a.ts` does.

## Independent ground truth

The harness queries the databases directly with plain fetch, never through RightClick X:

- Q03, Q04, Q05, Q07, Q08: the `truth()` functions of `experiments/life-science/questions.ts`. Q08g uses Q08's truth.
- H1:
  - **truth**: HA lookup for the purl, then HB `GET /v1/vulns/{id}` for every identifier of every advisory; 404s are recorded;
  - **witness**: HB `POST /v1/query` with `{package: {name: "lodash", ecosystem: "npm"}, version: "4.17.20"}`, whose vulnerability ids should include the OSV ids found.

## Scoring an executed output (pre-registered, applied mechanically)

| Task | Pass when |
|---|---|
| Q03 | Every truth entry with a resolution appears in the output as an object whose `rcsb_id` equals the entry id, with a numeric value under a key containing `resolution` that is within 0.01 of truth. No `rcsb_id` outside UniProt's PDB cross-references appears. The lowest such value belongs to a truth winner. |
| Q04 | Every truth accession and every truth gene name appears as a string value in the output. |
| Q05 | Every truth accession and organism name appears as a string value. |
| Q07 | The truth GO id and every parent label appear as string values. |
| Q08, Q08g | The truth chromosome and Ensembl gene id appear as string values. |
| H1 | Three checks. **Coverage:** every truth advisory that has at least one OSV-resolvable identifier is represented by an output record whose `id` or `aliases` contains one of its identifiers. **Exactness:** every output record's `summary` equals HB truth for its `id`. **No unrelated record:** every output record's `id`/`aliases` intersect some truth advisory's identifiers. |

An `unavailable`/`incomplete` outcome fails a positive task. It passes a negative control only if no plan in the ranking was marked established, and nothing ran on a generic join.

## Success criteria (as given; operationalised)

- **A.** On the candidate, at least one of Q03/Q04/Q05/Q07 has an established, multi-provider, unanchored top-ranked plan. These four were not meaningful on `lifesci-fanout-2`.
- **B.** That plan's execution passes its scorer against independent truth.
- **C.** H1 passes on the candidate: established top plan, executed, scored pass.
- **D.** Q08 (and Q08g): the candidate's executed plan has no generic join and scores pass. No Q08 plan with a generic join is marked established.
- **E.** N1–N3 pass. No plan anywhere in any recorded ranking is marked established with a generic join. Every executed join is listed for audit.
- **F.** No fan-out executes more items than its declared `max`, checked from execution traces and the network log.
- **G.** The full suite passes, with new regression and mutation tests.
- **H.** `tsc` passes.

Criteria are not changed after execution. Failures are reported as failures.

## Recorded evidence

Per build and task:

- the full ranking with each plan's status, joins, covered and missing terms, and rejection reasons;
- the outcome;
- execution traces (runs, `fanOuts`, attempts);
- the output;
- truth and the score;
- time and requests per host.

Files: `experiments/goal-satisfaction/evidence/`.
