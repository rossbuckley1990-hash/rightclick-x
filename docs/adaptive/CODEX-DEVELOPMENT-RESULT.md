# Real Codex development comparison

**Result: retained discovery works on this exposed target; no economic advantage demonstrated. Release remains NO-GO.** All four arms returned correct outputs for all four feasible `json_xs` tasks. RightClick's three fresh reuse sessions performed zero investigations and zero revalidation probes, but took longer and consumed more reported model tokens than every baseline.

The completed pilot uses harness freeze `40d3571ddf79da678edace2b64855f4e7991c6a1`, Codex CLI 0.159.3, `gpt-6.1-sol` at low reasoning effort, and 32 fresh sessions. Product source is unchanged from `1c9fa6a`. The [preregistered development plan and retained amendments](CODEX-DEVELOPMENT.md) keep the original acceptance thresholds intact. This is one already exposed program, not an unfamiliar holdout, a cross-vendor transfer, or an Actenon authority integration test.

| Arm | Feasible outputs | Prescribed cases | Cold time | Median warm time | Median warm reported tokens |
|---|---:|---:|---:|---:|---:|
| A: direct program | 4/4 | 8/8 | 8.5 s | 9.6 s | 64,418 |
| B: documentation | 4/4 | 7/8 | 8.5 s | 8.1 s | 50,923 |
| C: saved skills | 4/4 | 8/8 | 16.2 s | 18.3 s | 99,351 |
| D: RightClick | 4/4 | 8/8 | 27.8 s | 23.1 s | 197,014 |

Warm medians contain three different tasks per arm. RightClick was **2.41× slower than A**, which also passed all eight prescribed cases, and **2.85× slower than B**. These are descriptive observations from a fixed D/A/B/C order, not statistically established population effects. Model service/cache/load variation is uncontrolled. Tokens include cached input once; they are not actual charges or API-equivalent prices. No monetary-cost superiority is inferred.

B's remaining case needs explicit qualification: after the reversed-output wrapper change, it executed new Perl code that restored the correct, independently observed value. It failed the prescribed requirement to refuse that phase; it did **not** return a wrong value. The reversible wrapper therefore cannot establish a semantic reliability advantage merely by comparing refusal scores. Earlier stopped runs contain the same behavior in C. Keep the original scoring and report the distinction rather than relabeling correct values as factual errors.

## What the lifecycle trace actually establishes

RightClick initially refused the stale binary fingerprint before execution. Its automatic repair then failed because the egress check interpreted the local `cli:` source's URL origin as `null` and rejected it. The model explicitly relearned the program. Both compatible and incompatible phases incurred one investigation and 30 investigation probes.

In the incompatible phase, the model additionally supplied `acknowledgeChange: true`. The runtime returned reversed output with the evidence grade **`checked`**, under a weak whitespace predicate. It did not label that output independently `verified`. The model subsequently refused to return it as the requested answer. This demonstrates the value of distinguishing grades, and a remaining limitation: final-agent refusal is not independently enforced semantic refusal. The local-source repair defect and operator control of changed meaning remain release blockers. [Exact trace extraction](evidence/codex-development-40d3571/lifecycle-semantic-audit.json).

## Verification, resource accounting and failures

The [separate checker](../../experiments/north-star/check-codex-development.py) recomputed all 32 final scores, token totals, task/input/output binding, invocation identity/lifecycle, investigation counts, source-manifest equality and client/tool configuration. It parses recorded JavaScript as data through a separate syntax-facts emitter; it does not evaluate that code or import the product/scorer. The checker shares the generic TypeScript parser with the transport audit and was authored by the same implementation agent: **not independent-author review or a security certification**. Wall times remain host measurements rather than separately reconstructed timing observations.

Three valid negative controls reject changed task output even with its observation digest updated, inflated token totals, and a concealed JavaScript I/O call despite a claimed clean audit. An earlier invalid control altered a help response while leaving the correct task invocation intact; its acceptance and the correction are preserved. Full regression: **252/252 tests, zero failures/skips**. Product and harness typechecks pass. The product's earlier 28-check black-box proof and package checks retain their own unchanged source freeze; they were not relabeled as new runs.

Four failed/stopped freezes remain: home-directory aliases denied by the sandbox (`c047f96`), metadata pipe framing timeout before inference (`e21bc80`), literal Perl text falsely classified as JavaScript escape (`1a25b7f`), and unequal client approval access (`ccfa38f`). The final run preapproves only fixed local fixture tool names in both arms and keeps the same target sandbox, read-only client sandbox, disabled unrelated tools and private evidence/state. It does not grant generic shell or network access.

The valid pilot reports 3,402,422 model tokens and 484.4 seconds summed across sessions. Stopped runs report another 3,326,813 tokens and 599.0 seconds across completed rows; one interrupted session additionally has 33,684 tokens in recovered usage records, with original stdout unavailable. These costs are not erased or charged to a fictitious successful run. Host oracle preflights, setup, checking and authoring effort are additional. [Full resource summary](evidence/codex-development-40d3571/summary.json).

Account preflights and postflight observed ChatGPT subscription authentication, ordinary allowance available and zero credit balance. API/provider environment keys were excluded, authentication was pinned, and no purchase, credit reset or paid fallback occurred. This is observed included-allowance usage, not a guarantee about future account settings. The user's separate Claude extra-usage confirmation remains recorded; Claude was not retried.

## Reproduce and continue

Use the recorded installed tool versions and the same `json_xs` executable identity; model output is nondeterministic. From the evidence commit, with the harness unchanged from `40d3571`, copy the manifest into a **new** output directory, preserving all task/docs/oracle bytes and its freeze. First run a one-session D access checkpoint, check it, then resume the same path and freeze:

```sh
node experiments/north-star/run-codex.ts 40d3571 --holdout NEW/manifest.json --programs json_xs --arms D,A,B,C --session-limit 1 --out NEW/results.json
python3 experiments/north-star/check-codex-development.py NEW
node experiments/north-star/run-codex.ts 40d3571 --holdout NEW/manifest.json --programs json_xs --arms D,A,B,C --out NEW/results.json
python3 experiments/north-star/check-codex-development.py NEW
```

Use only verified included subscription access; stop if the preflight fails. Preserve exact resume path spelling. Existing outputs must not be overwritten. Account metadata and raw artifacts are evidence, not operator credentials. [Full checked results](evidence/codex-development-40d3571/final-checker.json) and [artifact manifest](evidence/codex-development-verification.json).

Next: fix the demonstrated local-source automatic-repair defect under unchanged authority and egress limits; distinguish local agent acknowledgement from independently authorised changed meaning; measure whether compact, sufficient capability disclosure reduces fresh-agent calls without losing constraints. Then freeze and evaluate fresh independent holdouts and complex changing workflows against strong baselines. Do not expand Actenon integration on a presumed speed advantage. The original goals and [release blockers](RELEASE-READINESS.md) remain open.
