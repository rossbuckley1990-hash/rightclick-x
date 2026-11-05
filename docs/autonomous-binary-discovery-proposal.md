# Proposal: autonomous empirical discovery of binary programs

**Status: a proposal for a later phase. None of it is implemented.** It follows an independent
acceptance evaluation of PR #57 (frozen commit `20bc3a7`). That evaluation found binary transport
byte-exact. It also found execution and storage defects, and it found that RightClick does not
learn binary programs by itself. The defects are listed first so that this proposal cannot be read
as replacing them.

## 1. What the evaluation found, and where each finding stands

| Finding | In `20bc3a7` | Status |
|---|---|---|
| CE2, CE3: a run that exited 1 was reported `completed`, with an empty or partial output returned as an artefact | yes | fixed on `fix/gauntlet-remediation` (exit-status contract) |
| CE5: the store bound held per process only; a truncated file was accepted on put; the read cache was unbounded | yes | fixed (lock-file accounting, verified atomic writes, bounded cache) |
| R5: a digest was permission to read | yes | fixed (random read grants; digests read nothing) |
| Retention: every input kept indefinitely | yes | fixed (inline inputs not stored; holds expire; release) |
| CE1: `--sort=numeric` gave `-n` a value | yes (a regression) | fixed |
| CE4: multi-value options learned with one value | yes (pre-existing) | fixed for documented placeholders |
| R11: a program-valued option read as a file role | yes | fixed for program- and directory-valued options |
| R8: provenance omits argv and which option consumed which file | yes | **open** |
| Access scoping by authenticated caller | none | **open**: one principal per runtime |
| L2 empirical acquisition: 1 of 6 programs | — | **open**: the subject of this proposal |
| L3 automatic composition of binary capabilities: no plan | — | **open**: the subject of this proposal |

The evidence for each fix is in
[`experiments/gauntlet-remediation/`](../experiments/gauntlet-remediation/README.md).

## 2. The gap

Five of the six held-out programs stayed `declared-only`. RightClick's generic samples are text.
A TIFF copier, a WebP decoder, an ASN.1 encoder and a gettext compiler reject text, so every
investigation trial failed, and nothing about their behaviour was observed. That one fact has four
consequences:

- **The contract comes from documentation only,** and nothing corrects its parsing errors (CE1, CE4).
- **No exit code can be given a meaning.** Since the remediation, only exit 0 counts.
- **Planning refuses the capability.** It is never chosen by automatic composition, and publishing
  it as a goal is refused.
- **Nothing independent checks the output.** Results are never `verified`.

In the evaluation the calling agent did all of the learning (Level 1). Closing the gap means
RightClick must obtain valid inputs, observe behaviour on them, and check the outputs itself.

## 3. Design

### 3.1 Bounded synthetic binary fixtures

A fixture library keyed by media type, independent of any program:

- **Generators.** Each produces minimal valid instances of a container format (TIFF, PNG, WebP,
  ZIP, DER, PO/MO, MP4 boxes, …) from a seed, plus controlled mutations: truncated, wrong magic,
  extra trailing bytes, one corrupted length field.
- **Bounds.** At most 64 KiB per fixture and at most 16 fixtures per investigation, from
  deterministic seeds, so an investigation stays reproducible and cheap.
- **Independent validation.** Every generated fixture is checked by a structural validator that
  shares no code with the program under test. A fixture that does not validate is never used.
- **Fixtures choose formats, not programs.** The format comes from the program's documentation
  (the words "TIFF", ".webp" or "DER") and is confirmed when the program accepts a valid fixture
  and rejects its mutations.
- **Other sources, recorded as such:**
  - an operator-approved sample corpus, pinned by digest;
  - outputs of other capabilities, once a witness has verified them, so that one learned encoder
    can feed its decoder.

**The risk of disguised adapters.** Format generators are format knowledge, not program adapters.
But they grow with the number of formats, and one written to match a particular program would be a
bespoke integration. To guard against that, generators come from format specifications, a program
may never select or configure its generator, and an acceptance evaluation must include formats for
which no generator exists. Those formats show what RightClick learns without help.

### 3.2 Verified file-role learning

A documented file option gets an **observed** role only from controlled experiments.

- **Read.** Change the content of the file the option names and see the output change. Remove the
  file and see an error that names it.
- **Write.** The program creates the named file in the sandbox's private directory and does not
  create it when the option is omitted.
- **Arity.** Supply 1 to k values and record which counts produce a usage error and which a
  result: `-crop` takes 4, `-c` takes one value from a set.
- **Operand syntax.** Variants such as `file,N` or `-` for stdin are found the same way, from
  documented examples that are confirmed by a run.

Each role, arity and operand form carries its trials as evidence, like `exitSemantics` does today.
Documentation stays the source of what to try, and runs decide what is true. A disagreement is
reported as a contradicted claim, never silently resolved.

### 3.3 Exit semantics from controlled pairs

Pairs of a valid fixture and its mutation give each exit code a meaning with evidence: success,
input rejected, or a semantic nonzero code such as "differences found". This extends what the
remediation records for text programs to binary ones. The run-time re-check stays unchanged: a
code is a success only when this run shows that code's basis.

### 3.4 Typed artefact ports

Artefacts get media types in the type lattice (`bytes:image/tiff`, `bytes:application/x-der`, …).

- **Assigning a type.** A port is typed only from observation: the output's magic number, confirmed
  by the media type's structural validator, on at least two fixture runs.
- **Planning.** The planner binds ports by media type, so `context_compose` can plan `dwebp` →
  `tiffcp` and publish a goal with pinned options.
- **No guessing.** An untyped artefact stays `json`-opaque and is never bound by a guess.

### 3.5 Independent witnesses

A witness per media type is a structural validator with a semantic check where the format allows
one: page count, image dimensions, catalog entries, DER structure.

- **Grading.** A result is `verified` only when the witness confirms the outcome the caller asked
  for. Otherwise it is `checked` (structure only) or `unverified`.
- **Separation.** Witnesses are separate implementations, never the program under test.

### 3.6 Promotion

A `declared-only` capability becomes **observed** only when all of these hold:

- valid and mutated fixtures produced consistent, deterministic behaviour;
- at least one file role or exit meaning was confirmed;
- the witness validated the outputs.

A caller's successful run alone never promotes a capability. A run with operator approval and a
witness-verified outcome may contribute evidence, recorded as such.

## 4. How it would be judged

The phase should be judged by a new independent evaluation with the rules it recommended:

- **Programs.** New programs, chosen after a freeze, including formats with no fixture generator.
- **Level 2 is required.** The share of capabilities RightClick promotes by itself, compared with
  the share the calling agent had to supply.
- **Level 3 is required.** At least one automatically planned binary workflow that fresh agents
  run without rediscovery.
- **Equal assurance.** The saved-script arm keeps its independent verification. RightClick's
  results are compared at the same assurance level, so a cheaper unverified result is not counted
  as a win.
- **Pre-registered thresholds.** The previous sealed band (at least 4 of 6 acquired, counting
  declared-only) was too lenient.

## 5. Costs and honest risks

- **Saved scripts can do all of this too.** A competent agent can write fixtures, validators and
  role tests for one program. RightClick's case is only that the machinery is general, persists,
  and is reused across programs and agents. That must be measured, not assumed.
- **Per-format work grows with formats.** If most programs need a new generator and witness, the
  advantage over scripts shrinks to what is shared.
- **The investigation budget grows.** Today an investigation runs about 20 to 24 sandboxed trials.
  Fixture and role experiments add trials; the cap must stay explicit and reported.
- **Security.** Fixtures and mutations are synthetic and bounded, and run only in the sandbox.
  Operator corpora are digest-pinned. No host file is ever read as a sample.

## 6. Phases

1. A fixture library and witnesses for three formats. Promotion rules, without composition.
2. File-role and arity experiments. Contradicted documentation reported.
3. Typed ports and planning across two formats, with goals published with pinned options.
4. An independent acceptance on unseen programs, Level 2 and Level 3 required.

Each phase ends with a frozen candidate and its own acceptance. Nothing here changes the verdicts
already reached: binary engineering CONDITIONAL GO at `20bc3a7`, autonomous acquisition NOT
ESTABLISHED, competitive advantage NOT ESTABLISHED as a general advantage.
