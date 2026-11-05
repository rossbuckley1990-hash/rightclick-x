# Capability bootstrapping: development evidence

This branch follows the PR #60 research evaluation, which acquired 1 of 6 held-out programs,
composed a needlessly lossy route, and lost to a saved-script agent on quality and on repeat-use
cost.

**Everything here is development evidence.** The session that built the code ran these
experiments, and the six programs measured are now known development cases. Whether the
architecture generalises is for the independent acceptance in
[`docs/acceptance-handoff-capability-bootstrapping.md`](../../docs/acceptance-handoff-capability-bootstrapping.md),
which has not been run.

## Source identity

| | Commit | Tree |
|---|---|---|
| PR #60, the comparison point (unchanged) | `97a8ac6` | `71abe8ce1ed118e8ace8bd240abbcac667844eb9` |
| main merged in | `fc5710e` | |
| **Source measured here** | `cb30f68` | `4325c7dc837ca70a7f8b07a61e28fca97a513f05` |

Later commits on this branch add only evidence and documentation.

## 1. Why PR #60 acquired 1 of 6

| Program | The missing capability | Class |
|---|---|---|
| `tiff2bw` (acquired) | nothing: a generator, a validator and a positional form were all available | — |
| `pngtogd` | output GD has no validator, so no witness. On this host libgd disables GD ("GD image support has been disabled"), so the program does not work. | missing witness; does not work here |
| `jpgicc` | JPEG has a validator but no generator, and no producer was ever sought | missing sample pathway |
| `giffix` | its usage says "GifFile", which the word rule did not read as GIF; and there were no GIF samples | documentation interpretation; missing sample pathway |
| `avifdec` | AVIF has no validator and no generator, and there were no samples | closed-world formats; missing sample pathway |
| `lame` | WAV and MP3 have no validator and no samples | closed-world formats; missing sample pathway |

**The common cause.** Format knowledge was a closed, hand-written library. Samples came only from
that library's generators. Each program was investigated alone, and only once. Four of the five
failures share this cause. The fifth (`pngtogd`) is a program that does not work on this host.

## 2. The architectural change

The change is one acquisition loop over all authorised programs, in which each acquired ability
supplies evidence for the next (`src/reflectors/binary-acquisition.ts`, and the bootstrapping
methods in `src/runtime.ts`).

1. **Witnessed formats.**
   - The extensions a program's usage gives its operands name provisional formats, with an input
     or output role (`output.[jpg|png]`, `input.avif`).
   - A provisional format is established only when one capability turns a known format into it,
     and another recovers the original's facts from the result.
   - It is then recognised by the leading bytes its witnessed samples shared.
2. **A sample pool with provenance.** Samples come from:
   - generators;
   - operator-approved sample roots (`RCX_SAMPLE_ROOTS`), recognised by structure and never by
     extension;
   - the sandboxed outputs of established capabilities and of candidates.

   A sample from a producer proven lossless can show that a decoder is exact.
3. **Decoders as witnesses.** A fact a format cannot show itself (the pixels of a WebP or an AVIF)
   is read through an acquired decoder, both at acquisition and at run time.
4. **Flag experiments.** Documented value-less flags are tested on controlled inputs. A flag that
   selects another format (`dwebp -ppm`), or that keeps more (`cwebp -lossless`,
   `avifenc --lossless`), becomes its own established variant. A flag's name is never trusted:
   decoded pixels are compared.
5. **The bootstrapping loop.** After every learn, a program with an open question is revisited when
   the evidence it lacked appears. Open questions are formats with no samples, candidates nobody
   witnessed, and fidelity not yet proven. Helper programs in directories the operator authorised
   for investigation are screened by their usage (they must name the needed format and an input
   RightClick can already sample), then investigated as producers.
6. **Goal-aware composition.**
   - Bytes routes are ranked by fidelity proven from evidence, then by primitive step count. A
     saved pipeline counts as all of its steps.
   - `preserve` (for example `["pixels"]`) is a hard constraint.
   - The result is checked again, independently, against the input. A fact that cannot be confirmed
     means the result is not established.
   - With no qualifying route, the answer says which step lacks the proof.

**The five defects**, each with a regression in `test/capability-bootstrapping.test.ts`:

1. Re-learning now uses new evidence.
2. Composition is fidelity-aware, with hard constraints.
3. `context_actions` reports availability, and reaches only through capabilities that run now, each
   with its route.
4. Format-selecting and fidelity flags are tested.
5. A missing or unknown run id gets an actionable refusal, with suggestions and no guessing.

## 3. Measured on the six (known) programs

The source is `cb30f68`, measured under the three authority tiers the acceptance handoff defines
(`evidence/tiers/development-six.json`):

| Program | T1 strict (PR #60's protocol) | T2 + investigation-only helpers | T3 + one approved sample root |
|---|---|---|---|
| `tiff2bw` | established, not composable (it drops pages) | same | same |
| `jpgicc` | unknown | **acquired**: JPEG samples from `cjpeg`, a discovered helper | **acquired**: JPEG samples from `avifdec`'s outputs on `avifenc`'s AVIFs |
| `avifdec` | unknown | **acquired**: AVIF witnessed through `avifenc` (a discovered helper) | **acquired** |
| `giffix` | unknown | unknown (the GIF helpers found need several frames or read GD) | **acquired**: GIFs from the approved package documentation root |
| `pngtogd` | unknown | unknown (GD is disabled on this host) | unknown |
| `lame` | unknown | unknown (nothing witnesses audio) | unknown |
| **Empirically acquired** | **1/6** | **3/6** | **4/6** |

The T3 result meets the 4/6 target. It does so on programs that are now development cases, after
seeing why they failed, so it shows the mechanism, not generalisation. Under PR #60's strict
protocol, the result is unchanged at 1/6.

**Development programs** (`cwebp`, `dwebp`, `avifenc`, `avifdec`, `ppm2tiff`), with all goal-aware
compositions found and executed automatically:

| Request | RightClick's answer |
|---|---|
| PNG → TIFF, `preserve: ["pixels"]` | `cwebp -lossless` → `dwebp -tiff`. Both flags were discovered by experiment; pixels confirmed end to end. |
| lossy WebP → AVIF, `preserve: ["pixels"]` | `dwebp` (shown exact) → `avifenc --lossless`. Pixels confirmed end to end; AVIF has no validator in RightClick. |
| PPM → WebP, `preserve: ["pixels"]` | **refused**: "no route is proven to keep pixels … cli:cwebp:tiff-to-webp". Correct: on this host `cwebp` takes no PPM, and its TIFF route is not proven lossless. |
| PPM → WebP, no requirement | `ppm2tiff` → `cwebp` (lossy), the shortest route |

## 4. Demonstration: an unfamiliar format, acquired, saved, and used by a fresh agent

**The unfamiliar software.** `avifenc` and `avifdec` (libavif). RightClick's format library
registers no AVIF validator and no AVIF generator (`evidence/demo/acquisition.json`,
`avifKnownToLibrary: false`).

**Acquisition: one `context_learn` call through the frozen MCP server, 9.1 s.**

- **What RightClick established, by its own experiments:**
  - `png`, `jpeg` and `y4m` → `avif`;
  - `avif` → `png`, `jpeg` and `y4m`;
  - `png` → `avif` with `--lossless`.
- **How AVIF became known.** `avifdec` recovered the width and height of `avifenc`'s inputs from its
  outputs. The format is now recognised by its witnessed signature `00000020667479706176696600000000`
  ("ftypavif").
- **How losslessness was shown.** The lossless variant was found by testing `avifenc`'s documented
  flags. It keeps width, height and pixels, witnessed by decoding with `avifdec`, in 4 recorded
  trials.

**Reuse by a fresh agent.**

- **Its inputs.** A new session with no history received only the inherited state, `./rcx`, and the
  task: "the same picture as an AVIF file, without losing any information". It was given no command
  sequence.
- **What it did.**
  - It found the capability with `context_graph` and `context_explain`.
  - It asked `context_compose` for `bytes:x-ext/avif` with `preserve: ["pixels"]`. The planner chose
    `cli:avifenc:png-to-avif-lossless` by itself.
  - RightClick confirmed `pixels` on the result, and the agent saved the artefact.
- **Its cost.** 8 calls, 91,123 tokens, 98.5 s. No `context_learn`, no rediscovery, no script, no
  human help.

**The output.** `evidence/demo/photo.avif`, 10,009 bytes, SHA-256 `b66cb789…`, made from
`evidence/demo/photo.png` (320×240, generated by `ffmpeg`, not by RightClick). It opens in any
AVIF-capable browser.

**The independent outcome check.** `ffmpeg` with libdav1d is independent of RightClick and of
libavif. It decodes the answer as a 320×240 AV1 image, with **PSNR r, g, b and average all infinite
against the input: the pixels are identical** (`evidence/demo/independent-check.txt`).

## 5. Comparison with saved scripts (critical)

**What PR #60 measured.** A saved-script agent with equal safeguards matched RightClick's
correctness, produced better quality (2/2 exact against 1/2), and was cheaper per reuse and in total
after two reuses.

**What this branch changes, and what it does not:**

- **Quality.** The planner now finds exact routes, and refuses lossy ones when exactness is
  required. That removes the quality loss PR #60 measured on its tasks (development evidence only).
- **Acquired functionality grows without integration code.** One acquired capability made the next
  acquirable: `avifenc` → `avifdec` → `jpgicc`. A saved-script agent can do the same, but only by
  writing and maintaining each converter and validator itself. This is the potential advantage. It
  is unmeasured here.
- **Per-reuse token cost is not shown to be better.** The fresh agent used 91,123 tokens for a
  one-step task. PR #60's saved-script reuse agents used 72,313–77,809 tokens for comparable tasks.
  RightClick's interface adds discovery calls (`context_graph`, `context_explain`) that a
  well-documented toolkit README avoids.
- **Missing classes of program.** Programs that need value options, many-to-one programs and
  formats with no witness stay unknown. A coding agent can handle each of these case by case.

**Verdict on competitive advantage: NOT ESTABLISHED.** It is not CONTRADICTED by new evidence,
because no new comparison was run. It awaits the independent evaluation, which must include the
saved-script baseline.

## 6. Verdicts (development evidence; independent acceptance outstanding)

| Claim | Verdict |
|---|---|
| Engineering reliability | **CONDITIONAL GO.** Every completed run was correct against the independent oracle. Hard constraints were refused or confirmed. CI is recorded on the PR. The condition: independent acceptance, and the limits listed above. |
| Autonomous acquisition | **PARTIAL.** 4/6 at T3, 3/6 at T2 and 1/6 at T1, on known programs. Not yet shown on unseen programs. |
| Automatic composition | **DEMONSTRATED** on development programs: three lossless, automatically planned workflows were confirmed independently, and one impossible requirement was correctly refused. |
| Competitive advantage | **NOT ESTABLISHED.** |
| Commercial readiness | **NOT ESTABLISHED.** |

## Deviations and limits

- **A development test changed.** One PR #60 test now expects the planner's new fidelity-first
  choice (a 3-step exact route over a 2-step lossy one).
- **`tiff2bw` is not composable** because one generated fixture has two pages and `tiff2bw` keeps
  only the first. This is correct behaviour, and it shows the result depends on the fixtures.
- **Helper discovery is bounded and name-led.** Candidates are found by the format's name in program
  names, then screened by their usage. A producer whose name does not carry the format (`ffmpeg`)
  is not found.
- **One local test fails for environmental reasons.** `C2 sandbox: memory use is bounded` fails on
  this machine under memory pressure, on main's tree as well. It passed in CI.
