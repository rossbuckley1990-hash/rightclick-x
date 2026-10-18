# Local CLI repair under a closed network policy

Development remediation prompted by the [real Codex pilot](CODEX-DEVELOPMENT-RESULT.md). This does not replace its unfavorable economics or count as a fresh holdout. The current branch and original acceptance thresholds remain unchanged.

## Reproduced defect and correction

Direct execution and persisted goals tried to interpret `cli:/absolute/program` as an HTTP origin. With the benchmark's `origins: []`, automatic repair refused origin `null` before reaching local investigation. The first three regressions failed on `d67e95c`; [raw failures](evidence/cli-repair-policy/before-tests.log) are retained.

The correction exempts only `cli:` contract rereads from the HTTP-origin guard. `learn` still routes them through the existing canonical-program authority, native sandbox and byte-identity checks. Network discovery and redirects retain their origin policy. Missing local programs do not generate a fictitious `null/` successor lookup. Neither discovery nor repair adds execution authority.

An expanded regression exposed pointless permitted investigation after execution authority had been revoked. Repair now stops on that explicit local authority refusal. No task execution occurred in that failed attempt. Another failed assertion looked for a saved-goal investigation refusal only in the top-level error; the reason was in the existing `attempts[].healing` diagnostic. That assertion now checks both fields. All intermediate logs are preserved. The focused 22-test suite passes with zero skips, including remote origin/redirect restrictions and ambiguous-effect retry controls.

Four regression cases cover direct and saved-goal compatible changes, incompatible behavior, authority revocation, unavailable sandbox, disappearance, persistence and return. A withdrawn goal remains refused after the program returns until explicit authorised rediscovery; automatic return discovery is not claimed. Changed semantics still require more than these bounded samples, and caller `acknowledgeChange` is not independent operator approval.

## Frozen replay protocol

Before running the diagnostic, freeze the source, harness and checker in a local commit. Compare the previous `d67e95c` source against that source freeze, using the same harness and `/usr/bin/json_xs` identity. The product has no program-specific changes. Only this exposed development fixture names `json_xs`.

Each replay launches 17 fresh Node processes: seed acquisition/publication, direct and saved-goal warm calls, compatible changes and subsequent reuse, investigation/execution revocation for each route, incompatible changes, removal, return without discovery, and return after explicit discovery. Each case copies the specified retained state. The compatible wrapper execs the original program; the incompatible wrapper reverses each output line, exactly as in the pilot. New input values distinguish the phases. The native sandbox, explicit program allowlists and empty HTTP-origin list remain in force. No model, network service, paid resource or external action is used.

Success requires the raw dispatched input, output and program fingerprint to agree with the independent JSON/pretty-print check. Refusals require zero task dispatches. Compatible repair must complete in one public runtime call, preserve the goal's pinned operation and stored predicates, and the following fresh process must reuse it with zero investigation. Changed meaning must refuse the requested execution; investigation probes are separately counted. Revocations must produce neither task dispatch nor investigation. Missing programs must be withdrawn after the fix. No result may be relabeled independently `verified` merely because structural predicates passed.

The [Python checker](../../experiments/north-star/check-cli-repair.py) uses only the standard library, reads raw sandbox records and saved states, verifies frozen source hashes, and rejects four deliberate corruptions: wrong output, dispatch attached to refusal, unapproved network activity and altered authority. It is separate from the product and runner but has the same author; it is not independent-author review or OS attestation. Timing includes operation time and fresh child-process wall time, with acquisition/probe costs retained. A before/after runtime repair improvement is not a coding-agent economics win.

```sh
node experiments/north-star/cli-repair-diagnostic.ts BEFORE_EXPORT d67e95c NEW_BEFORE_DIR
node experiments/north-star/cli-repair-diagnostic.ts AFTER_EXPORT AFTER_FREEZE NEW_AFTER_DIR
python3 experiments/north-star/check-cli-repair.py NEW_BEFORE_DIR NEW_AFTER_DIR
```

Result pending the frozen replay. Release remains NO-GO pending the full [acceptance matrix](ACCEPTANCE-MATRIX.md).
