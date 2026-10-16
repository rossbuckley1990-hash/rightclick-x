# Cross-provider identifier links: design note and measurement

**Status:** prototype on `main` (`4975352`, `c578aac`), tags `lifesci-links-1` and `lifesci-links-2`. This follows up on prediction P3 of the life-science experiment ([REPORT.md](REPORT.md), *Typed links*). It was **not pre-registered**.

## The problem, from the real evidence

In Phase A (`evidence/phase-a-lifesci-freeze-3.json`), one UniProt accession had three types:

- **`id.stable`**: UniProt `accession` ("Unique and stable identifier…");
- **`text`**: about 40 EBI Proteins `accession` parameters, none described;
- **`id.uniprot`**: RCSB GraphQL `uniprot_id`.

PDB ids were `id.entry` on input and `id.rcsb` on output. About 300,000 cross-provider edges existed, almost all `text→text` plumbing. Only 85 capability pairs were linked across sources by a specific `id.*` type. On inspection most of those are wrong: 81 are Proteins UniParc/UniRef `id` outputs, which description inference typed `id.entry`, feeding RCSB `entry_id`. The rest are 4 correct `organism.taxonId → taxonomy` links. Agents had to bridge every hop themselves.

## Options considered

| Mechanism | Verdict |
|---|---|
| **Description and name cues** (e.g. "UniProt primary accession" ↔ a provider called UniProt with a field `primaryAccession`) | **Rejected as a source of links.** These cues already misfire in the same data: Proteins `pubmed` → `id.uniprot`, `is_ref_proteome` → `id.not`, UniParc ids → `id.entry`. Matching names across providers is exactly the knowledge we lack. Any rule good enough for these five databases would be a disguised per-provider rule. |
| **Annotations (x-bte, and similar)** | **Sound where present, but absent here.** None of the five contracts carries x-bte or any identifier-scheme annotation. An adapter would feed the same structure as below (a named scheme on input and output ports). Not built: nothing here could test it. |
| **Rewrite types** (unify `id.stable`, `text` and `id.uniprot` into one type) | **Rejected.** `text` cannot be unified with anything. Retyping changes contract signatures, so it would show up as drift and retire crystallized pipelines. It would also stop a caller's plain-text accession from binding where it binds today. |
| **Value evidence → additive identifier schemes** | **Built.** Links come only from runs that actually happened. Declared types stay untouched. |

## Design (`src/core/identities.ts`)

**Evidence.** A completed, non-composite run counts as evidence only if:

- it accepted an *identifier-shaped* value: one token, 3–64 characters, with at least one letter and one digit, e.g. `P04637`, `4HHB`, `GO:0006915`, `TP53`;
- the input was not a free-text port (`q`, `query`, …) and not an enum;
- the answer named that value in a key field: a field whose name ends in `id`, `ids`, `key`, `code`, `accession(s)` or `identifier(s)`.

Such a run records three kinds of link:

- **echo**: output port O of the same call → input port P;
- **co-accept**: input P ↔ an input Q of another capability that accepted the same value the same way;
- **flow**: an output port O′ of an *earlier* call that produced the value → input P.

What is never evidence:

- failures and refutations;
- answers that do not name the value (a lookup of `Z99999` that returns some other record);
- a search box echoing its query;
- words, plain numbers, dates and versions;
- a value the call was given, recorded as if the call had produced it.

**Schemes.**

- Input ports are unified, by union-find, through co-acceptance.
- Within one contract, inputs with the same qualified name and declared type join as *siblings*: every Proteins `accession`, every RCSB `entry_id`. Generic names such as `id`, `key`, `name` and `code` never join this way.
- Output ports only *feed* schemes and are never merged. One output (a cross-reference list) can feed two schemes without making those schemes one.
- An output path the contract does not declare becomes an `observed` port once it has fed a scheme. It is recorded only from a run where the caller set no optional input, because a GraphQL `selection` or a REST `fields` reshapes the response. Observed ports are excluded from contract signatures.

**Use in the graph and the planner.**

- A port carries `schemes: [...]`. An input accepts a value from any output that feeds one of its schemes.
- Cardinality is kept: a list never fills a single-value port.
- A text-typed input in a scheme takes values produced by other steps only through the scheme (added in `c578aac`, after the first measurement). Specifically typed ports and caller values are unaffected.
- In `context_compose`, a caller value counts as part of a scheme when its name matches a member port's name and its shape (length and first-character class) has been seen. Such a binding gets the same ranking credit as a same-named port.
- The evidence (links and accepted values, bounded) persists with the state. Re-learning a contract re-applies it, with no drift and no retirements.

**Tests:** `test/identities.test.ts`, 6 synthetic tests, no real provider names. They cover:

- three providers typing one id as `id.stable` / `text` / `id.protein`: unlinked until runs link them, after which a caller's accession plans and runs straight to the third provider;
- flow evidence turning `entry → registry` into a typed chain;
- no evidence from failures, missing echoes, search echoes, words or numbers;
- reshaped responses not creating ports;
- persistence with no drift;
- a mixed cross-reference list feeding two schemes without merging them, with cardinality kept;
- the scheme-only rule for text ports.

The full suite passes (116/116), `tsc` is clean.

## Measurement

The measurement script is `links.ts`, with evidence in `evidence/links-lifesci-links-{1,2}.json` and `evidence/phase-a-lifesci-links-{1,2}.json`.

- Phase A was re-run unchanged on each tag: learn plus the five pre-registered smoke calls, 21 requests.
- Then every `context_run` call the 28 Phase B agent sessions made (77 calls) was replayed in order, in one process, from that Phase A state. Arguments were as logged, with `verify` dropped. 76 completed; one was the agent's own call to a non-existent id, and it failed as it did originally.
- 104 requests, under 1 request per second per host, read-only, no refusals.

A **meaningful link** is a capability pair across two sources where an output fills a *required* input either through a shared scheme with equal cardinality, or through a specific `id.*` type.

| Graph state | id-type pairs | scheme pairs (not already id-typed) | schemes |
|---|---|---|---|
| freeze-3 Phase A (baseline) | 85 (81 of them wrong, see above) | 0 | 0 |
| links-2 Phase A (5 smoke calls) | 86 | **23** (22): S1→S2 22, S2→S1 1 | 2 |
| links-2 after replaying the agents' 77 calls | 86 | **26** (25): S1→S2 22, S2→S1 3, S4→S3 1 | 5 |

The +1 id-type pair is an observed Proteins `accession` port. It was typed with its scheme's most specific member type, `id.stable`.

**Checked by hand, every one of the 26 scheme pairs is correct:**

- UniProt `getbyaccession.primaryAccession` → 22 Proteins accession lookups;
- three Proteins `accession` outputs → UniProt `getbyaccession`;
- RCSB Search `result_set.identifier` (list) → RCSB Data `entries(entry_ids)`.

The within-provider schemes are also correct:

- RCSB `entry_id` (9 operations);
- `comp_id`, fed by 5 RCSB fields that carry the same chemical-component id (`MK1`);
- Proteins `gene.value` → `exact_gene`.

Two fed ports are **mixed lists**: RCSB `polymer_entity_groups.rcsb_id` (feeding the accession scheme) and Proteins `dbReferences.id` (feeding `entry_id`). They are harmless today only because no list port belongs to those schemes. If one did, these lists would hand it non-matching ids.

**Planner probes** (plan only, ≤3 steps; a plan is meaningful when every cross-source binding is a scheme or id-type binding). The table shows meaningful plans / plans with a generic crossing, among the top 5:

| Hop the agents needed | before replay | after replay |
|---|---|---|
| accession → genomic coordinates (Q08) | 1 / 2 | **1 / 0** |
| accession → structure (Q03, Q11) | 0 / 5 | 0 / 5 |
| accession → GO term → ontology parents (Q07) | 0 / 5 | 0 / 5 |
| PDB entry → accession → gene (Q04) | 0 / 5 | 0 / 5 |
| PDB entry → accession → organism (Q05) | 0 / 5 | 0 / 5 |

On `lifesci-links-1` (before the text-port rule) the schemes were the same. But the planner still bound RCSB `em_experiment.aggregation_state` to Proteins `accession`, which is what motivated `c578aac`.

## What this shows

1. **The mechanism is general and precise.** Five smoke calls alone linked UniProt and EBI Proteins accessions across all 22 lookup operations. Every learned cross-provider link was correct, and no provider-specific rule exists in `src/`.
2. **It is far from closing P3.** After replaying all 77 real agent calls, there were 26 meaningful pairs, and only one of the five agent hops planned cleanly. The reasons, in order of weight:
   - **One-to-many relations.** PDB entry → accessions, accession → PDB entries, and accession → GO terms are all lists in these APIs, e.g. RCSB `rcsb_polymer_entity_align.reference_database_accession` and UniProt cross-references. The planner has no fan-out from a list into a single-value port. This is the main blocker.
   - **Undeclared nested paths.** UniProt search returns `results` as an opaque `list:text`. Its `primaryAccession` and cross-reference ids are two array levels deep, which this prototype does not turn into ports. Agents also often reshaped responses (`selection`, `fields`), and those runs rightly add no ports.
   - **Links never exercised.** No agent ever called RCSB `uniprot(uniprot_id)`, so `id.uniprot` stays unlinked. Evidence only covers what has been used.
   - **Generic plumbing still dominates ranking.** Unschemed text ports (`accession_locations`, `upid`, OLS `onto`) still take arbitrary text. In the probes the planner moved its junk there.
3. **Evidence can also expose wrong lexical types.** The 81 baseline `id.entry` links from UniParc/UniRef ids are wrong. Detecting that would need negative evidence, which this prototype does not record.

## Not done / next

- **List fan-out in the planner** (map a single-value step over a list). Without it, most cross-database hops stay unplannable whatever the identifier evidence.
- **Observed ports up to two array levels**, flattened, under the same "no optional input" rule.
- **Cross-session flow evidence.** Recent produced values are kept per process only. In Phase B each session started from the Phase A state, so in real use most evidence would come from long-lived servers.
- **An x-bte / annotation adapter** that seeds named schemes; it needs a contract that carries such annotations to test.
- **Negative evidence**: a scheme value refused by a port, or an id.* port whose observed values never resolve. This could retire wrong lexical types.

### Note on the Phase A smoke results on these tags

On `lifesci-links-1/-2`, smokes S1 and S2 report FAILED with status `completed`. This is not caused by this change. Commit `8d417ea` (another session's output views) withholds any `context_run` output over 32,000 characters and returns a summary. The S1/S2 outputs are about 0.7–0.9 MB (875,618 and 713,605 bytes on freeze-3), so the harness can no longer find `P04637` in the reply. S3 and S5 "needed facts" are NO exactly as on freeze-3. Scheme learning reads the full output inside the runtime, so it is unaffected.

`lifesci-links-2` = `c578aac`, which also contains another session's `43aa681` (saved-goal anchors), committed in between.
