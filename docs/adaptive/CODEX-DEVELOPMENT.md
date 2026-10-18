# Codex development pilot

Preregistered before model execution on 18 October 2026. This is an exposed-target development pilot, not a fresh holdout or an acceptance result. The same Adaptive Capability Plane objective, branch and original acceptance thresholds remain binding. The Claude pilot and its quota failure remain untouched.

## Purpose and fixed design

The equal-control Actenon comparison found the saved script faster than RightClick. The next necessary evidence is acquisition and reuse through a real coding agent. Use the installed Codex CLI 0.159.3, its available default model `gpt-6.1-sol`, fixed low reasoning effort, and the already exposed `json_xs` tasks from the Claude development manifest. This is not a model selection experiment. Use all four A/B/C/D arms in the existing order, all four feasible tasks, the infeasible task, compatible wrapper change, incompatible reversed-output change and removal: 32 fresh sessions. No early stop on bad answers. Stop on quota, invalid transport/trace or timeout, preserving every attempt. Each session retains the existing 600-second ceiling.

`run-codex.ts` deliberately copies the task, prompt, mutation and scoring logic from the frozen `run.ts`; it substitutes only the client transport, provenance schema and stricter requirement for a valid completed client session. It cannot resume or overwrite the Claude result. The runner, helpers and manifest must match its frozen commit. The product remains unchanged from the CLI option-grammar fix. Compare actual target execution and oracle output using the same instrumented host and scorer. Do not count a builtin-only answer or a probe as successful task execution. All raw transcripts, tool source, sandbox observations, requests, errors, attempts and retained state are evidence.

Baseline A gets direct sandboxed program execution, B additionally gets the existing documentation, C gets the existing saved skill store, and D gets the existing thirteen RightClick tools and persisted capability state. No program-specific product integration is added. The model has a fresh empty working directory for each session; unrelated tools, hooks, user configuration, rule loading and host skill discovery are disabled. The same executable sandbox and no-network target controls apply to all arms. The CLI transport's conservative raw tool trace audit is an observation check, not OS isolation or proof of universal tool-surface coverage. Any unexpected action requires review and stops scoring. The controlled experiment author and checker remain the same person/model; this is not independent-author validation.

## No-spend preflight

The user confirmed Claude extra usage is disabled; that pilot encountered a weekly limit before model work. No repeat Claude call is needed here. The installed Codex CLI separately reports ChatGPT authentication, available subscription allowance and no credits. The new Python preflight calls only initialize, account/read, account/rateLimits/read and model/list; it creates no thread or turn. It retains account type, plan, allowance, model metadata and an account identifier hash, excluding email and credentials.

Before the pilot, require a current ChatGPT personal subscription (`plus`, `pro`, or `prolite`), ordinary usage allowed, less than 90% of the primary allowance used, no credits, no unlimited credit entitlement and zero balance. Pin ChatGPT authentication and the OpenAI provider, remove API/provider environment variables, and stop on any usage block. Never purchase, reset, top up or switch to an API key. This establishes the observed subscription route at preflight time; it does not control subsequent account changes. Official documentation distinguishes [ChatGPT subscription authentication from API billing and documents forced login](https://learn.chatgpt.com/docs/auth).

Codex token usage counts input plus output; cached input is already included in input. Preserve missing usage as missing. Do not invent API-equivalent prices, actual charges or cross-vendor comparable turn counts. Record wall time, target execution/probe counts, correctness, tokens, tool calls and failure details. A single exposed program cannot establish commercial advantage, sample-size/statistical gates, unknown-software generality or cross-vendor inheritance.

## Reproduction

Freeze the harness first. Copy the existing exposed `json_xs` manifest into a new evidence directory with only its commit/provenance fields updated to that freeze, retaining original task, docs and oracle bytes. Run:

```sh
node --test test/codex-session.test.ts
npx tsc -p tsconfig.harness.json
node experiments/north-star/run-codex.ts FREEZE --holdout NEW_MANIFEST --programs json_xs --arms A,B,C,D --out NEW_RESULTS
```

No inference occurs for `--preflight`; that flag checks source/manifest binding only. A real run also performs the live account allowance preflight. Do not present source preflight as model execution. Inspect raw client/tool/sandbox evidence and separately recompute correctness and accounting before drawing conclusions.

## First-use issue found alongside preflight

The installed `rcx run` entry point currently parses every `k=v` value as a string. It cannot directly express the options arrays or named-file maps exposed by discovered CLI capabilities. Structured arguments are available through MCP, but this remains a command-line developer-experience gap. It is recorded for remediation after this frozen model pilot; no untested replacement command is advertised.

## Failed environment attempt retained

Freeze `c047f96` started eleven sessions before the runner was forcibly stopped (ten completed rows, one interrupted). Its executable aliases lived under the evidence directory in `/Users`; the product's existing macOS sandbox denies file reads there. Feasible executions returned launcher code 126. The raw scorer marked some refusal rows correct, but **the entire attempt is invalid environment evidence and excluded from comparative claims**. The interrupted session's available tool/assistant/usage records were recovered from its own rollout; missing original stdout is not fabricated. [Failure record](evidence/codex-development-c047f96/environment-failure.json).

A no-model control using the same sandbox and input with only the executable alias moved to the temporary test directory succeeded. The next harness freeze therefore keeps evidence and retained state private, stores only disposable executable aliases in the temporary directory, and checks every feasible task's existing oracle through the sandbox before invoking the model. These host preflights are retained with time and output; they are measurement setup, do not populate RightClick's state and must be included when accounting for total experiment effort. No sandbox restriction is removed and product source is unchanged. The runner additionally stops on a feasible-task launcher failure, supports an explicit one-session checkpoint and stop marker, and streams raw client output to disk so interruption cannot discard buffered output. Run one session, audit it, then resume the same freeze to complete all arms; do not select sessions by success.

Freeze `e21bc80` then stopped before inference because the metadata reader timed out on account/read. A Python text-buffer/select interaction could leave an already-read response buffered after a notification. The next preflight uses explicit byte framing; an offline synthetic test coalesces each notification and response in one write and verifies metadata redaction. The failed preflight and attempted checker invocation remain preserved. No model call occurred on this freeze.

Freeze `1a25b7f` passed the single-session checkpoint and continued to 13 rows, stopping on the documentation arm’s infeasible task. The conservative regex audit incorrectly treated `require` inside a Perl string argument as JavaScript escape code. The raw call used only the authorised sandbox tool. This stopped comparison is retained separately; it is not accepted as a complete benchmark. The next freeze parses JavaScript syntax rather than scanning literals. Tests retain refusal of actual JavaScript I/O, imports, dynamic tool access and constructor execution. The Python checker uses a separate syntax-facts emitter and its own decisions, with the same generic TypeScript parser; this is still not independent-author security review.

Freeze `ccfa38f` completed 29 rows before an explicit stop marker. Baseline A passed eight prescribed cases; B/C each returned correct values in the reversed-output case but failed its prescribed refusal criterion. D could not learn because client approval policy rejected context_learn before server dispatch. This is unequal access and invalidates the comparison. The next freeze explicitly preauthorises only the fixed local benchmark tool names for both servers, keeping all other tools unavailable and retaining the same target sandbox. This follows the documented [per-tool MCP approval configuration](https://learn.chatgpt.com/docs/config-file/config-reference). Approval transport errors now stop immediately. Before further arms, run D cold first as an access checkpoint, then complete D and A/B/C from the same freeze. The changed order is prospective development setup; no acceptance threshold is changed and no randomised timing claim is made.

The first altered-output negative control for ccfa38f accidentally changed a help response rather than the later task output and was correctly accepted. It is retained as an invalid control; the replacement must alter all matching task execution outputs.
