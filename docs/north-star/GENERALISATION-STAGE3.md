# Stage 3: generalisable investigation

## Why unfamiliar programs failed before

Twelve programs were drawn across six UCE freezes. Each holdout failure is classified once, by its first cause:

| Program (freeze) | Result | Failure class | General mechanism now in place |
|---|---|---|---|
| cups-config (2) | wrong outcome | Incorrect output interpretation (usage text taken as output) | Usage, prompt and help text rejected as results (UCE) |
| zipinfo (3) | wrong outcome | Incorrect output interpretation (error report taken as output) | Failure exits that keep little of the input are error reports (UCE) |
| xmllint (3) | fail | Semantic information loss (a mode that drops text) | Preservation evidence + outcome contract (Stage 2) |
| htmltree (4) | wrong outcome | Insufficient input discovery (operands misparsed) | Operand parsing with nested groups and variadics (UCE); literal vs file operands (Stage 3) |
| mp2bug (4) | wrong outcome | Incorrect capability interpretation (unsupported mode composed) | Unsupported behaviour never composed (UCE) |
| od (5) | wrong outcome | Wrong operation selection (an unrelated formatter inserted) | Lineage in the outcome contract, inside saved pipelines too (Stage 2) |
| net-snmp-create-v3-user (6) | wrong outcome | Unsupported interaction pattern (interactive prompt) | Prompts detected (UCE) |
| tab2space (6) | wrong outcome | Misleading documentation (behaviour contradicts the manual) | Not fixable by investigation alone. It needs a witness; conformance examples make such a program's actual behaviour the contract |
| uuname (7) | fail | Missing environmental precondition (no UUCP configuration) | The precondition is named in the investigation summary (Stage 3) |
| expand, mandoc, base64 | pass | — | — |

**Not investigable.** Many earlier draws could not be investigated at all: DTrace scripts, daemons, privileged tools. The UCE exclusion rules were mechanical and missed them. The new protocol has an **independent evaluator** screen eligibility from the documentation (EVALUATION-PLAN.md §3). Inadmissible programs are therefore recorded as screened out, not counted as RightClick X failures, and the screening itself is recorded.

**A class the UCE holdout could not reveal.** The UCE harness posed one fixed-mode task per program. Realistic tasks need **parameters**: a width, a delimiter, a field number, a pattern, a character set. The baseline investigator kept only flag-only options, at most eight, and treated every operand as a file. A user asking for "wrap at 20 columns" could never have been served.

## Mechanisms added in Stage 3

All are general, with synthetic-program tests in `test/generalisation.test.ts`; no real program was used before the holdout draw.

1. **Manual pages read properly:**
   - lower-case argument names (`-w width`);
   - descriptions wrapped over several lines;
   - mdoc rendering artefacts (`-Sm`);
   - sibling commands in a shared synopsis (`expand` / `unexpand`).
2. **Literal operands.** Operands named as values (`string1`, `pattern`, `start`, `delimiter`, …) are passed as argument text, not file content. Experiments use typed sample values, and the operands become input ports. Capabilities with literal ports are `direct-only`: callable with caller-chosen values, never composed automatically. A literal starting with `-` is refused.
3. **The documented-options interface (`<program>:invoke`):**
   - the caller passes options from the program's documentation, with their arguments, plus named input files;
   - anything undocumented is refused before running, with no repair attempted;
   - options that write files, run commands or use the network are not offered;
   - up to six argument-taking options are exercised during investigation, and the evidence is recorded on the card.
4. **Preconditions named.** When a program fails on every input, and its own errors name a missing file, configuration or privilege, the investigation says so.
5. **Agent interface (found in the development pilot):**
   - unknown inputs refused with the real ones listed;
   - unchanged programs not re-investigated;
   - learned capabilities and their options announced to new sessions;
   - named list values bound to their ports.

## Results

See the retained [holdout selection](evidence/holdout-ns-freeze-1.json) and [raw benchmark results](evidence/benchmark-ns-freeze-1.json) for `ns-freeze-1`. The [evaluation plan](EVALUATION-PLAN.md) records selection and harness limitations; the later [benchmark accounting report](../adaptive/BENCHMARK-REPORTING.md) records the corrected accounting. Evaluator-model selection is not independent-author review. The previously referenced `BENCHMARK-RESULTS.md` report was absent.
