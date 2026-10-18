# CLI option grammar and reserved-option collisions

Status: reproduced and corrected at source freeze `1c9fa6a`; full mission PARTIAL, release NO-GO. No original acceptance criterion changes.

The previous diagnostic left dynamic selector families unsupported. Auditing that gap found a prerequisite defect in the existing compact-option grammar: a known excluded `-delete` can be accepted as an attached value for allowed `-d`; an excluded `-erase` can be accepted as a bundle of individually allowed letters. The original token is then passed unchanged, allowing the program to interpret the excluded operation. A generic disposable fixture will test both collisions alongside permitted separated/attached value controls. All effects are confined to supplied disposable sandbox files. This is an admission/semantic defect, not evidence of a host-sandbox escape or universal containment.

Freeze the harness, preserve its before output and source hashes, then require both excluded forms to refuse with zero execution and no healing. Preserve permitted controls and the existing exposed-task results. Check the ordinary parser's ambiguous synopsis expansion too: a single-dash word does not establish every constituent short option. Any correction must retain exact documented declarations without fabricating new flags. Run generic adversarial regressions, complete type/regression/build/package checks, and separate raw-artifact verification.

Dynamic families will not be opened with a broad `-NAME` wildcard. ExifTool's locally inspected enumeration contains hundreds of kilobytes, and selector spelling can collide with literal control options. A closed vocabulary, accurate collision handling, bounded agent-facing contracts and safe revalidation need evidence before promotion. Existing family refusals remain visible; the declared `-TAG` placeholder does not authorize arbitrary parameters. Actenon remains the separate candidate for independent exact-action enforcement; this parser cannot replace it.

```sh
node experiments/north-star/cli-option-collision.ts /tmp/rcx-options-before.json
```

Frozen reproduction `e3b721a` confirmed both excluded forms were dispatched and returned `REMOVED`; the allowed separated/attached controls returned the original record with the requested format. The [before artifact](evidence/cli-option-grammar/before.json) retains exact argv and runtime outputs. These observations establish dispatch of the excluded fixture branch; they do not claim an independently observed production resource effect.

The correction retains documented exclusions in each invocation contract and checks them before interpreting compact spellings. Allowed short bundles and attached values are expanded to separate documented flags and values before dispatch, so the native parser never receives an ambiguous combined token. A synopsis word such as `-except` no longer invents `-e`, `-x`, `-c`, `-p` or `-t` flags. A documented whole spelling remains available; individual letters need their own declarations. Existing unit expectations that asserted fabricated letters or raw compact argv are corrected to assert the stricter contract; no benchmark task or acceptance threshold changes. Semantic version 22 re-derives cached contracts on runtime upgrade.

The first targeted test run passed the new security regressions and failed one old message assertion: excluded `-o` is now accurately labelled excluded rather than undocumented. That failed log is retained as `targeted-attempt1.log`; the assertion now requires the explicit exclusion message, with the original failed-status/no-healing requirements preserved.

## Frozen result and remaining scope

At `1c9fa6a`, the identical fixture has **zero excluded dispatches** and two explicit refusals, versus two excluded dispatches before. Both permitted format controls still return the requested format and unchanged file content. The compact control now reaches the process as `-d compact`, rather than a potentially ambiguous single token. The [separate Python checker](../../experiments/north-star/check-cli-option-collision.py) validates frozen source hashes, unchanged fixture source, actual argv, outputs and zero-dispatch refusals. Its negative control rejects a claimed refusal containing an execution event. This is a separate implementation by the same author, not independent-author security review.

Generic regressions also verify refusal without healing after state reload and after knowledge import/revalidation; canonical short bundles; conflicting aliases; optional-value ambiguity; and no fabricated synopsis letters. The full freeze passes **248/248 tests with zero skips**, both typechecks, both builds, offline package/thirteen-tool/uninstall checks and **28/28 black-box lifecycle checks**. Repeating the unchanged exposed-file diagnostic retains **12/16** exact direct-output matches and four dynamic-selector refusals, checked separately from raw artifacts. [Verification and hashes](evidence/cli-option-grammar/verification.json) bind all results and retained failures.

Reproduce with a working host sandbox and a new output filename:

```sh
node experiments/north-star/cli-option-collision.ts /tmp/rcx-options-new.json
python3 experiments/north-star/check-cli-option-collision.py docs/adaptive/evidence/cli-option-grammar/before.json /tmp/rcx-options-new.json
npm run typecheck
npx --no-install tsc -p tsconfig.harness.json
npm test
npm run build
node ci/adaptive-package-smoke.ts
```

The initial vocabulary inspection is retained as [raw enumeration](evidence/cli-option-grammar/selector-list.txt) and [inventory](evidence/cli-option-grammar/selector-inventory.json): the exposed installed tool prints 399,235 bytes. This supports a bounded-interface requirement for future family discovery; it does not show that automatic family discovery works. No wildcard expansion has been enabled. All four ExifTool cases remain open.

The correction enforces the learned invocation grammar, not all possible native parser behaviors or consequences. Provider documentation can be incomplete or misleading; option values can have program-specific meaning. In-process admission is not independent authority, and the host sandbox is not universal execution-surface containment. Prior Actenon fixtures retain their own exact source freezes and limits. Real-model transfer, new holdouts, fair baseline economics, released optional installation and independent-author review remain required. No model call, external effect or spending occurred; the subscription pilot remains on its earlier quota-blocked freeze.
