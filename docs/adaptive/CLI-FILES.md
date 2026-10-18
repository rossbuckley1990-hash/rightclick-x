# CLI invocation fidelity development experiment

Status: planned local diagnostic; full mission PARTIAL and release NO-GO. Original acceptance thresholds and historical scores remain unchanged.

The next product checkpoint tests exposed xsubpp5.34, autom4te, lzdiff and exiftool cases against direct sandbox execution. The diagnostic supplies the existing oracle's options; this is deliberately **not** an agent, unfamiliar-software holdout or economic result. Its purpose is to distinguish invocation defects from agent selection/discovery failures. It retains every feasible task, including refused or unmappable invocations, and records exact inputs, actual argv/stdout, direct outputs, source hashes and capability contracts. Only temporary sandbox files may be written by the programs.

Suspected defects to test before changing product code: named files are always appended as operands, including option values; file names are silently rewritten and may collide or be interpreted as flags. Any fix must be generic, preserve documented option restrictions and operator authority, refuse ambiguous/invalid inputs before execution, and preserve existing failed evidence. Dynamic option families remain a separate discovery limitation; no application-specific tag allowlist will be added for this experiment.

Use a new output path:

```sh
node experiments/north-star/cli-files-diagnostic.ts /tmp/rcx-cli-files-before.json
```

Record the before result, add behavioral regression fixtures for demonstrated defects, freeze the corrected source and rerun the same diagnostic. Run relevant full regression/type/build/package checks after product changes. A separate checker must compare raw artifacts rather than trust the diagnostic's booleans. New holdouts, real model transfer, independent-author review and fair A/B/C/D economics remain required.

The first diagnostic at `cd6a061` selected the first graph provider's option declarations instead of the investigated program's declarations. This omitted option values in two cases and is a harness failure, not product evidence for those cases. Its complete [artifact](evidence/cli-files/attempt1.json) and log are retained. The corrected diagnostic uses the investigation keyed by the exact executable path before establishing the product baseline.
