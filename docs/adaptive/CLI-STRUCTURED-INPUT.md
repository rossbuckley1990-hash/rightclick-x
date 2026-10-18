# Structured command-line inputs

This addresses the recorded developer-experience blocker in the release assessment. Before this change, `rcx run` and `rcx compose` accept only string-valued `k=v` inputs. Unrecognised arguments are silently ignored; array/object values cannot be expressed. Runtime failure objects also leave a successful process exit status. The existing MCP interface supports structured values, so the CLI should forward the same values without introducing another execution path.

Preregistered behavior: `--args JSON` or `--args-file PATH` supplies one JSON object; `--args-file -` reads standard input. These forms are mutually exclusive with each other and with `k=v`. Existing scalar assignments stay strings. Duplicate flags/keys, unknown arguments, malformed/non-object/lossy JSON, invalid UTF-8 and oversized input refuse before runtime creation. Reuse the existing JSON fidelity parser; do not silently round numbers or collapse duplicate keys. No input field supplies operator authority. Existing runtime restrictions and outcome checks apply. Failed execution or an executed composition with no successful plan exits nonzero while retaining its JSON result.

Reproduce baseline failures, then test both commands, literal content, file/stdin input, error handling and operator refusal. Verify a clean installed CLI with a retained real program requiring options arrays and named-file maps, plus fresh-process reuse, without a provider-specific adapter. Preserve failed experiments, run appropriate regression/typechecks and retain the fixed thirteen-tool interface. This is a developer-path correction, not an independently measured usability or economic advantage; all original release and commercial gates remain binding.

The first test draft incorrectly referred to a nonexistent `builtin:json.stringify`; its source and log are retained as a harness error. It is not a product-defect count. The corrected tests learn an actual local OpenAPI echo contract and inspect the complete request received by that owned fixture. All six corrected initial checks fail on the original source, then pass on the implementation. Two further checks cover the 16 MiB limit and shell failure status for unsuccessful composition/refuted verification. No previously passing acceptance test is relaxed.

The first packaged attempt at `504de12` discovers `json_xs` but fails when the harness assumes it consumes named file operands. Its documentation and the recorded native error show that this program reads stdin; it receives an empty document instead. All commands, the package and the failed run are retained. A generic staging port is not evidence that a particular program reads file operands. The revised harness keeps `json_xs` for stdin plus option-array checks and adds the explicitly authorised, normally discovered `/usr/bin/sort` for real named-file maps and operand arrays. This corrects the fixture assumption and expands it to five successful required outputs; no product change or permission broadening after discovery is used to rescue the failed call. File inputs are preserved alongside the raw command logs.

## Result

Product, tests and README are frozen at `504de121804f272375c444448ec61885f1d2b708`. The corrected installed-workflow harness is `9c271553bc7d1274716e5cacc7e6d7c125996ebb`; the separate checker is `337f11340b8366c3d348326524ce7a32b91f1ea9`. Both retain identical product source. The original baseline is `8fffc02de6c76427e00374c1b77f30165c15f564` on the same programme branch.

| Check | Observation |
|---|---|
| Final eight tests on original source | Eight expected failures, zero skips; earlier invalid harness remains separate |
| Native regression / typecheck | 291/291, zero skips; typecheck passes; Node 26.12.0 on macOS 26.4.1 |
| Frozen Linux CLI/interface tests | 14/14, zero skips; cached Node 24.22 image, network disabled, source read-only |
| Frozen black-box proof | 28/28; source unchanged |
| Offline installed CLI | Five correct outputs: three JSON stdin/option-array cases and two named-file/operand-array cases |
| Reuse and restrictions | Fresh process for each command; retained reflections unchanged; investigation permission absent after initial operator command; deny-all execution policy refuses with nonzero exit |
| Packaging/interface/removal | 413,423 bytes; empty install directory/cache; thirteen MCP tools; uninstall passes |
| Separate Python checker | Package source bytes match 47 frozen files; recorded inputs, actual returned values and receipt digests agree; four corruption controls rejected |

The checker rejects wrong output even with an updated output digest, substituted input, a hidden invocation and an elevated `verified` grade. All five task outputs are correctly labelled `unverified` by the runtime; the fixture's separate oracle checks their actual content. It is the same author using a different implementation and process, not independent-author validation or native-call tracing. The test proves this installed developer path, not a new model/vendor transfer result.

The final attempt records 21 command invocations, including build, install, investigation, explanations, execution, policy refusal, MCP enumeration and removal. The prior failed package attempt, its package and every command remain preserved. Raw timings are available but no latency advantage is claimed. This does not establish unfamiliar-developer usability or superior economics; the earlier adverse A/B/C/D results and all original thresholds remain unchanged. Both programs are exposed development targets. `sort` has been added to the exclusion list for every future holdout.

CLI input files are read by the host CLI process before runtime creation. The program sandbox governs subsequent program execution; this feature does not extend containment to arbitrary host-file access or other agent tools. The real-program aliases are staged outside the existing home-directory sandbox exclusion. That private-program installation limitation remains open. The Actenon/core runtime source is unchanged in this checkpoint, so its prior source-bound authority evidence remains scoped to its original fixtures.

## Reproduction

From a checkout retaining the frozen history, export product `504de12` into a new directory. Include `src`, `bin`, `ci`, `test`, `proof`, `demo`, `package.json`, `tsconfig.json`, `README.md` and `LICENSE`. Use the harness/checker from `337f113` (which includes the corrected harness and the same product). On this supported macOS fixture host with Node, npm, Bun, a working native sandbox, `/usr/bin/json_xs` and `/usr/bin/sort`:

```sh
node experiments/north-star/cli-input-package.mjs SOURCE_EXPORT 504de121804f272375c444448ec61885f1d2b708 NEW_OUTPUT_DIR
python3 experiments/north-star/check-cli-input-package.py NEW_OUTPUT_DIR
```

The harness refuses an existing output directory or source mismatch, builds and packs locally, installs from the local tarball using an empty offline cache, runs only synthetic local tasks and uninstalls. The tarball and raw records remain in the output directory. Run `npm run typecheck` and `npm test` in the source checkout; `node proof/run.ts 20261018` runs the loopback-only black-box proof. Linux uses the existing immutable image `sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5`, `--network none`, the export mounted read-only and `node --test test/command-input.test.ts test/interface.test.ts`.

`evidence/cli-structured-input-verification.json` binds the source, failures, package, logs, checker and reports. Release remains **NO-GO**. Continue the comparative unfamiliar-software programme; the slow repeated-publication diagnostic is a concrete remaining performance investigation while the independent Claude evaluation route is quota-blocked. No live models, paid service, push, merge, publication or outreach was used.
