# Stage 2: semantic goal satisfaction

- **Builds on:** `ns-stage1` (`65ae92d`).
- **Acceptance suite:** [`test/semantic-acceptance.test.ts`](../../test/semantic-acceptance.test.ts), cases S1–S8 as pre-registered in EVALUATION-PLAN.md §8, plus S1b.
- **On `ns-baseline`:** S1, S3, S5, S6 and S7 pass; **S1b, S2, S4 and S8 fail**. Raw output: [`evidence/stage2-semantic-on-ns-baseline.txt`](evidence/stage2-semantic-on-ns-baseline.txt).
- **After this stage:** 9/9.

## What was wrong

| Case | What happened on the baseline |
|---|---|
| **S1b** (freeze-5's real failure mode) | A pipeline `pageset (typeset as pages) → octdump` was crystallised after one run. Later, a plain "octal dump of the bytes of a text" request **reused the saved pipeline**: its title carried the old request's words, so it outranked `octdump` alone. The dump was of the typeset text, not the caller's. This is the same propagation recorded on `uce-freeze-5`, where the wrong `mandoc → od` plan was saved and reused for three later intents (`evidence/stage0-probe-s1-results.txt`). |
| **S2** | "Compare two files line by line" with **one** text: the plan ran `Summarize text` on the input and compared the input with its own summary. It completed. |
| **S4** | A goal checked only by `{"op":"exists"}` was published as **`verified`**. |
| **S8** | A program observed to keep every word of its input silently dropped a line at run time. The run completed, and the loss was reported as success. |

**S1 itself** (the historical `mandoc → od`) passes on the baseline, but only because of the "bloated plan" heuristic (`planner.ts`). S1b shows the protection was incidental.

## Mechanisms (general; no program-specific code)

### 1. Outcome contract

`src/core/contract.ts`; returned as `contract` by `context_compose`. Every compose request produces a machine-checkable contract stating:

- **input semantics** (caller values and types);
- **required output information** (`want`, `require`);
- **transformation requirements** (the request's own words, excluding words that only name the type);
- **invariants:**
  - lineage;
  - distinct inputs;
  - preservation;
- **completeness** and **provenance** requirements;
- **verification conditions** (predicates, witnesses, the strongest achievable assurance);
- **authority and risk**;
- **allowed uncertainty**: none. A result whose contract cannot be established is reported as not established;
- **failure conditions**.

### 2. Lineage

Every step of a plan must be justified by the request, as one of:

- **requested**: its title or tags carry a word of the request;
- **required information**: its result carries a required term;
- **type conversion**: it produces a different type that a later step or the answer uses, and is not same-type `text→text`/`json→json` plumbing;
- **caller-anchored**: named in `through`.

**Saved composites are opened, and their inner steps are judged against the current request.** A plan with an unjustified step is listed with its contract assessment (`plans[].contract`) but never runs, and is never chosen during repair. If no plan honours the contract, the outcome is `violated`, with the reason, and nothing runs.

### 3. Preservation

The investigator tags a program mode `preserves-input-words` when **experiments** showed that it kept every word of distinct inputs. When every step of the chosen plan carries that evidence, the contract requires the result to keep the caller's words. If it does not, the run is reported `failed`:

- `outcome.status: "violated"`;
- the output withheld under `rejectedOutput`;
- nothing crystallised or published.

### 4. Assurance is named for what was done

- **`verified`**: an independent outcome witness (a separate read-only provider) passed.
- **`checked`**: stored predicates passed. RightClick X checked them on its own output.
- **`unverified`**: nothing checked.

These labels apply to run and compose results, receipts, published-goal trust, cards and the synthesized OpenAPI. `authority.publish` gains `"checked"`; `"verified"` now requires a witness. `executed.contract.assurance` reports `independently-checked`, `predicate-checked` or `unchecked`.

## Changes to existing tests and harnesses (stricter semantics; no assertion removed)

- **Seven assertions** that expected `"verified"` for runs checked only by predicates now expect `"checked"`. They are in `quantities`, `runtime` ×2, `drift` ×2 and `synthesis` ×2.
- **`investigation.test.ts`:**
  - a predicate-checked goal is `checked`;
  - the card's limitation text is updated;
  - **added:** an operator's verified-only policy refuses a goal that is only checked.
- **`proof/run.ts`.** The proof requires the *main* run to be `verified` by its witness, which is unchanged. The witness's *own* predicate status is now accepted as `checked` or `verified`, since its predicates are the check.
- **`experiments/stress-drift.ts`** counts a passed predicate (`checked`) as available, as before.
- **Tool descriptions:** the `verify` and `publish` parameters now say what makes a result `checked` vs `verified`. No tool was added or removed.

## Results

| Suite | Result |
|---|---|
| Semantic acceptance (S1–S8, S1b) | **9/9** (baseline 5/9) |
| Full test suite | 181/181 |
| Lifecycle proof | 28/28 |
| Labs | 30/30 direct, 30/30 gateway |
| Negative controls | 6/6 |

## Limits (stated, not hidden)

- **Lineage relies on words.** It uses the request's words and the capability's title and tags. A step whose title shares a word with the request counts as requested even when the match is incidental. The rule catches steps with **no** connection to the request, not subtle mismatches.
- **Preservation covers word content only.** It is checked only where experiments supplied the evidence (local programs). It says nothing about order, formatting or numeric precision, and nothing for web operations.
- **Contracts do not prove semantic correctness.** They make the request's observable requirements explicit and refuse what cannot be established. Correctness beyond that needs predicates or witnesses, and the assurance label says which was used.

## Gate

| Requirement | Result |
|---|---|
| No known incorrect result marked verified in the semantic acceptance suite | **PASS** |
| No completed run with wrong output in the suite | **PASS** |
| Historical mandoc → od case preserved and handled correctly | **PASS** (S1; also S1b for its propagation) |

**Stage 2 verdict: PASS**, pending the full regression on the `ns-stage2` tag (recorded in `evidence/stage2-suites-ns-stage2.txt`).
