# Stress tests

All on one laptop (Apple Silicon, Node 24). X1–X4 run against local synthetic services so they can be pushed hard without loading anyone else's servers; X5 runs live against the public internet, read-only. Raw results are in [`results/`](results/).

| # | Test | Result |
|---|---|---|
| X1 | **Scale** (`stress-scale.ts`). 2,000 generated API providers, about 20,000 operations, learned in batches of 100. | **20,014 capabilities, 156.7 million typed links**, learned in 213 s; memory 225–366 MB. On the full graph: planning 197 ms, plan + run 199 ms, search 238 ms. |
| X2 | **Chaos routing** (`stress-chaos.ts`). 30 interchangeable vendors with hidden failure rates of 0–90%; the rates reshuffle twice. 900 runs; baselines are a hard-coded vendor and a random vendor. | Phase 0: everyone 100%. After the first reshuffle (vendor 0 fails 37%), the hard-coded integration fell to 40–51%; RightClick X dipped to 76% first-try and was back at 100% within ~90 runs. After the second (vendor 0 fails 75%), hard-coded fell to 3–23%; RightClick X held 94–98% final, 74–90% first-try, routing to the vendors that really were best (vendor 9: observed 0.86 vs true 0.86). 3,188 receipts, intact. |
| X3 | **Drift storm** (`stress-drift.ts`). 50 providers randomly jumping between REST v1, REST v2, GraphQL and MCP during 1,500 integration calls. | **373 breaking releases, 268 drifts detected and repaired mid-traffic, 1,500/1,500 calls verified (100% availability)**. p50 1 ms, p99 2 ms (in-process). |
| X4 | **Concurrency** (`stress-concurrency.ts`). 1,000 simultaneous MCP tool calls over HTTP to one instance. | `context_inspect`: 0 errors, 2,197/s, p99 449 ms. `context_compose` (plan + run across GraphQL, MCP and OpenAPI services): 0 errors, 164/s, p99 6.0 s. 3,000 receipts in one intact chain. |
| X5 | **Acquisition on demand** (`acquire.ts`, live). A runtime with only its builtins gets goals it cannot do; `context_compose` with `acquire: true` researches APIs.guru and the MCP Registry, learns what it finds, plans, runs, verifies. Constrained to read-only capabilities. | 3/3 verified. **EUR exchange rates** via ExchangeRate-API (found and learned in ~1–13 s). **Ada Lovelace** via a third-party Wikipedia MCP server from the official registry, then summarized. **Ontario's public holidays** via the Canada Holidays API, with the caller's `province` bridged to the API's `provinceId`. Along the way it learned and discarded candidates that needed keys (HTTP 401/403). |

## What broke, and what changed because of it

- **Learning was quadratic.** Every added provider recounted every typed link: at 6,000 capabilities a batch of 100 providers took 241 s. Powers are now counted in a streaming pass (O(nodes) memory), measured once per batch, and full adjacency is built only on demand: the same batch takes 2.4 s (100×) and memory dropped from 762 MB to 174 MB.
- **The receipt chain could fork under concurrency.** Appends hash asynchronously, so two simultaneous runs could link to the same previous receipt. Appends are now serialized; a test runs 200 concurrent runs and checks the chain.
- **The ledger never forgot.** A vendor with 300 past successes kept its trust long after it started failing. Reliability now weights an exponential moving average of recent outcomes.
- **Directory research ranked noise.** Every query word counted equally, so "summary" matched half the directory, and the MCP Registry returned nothing for multi-word searches. Ranking is now rarity-weighted with name/title boosts, and the registry is queried term by term, tolerating individual failures.
- **Acquisition triggered too rarely.** A builtin that merely echoed the input "satisfied" a Wikipedia goal. Acquisition now also fires when the best plan covers too little of the intent.
- **Callers name entities, APIs name ids.** A caller's `province` now fills an `id.province` port; a goal asking for `json` gets the complete result rather than an intent-matching fragment.

## Honest limits

- X1 uses a synthetic vocabulary that is denser than real APIs, so typed links grow faster than in practice (real: 4.9 M links for 4,359 capabilities in E2).
- X2's ledger explores little: a good vendor tried once early and failed may not be retried for a long time.
- X3 and X4's services are local, so their latency numbers measure RightClick X, not networks.
- X5's verification is only as good as its predicates; the first run "verified" a wrong answer against a weak check (fixed by stricter predicates, recorded above).
