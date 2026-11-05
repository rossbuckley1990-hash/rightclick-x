# Autonomous binary acquisition: Stage 2 experiments

These experiments test whether RightClick can establish binary capabilities from installed programs by its own experiments, compose them automatically, and hand them to a fresh agent, and whether that beats an equally careful agent that writes and keeps scripts.

**This is development evidence, not an independent evaluation.** The session that built the code designed the tasks and ran the experiments. Each cell was run once. All agents were fresh Claude Opus 5.5 subagents with no conversation history.

## Source identity

| | Commit | Tree |
|---|---|---|
| Integrated base: PR #57 with PR #59 | `4559119` | `9be85a5` |
| **Frozen for these experiments** | `3da8d04` | `85d30d83ba8ba4cbbaabd16aab314bf56dc3e64b` |

The experiments ran against a `git archive` of `3da8d04`. Later commits change only tests and evidence.

## What was built (in `3da8d04`)

- **Validators:** structural validators as independent witnesses, plus an exact `pixels` fact for decodable images (`src/core/formats.ts`).
- **Fixtures:** specification-derived and bounded, sharing no code with the validators (`src/core/fixtures.ts`).
- **Acquisition:** documentation nominates formats and output options; experiments decide (`src/reflectors/binary-acquisition.ts`). A transformation needs:
  - two distinct valid inputs;
  - a repeat run;
  - outputs that validate.

  The facts the output keeps become run-time checks, and an acquired encoder's outputs feed the investigation of its decoder.
- **Types:** a `bytes:<media type>` lattice that never reaches text or JSON.
- **Execution:** every run re-establishes the contract. It also writes an invocation record (R8).
- **Composition:** an incoming artefact is identified by its structure. A transformation that changes shared facts (size, pixels) is never composed automatically.

## Experiment 1: held-out generalisation

**Selection.** After the freeze, a fresh agent chose six installed programs whose names do not appear in the repository at `3da8d04` (`evidence/selection/selection.json`, SHA-256 `04a87060…`, sealed before any run):

- two whose input RightClick can generate (PNG, TIFF);
- two whose input it can only validate (JPEG, GIF);
- two with formats unknown to it (AVIF, WAV/MP3).

**How it was judged.** `generalisation.mjs` learned each program through the frozen MCP server. It then ran every established capability on held-out inputs made by `ffmpeg`. Each result was judged by `ffprobe`.

| Program | Category | RightClick's result |
|---|---|---|
| tiff2bw | generate | **Established tiff → tiff** (11 trials). On a held-out TIFF, `ffprobe` confirms a 52×36 TIFF. It is tagged `unsupported` for composition, because it changes the pixels (greyscale). |
| pngtogd | generate | Not established. The output is GD, a format no validator checks. |
| jpgicc | check | Not established. There are no JPEG samples: no generator, and no acquired JPEG producer. |
| giffix | check | Not established. Its usage names "GifFile", which the format-word rule does not match. |
| avifdec | unknown | Not established. AVIF is outside the library. |
| lame | unknown | Not established. Audio formats are outside the library. |

**Result: 1/6 acquired. The other 5 were correctly left unknown, with no false capability.** The `giffix` miss is a limit of matching documentation words, and it was deliberately not "fixed" after seeing these results. The saved-script arm was not run on these programs.

## Experiment 2: fresh-agent inheritance, and the saved-script comparison

**Programs:** `ppm2tiff`, `cwebp` and `dwebp` (development cases).

**Arms:**

- **Arm R:** an agent reaches RightClick only through `./rcx` (the frozen MCP server) and may not write scripts.
- **Arm S:** an agent builds a toolkit and must add confinement (the same `confine` wrapper), SHA-256 pins, independent validation, all-or-nothing output and a README.

**Phases:** each arm has one acquisition agent, then one fresh reuse agent per unseen task. The reuse agents see only the inherited state or toolkit and a sealed task (`evidence/tasks/`).

**Inputs and oracle:** the inputs are made by `ffmpeg`. The oracle (`oracle.mjs`) is `ffprobe` for format and size, plus PSNR ≥ 15 dB against the input; infinite PSNR means exact.

| | Arm R (RightClick) | Arm S (saved scripts) |
|---|---|---|
| Acquisition | 114,790 tokens, 311 s, 27 calls, no scripts | 132,657 tokens, 936 s, toolkit with a 62-check self-test |
| What was acquired | 6 single-step conversions plus composed routes, established by RightClick | 8 input × 6 output formats, using the programs' format options |
| T2: photo.ppm → WebP | **correct**, 18.3 dB (lossy), 74,794 tokens, 111 s, 3 calls; **automatic composition** | **correct, exact** (lossless), 72,313 tokens, 52 s |
| T3: scan.pgm → PNG | **correct, exact**, 101,483 tokens, 351 s, 14 calls; manual call to the declared-only `cwebp -lossless`, then an acquired capability | **correct, exact**, 77,809 tokens, 70 s |
| Total tokens (acquisition plus 2 reuses) | 291,067 | 282,779 |
| Malformed inputs (truncated, text, empty) | 3/3 refused, nothing run | 3/3 refused, nothing written |
| Silent errors | 0 | 0 |

**Break-even.** RightClick's acquisition was cheaper by 17,867 tokens, but each reuse cost about 13,078 tokens more. The saved scripts were therefore cheaper in total from the second reuse on, faster to reuse, and gave better quality: 2/2 exact against 1/2.

## Product defects these experiments found (in `3da8d04`, not fixed here)

1. **Re-learning ignores new samples.** When a decoder (`dwebp`) is learned before its encoder (`cwebp`), it acquires nothing, and re-learning it is a no-op ("already learned and unchanged"). The acquisition agent had to forget and learn it again.
2. **Route quality is not ranked.** The executor preferred a reused crystallised pipeline with an extra lossy WebP round trip over a satisfied 2-step plan (T2: 18.3 dB against 20.3 dB direct).
3. **`context_actions` overstates reach.** It lists PNG → TIFF as reachable, which `context_compose` correctly refuses.
4. **Only default output formats are acquired.** Format-selecting options (`dwebp -ppm`, `cwebp -lossless`) are not explored, so lossless routes stayed manual. This is the main reason arm S had wider coverage and better quality.
5. **A missing `id` gives an unclear error.** `context_run` without `id` fails with a `TypeError`, not a clear refusal (found through a harness bug).

## Deviations

- **The oracle threshold changed.** It was first set at 30 dB, then recalibrated to 15 dB on reference answers made outside both arms, after the arms had started but before any answer was examined. The reason: a correct `cwebp` encoding of the test picture scores 20.3 dB.
- **The first held-out run hit a harness bug.** The runner passed `capability` instead of `id`. It is kept as `evidence/generalisation/attempt-1-harness-error.json`, and the run was repeated.
- **A test changed after the freeze.** The real-program test asserted a route that the GitHub macOS runner's `cwebp` build cannot provide, because that build has no TIFF input. The test now asserts the correct behaviour on either build. The product source is unchanged.
- **The arms' prompts differ in one respect.** Arm R's reuse prompts describe `./rcx`, and arm S's reuse prompts point to `toolkit/README.md`.

## Verdicts

| Claim | Verdict | Basis |
|---|---|---|
| **Engineering reliability** (the tested binary capabilities execute faithfully and safely) | **DEMONSTRATED** for the tested development scope | All completed runs were correct by an independent oracle. Malformed input was refused before running. The contract is re-checked each run. CI is in the PR. Defects 1–5 remain. |
| **Autonomous acquisition** on development programs | **DEMONSTRATED (narrow)** | RightClick, not the agent, established 6 conversions for 3 programs, including a decoder for a format it cannot generate. The agent wrote no integration. |
| **Autonomous acquisition** on held-out programs | **NOT ESTABLISHED** | 1/6. Formats without a fixture source or validator stay unknown, which is correct behaviour, but it is not generalisation. |
| **Automatic composition** | **DEMONSTRATED** | T2 and the unit tests: the composer chose the capability sequence from typed contracts, with no plan from the caller. Its route choice is not quality-aware (defect 2). |
| **Fresh-agent inheritance** | **DEMONSTRATED** | T2 was solved in 3 calls without rediscovery. T3 used inherited capabilities plus a manual call. |
| **Competitive advantage** over a safety-equivalent saved-script agent | **CONTRADICTED** in this experiment (n=1 per cell) | Equal correctness (2/2 each). The scripts were exact 2/2 against 1/2, cheaper per reuse, cheaper in total after 2 reuses, faster, and covered more formats. |
| **Commercial value** | **NOT ESTABLISHED** | No customer evidence. |

## Reproduce

- **The tests:**

  ```bash
  node --test test/binary-acquisition.test.ts
  ```

- **The held-out run:**

  ```bash
  node experiments/binary-acquisition/generalisation.mjs <frozen-tree> evidence/selection/selection.json <work-dir>
  ```

- **The oracle,** for any answer:

  ```bash
  node experiments/binary-acquisition/oracle.mjs evidence/tasks/photo.ppm <answer.webp> webp
  ```
