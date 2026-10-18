# Subscription development pilot

2026-10-18, frozen source `2a8eaa5dd30143f9dbec38a9482aeddcb377e8f9`, same programme branch. The operator confirmed that Claude extra usage is disabled. The runner excludes API/provider credential environment variables, disables hooks and session persistence, uses a fresh context with the prescribed MCP surface, and stops on a quota refusal.

The [manifest](evidence/claude-development-2a8eaa5/manifest.json) copies the already exposed `json_xs` tasks without changing their requests or oracles. Their reference invocations were rerun in the local sandbox and all outputs matched the preserved originals. These are development tasks, not a fresh holdout. Intended comparison: A direct, B documentation, C retained skills, D RightClick X; existing budgets and scoring unchanged.

The first A session returned HTTP 429 `usage_limit_reached`: **weekly limit exhausted**, reset reported as 22 October at 11pm Europe/London. It reported zero tokens, zero cost, no model usage and no tool calls. The runner stopped after this single attempt. The observation stream contains initialization only, so execution remains **unknown**, not a fabricated zero-execution success. No model comparison or economic result is established. [Raw results](evidence/claude-development-2a8eaa5/results.json), [conservative report](evidence/claude-development-2a8eaa5/report.json).

Resume this exact freeze and evidence directory when subscription quota is available; preserve the blocked attempt and reconcile retry costs before acceptance:

```sh
node experiments/north-star/run.ts 2a8eaa5 --holdout docs/adaptive/evidence/claude-development-2a8eaa5/manifest.json --programs json_xs --arms A,B,C,D --out docs/adaptive/evidence/claude-development-2a8eaa5/results.json
```

Reported `total_cost_usd` is model telemetry, not evidence of an actual subscription charge. Do not enable extra usage or substitute paid API credentials. Local product and authority experiments continue while the live benchmark is unavailable.
