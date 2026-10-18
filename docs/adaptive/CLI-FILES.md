# CLI invocation fidelity development experiment

Status: reproduced and corrected at source freeze `37394b0`; full mission PARTIAL and release NO-GO. Original acceptance thresholds and historical scores remain unchanged.

The next product checkpoint tests exposed xsubpp5.34, autom4te, lzdiff and exiftool cases against direct sandbox execution. The diagnostic supplies the existing oracle's options; this is deliberately **not** an agent, unfamiliar-software holdout or economic result. Its purpose is to distinguish invocation defects from agent selection/discovery failures. It retains every feasible task, including refused or unmappable invocations, and records exact inputs, actual argv/stdout, direct outputs, source hashes and capability contracts. Only temporary sandbox files may be written by the programs.

Suspected defects to test before changing product code: named files are always appended as operands, including option values; file names are silently rewritten and may collide or be interpreted as flags. Any fix must be generic, preserve documented option restrictions and operator authority, refuse ambiguous/invalid inputs before execution, and preserve existing failed evidence. Dynamic option families remain a separate discovery limitation; no application-specific tag allowlist will be added for this experiment.

Use a new output path:

```sh
node experiments/north-star/cli-files-diagnostic.ts /tmp/rcx-cli-files-before.json
```

Record the before result, add behavioral regression fixtures for demonstrated defects, freeze the corrected source and rerun the same diagnostic. Run relevant full regression/type/build/package checks after product changes. A separate checker must compare raw artifacts rather than trust the diagnostic's booleans. New holdouts, real model transfer, independent-author review and fair A/B/C/D economics remain required.

The first diagnostic at `cd6a061` selected the first graph provider's option declarations instead of the investigated program's declarations. This omitted option values in two cases and is a harness failure, not product evidence for those cases. Its complete [artifact](evidence/cli-files/attempt1.json) and log are retained. The corrected diagnostic uses the investigation keyed by the exact executable path before establishing the product baseline.

The corrected before run at `d890a05` matched direct output for 11/16 exposed cases. `xsubpp5.34#4` received `-typemap mytypemap paint.xs mytypemap`, instead of the reference's `-typemap mytypemap paint.xs`, and exited 255. All four dynamic ExifTool tag selectors were refused before execution. All four autom4te and lzdiff cases already matched direct execution. This is not a revision to the historical agent score.

Generic fixture regressions then failed all four tests on the unchanged product: no way to select auxiliary-file roles, lossy names/prototype-key handling, flag-like names reaching the process, and sandbox-level path rewriting. These failures are retained in `regression-before.log`. An initial test-only TypeScript union inference error was corrected by explicitly typing the list of file maps; it did not alter the cases.

The implementation now offers `operands`, an optional ordered list of names from `files`. Omission retains all files as operands; `[]` selects none. This is explicit because a filename-looking option value may be a pattern rather than a file. Every selected name must exist in the supplied map. File names are preserved, including spaces and Unicode; traversal, leading dashes, reserved `.rcx.` names, control characters, overlong names and portable case/normalization collisions are refused. The host sandbox also validates names and exclusively creates them, so filesystem-specific aliases cannot overwrite another supplied file. Invalid inputs cannot trigger execution, healing or retry. No new option is allowed and no program-specific rules are added.

Semantic version 21 causes existing cached contracts to be re-derived by the established migration path. Zero-investigation reuse applies only to state learned under this version, not migration across this upgrade. Program authorization and the existing sandbox remain required. The new operand selector is not independently enforced exact-action authority; Actenon's separately documented boundary is unchanged.

## Verified development result

The identical 16 exposed cases at frozen source `37394b0` now have **12 exact direct-output matches**, up from 11. The added match is the typemap case, whose actual argv now equals the direct oracle. All four ExifTool selector cases remain explicit refusals with zero program dispatch. Every case and complete contract is retained in [before](evidence/cli-files/before.json) and [after](evidence/cli-files/after.json). The diagnostic uses known reference options and, when the capability exposes it, their explicit operand list. It does not demonstrate that an AI agent can select them unaided. Its first-use discovery cost and oracle guidance cannot count as competitive savings.

The Python [raw checker](../../experiments/north-star/check-cli-files.py) imports no product code. It checks all 16 cases against the unchanged task manifest, frozen source hashes, supplied file contents, actual argv, exit codes, exact stdout and unchanged refusal cases. It does not trust recorded success booleans. Its negative controls reject a duplicate operand and changed file contents even when success flags and output are unchanged. This is separate-implementation verification by the same author; independent-author review remains open.

The frozen implementation passes **246/246 tests with zero skips**, both typechecks, Node/browser builds, offline package installation with the original thirteen tools and uninstall, and **28/28 black-box lifecycle proof checks**. The proof ran from an isolated Git archive; every recorded product source hash matches the freeze. Generic behavioral regressions cover fresh runtime reuse with new input and zero investigation, exact names/content/order, empty operand lists, nineteen malformed file/operand cases refusing without dispatch or healing, and direct sandbox validation. A completed fixture invocation remains unverified unless supplied with a real independent outcome witness. [Verification and artifact hashes](evidence/cli-files/verification.json) bind this checkpoint.

Reproduce the corrected frozen product and the checker from this evidence commit:

```sh
npm run typecheck
npx --no-install tsc -p tsconfig.harness.json
npm test
node experiments/north-star/cli-files-diagnostic.ts /tmp/rcx-cli-files-new.json
python3 experiments/north-star/check-cli-files.py docs/adaptive/evidence/cli-files/before.json /tmp/rcx-cli-files-new.json
npm run build
node ci/adaptive-package-smoke.ts
```

The diagnostic requires the installed, exposed macOS programs and a working host sandbox; it is not an unfamiliar-environment installation proof. Run `node proof/run.ts` in a separate source export because it writes `proof/results/latest.json`. Windows and fresh-host usability remain untested. No model was called, and the quota-blocked Claude pilot remains at its existing freeze. Next product work must address generic discovery limitations and agent usability without hand-built application adapters, followed by fresh independent holdouts and the original fair A/B/C/D gates. No economic advantage or release readiness is established here.
