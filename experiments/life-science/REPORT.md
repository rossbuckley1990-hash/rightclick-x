# Life-science interoperability with no per-database authoring: report

**Question.** Can RightClick X do, with no per-database code, configuration or annotation, what published 2026 systems still do by hand? TogoMCP writes an MIE schema file per database (≈2–4 expert hours) and reviews those files manually when databases change. BioThings Explorer chains only APIs that carry hand-written x-bte annotations.

**Pre-registration:** [`PREREGISTRATION.md`](PREREGISTRATION.md), committed as `ef9e9fd` (2026-10-16 12:12 +01:00) before any RightClick X run against these databases. Deviations are listed at the end.

**Evidence:** [`evidence/`](evidence/):

- `phase-a-*.json`;
- `phase-b-lifesci-freeze-3/` (one file per session, `summary.json`, `rescored.json`);
- `phase-c-lifesci-freeze-3.json`;
- `views-check-lifesci-views-1.json`, `phase-b-views-lifesci-views-1/` (post hoc Q09 follow-up);
- `phase-c-lifesci-rundrift-1.json`, `phase-c-lifesci-rundrift-2.json` (post hoc Phase C re-runs for the `context_run` drift fix);
- `bodies-manifest.json` (SHA-256 of all 113 MB of raw responses, which are kept outside git).

## Summary

| | Result |
|---|---|
| **Onboarding effort** | **0 lines** of per-database code or configuration for 5 databases (UniProtKB, EBI Proteins, RCSB Data GraphQL, RCSB Search, OLS4) plus one exploratory MCP server. Each was given to `context_learn` as its URL only: 216 typed capabilities, each database learned in 0.2–3.1 s with 1–4 requests. |
| **…but only after three general product fixes** | On the frozen build (`lifesci-freeze-1`) UniProt could not be learned at all and every EBI Proteins call returned 404. RCSB method and resolution were unreachable. All three were real-world contract quirks, and all were fixed generally with regression tests (`lifesci-freeze-2`, `-3`). One of the fixes was itself wrong the first time; that failure is preserved too. |
| **AI agents answering 14 multi-hop questions** (strict, as run; primary) | **Claude Code 10/14 (PARTIAL), Codex 12/14 (PASS)**, counting answers that are correct *and* grounded in data RightClick X fetched. Correct alone: 11/14 and 13/14. |
| **after correcting harness defects** (reported alongside, not instead) | Claude Code 12/14, Codex 13/14: both PASS. One transient OLS 404 in the truth harness, and a grounding check that wrongly tested the string "646-668". |
| **Negative control** (non-existent gene) | Both answered **NONE** after actually querying UniProt. No fabrication. |
| **Large cross-database counts** (the TogoMCP truncation risk) | Both reported exact totals: 311 UniProt PDB cross-references vs 323 RCSB-mapped entries for p53. The two databases genuinely disagree (see *Findings*). |
| **Drift: a breaking change RCSB really made** (2022 v1 → today's v2; v1 now 404) | The drift report exactly matched the true contract diff (7 operations modified), in 0.7 s, with no human step. **Self-healing on first use:** the stale 2022 capability failed, RightClick X re-learned, re-planned to v2 and returned the correct 10 entries in 1.7 s. |
| **Drift: a silent identity shift OLS really made** (June → October 2026) | The drift report exactly matched the true diff (+3 added, ~4 modified). Both operation ids that now name a *different* operation were flagged as modified. **But** a direct call on such an id runs the new operation and returns an empty, successful result. |
| **Typed automatic chaining across databases** | Essentially none, as predicted. The same UniProt accession is typed three ways by three providers. Agents chained hop by hop with `context_run`; `context_compose` was used in 1 of 28 sessions. |

**Bottom line.** For these five databases RightClick X removed the per-database schema-authoring step entirely. It replaced the manual drift review with an automatic, exact diff, plus self-repair on use in the `context_compose` path. With it, two different AI agents answered 22–25 of 28 multi-hop questions correctly from live data (22 strict, 25 after correcting harness defects). It did **not** remove the need for cross-database identifier knowledge. Like TogoMCP's two-stage workflow, the agent supplies that knowledge by bridging hops itself. BTE's x-bte annotations exist to provide exactly that knowledge. Not every capability self-heals: the healing path covers compose/goals, not plain `context_run`. (That was true of the build the experiment ran on. A post hoc fix was checked against the same two real changes: see *Follow-up: drift for plain `context_run`*.)

## Build

| Tag | Commit | What |
|---|---|---|
| `lifesci-freeze-1` | `c3a902e` | HEAD at freeze. GPT 6 Astra's work (money quantities, outcome witnesses, `goal:<slug>`, `proof/`) was uncommitted when this session started, and was committed by another session (`6d6956c`, merge `c3a902e`) before the freeze. This session did not change it. 83/83 tests, `tsc` clean. |
| `lifesci-freeze-2` | `fbf88bb` | + three general fixes from Phase A (below). 86/86 tests. |
| `lifesci-freeze-3` | `ea2f6dc` | `-2` + a correction of one of those fixes. 86/86 tests, `tsc` clean. **Phase B and C ran on this build.** It is a tagged commit built from `-2` alone, so it does *not* contain another session's concurrent product commit `8df49c1` (example-value typing, fixed goal inputs). `main` contains both (`d700741`). |

| `lifesci-rundrift-1` | `43aa681` | Post hoc. `main` + plain-`context_run` repair, refusal of shifted ids, anchors pinned to operations. 116/116 tests. **Phase C re-run: C1-b and C1-d FAIL** (see *Follow-up*). |
| `lifesci-rundrift-2` | `968637a` | Post hoc. `-1` + the operation-identity correction. 116/116 tests, `tsc` clean. |

Every run executed a `git archive` export of the tag, never the shared working tree. Another session edited `src/` in the same checkout during this experiment; that did not affect these runs.

## Rules of conduct (as run)

- **1 request/s per host.** Enforced by the harness-side `polite-fetch.ts`, preloaded with `node --import` into every RightClick X process and into the truth harness. Measured over all runs: the minimum gap between request starts to the same host within one process was 973–1000 ms. Start times are estimated from the log, so the estimate is only good to tens of ms.
- **Read-only.** PUT/PATCH/DELETE refused: 0 attempted.
- **No credentials, no spending** beyond the existing Claude Code/Codex subscriptions. Claude Code reported $5.64 of usage-equivalent cost for the 14 Phase B sessions.
- **Hosts contacted:**
  - Phase B agents' RightClick X processes: rest.uniprot.org 52, www.ebi.ac.uk 26, data.rcsb.org 17, search.rcsb.org 6, registry.modelcontextprotocol.io 27, api.apis.guru 8, gateway.pipeworx.io 3. The last three came from agents calling `context_research` (survey only; nothing was learned from it).

## Phase A — onboarding by `context_learn` only

| Source | freeze-1 | freeze-2 | freeze-3 | Capabilities (read-only) |
|---|---|---|---|---|
| S1 UniProtKB REST | **FAILED**: no contract found (HTTP 500) | learned, smoke OK | learned, smoke OK | 3 (3) |
| S2 EBI Proteins API | learned, **every call 404** | learned, **still 404** (fix too strict) | learned, smoke OK | 65 (64) |
| S3 RCSB Data GraphQL | learned; method/resolution **unreachable** | reachable via `selection` | reachable (supplement) | 29 (29) |
| S4 RCSB Search | learned, smoke OK | same | same | 7 (6) |
| S5 OLS4 | learned, smoke OK | same | same | 112 (101) |
| S6 pipeworx "pdbe" MCP (exploratory) | learned without credentials | same | same | 44 (39) |

**The failures, each from a real contract, and the general fixes** (`fbf88bb`, `ea2f6dc`; tests in `test/contracts.test.ts`, which fail on `-1`/`-2` and pass on `-3`):

1. **Content negotiation (unpredicted).** UniProt REST answers **HTTP 500 to any request whose Accept header lists `text/html`**, even at lower priority. That covers the contract URL and every data endpoint. RightClick X sends `application/json, text/html;q=0.9, */*;q=0.5`. **Fix:** for GET/HEAD only, a 406 or 5xx in answer to a multi-type Accept is retried once with the first listed type. Writes are never retried.
2. **Unstated OpenAPI base (predicted, P1).** The EBI Proteins contract has no `servers`. Per OpenAPI 3 that means the origin, but the API lives under `/proteins/api/`. **Fix:** when `servers` is absent and the contract lives below a path, probe up to two parameterless JSON GET operations at the origin first, then at the contract's directory, and record the outcome on the provider.
   - **First version wrong:** it required a 2xx. The Proteins search operations, though declared parameterless, answer **400** with a JSON error naming a missing filter, so the probe fell back to the origin.
   - **Corrected:** a routed JSON answer that is neither 404 nor 5xx identifies the base. The freeze-2 failure is preserved in `phase-a-lifesci-freeze-2.json`.
3. **Silent GraphQL selection cap (predicted, P2).** The reflector selects ≤25 fields per type and ≤8 subfields per object. RCSB `CoreEntry` has 101 fields; `exptl` and `rcsb_entry_info` (method and resolution) fell beyond the cap, silently. **Fix:** the default selection stays bounded but every GraphQL capability gains an optional `selection` input.
   - Its description lists the omitted fields with their subfields.
   - A caller-supplied selection set replaces the default, and is validated: no arguments, variables or operations.
   - **Residual limit:** the list is clipped at 3,000 characters and says so. For `CoreEntry` it names `exptl` but not `rcsb_entry_info`. Agents found `rcsb_entry_info` anyway, from the schema or the GraphQL convention.
   - Agents used `selection` in 7 of 28 Phase B sessions: every RCSB entry question (Q03–Q05 for both clients, plus Codex's Q10).

**Typed links (predicted, P3: confirmed).**

- About 300,000 cross-provider edges exist, but nearly all are generic `text→text`, `list:text→list:text` or `number→number` plumbing.
- The same UniProt accession is typed **`id.stable`** by UniProt (from "stable identifier" in its description), **`text`** by EBI Proteins (`accession`), and **`id.uniprot`** by RCSB (`uniprot_id`).
- PDB ids are `id.entry` on input and `id.rcsb` on output.
- Some description-based inferences misfire, e.g. Proteins `pubmed` → `id.uniprot` and `is_ref_proteome` → `id.not`.
- So the planner cannot chain gene → accession → structure by type. This was not fixed: mapping differently named identifier schemes is knowledge, not a quick general rule (see *Limitations*).

**S6 note.** The registry entry `io.github.pipeworx-io/pdbe` turned out to be a general third-party gateway: 3 PDBe tools plus prediction-market, "ask-pipeworx" and memory tools. It stayed in the agents' graph as pre-registered. One Phase B answer used one of its PDBe tools (Claude Q05, `get-summary` for 6M0J, alongside RCSB and UniProt). No agent used its `ask-*` tools.

## Phase B — Claude Code and Codex, RightClick X as their only MCP server

Claude Code 2.1.294 and Codex CLI 0.159.3, default models, one fresh session per question, starting from the Phase A state. 28 sessions, run sequentially. Truth was recomputed directly against the databases right after each session.

Legend:

- ✓ correct and grounded (strict);
- ✓\* correct and grounded only after the harness correction;
- ✗ incorrect.

Each cell gives seconds / MCP calls · providers reached through RightClick X.

| Q | Hops | Claude Code | Codex |
|---|---|---|---|
| Q01 | gene → accession | ✓ 14 s/3 · UniProt | ✓ 31 s/5 · Proteins |
| Q02 | gene → acc → UniProt PDB xrefs (10) | ✓ 34 s/4 · UniProt | ✓ 31 s/6 · UniProt |
| Q03 | … → RCSB → best resolution | ✓ 36 s/8 · UniProt+RCSB | ✓ 49 s/9 · UniProt+RCSB |
| Q04 | PDB → method/res → accessions → genes | ✗ 46 s/9 | ✗ 53 s/9 |
| Q05 | PDB → res → accessions → organisms | ✓ 54 s/15 · RCSB+Proteins+UniProt+pipeworx | ✓ 44 s/7 · RCSB+UniProt |
| Q06 | gene → acc → disease (MIM) → MONDO (OLS) | ✓\* 34 s/5 · UniProt+OLS | ✓ 43 s/10 · OLS+UniProt |
| Q07 | acc → GO term → OLS parent | ✓ 44 s/6 · UniProt+OLS | ✓ 66 s/11 · UniProt+OLS |
| Q08 | gene → acc → Proteins coordinates | ✓ 80 s/13 · UniProt+Proteins | ✓ 51 s/7 · Proteins |
| Q09 | acc → length; Proteins isoform entries | ✗ 60 s/12 | ✓ 45 s/7 · Proteins+UniProt |
| Q10 | PDB → ligand → chem. component | ✓ 62 s/10 · RCSB | ✓ 49 s/10 · RCSB |
| Q11 | gene → acc → RCSB Search entries | ✓ 52 s/9 · UniProt+RCSB Search | ✓ 56 s/9 · Proteins+RCSB Search |
| Q12 | gene → acc → Proteins TRANSMEM | ✓\* 19 s/3 · Proteins | ✓\* 44 s/7 · Proteins |
| Q13 | negative control | ✓ NONE | ✓ NONE |
| Q14 | exact totals, large sets | ✓ 311 \| 323 | ✓ 311 \| 323 |
| **Strict (primary)** | | **10/14 PARTIAL** | **12/14 PASS** |
| Re-scored | | 12/14 PASS | 13/14 PASS |

Median 46 s and 49 s per question, 113 MCP calls per client in total. 17 of 28 sessions reached more than one database through RightClick X. The agents bridged the databases themselves, hop by hop, with `context_run`; `context_compose` appeared in one session.

**The misses, examined:**

- **Q04, both clients: the question's fault, scored as pre-registered.** Both answered `HBA1, HBA2, HBB`. P69905 is encoded by two genes, HBA1 and HBA2. The question asked for each entry's *primary* gene name, and the pre-registered rule requires set equality. Method, resolution and accessions were right.
- **Q09, Claude: a RightClick X gap.**
  - The EBI Proteins isoforms response for P04637 is multi-megabyte (the agent reported 1.2–3.8 million characters).
  - Claude Code could not read it whole, and RightClick X offers no server-side count or projection over a large output. Its attempt to compose a count failed.
  - It then counted isoforms from a UniProt search instead and answered 8, saying 9 was possible if the canonical entry were included. The endpoint returns 9.
  - Codex read the same output and counted 9.
- **Q06 (Claude) and Q12 (both): harness defects, re-scored.**
  - Q06: the truth query hit a transient HTTP 404 from OLS. The same URL returned 200 seconds later, and Codex's identical answer scored correct with truth computed normally.
  - Q12: the grounding check looked for the literal string `646-668`, but the API returns `"begin":"646","end":"668"`. The pre-registered rule exempts pure numbers. Re-scored with both numbers required as JSON values in a fetched body, which they were.
  - `rescore.ts` keeps the strict verdicts next to the re-scored ones.

**Witnesses (harness-side, second source).**

- Q01, Q02, Q03, Q06, Q08 and Q12 agreed across sources at run time.
- Q01's first check falsely disagreed because the Proteins API also lists isoform accessions; this was fixed before registration.
- Product-side outcome witnesses (`context_compose` `witnesses`) were available but no agent used them. Agents mostly used `context_run`, which has no witness parameter.

## Phase C — drift on real, recorded contract changes

The contracts are byte-for-byte Internet Archive captures, with provenance and digests in [`contracts/PROVENANCE.md`](contracts/PROVENANCE.md). A harness-side **replay proxy** served the archived contract at a local URL, then switched to the live contract. All other requests went unchanged to the live provider.

| Case | Result |
|---|---|
| **C1-a** RCSB Search 1.13.0 (2022-02-05, `/rcsbsearch/v1/`) → 2.6.0 (`/rcsbsearch/v2/`): re-learn the same URL | **PASS.** RightClick X's drift report: +0 −0 ~7, identical to the harness's own operation-level diff of the two documents. 708 ms, no human step. |
| **C1-b** Self-healing on use, starting from the stale 2022 graph: `context_compose` (`run: true`) through the stale `runJsonQueriesGet` | **PASS.** The v1 call got a live 404, RightClick X re-learned the source ("API drift … ~7 capabilities") and re-planned. It returned exactly the 10 entries independent truth gives for P41159, in 1.7 s. |
| **C1-c** Agents with the stale graph, question Q11 | Both **correct and grounded**, but **not through RightClick X's healing.** A plain `context_run` on a stale capability does not re-reflect. Claude Code re-learned `https://search.rcsb.org/openapi.json` itself, an address from its own knowledge. Codex bypassed the stale capability with RightClick X's `builtin:web.fetch` and a v2 URL it built itself. |
| **C2** OLS4 2026-06-05 → 2026-10-16: `getHierarchicalChildrenByOntology` now names the *individuals* operation; the class operation became `…_1` | **PASS on the pre-registered criterion.** Drift report +3 −0 ~4, identical to the true diff, with both shifted ids marked *modified*. Before the switch the class-children call for GO:0015669 returned truth's 2 children. **After re-learning, the same capability id silently calls the individuals endpoint and returns `completed` with an empty list.** The drift report is the only signal. |

**Against TogoMCP's manual review:** detecting and applying a real breaking change (C1) and a real silent identity shift (C2) took one `context_learn` call and no human review. The diff RightClick X produced was exact both times. The C1-c and C2 caveats show where a caller can still be surprised.

## Findings about the databases themselves

- **UniProt vs RCSB disagree on p53 structures.** UniProtKB cross-references 311 PDB entries for P04637; RCSB Search maps 323 entries to it. These are live, unforced numbers. An integration that treats either list as complete silently drops entries.
- **UniProt REST fails content negotiation:** HTTP 500 to `Accept: application/json, text/html;q=0.9`.
- **The EBI Proteins API contract omits `servers`**, and its "parameterless" search operations require a filter.
- **OLS4 reassigned operationIds between releases**, so the same id names a different operation.
- **RCSB Search v1 is gone** (404), and its 2022 contract is still the one in the Internet Archive.

## Comparison with the stated limitations of prior systems

| Stated limitation (verified in the source) | This experiment |
|---|---|
| **TogoMCP:** "Onboarding a new database requires ~2–4 h of expert effort" (MIE file: automated discovery, LLM drafting, validation, expert review). | **0 lines and 0.2–3.1 s per database** from published contracts, *after* three general product fixes, each made once and for all contracts. RightClick X has no curated guidance layer. TogoMCP's MIE files carry expert semantic warnings (e.g. silent-failure traps) that a contract does not. |
| **TogoMCP:** "updates … are detected through periodic manual review, and the corresponding MIE files are revised accordingly". (Its Sept 2026 BioHackathon preprint adds CI that re-runs examples.) | Re-learning gave an **exact** diff of a real breaking change and a real identity shift with no review. Use-time self-repair worked for `context_compose`, not for plain `context_run` (C1-c), and an id-pinned call can silently change meaning (C2). |
| **TogoMCP:** a missing cross-reference yields "a silently truncated VALUES clause" and "a plausible but incorrect count, with no error raised". | Exact large totals were obtained (Q14). The two databases legitimately differ (311 vs 323), and the agents reported both rather than one. **But** RightClick X has its own large-result weakness: no projection or count over a multi-megabyte output (Q09), and a default GraphQL selection that was silently capped before this experiment's fix. |
| **BTE:** chains APIs through hand-written x-bte semantic annotations in SmartAPI (the authors "created SmartAPI registrations for 34 APIs"). | RightClick X needed no annotation to *call* any of these APIs, and the agents chained them. But RightClick X's own typed planner could **not** chain them automatically (P3). The identifier semantics BTE writes by hand are missing here too; in this experiment the AI agent supplied them. |

No claim of a first is made. Only these two systems were checked, and this is not a head-to-head benchmark: different databases, protocols (SPARQL/TRAPI vs REST/GraphQL) and questions.

## Follow-up (post hoc): output views for the Q09 gap

Not pre-registered, single run. It tests one product change against the one miss it targets.

**Change.** `8d417ea`, tagged `lifesci-views-1` (`main` at the time + this change only). `context_run`, `context_run_status` and `context_compose` take an optional `view`: `select`, `fields`, `count`, `offset`, `limit`, `full`. Without a view, an output over 32,000 characters of JSON is withheld whole, never cut. It is replaced by its size, count and shape, plus how to ask for less or for all of it. Run records, receipts and output digests still cover the full output. Regression tests are in `test/output-views.test.ts`.

**Harness check on the real API** (`views-check.ts`, no AI; `evidence/views-check-lifesci-views-1.json`). Same Phase A state, live EBI Proteins:

| Call | Response | Result |
|---|---|---|
| `context_run` isoforms P04637, no view | 2,805 chars (output 1,214,686 chars, withheld) | summary `total: 9` |
| `context_run_status` same run, `count` | 1,135 chars | 9, no second upstream call |
| `context_run_status` same run, `select: "accession"` | 1,290 chars | the 9 accessions truth lists |
| `context_run_status` same run, `full: true` | 2,433,932 chars | all 9 entries, same output digest |

Truth, computed directly at the same time: 393 | 9.

**Agents, Q09 only** (`evidence/phase-b-views-lifesci-views-1/`):

- **Codex: ✓ `393 | 9`, grounded, 34 s / 7 calls** (freeze-3: ✓ 45 s / 7). Unprompted, it called the isoforms capability with `view: {"count": true}`.
- **Codex, attempt 1: invalid, preserved** (`codex-Q09-attempt1-remote-app.json`). Codex used an account-level app connector: a different, remote RightClick deployment without these databases. It logged 0 calls to the server under test and answered "unavailable". The harness now runs Codex with `--disable apps` (deviation 8).
- **Claude Code: not run.** The `claude` CLI's login had expired ("OAuth session expired and could not be refreshed"). The session made no tool call (`claude-Q09-attempt1-auth-failure.json`). Claude Code's original Q09 miss is therefore **not yet re-tested** with an agent.

## Follow-up (post hoc): drift for plain `context_run`

Not pre-registered. This targets the two caveats from Phase C, C1-c and C2. Phase C was re-run in full under the fix policy. C1-d and the C2 refusal check were added to `phase-c.ts` for it.

**Change.**
- `4c986bc`, `43aa681`, `968637a`. A failed `context_run` of a learned operation re-reads its contract once, at most once a minute per source. If the contract drifted, the run record carries `healing` (the error, the drift report, what was retried), and the run retries the operation the caller meant.
- "The same operation" means the same method and full path, ignoring host, parameter names and whole version segments; for GraphQL the same field, for MCP the same tool; and the same risk. The run retries under the same id, or under the one capability at that source that now carries the operation.
- An id that re-learning pointed at a *different* operation is refused without an upstream call. The record says what the id called before and after, and names the successor. `acknowledgeChange: true` runs the new operation.
- Saved-goal anchors pin the operation too. They follow the successor or fail closed.
- Regression tests: `test/run-drift.test.ts`.

**Phase C on `lifesci-rundrift-1`: FAIL, preserved.** The first operation rule compared paths *below the server base*. The live RCSB contract moved its version from `servers` (`/rcsbsearch/v1/` + `/query`) into its paths (`/` + `/rcsbsearch/v2/query`), so the rule judged C1 a change of meaning:
- **C1-d** (plain `context_run`) refused to retry: "no equivalent of GET /query".
- **C1-b**, which passed on freeze-3, failed closed on its anchor ("required anchor contract changed meaning").
- **C1-c Codex** was still correct. It read the refusal and called again with `acknowledgeChange: true`.

The rule now compares the full path without version segments (`968637a`), with a synthetic regression for both ways a contract can split the path.

**Phase C on `lifesci-rundrift-2`** (`evidence/phase-c-lifesci-rundrift-2.json`). Same archived contracts and live providers. C1-c starts from the freeze-3 Phase A state.

| Case | Result |
|---|---|
| **C1-a** re-learn after the RCSB break | **PASS**, +0 −0 ~7, identical to the true diff. |
| **C1-b** compose through the stale capability | **PASS**, truth's 10 entries in 1.9 s. |
| **C1-d** plain `context_run` of the stale 2022 capability (new) | **PASS.** The v1 call got a live 404. RightClick X re-read the contract by itself ("API drift … ~7; retried the same operation") and the v2 call returned truth's 10 entries for P41159, in 1.9 s. |
| **C1-c Codex** | **✓ correct and grounded, now through RightClick X's repair.** Its first RCSB call (`getmetadata`) got the v1 404. RightClick X re-read the contract without a `context_learn` from the agent and retried on v2. Every later RCSB call went straight to v2. 53 s, 14 calls. (freeze-3: correct, but by bypassing the stale capability with `web.fetch` and a v2 URL it built itself.) |
| **C1-c Claude Code** | **Not run.** The `claude` CLI's login had expired ("OAuth session expired and could not be refreshed"); the session made no tool call. Claude Code's C1-c is **not re-tested** on this build. |
| **C2** OLS4 identity shift | Drift report +3 −0 ~5 against the true +3 −0 ~4: **PASS on the pre-registered criterion** (both shifted ids flagged), but no longer an exact diff. The extra modification is OLS's `search`: its `groupField` description changed, and the parameter-typing rules on `main` since `4975352` (another session's) type the old text as `url`, while freeze-3 typed it as `text`. The harness's true diff does not compare parameter types. |
| **C2 refusal** (new) | **PASS.** After re-learning, the class-children id was refused with no upstream call: "it called GET /ols4/api/ontologies/{}/classes/{}/hierarchicalChildren, it now calls … /individuals/{}/hierarchicalChildren", naming `…-1` as the successor. That successor returned truth's 2 children. With `acknowledgeChange: true` the id ran the individuals operation and returned 0, as before. |

## Limitations

- **Small and single-run.** 14 questions, 2 clients, 1 run each, 5 databases. No variance estimate.
- **Friendly targets.** All five publish machine-readable contracts. Databases with only SPARQL/RDF (most of TogoMCP's RDF Portal), or with no contract at all, were not tested.
- **The agent does the identifier bridging.** Typed composition across databases did not happen (P3). Fixing it needs cross-provider identifier equivalence: learned from observed values, or from annotations such as x-bte. That is not built.
- **Self-healing covers `context_compose`/goals only** on the builds Phase B and C ran. There, a failed `context_run` does not re-reflect its source (C1-c), and an id-addressed call after an identity shift runs the new operation without an error (C2). Both are fixed post hoc and checked on the same real changes (see *Follow-up*). They are re-tested with Codex but not Claude Code, and single-run. Argument names are not remapped: a retried operation whose parameter was renamed fails.
- **No server-side projection or aggregation over large outputs** (Q09) on the builds Phase B ran. Output views were added afterwards (see *Follow-up*). They are tested on the real API and with Codex, not yet with Claude Code. There is no filter operator.
- **The `selection` field list is clipped** at 3,000 characters for very wide GraphQL types.
- **Contract quirks needed product fixes.** "Zero per-database authoring" held only after three general fixes made during the experiment. More databases will surface more such quirks.
- **The replay proxy** emulates "the contract at the same URL changed". The old v1 service no longer exists, so C1's pre-change state was learned but never executed successfully.
- **One exploratory provider** (S6) was a third-party gateway with unrelated tools, and was available to the agents.
- **Prompts** named the answer format and said that databases were already learned; they did not name operations or routes.

## Deviations from the pre-registration

1. Phase A ran on three freezes (`-1`, `-2`, `-3`) because of the fix policy. Phase B and C ran on `-3` as the first complete run. `-3` is a tagged commit off `-2`, not `main`, so it excludes another session's concurrent product commit.
2. Two harness-check sessions (Claude and Codex on Q01) ran before the primary Phase B run, to validate the harness. They are reported in `evidence/harness-check*-lifesci-freeze-3/` and not counted.
3. `phase-a-supplement.ts` (post hoc): confirmed method/resolution are reachable through `selection` on `-3`.
4. Harness defects in Phase B scoring (a transient truth-query 404; a range string checked for grounding) were corrected in `rescore.ts`. The strict verdicts remain primary.
5. After Phase B, `polite-fetch.ts` was changed to also keep bodies relayed by the local replay proxy, which C1-c grounding needed. Phase B had already run with the original version.
6. C2 planned no goal/anchor test, and none was run. Instead the shifted id was invoked directly before and after re-learning.
7. C1-b composed with `want: json` and the stale capability as anchor, because RCSB's response schema is an external `$ref` and types only as `json`.
8. The Q09 follow-up is post hoc. Its start state is the freeze-3 Phase A state, re-derived once by the `lifesci-views-1` build. Copied raw, the newer semantics version re-learned all six providers on every startup, so the server took 5.1 s to answer `initialize`; re-derived, it took 0.13 s, with the same providers and capability counts. Codex was run with `--disable apps` so that RightClick X was its only MCP server, as pre-registered. In the harness check and the first, invalid attempts, the harness's own truth queries ran without `polite-fetch.ts`: two direct requests per run.

9. The run-drift follow-up is post hoc. Phase C was re-run in full on `lifesci-rundrift-1` (a FAIL, preserved) and `-2`. C1-d and the C2 refusal check are additions, and C1-c started from the freeze-3 Phase A state (`--state`). In both C1-c runs Codex ran without `--disable apps` (added to `phase-c.ts` afterwards); its MCP log shows all of its 14 calls going to the server under test.

## Reproduce

```bash
RCX_FREEZE=lifesci-freeze-3 node experiments/life-science/phase-a.ts
RCX_FREEZE=lifesci-freeze-3 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/phase-b.ts --label phase-b
node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/rescore.ts phase-b-lifesci-freeze-3
RCX_FREEZE=lifesci-freeze-3 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/phase-c.ts
# Q09 follow-up (post hoc), on a start state re-derived by the views build (deviation 8)
RCX_FREEZE=lifesci-views-1 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/views-check.ts --state <state>
RCX_FREEZE=lifesci-views-1 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/phase-b.ts --only Q09 --label phase-b-views --state <state>
# run-drift follow-up (post hoc, deviation 9)
RCX_FREEZE=lifesci-rundrift-2 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/phase-c.ts --parts c1a,c1b,c1d,c1c,c2 --state <freeze-3 phase-a-state.json>
```

Needs Node ≥ 22.18 and logged-in `claude` and `codex` CLIs. Results vary with live data; truth is recomputed at the same time.
