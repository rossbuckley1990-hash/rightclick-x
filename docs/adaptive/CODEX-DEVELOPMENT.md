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
