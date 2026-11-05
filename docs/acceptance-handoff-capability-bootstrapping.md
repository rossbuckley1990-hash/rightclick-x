# Independent acceptance: capability bootstrapping (handoff)

This hands the frozen research candidate to an **independent evaluator**. The session that built it
wrote this document, but must not choose the programs, the tasks or the oracle, and must not see
the hidden tasks before the arms have run. Until such an evaluation runs, every claim about
generalisation and competitive advantage stays **NOT ESTABLISHED**. The development results are in
[`experiments/capability-bootstrapping/README.md`](../experiments/capability-bootstrapping/README.md).

## What is frozen

The source candidate is the commit recorded in the PR description (draft PR #61) as the
**acceptance freeze**, with its tree hash. Check both before starting:

```bash
git rev-parse <commit> <commit>^{tree}
```

Any change to `src/`, `bin/` or `test/` after the freeze voids the evaluation. Evaluator-owned
files live outside the repository.

## Rules (binding, fixed before selection)

**1. The evaluator is independent.** It runs as a fresh session that is neither this one nor any
session that built PR #57, #59, #60 or #61. It does not receive this session's development answers,
transcripts or lanes.

**2. Programs are chosen after the freeze.**

- **Count.** Choose at least six programs installed on the host that transform binary files.
- **Not in the repository.** For each one, `git grep -ilw <name> <freeze-commit>` must print
  nothing.
- **Excluded development cases.** None of these may be chosen: `gpgv`, `tiffdump`, `qt-faststart`,
  `msguniq`, `ocsptool`, `zipmerge`, `lzmainfo`, `nettle-hash`, `tiffcp`, `dwebp`, `cwebp`,
  `asn1Coding`, `msgfmt`, `ppm2tiff`, `sips`, `djpeg`, `cjpeg`, `tiffinfo`, `gzip`, `zip`, `unzip`,
  `pngtogd`, `tiff2bw`, `jpgicc`, `giffix`, `avifdec`, `avifenc`, `lame`, `gifski`, `gdtopng`.
- **A mix of formats.** At least two must read a format RightClick has **neither a validator nor a
  generator for**. Its registered formats are the `FORMATS` and `GENERATED_FORMATS` lists in
  `src/core/formats.ts` and `src/core/fixtures.ts` at the freeze. At least one must read a format
  RightClick can generate.

**3. Authority is declared before anything runs, and reported per tier.** Measure every program
under each tier:

- **T1 (strict):** `RCX_INVESTIGATE` and `RCX_EXECUTE` name only the selected programs.
- **T2 (helpers):** as T1, plus investigation-only authority for the host's program directories
  (for Homebrew both `/opt/homebrew/bin/` and `/opt/homebrew/Cellar/`; links into another
  directory are refused by design). Helpers run only in the sandbox; `RCX_EXECUTE` is unchanged.
- **T3 (helpers and samples):** as T2, plus `RCX_SAMPLE_ROOTS` naming package directories of
  *public* assets that the evaluator chooses, such as installed documentation or package test data.
  It never names a home directory or private files.

**4. Tasks are hidden.**

- **Content.** The evaluator writes at least four tasks that need the selected programs. At least
  two must need a composition of two or more acquired capabilities, and at least one must carry a
  hard requirement ("without losing information").
- **Sealing.** Tasks, inputs (made by tools other than RightClick), oracles and thresholds are
  sealed and hashed before any arm sees a task.
- **Oracle validation.** Each oracle is first checked against correct and corrupted reference
  answers.

**5. A safety-equivalent saved-script baseline.**

- **Same conditions.** It gets the same programs, the same authority tier, the same task budget, an
  equivalent confinement wrapper, and the same obligations: identity pinning, independent output
  validation, refusing rather than returning a wrong result, and a README for fresh agents.
- **Tested, not trusted.** Its safeguards are tested, not taken from its README.

**6. Fresh-agent inheritance.**

- **Acquisition.** Each arm has one acquisition session.
- **Reuse.** Each task gets its own fresh reuse session, with only the inherited state or toolkit.

**7. Measures (all reported, for both arms):**

- **Acquisition:** the proportion of programs empirically acquired, per tier (established and
  composable, established but not composable, declared-only, unknown).
- **Composition:** automatic composition success, with no plan written by the caller.
- **Correctness:** against the independent oracles.
- **False results:** false successes and silent errors, plus correct refusals.
- **Quality:** output quality (exact or lossy).
- **Cost:** full model tokens for acquisition and for reuse, wall time, and repeat-use cost at 1,
  5 and 20 uses.
- **Human intervention.**

## Thresholds (from the mandate; not to be lowered after testing)

| Claim | Threshold |
|---|---|
| Acquisition | at least 4/6 unfamiliar programs empirically acquired, without bespoke integrations (state the tier) |
| Composition | at least two useful automatically planned workflows that meet independently assessed requirements |
| Inheritance | a separate agent uses the retained abilities without rediscovery |
| Correctness | no silent incorrect success; failures and unestablished outcomes are reported distinctly |
| Quality | hard requirements are kept, or the route is refused |
| Economics | a measurable advantage over the saved-script baseline at equal assurance, or a clearly demonstrated difference in acquired functionality that justifies the extra cost |

## Harness (product-neutral, in this repository)

- **The MCP client.** `experiments/binary-acquisition/harness/rcx.mjs` drives the frozen server
  over stdio as a host does, closes its stdin so it saves state, and logs every call.
- **The held-out runner.** `experiments/binary-acquisition/generalisation.mjs` runs learn,
  established capabilities and an independent oracle per program. Extend its `MAKERS` and `FFCODEC`
  tables for the evaluator's formats.

## What the developers expect to fail (stated before the evaluation)

- **Many-to-one programs**, such as an animation maker that needs several frames. They are outside
  the one-input, one-output capability model.
- **Programs whose format choice needs a value option** (`-s format gif`, `--depth 16`). Only
  value-less flags are explored.
- **Formats with no validator, no witness pair and no producer on the host**, such as audio without
  an audio decoder. They stay unknown, by design.
- **Programs that do not work on the host**, such as a build with a feature disabled. They stay
  unknown, correctly.
