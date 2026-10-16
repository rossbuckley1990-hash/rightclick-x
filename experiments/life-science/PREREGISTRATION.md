# Pre-registration: life-science database interoperability with zero per-database authoring

**Status:** registered before any RightClick X run against these databases. It is committed to git before Phase A starts; the commit timestamp is the registration time. Any later change to this file is a deviation and is listed under *Deviations* in `REPORT.md`.

**Date:** 2026-10-16 · **Author:** Claude Code session for Ross Buckley · **Build under test:** tag `lifesci-freeze-1` (commit `c3a902e`). See *Build* below.

## 1. The open problem

Published 2026 systems still need hand-written, per-database artefacts so that an AI can query life-science databases:

- **TogoMCP** (Kinjo et al., *Database* 2026, doi:10.1093/database/baag042, PMC13397537). Each database needs an MIE schema file. The paper says onboarding a new database "requires ~2–4 h of expert effort". When the RDF Portal changes, "updates … are detected through periodic manual review, and the corresponding MIE files are revised accordingly". For cross-endpoint questions, a missing cross-reference causes "a silently truncated VALUES clause" and "a plausible but incorrect count, with no error raised". Checked against the full text on 2026-10-16. A September 2026 BioHackathon preprint from the same group (doi:10.37044/osf.io/t25ng_v2) reports that MIE examples now assert their results in CI. It also reports further silent wrong answers, such as "a gene enumeration that returns 10,000 of 18,080 rows without an error or a warning".
- **BioThings Explorer** (Callaghan et al., *Bioinformatics* 2023, doi:10.1093/bioinformatics/btad570). It chains biomedical APIs through x-bte, an OpenAPI extension of hand-written semantic annotations registered in SmartAPI. The authors "created SmartAPI registrations for 34 APIs with semantic annotations". An API without such an annotation is not chained.

**Hypothesis under test.** RightClick X needs only the databases' own published machine-readable contracts (OpenAPI, GraphQL introspection) and no per-database code, configuration or annotation. With it, AI agents can answer multi-hop questions that span these databases correctly, and a real contract change is absorbed without manual review.

**Not claimed.** This is not a head-to-head benchmark against TogoMCP or BTE. They use different databases, protocols (SPARQL/RDF; TRAPI) and question sets. The comparison is against their *stated* limitations. No claim of a "first" is made beyond the two systems checked here.

## 2. Targets (public, read-only, no credentials)

| # | Database | Contract given to `context_learn` | Protocol |
|---|---|---|---|
| S1 | UniProtKB REST | `https://rest.uniprot.org/uniprotkb/api/docs` | OpenAPI 3.0.1 |
| S2 | EBI Proteins API | `https://www.ebi.ac.uk/proteins/api/openapi.json` | OpenAPI 3.0.1 (65 paths) |
| S3 | RCSB PDB Data API | `https://data.rcsb.org/graphql` | GraphQL (introspection) |
| S4 | RCSB PDB Search API | `https://search.rcsb.org/openapi.json` | OpenAPI 3.0.1 |
| S5 | EMBL-EBI OLS4 | `https://www.ebi.ac.uk/ols4/v3/api-docs` | OpenAPI 3.1.0 |
| S6 (exploratory) | PDBe via a third-party MCP wrapper, `io.github.pipeworx-io/pdbe`, listed in the official MCP Registry | `https://gateway.pipeworx.io/pdbe/mcp` | MCP (streamable HTTP) |

S6 adds protocol diversity and, if usable without credentials, a separate provider for witness checks. It is a third-party wrapper, not EMBL-EBI. It is excluded from scoring. If it needs credentials or fails, that is recorded and it is dropped.

## 3. Rules of conduct

- At most **1 request per second per host**, enforced harness-side by `polite-fetch.ts`. It is preloaded with `node --import` into every process that touches the databases (the RightClick X server and the truth harness). The product's own user-agent is kept (`rightclick-x/0.1 (+github…)`); the truth harness uses `rightclick-x-lifescience-truth/0.1`.
- Read-only. PUT/PATCH/DELETE are refused by the preload. POST is allowed only because GraphQL queries, RCSB search queries and MCP JSON-RPC use it.
- No credentials, no network scanning, no spending beyond the existing Claude Code and Codex subscriptions.
- Every request is logged (`RCX_NETLOG`). Every failure is preserved in the evidence. Nothing is re-run silently.
- **No provider-specific code.** Nothing under `src/` may name these hosts, databases, fields or identifiers.

## 4. Build

At the start of this session, GPT 6 Astra's work (money quantities, outcome witnesses, `goal:<slug>` capabilities, `proof/`) was uncommitted in the working tree. Before the freeze it was committed by another session (`6d6956c`, merged as `c3a902e` at 12:01 +01:00). This session did not commit or alter it. The freeze is therefore on HEAD `c3a902e`, tagged `lifesci-freeze-1`. Validated on an exported copy: 83/83 tests and `tsc` clean. All runs use an exported copy of the tag (`git archive`), so later edits to the working tree cannot affect them.

**Fix policy.** A failure may be fixed only by a general change: no host, database, field or identifier names in `src/`, and a regression test with a synthetic contract. Each fix gets a new freeze tag (`lifesci-freeze-N`), a full test run, and a full re-run of the affected phase. Results on both freezes are reported. **The primary Phase B result is the first complete Phase B run.** Later re-runs are reported next to it, never in place of it.

## 5. Phase A — onboarding by `context_learn` only

The harness starts RightClick X (frozen build, stdio MCP, fresh state) and calls only MCP tools: one `context_learn` per contract URL, then `context_providers`, `context_graph` and `context_explain` to describe the result. Then one smoke `context_run` per source, chosen now:

| Source | Smoke call |
|---|---|
| S1 | get entry by accession `P04637` |
| S2 | get protein by accession `P04637` |
| S3 | `entry(entry_id: "4HHB")` |
| S4 | GET query with a text query for `rcsb_id = 4HHB` |
| S5 | search `q=apoptosis` |

**Recorded per source:** lines of per-database code or configuration written (expected **0**), wall time and requests to learn, number of capabilities, number of read-only capabilities, input/output semantic types, smoke-run outcome, and whether the smoke output contains the facts the questions need.

**Success criteria (A).** A-PASS for a source if `context_learn` with only its URL yields at least one executable read capability whose smoke run returns the expected record. Also recorded: the number of cross-provider *typed* links between S1–S5 (how many identifier outputs of one database the planner can feed to another automatically).

**Predicted failures (from reading the contracts before any run):**

- **P1. EBI Proteins base URL.** The contract has no `servers` entry. Per OpenAPI 3, the default server `/` resolves against the document's location, which gives `https://www.ebi.ac.uk/`. The real API lives under `/proteins/api/`. A spec-compliant client calls `https://www.ebi.ac.uk/proteins/P04637`, which returns HTTP 404 (checked). Expected: every S2 operation fails.
- **P2. GraphQL selection cap.** The frozen GraphQL reflector selects at most 25 fields per return type and 8 scalar subfields per nested object. RCSB `CoreEntry` has 101 argument-free fields. The 25 selected are `assemblies` … `em_imaging`, and exclude `exptl`, `rcsb_entry_info` and `refine`, where the method and resolution live. Expected: S3 cannot return method or resolution through `entry`, and the cap is silent.
- **P3. Identifiers do not type-link.** `accession` infers to `text`, `entry_id` to `id.entry`, `uniprot_id` to `id.uniprot`, `comp_id` to `id.comp`, and RCSB outputs `rcsb_id` to `id.rcsb`. Expected: few or no strong typed links between UniProt, Proteins and RCSB, so `context_compose` will not chain gene → accession → structure on its own. Agents can still chain the steps by hand, one `context_run` per hop.
- **P4.** UniProt's responses carry no schema, so outputs are typed only as `json`.

## 6. Independent truth and witnesses

`questions.ts` holds, for every question, its wording, answer format, a **truth procedure** and a scorer. The truth procedure queries the databases directly with plain HTTP from the harness process, never through RightClick X. Truth is recomputed right after each agent run, because the databases are live (PDB releases weekly).

**Witnesses** are a second, separate source for the same fact, checked harness-side:

| Q | Witness |
|---|---|
| Q01 | EBI Proteins API search vs UniProt search |
| Q02 | RCSB Search mapping vs UniProt PDB cross-references |
| Q03 | UniProt cross-reference "Resolution" vs RCSB entry |
| Q06 | the MONDO term's own OMIM cross-reference |
| Q08 | UniProt Ensembl cross-reference vs Proteins coordinates |
| Q12 | UniProt features vs Proteins features |

A witness disagreement is reported as a property of the databases, not scored against the agent; the question names which source is authoritative. Product-side witnesses (`context_compose` `witnesses`, available in this freeze) are exploratory. Agents may use them but are not asked to.

## 7. The questions (fixed; wording is in `questions.ts`)

| ID | Hops | Answer format |
|---|---|---|
| Q01 | gene TP53 → reviewed UniProt accession | `<accession>` |
| Q02 | gene LEP → accession → UniProt's PDB cross-references | `<accession> \| <count> \| <PDB IDs>` |
| Q03 | gene LEP → accession → PDB xrefs → RCSB entry metadata → best resolution | `<PDB ID> \| <Å> \| <method>` |
| Q04 | PDB 4HHB → method, resolution → polymer entities → UniProt accessions → gene names | `<method> \| <Å> \| <accessions> \| <genes>` |
| Q05 | PDB 6M0J → resolution → polymer entities → accessions → UniProt organism | `<Å> \| <acc>: <organism>; …` |
| Q06 | gene CFTR → accession → UniProt disease (MIM 219700) → OLS MONDO term | `<accession> \| <disease> \| <MONDO ID>` |
| Q07 | P68871 → GO annotation "oxygen transport" → OLS GO is_a parent | `<GO ID> \| <parent labels>` |
| Q08 | gene BRCA1 → accession → Proteins API coordinates → chromosome, Ensembl gene | `<accession> \| <chr> \| <ENSG>` |
| Q09 | P04637 → UniProt canonical length; Proteins API isoform entries | `<length> \| <count>` |
| Q10 | PDB 1HSG → non-water ligand → chemical component formula, weight | `<comp ID> \| <formula> \| <weight>` |
| Q11 | gene LEP → accession → RCSB Search entries mapped to it | `<count> \| <PDB IDs>` |
| Q12 | gene EGFR → accession → Proteins API TRANSMEM features | `<accession> \| <count> \| <start-end>` |
| Q13 | **negative control:** gene QZX9NOTAGENE → accession (none exists) | `NONE` |
| Q14 | P04637 → exact totals of UniProt PDB xrefs and RCSB-mapped entries (large sets; tests truncation) | `<count> \| <count>` |

Design-time reference values were checked once, harness-side only, to confirm every question is answerable: Q01 P04637; Q02 P41159, 10; Q03 1AX8, 2.4 Å, X-ray; Q04 X-ray, 1.74 Å, P68871/P69905, HBB/HBA1; Q05 2.45 Å, P0DTC2 SARS-CoV-2 / Q9BYF1 *Homo sapiens*; Q06 P13569, Cystic fibrosis, MONDO:0009061; Q07 GO:0015671, gas transport; Q08 P38398, 17, ENSG00000012048; Q09 393, 9; Q10 MK1, C36 H47 N5 O4, 613.789; Q11 10; Q12 P00533, 1, 646-668; Q13 none; Q14 311 vs 323. **Scoring uses truth recomputed at run time, not these values.**

**Scoring rules** (implemented in `questions.ts`):

- Accessions and IDs: case-insensitive exact match; a `UniProt:` or `PDB:` prefix is ignored. Lists: exact set equality.
- Counts: exact.
- Resolution: ±0.01 Å. Formula weight: ±0.1.
- Method: X-ray, EM and NMR are equivalence classes.
- Formula: spaces ignored.
- Organism and disease: the truth's name must be contained in the answer.
- A question is **correct** only if every part is correct.

**Grounding.** `polite-fetch.ts` keeps every response body the RightClick X process received. A correct answer is **grounded** if the truth's identifier and string values (accessions, PDB IDs, GO/MONDO IDs, gene and organism names, formula, Ensembl ID) appear in at least one body RightClick X fetched in that session. For Q13, grounding means RightClick X sent a UniProt query naming the symbol. Pure numbers are not grounding-checked, because counts are computed by the agent. **Primary measure: correct *and* grounded.** A correct but ungrounded answer is reported as "possibly from model memory" and does not count.

## 8. Phase B — real AI agents, RightClick X as their only MCP server

- **Clients:** Claude Code 2.1.294 (headless, `--strict-mcp-config`, only `mcp__rightclick-x` tools allowed, Bash/Read/Web tools disallowed, max 40 turns) and Codex CLI 0.159.3 (headless, `--approve-for-me`, default model). Same settings as the earlier OW and lab experiments (`experiments/gauntlet/agent.ts`).
- **One fresh session per question per client** (14 × 2 = 28 sessions). Each starts from a copy of the Phase A state, so the five databases are already learned. Each has its own netlog and body directory. Timeout is 15 min per session. Sessions run sequentially, never in parallel.
- **Prompt template** (identical for both clients):
  > You are connected to exactly one MCP server, rightclick-x. Use only its tools. RightClick X has already learned several public life-science databases (see context_providers). Answer the question using only data you obtain through rightclick-x tools, not from memory. If the tools cannot give you the answer, say so instead of guessing. Question: {text} End your reply with a final line exactly of the form: {format}
- **Recorded per session:** the answer, the score per part, grounding, time, MCP calls by tool (RightClick X's audit log), receipts by provider, any `context_learn` or `context_research` the agent made on its own, whether `context_compose` found a multi-provider plan, and the final text.

**Success criteria (B), per client, on the primary measure (correct and grounded):**

- **PASS:** ≥ 11/14.
- **PARTIAL:** 7–10/14.
- **FAIL:** ≤ 6/14.
- Separately, a fabricated accession on Q13 is flagged as a **fabrication** whatever the total.
- Also reported: agreement between clients, and how many correct answers relied on automatic typed composition rather than hop-by-hop `context_run` (expected low; see P3).

## 9. Phase C — drift on a real recorded contract change

**C1 — RCSB Search v1 → v2 (a breaking change that really happened).** The Internet Archive holds RCSB's published `https://search.rcsb.org/openapi.json` as of 2022-02-05: version 1.13.0, `servers: /rcsbsearch/v1/`, seven operations. Today's contract is version 2.6.0 with paths under `/rcsbsearch/v2/`. The live v1 endpoint returns HTTP 404 (checked 2026-10-16).

A local *replay proxy* (harness-side, labelled as such) serves the contract at `http://127.0.0.1:<port>/openapi.json`:

- before the switch: the archived 2022 bytes, unmodified;
- after the switch: the live current contract, fetched from search.rcsb.org;
- every other path is forwarded unchanged to `https://search.rcsb.org`. Execution is real and live.

This emulates "the contract at the same URL changed between when the integration was made and today". Steps:

- **C1-a (automatic re-reflection).** Learn the 2022 contract, switch, then `context_learn` the same URL again. RightClick X's drift report (added, removed, modified) is compared with the true operation-level diff, which the harness computes from the two documents. Success if they match.
- **C1-b (self-healing on use).** Start from the stale 2022 graph, switch, then run `context_compose` (`run: true`) for the Q11 search through the stale v1 capability. Success if RightClick X detects the failure, re-learns, re-plans to v2 and returns the entries that match independent truth (Q11), with no manual step. An honest failure is recorded as C1-b FAIL.
- **C1-c (agents).** Claude Code and Codex each get the stale graph after the switch and question Q11, scored as in Phase B.

**C2 — OLS4 2026-06-05 → today (a silent identity shift that really happened).** The archived OLS4 contract from 2026-06-05 names the class-children operation `getHierarchicalChildrenByOntology`. Today that operationId names a *different* operation (individuals' hierarchical children), and the class operation became `getHierarchicalChildrenByOntology_1`; the same happened for `…Ancestors…`. The same capability id now means something else. Also: +3 operations, and new parameters on two operations. Learn old, switch, re-learn. **Success** if RightClick X's drift report marks the shifted ids as **modified** (not unchanged) and lists the added and changed operations, matching the harness's own diff.

**TogoMCP's equivalent step** is "periodic manual review" with MIE files revised by hand. Phase C measures whether RightClick X's detection and update needed any human step.

## 10. What would count against the hypothesis

- Any per-database code or configuration was needed to answer (Phase A ≠ 0 lines).
- Phase B FAIL for either client on the primary measure.
- Fabrication on Q13.
- Drift reports that miss a real change, especially C2's silent identity shift.
- Any fix that is provider-specific.

All of these are reported, and failures are not re-run away.

## 11. Outputs

`experiments/life-science/REPORT.md` and `experiments/life-science/evidence/*.json`:

- Phase A: providers, capabilities, smoke runs, netlog summary.
- Phase B: per session, the prompt, answer, truth, scores, grounding, MCP calls, receipts and final text.
- Phase C: the archived and current contract digests, drift reports, the true diff, and the healing attempt.

Large raw response bodies stay out of git. Their SHA-256 digests are recorded.
