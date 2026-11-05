# GLM development comparison (Domain-2 shaped): A/B/C/D on unfamiliar HTTP APIs

**Status: development evidence. Not holdout evidence. No gate is updated by this file.**
Run date: 2026-11-02/03. Harness: `experiments/north-star/glm/` (this branch). Raw results:
`results.json`; full per-session transcripts under `transcripts/`.

## Why this run exists, and what it is not

The preregistered evaluation (EVALUATION-PLAN.md) requires Claude Code (Sonnet) agents and
an independent evaluator, and its Domain-2 pool is a fixed list of public APIs. None of
that is available in this environment: Claude is not installed, and the public pool was
unreachable (Cloudflare challenges, daily rate limits) from the development network. What
was possible — and is recorded here — is a development-scale comparison that preserves the
plan's arm definitions, prompt shape, session sequencing, oracle-at-evaluation-time and
contains-all scoring, with these recorded deviations:

| Protocol element | This run |
|---|---|
| Agent model | GLM-4-Plus (same model for all arms), in-process tool loop — not Claude Code Sonnet |
| Evaluator | The implementation author — tasks and APIs are development material, never holdout material |
| Software | Two fictional loopback HTTP APIs with OpenAPI contracts (no model prior knowledge — the property the competitive thesis itself demands), not the fixed public list |
| Transport | The production MCP servers (`surface.ts`, `rcx mcp`) over stdio, driven by the harness loop |
| Domain | No CLI arm (the host cannot mount /proc in new PID namespaces, so the product sandbox cannot run; that is a fail-closed refusal, not a workaround) |

## Setup

Four arms, exactly the plan's definitions adapted to HTTP:

- **A** — a single `http_get` tool restricted to the API's origin (production `surface.ts`).
- **B** — A plus the API's OpenAPI contract in the prompt (documentation given every time).
- **C** — A plus an Agent-Skills-style persistent store (`save_skill`/`list_skills`/`read_skill`), kept across sessions.
- **D** — the thirteen `context_*` tools over the production `rcx mcp` server, `RCX_STATE_FILE` persisted across sessions; the operator-authorised contract URL is given in the task, matching "the API's root or contract URL as the authorised interaction surface".

Two APIs (fictional, deterministic, genuinely unfamiliar): **PortLog** (plain REST berths/
vessels/schedule/tides) and **KilnWatch** (ceramics registry with query filters and nested
objects). Four tasks each. Session sequence per arm×API: task 1 (first use), tasks 2–4
(reuse, fresh session each), then a **compatible change** (the task-1 endpoint moves, the
contract is updated) and task 1 again. Oracle values are recomputed from the live contract
at scoring time.

40 sessions planned; **37 completed, 3 blocked** (kilnwatch D reuse×2, D changed×1): the
shared model endpoint rate-limited (HTTP 429) persistently during those sessions — D's
requests are an order of magnitude larger than the baselines' and exhaust the window.
The blocked sessions are preserved with their error records in `results.json`.

## Scoring defect found and corrected during the run

The first scoring pass marked every path-parameter task (PL2, KW2) wrong for all arms.
The cause was in the harness oracle, not in the agents: `new URL()` percent-encodes `{param}`
path templates, so the oracle fetched `/v1/vessels/%7Bimo%7D` (404) and scored answers
against undefined expectations. The oracle was fixed to substitute parameters before URL
construction, and all preserved answers were re-scored offline against the corrected
oracle (`/tmp` script preserved in the PR description; answers, transcripts and both
verdict sets are in the evidence). **No model output was re-run or altered.**

## Results (37 clean sessions)

| Arm | Correct | Unable | Wrong | First-use med tokens | Reuse med tokens | Reuse med seconds | Changed-phase | Skills authored |
|---|---|---|---|---|---|---|---|---|
| A | 10/10 | 0 | 0 | 2,752 | 1,892 | 3.0 | 2/2 | — |
| B | 8/10 | 2 | 0 | 18,460 | **1,448** | **1.9** | 1/2 | — |
| C | 10/10 | 0 | 0 | 3,658 | 3,299 | 3.2 | 2/2 | 0 bytes |
| D | 7/7 | 0 | 0 | **137,834** | **34,576** | 6.8 | 1/1 | — |

(3 additional D sessions blocked by endpoint rate limits, not scored.)

Every completed session on every arm answered correctly, including the change phase:
D recovered from the moved endpoint within one session, and A re-discovered it. Arm B
exhausted its 30-turn budget twice on KilnWatch KW1 (first use and changed phase) — the
full contract in the prompt is heavy enough to lose a task in.

## The honest headline: RightClick X is the most expensive arm by an order of magnitude

- First use: **D 137.8k median tokens vs A 2.8k** (49×). D's discovery (learn, graph
  search, explain, run) reads large JSON cards at every step.
- Reuse: **D 34.6k median tokens vs A 1.9k, B 1.4k** (18–24×). D's per-call tool results
  (explain cards, run records with receipts and verification blocks) dominate; retained
  capabilities reduce D's *discovery* calls on reuse (12→4.5 median tool calls) but each
  call is far heavier than a bare HTTP GET.
- Break-even: **there is none at this task scale.** D costs more on first use and more on
  every reuse. The cheapest "integration" for a simple HTTP API is one GET, and B shows
  that a 2.6 kB contract pasted into the prompt beats everything on reuse cost.
- D's large requests also made it the only arm to be **rate-limit blocked** (3 sessions):
  context weight is not just a cost problem, it is an availability problem.
- C authored **zero** skill bytes across ten sessions: with four tasks per API the model
  never chose to save a skill. The skills-baseline needs longer task series to be meaningfully
  exercised (recorded as a harness-design lesson for the real protocol).

These results are consistent with the repository's own preserved unfavourable evidence
(ACTENON-EQUAL-CONTROL-RESULT, MODEL-RECHECK-RESULT, CODEX-DEVELOPMENT-RESULT): no
economic advantage has been established, and this run adds a clean, mechanism-level
measurement of **why**: the payload weight of the client-visible tool interface.

## What this run does establish (and what it cannot)

Established (development-grade): the four-arm harness works end-to-end on the production
MCP servers; scoring is mechanical and self-correcting (the oracle defect was caught by
the disagreement between arms that should have agreed); on unfamiliar-but-simple HTTP
APIs, correctness is a tie across arms and the cost ranking is **B < A < C ≪ D**.

Not established: holdout generalisation (R8), economic advantage (R9), cross-agent
transfer, incompatible-change refusal behaviour, CLI-domain behaviour, and anything
requiring the preregistered protocol's independent evaluator and Claude arms. Those
remain open gates; this evidence does not touch them.

## Bottleneck implication (feeds the next work package)

The dominant, measured disadvantage is **context weight per tool call**: D's median reuse
session carries ~34.6k tokens where the same answer needs ~1.4–1.9k. The architectural
lever is the default disclosure of `context_explain` / `context_graph` / `context_run`
results — the run-record JSON alone includes receipts, verification blocks and metadata
the caller rarely needs. Reducing the default client-visible payload (while keeping
`detail:"full"` and `context_run_status` complete) is a general improvement that should
move D's reuse cost toward the baselines without weakening any check (the stored record
and receipt chain keep everything; only the wire format shrinks). This is the same lever
the repository's DISCLOSURE.md checkpoint identified (41.9% serialized reduction) — the
development comparison above quantifies why it is the decisive one for the competitive
question.
