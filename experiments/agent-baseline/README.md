# Agent baseline: RightClick X against a competent agent with ordinary tools

`node experiments/agent-baseline/run.ts [--task tidy|services|all] [--trials 3] [--reps 2]`

This runs billed agent sessions with the `claude` CLI's default model and account. Each session:
- is capped at $1 and 30 turns;
- keeps no session history;
- loads no user or project settings;
- gets only the tools of its arm.

## Question

For the same task, does a fresh agent session reach a correct, independently confirmed outcome with less time, tokens or cost when it uses RightClick X than when it uses ordinary tools?

## Tasks

**tidy: one authorised local program (`/usr/bin/tidy`).** Correct and pretty-print unseen HTML.
- The harness checks every answer with its own code: tags must balance, and every word of the input must survive.
- `rcx-warm`: an operator script already learned the program and saved a goal. This is the reuse case.
- `rcx-cold`: empty state.
- `shell`: Bash, told the same authorised program path.

**services: three unfamiliar internal HTTP services, given only as OpenAPI contracts.** Determine an order's sales tax rate and confirm it with the inspection service.
- Ground truth lives only in the services process and the harness.
- That process logs every request, so "inspection asked" means the logged requests show that session asking the inspection service about the right order with the right candidate. It does not rely on the agent's report.
- Each repetition is one cold session followed by two sessions with new orders.
- `rcx`: RightClick X state persists across the sessions.
- `shell`: nothing persists.
- `shell-memory`: a directory persists across the sessions, and the agent is told to leave notes or scripts there for later sessions and to check it first. This is the strongest fair baseline for reuse.

## Fairness controls

- All arms use the same model and the same task text, apart from the tool sentence.
- Inputs are unseen and differ per session.
- The order of arms alternates between repetitions, because prompt caching across sessions favours whichever arm shares a cached prefix.
- Cost is reported as given by the CLI, so the cache effects stay visible. Output tokens, uncached input tokens and cache reads are reported separately.

## Limits

- One model and one vendor. Small samples: 3 trials, or 2 repetitions of 3 sessions.
- The tasks are small. They don't represent large, messy systems.
- The services are local, purpose-built processes, not third-party production systems.
- RightClick X's operator setup is scripted. Its timing and configuration are reported separately as setup effort.

## Results, 2026-10-25

This used `main` at `c27a52f`, Claude Code 2.1.301 and `claude-opus-5-5`: 33 sessions, $3.53 as reported by the CLI. The raw data is in `results/2026-10-25/`.

| Task / arm | Pass | Inspection asked | Median time | Median turns | Median uncached input | Median cost |
|---|---|---|---|---|---|---|
| tidy: shell | 3/3 | — | 14.0 s | 2 | 6,859 | $0.078 |
| tidy: rcx-warm (saved goal) | 3/3 | — | 25.9 s | 5 | 13,163 | $0.144 |
| tidy: rcx-cold | 3/3 | — | 30.5 s | 8 | 14,222 | $0.179 |
| services: shell, first / later | 2/2, 4/4 | 2/2, 4/4 | 13.4 s / 16.1 s | 5 / 5 | 7,490 / 7,476 | $0.095 / $0.095 |
| services: shell-memory, first / later | 2/2, 4/4 | 2/2, 4/4 | 17.4 s / 19.4 s | 6 / 6 | 8,045 / 6,161 | $0.112 / $0.094 |
| services: rcx, first / later | 2/2, 4/4 | 2/2, 4/4 | 34.5 s / 14.5 s | 11 / 4 | 21,347 / 13,688 | $0.261 / $0.140 |

**This is not a breakthrough, and none should be claimed from it.**

- **Success:** every arm succeeded in every session. On these small tasks a frontier model with a shell is fully competent.
- **The known program (tidy):** the shell is about 2× faster and about half the cost, even when RightClick X already has the goal saved.
- **Reuse of the unfamiliar services:** RightClick X's later sessions are the fastest and use the fewest turns, but cost about 47% more than the stateless shell. Its first session costs about 2.7× the shell's.
- **Where the extra cost comes from:** it isn't the work. RightClick X's own tool time is about 70 ms per session. The cost is per-session context: about 6k more uncached input tokens (13 tool definitions of about 4.3k tokens, plus instructions and explanations), and turns spent inspecting a goal before running it. The audit logs show `context_explain` → `context_run` in every reuse session.
- **What this doesn't measure:** what RightClick X adds beyond the outcome. That covers sandboxed and authorised execution, stored checks and witnesses enforced on every reuse whatever the agent remembers, refusal of incompatible changes, and drift and outage handling. It also doesn't measure tasks large enough for rediscovery to be expensive.
