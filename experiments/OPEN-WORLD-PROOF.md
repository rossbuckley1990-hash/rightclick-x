# Open-World Proof

**Question:** how much real, useful functionality can an AI acquire from unfamiliar software without anyone writing an integration for it?

**Short answer from these experiments:** with one MCP connection to an unchanged RightClick X build, two AI agents from different vendors (Claude Code, OpenAI Codex) found, combined, executed, verified and reused capabilities from real, independently operated internet services they had not been integrated with: a GraphQL API, two REST/OpenAPI services found in a public directory, and a remote MCP server found in the official MCP Registry. They kept working when an owned service changed its contract across three protocols and reported honestly when it disappeared. **No product code changed during the experiments (0 lines under `src/` and `bin/` since the freeze tag).** The limits are listed at the end and are real.

Machine-readable results: [`open-world/results/manifest.json`](open-world/results/manifest.json). Raw evidence (prompts, every MCP call RightClick X recorded, agent final text, independent truth, checks): [`open-world/evidence/`](open-world/evidence/).

## Executive summary

| | |
|---|---|
| **What RightClick X discovered** | With no address given: the Canada Holidays API and ExchangeRate-API (via APIs.guru), and a Wikipedia MCP server (via the official MCP Registry). With an address given: the countries GraphQL API. It also learned (and then could not use, because they require keys) several translation APIs while searching for an alternative. |
| **What it created** | Saved, reusable capabilities with no code: *Next Ontario holiday*, *CAD to EUR*, *Country currency in USD* (GraphQL → REST), *Capital briefing* (GraphQL → MCP), and a country briefing workflow spanning four providers. |
| **What it executed** | Every task through RightClick X's 13 `context_*` MCP tools only; RightClick X's own audit log records each call (research, learn, explain, graph, compose, run…). |
| **What it verified** | Every reported fact was checked by the harness directly against the original services (labelled as independent verification): holiday name and date, exchange rates (±0.5%), capitals, Wikipedia text overlap, and translations exactly equal to the controlled service's documented output. |
| **How it adapted** | A controlled service on Cloudflare changed contract four times (renamed REST, GraphQL, MCP, rollback); each time RightClick X detected drift, re-learned, retired the stale pipeline and returned a verified answer (~300–350 ms). When the service was deleted it withdrew it and failed honestly; when restored, it rediscovered it. |
| **Why it matters** | None of these pairings existed as an integration. Each was assembled at request time from contracts the services already publish, saved, and reused by a different AI after a restart. Conventionally, each would be client code someone writes and maintains. |
| **What remains unproven** | See *Limitations*: two AI clients only; real providers are friendly, well-described public APIs; cryptic names without descriptions and interfaces without machine-readable contracts are not covered; front-door (RFC 9727) discovery was tested on synthetic environments only. |

## Build

- Frozen builds: OW1–OW5 ran on **`gauntlet-freeze-1`**; the generalization extension below ran on **`gauntlet-freeze-2`** (`3739ddf`), which adds two general inference/healing fixes. Original build record: tag **`gauntlet-freeze-1`**, commit `5945a9a` (`eb757bd` plus a host-side audit log of MCP tool calls; no behavioural change). Validated: 63/63 tests, `tsc` clean, 13 tools over stdio and Streamable HTTP confirmed with `@modelcontextprotocol/inspector --cli`. Record: [`phase0-build.json`](open-world/evidence/phase0-build.json) (Node v24.16.0, macOS 26.4.1 arm64, `dist/rcx.mjs` sha256 `9d433baa…`).
- Later commits touched only `experiments/` and `lab/`: `git diff gauntlet-freeze-1 -- src bin` is empty.
- MCP clients: **Claude Code 2.1.294** (headless, `--strict-mcp-config`, only RightClick X's tools allowed) and **Codex CLI 0.159.3** (headless, `--approve-for-me`: Codex's own automatic reviewer handles approvals; shell sandboxed). RightClick X ran as a local stdio MCP server per agent session with its state persisted to a file (which is how "restart" is realized: a new process, same state).

## Experiments

Distinctions used: **DISCOVERED** (in RightClick X's graph) → **EXECUTABLE** (callable) → **EXECUTED** (RightClick X has a receipt for it) → **VERIFIED** (the requested outcome matched independent checks).

### OW2 — Discovery without addresses · **PASS**

The agent was given an objective and no service addresses: *next public holiday in Ontario, and today's CAD → EUR rate*.

| Client | Discovered and executed | Answer | Independent truth | MCP calls | Time |
|---|---|---|---|---|---|
| Claude Code | Canada Holidays API, ExchangeRate-API (both found via APIs.guru) | Christmas Day · 2026-12-25 · 0.628 | Christmas Day · 2026-12-25 · 0.628 | 11 | 63.5 s |
| Codex | same | Christmas Day · 2026-12-25 · 0.628 | same | 15 | 128.7 s |

Both saved the workflows (*Next Ontario holiday*, *CAD to EUR*). The Codex run was first scored FAIL by a **harness** parser bug (it read `0.628 EUR per CAD` as a number); the original record is preserved and the same answer was re-scored after fixing the parser. Evidence: [`ow2-discovery-claude.json`](open-world/evidence/ow2-discovery-claude.json), [`ow2-discovery-codex.json`](open-world/evidence/ow2-discovery-codex.json).

### OW1 + OW3 — Three independent providers, three protocols, saved, reused after restart by another AI · **PASS**

Given only the countries GraphQL address, Claude Code had RightClick X find an exchange-rate service (APIs.guru) and a **Wikipedia MCP server (official MCP Registry)**, and produced a briefing for Portugal.

- Providers executed: `graphql:countries-trevorblades-com` (GraphQL), `openapi:exchangerate-api` (REST/OpenAPI), `mcp:wikipedia-mcp-server` (remote MCP).
- Saved: *Capital briefing* (Country → Get Wikipedia Article) and *Currency in USD* (Country → latest exchange rates).
- Run 1 (Claude Code, PT): Lisbon · EUR 1.12 · Wikipedia summary — all verified (summary shares 10 content words with Wikipedia's own REST summary). 261 s, 31 MCP calls.
- **RightClick X restarted; Codex, KE:** found and used both saved capabilities in **8 MCP calls, 31 s**: Nairobi · KES 0.00771 · summary — all verified.

Evidence: [`ow1-ow3-three-providers.json`](open-world/evidence/ow1-ow3-three-providers.json). An earlier two-provider version (countries GraphQL × an exchange-rate API found by RightClick X; Claude builds, Codex reuses after restart) also passed: [`ow3-gauntlet2-two-provider.json`](open-world/evidence/ow3-gauntlet2-two-provider.json).

### OW4 — Adaptation across a real network boundary · **PASS**

**Controlled test service** (owned, disposable): `rcx-ow-service` on Cloudflare Workers (free tier), switched between contracts by the test infrastructure through a secret-guarded admin route. RightClick X ran locally; the client spoke only MCP. Task unchanged throughout; answers checked against the service's documented behaviour.

| Round | Contract | Result | RightClick X behaviour | Time |
|---|---|---|---|---|
| v1 | REST `POST /translate` | VERIFIED | discovered from the root URL, composed, saved | 50 ms |
| v2 | REST, renamed path and fields, nested response | VERIFIED | drift detected → re-learned → pipeline retired → re-planned | 302 ms |
| v3 | GraphQL | VERIFIED | protocol change handled the same way | 332 ms |
| v4 | MCP | VERIFIED | same | 347 ms |
| rollback | REST v1 | VERIFIED | same | 329 ms |
| deleted | none (`wrangler delete`) | failed, honestly | provider and its pipeline withdrawn | 423 ms |
| restored | REST v1 | VERIFIED | rediscovered | 67 ms |

The first attempt failed for an infrastructure reason, preserved as [`ow4-attempt1-FAILED.json`](open-world/evidence/ow4-attempt1-FAILED.json): a freshly deployed `workers.dev` route propagates across Cloudflare's edge for some seconds (error 1042 flaps), so RightClick X correctly found "no supported contract" at that moment. The harness now waits for five consecutive consistent answers after deploying or deleting. Evidence: [`ow4-network-adaptation.json`](open-world/evidence/ow4-network-adaptation.json).

### OW5 — The Chameleon Challenge · **PASS**

One scenario combining everything. Real providers: countries GraphQL (address given); an exchange-rate service and a Wikipedia MCP server (found by RightClick X). Plus the controlled translation service (labelled). The workflow was not revealed; the agents were told the outcome and asked to save what works.

| Phase | Client | Environment | Result |
|---|---|---|---|
| 1. Build | Claude Code | as above | Lima · PEN 0.291 · Wikipedia sentence · translation **exactly** equal to the service's documented output. VERIFIED. 133 s, 21 MCP calls. |
| 2. Reuse | Codex, after restart | translation service moved REST → GraphQL | Tokyo · JPY 0.00633 · sentence · exact translation. VERIFIED. 78 s, 17 MCP calls. |
| 3. Disappearance | Claude Code | translation service deleted | Brasília · BRL 0.198 · sentence · translation reported **"unavailable"**. RightClick X searched for alternatives (it learned LibreTranslate, Google Cloud Translation, Amazon Translate and others) but none were usable without keys; nothing was fabricated. VERIFIED (accurate failure). |

Evidence: [`ow5-chameleon-challenge.json`](open-world/evidence/ow5-chameleon-challenge.json).

### Negative controls · **6/6 PASS**

| Control | Expected behaviour |
|---|---|
| Identical primitive types, different entities | An invoice id is never used as an order id; no plan. |
| Numeric field with ambiguous meaning | With the tax-rate capability gone, an order total (also a number) is not returned as the tax rate. |
| Compatible operation would change data in a read-only task | With `risks:["read"]`, write/destructive capabilities never appear; destructive ones never run without `confirm: true`. |
| Provider returns success with an incorrect result | Verification marks it refuted, and it counts as a failure. |
| A required provider disappears | Withdrawn; dependent pipelines retired; alternative used, else honest failure. |
| Contract changes, operation name unchanged | The saved pipeline built on the old contract is retired. |

Evidence: [`negative-controls.json`](open-world/evidence/negative-controls.json) (each control runs named regression tests on the frozen build).

## Measurements

Measured (from evidence files):

| Measure | Value |
|---|---|
| Provider-specific code written | **0 lines** (no change under `src/`, `bin/` since the freeze tag) |
| Addresses given to agents | OW2: none · OW1/3, OW5: one public API address (+ the controlled service in OW5) |
| Agent task time | 31 s – 261 s per task (dominated by the AI client's own reasoning) |
| MCP calls per task | 8 (reuse of a saved capability) to 31 (first-time discovery across three providers) |
| Recovery after a contract change (network) | 302–347 ms |
| Withdrawal on deletion / rediscovery after restore | 423 ms / 67 ms |
| Runtime startup to first MCP response | 109 ms (local stdio) |
| Memory (RSS) | 134 MB |
| MCP round trip p50 / p95 | 0.04 / 0.11 ms (local stdio) |
| Planning latency | 2.3 ms |

## Comparison with a conventional integration

Measured: RightClick X required no client code, no SDK installation, and no code change when the controlled service changed contract four times. A hand-written v1 client for the same controlled service (see `demo/evolving.ts`, `handWrittenClient`) breaks on each of v2, v3 and v4 (measured in E10).

Estimated (not measured): a conventional build of the OW5 briefing needs a GraphQL client for countries, an HTTP client for exchange rates, an MCP client session for the Wikipedia server, an HTTP client for translation, response mapping for each, and orchestration — typically a few hundred lines and a day or more of engineering, plus re-work for each breaking change in any provider.

## Reproduce

Requirements: Node ≥ 22.18; `claude` and `codex` CLIs logged in; for OW4/OW5 a Cloudflare account logged in with `npx wrangler login` (free tier).

```bash
git checkout gauntlet-freeze-1 -- src bin           # the frozen product
node experiments/gauntlet/exp1.ts claude            # OW2, discovery without addresses (also: codex)
node experiments/open-world/ow1.ts                  # OW1+OW3, three providers, restart, Codex reuse
node experiments/open-world/negative-controls.ts    # negative controls
node experiments/open-world/ow4.ts                  # OW4, deploys the controlled service to your Cloudflare account
node experiments/open-world/ow5.ts                  # OW5, the Chameleon Challenge
```

Results vary with live data (exchange rates, holidays); verification compares against the same live sources at the same time.

## Public demonstration script (about 3 minutes)

1. Show `git diff gauntlet-freeze-1 -- src bin` is empty: the product is frozen.
2. Run `node experiments/gauntlet/exp1.ts claude`. Narrate: the agent has one MCP server and no addresses. Point at the audit log as RightClick X researches public directories, learns the Canada Holidays API and an exchange-rate service, and answers.
3. Show the independent check line: the harness asked the original services directly; the facts match.
4. Run `node experiments/open-world/ow4.ts`. Narrate each contract change on the live Cloudflare service and the recovery line; then the deletion line ("failed, honestly") and the rediscovery.
5. Close on the limitations below.

## Generalization extension (`gauntlet-freeze-2`)

Two gaps from the first round were tested further.

**More AI models.** The no-address discovery experiment (OW2) was repeated through Claude Code with **Claude Sonnet 5.5** and the much smaller **Claude Haiku 5.5**. Both found the Canada Holidays API and ExchangeRate-API in public directories and answered correctly (Sonnet 66 s / 10 MCP calls; Haiku 115 s / 11 MCP calls). With the client defaults already tested (Claude Code's default model and Codex's `gpt-6-astra`), four models from two vendors succeeded through the same interface. Evidence: `ow2-discovery-claude-sonnet.json`, `ow2-discovery-claude-haiku.json`.

**Idiosyncratic field names.** A third lab domain uses cryptic fields (`acctno`, `hldr`, `jur`, `vatpct`, `txr`…) whose meaning is only in each field's published description. On `gauntlet-freeze-1` it **failed 0/5** (no plan; preserved as `accounts-domain-on-gauntlet-freeze-1-FAILED.json`). Two general fixes, each with regression tests:

- a field described as "*entity* reference / identifier / ID" identifies that entity (`acctno`: "Account reference" → `id.account`), with filler words and "phone number" excluded;
- the self-healing bar is measured once, before execution, from the original plan's leaf capabilities, so saved pipelines' titles cannot inflate it and withdrawal during healing cannot erase it (the regression test that refuses an order total as a tax rate caught a first, wrong version of this fix).

On `gauntlet-freeze-2`: **30/30 freshly generated environments across three domains** (10 each, including cryptic names), 64/64 tests, 6/6 negative controls, and OW2 re-run against the real services: PASS.

## OW6 — A task that depends on two separate real machines · **PASS** (`gauntlet-freeze-3`)

`gauntlet-freeze-3` (`7b78eb6`) differs from `-2` only by bumping the semantics version so persisted graphs re-derive types after the inference fix (an omission found before deploying); re-validated: 64/64 tests, lab 30/30, negative controls 6/6.

Two Cloudflare Durable Object instances of the frozen build, on separate machines: **A** in AMS (weur) holds an origin-pinned GitHub credential; **B** in EWR (enam) does not. Provisioning (operator, harness-side, labelled): A learned GitHub's OpenAPI description; B learned Wikipedia REST and was wired to A as a federation peer. **Claude Code connected only to B** (Streamable HTTP MCP) with the task: *the real name of GitHub user `gvanrossum`, and the first sentence of the Wikipedia summary about that person.*

| Check | Result |
|---|---|
| Name | Guido van Rossum (GitHub API, queried directly: Guido van Rossum) |
| Summary grounded in Wikipedia's own summary | yes |
| GitHub step executed **on A** (A's receipts) | openapi:github-v3-rest-api:users-get-by-username |
| B reached A through federation (B's receipts) | 1 peer run(s); 1 local Wikipedia run(s) |
| Credential stayed on A | B's credentialed origins: https://rcx-a.ross-buckley1990.workers.dev (A's endpoint only) |

Agent time 46.8 s. The peer was wired by the operator; RightClick X does not search networks for peers. Evidence: [`ow6-federation.json`](open-world/evidence/ow6-federation.json).

## Discovery from an environment's front door (`gauntlet-freeze-4`)

**Gap addressed.** Until this build, discovery without addresses relied on public directories (APIs.guru, the MCP Registry) or on peers an operator configured. Many real environments are neither: an organisation's own services are not listed publicly. RFC 9727 (*api-catalog*, IETF, 2025) defines a standard way for an environment to publish its APIs at one well-known address, `/.well-known/api-catalog`, as a linkset.

**Change (general, no provider-specific code).** When RightClick X is pointed at any origin, `context_learn` now also probes `/.well-known/api-catalog`. If the origin publishes an RFC 9727 linkset, RightClick X follows the listed `service-desc`, `item` and `service-meta` links one level, capped at 50. It then discovers each one with the same reflectors as before (OpenAPI, GraphQL, MCP). No new AI-facing tool was added. Regression test: *RFC 9727 api-catalog: given only an environment's front door, every listed service is discovered* (65/65 tests). Frozen as `gauntlet-freeze-4` / `lab-freeze-4` (`66b871c`).

**Lab, gateway mode (`node lab/run.ts --gateway`, `node lab/report.ts 10 --gateway`).** The harness gives RightClick X **one address**, the environment's gateway, and no service address, protocol or schema. When the lab removes a provider or introduces a new one, the environment updates its catalog and RightClick X re-reads the gateway. Result: **30/30 freshly generated environments passed all 14 steps** across invoicing, logistics and the cryptic-name *accounts* domain ([lab/RESULTS-GATEWAY.md](../lab/RESULTS-GATEWAY.md)). The address-given lab was re-run on the same build: 30/30 ([lab/RESULTS.md](../lab/RESULTS.md)). Negative controls: 6/6.

**Real AI agents given only the gateway** (`node lab/ai-clients.ts --gateway --domain <d>`). Claude Code and Codex each had only RightClick X as their MCP server. The prompt named only the gateway address ("You have not been told which services exist, where they are…") and the objective.

| Domain | Claude Code | Codex | Services reached through RightClick X |
|---|---|---|---|
| accounts (cryptic names) | 11 (expected 11) · 26.9 s | "20%" (expected 20) · 41.8 s, see note | 3 of 3 (MCP, GraphQL, MCP) |
| logistics | 37.3 (expected 37.3) · 18.7 s | 3.2 (expected 3.2) · 44.9 s | 3 of 3 (GraphQL, MCP, GraphQL) |
| invoicing | 16.7 (expected 16.7) · 31.9 s | 24.9 (expected 24.9) · 41.7 s | 3 of 3 (OpenAPI, MCP, MCP) |

Note: the harness first scored answers with a strict `Number()`, which rejected Codex's correct value written with a percent sign. That is a harness defect, not a product one. Scoring now takes the leading number. The strict verdict is preserved in the evidence (`correctStrict: false`) next to the re-scored one, with the reason. Strict count: 5/6; re-scored: 6/6. Evidence: `lab/results/ai-clients-*-gateway-*.json`.

**What this does and does not show.** RightClick X can enter an environment knowing only its front door and assemble the environment's capabilities from a published standard catalog. It does not find services the environment does not list, and it does not scan networks. The environments here are local and synthetic; no real organisation's RFC 9727 catalog was tested.

## OW8: a customer's integration through a genuine upstream change, under the customer's own rules (`gauntlet-freeze-10`)

**Question.** Can RightClick X keep an independently operated customer's integration working through a genuine upstream API change, without intervention, while satisfying the customer's own correctness and security requirements?

**Short answer.** Yes, in the cases tested here, with stated limits. Where the operator publishes a machine-readable successor at its own origin, the integration kept working with no intervention, inside the customer's egress policy, with zero wrong answers. Where it does not, the integration failed closed, inside the same policy, again with zero wrong answers. It took three failed attempts and five general fixes to get there; every failure is preserved.

**Setup ([`ow8-upstream-change.ts`](open-world/ow8-upstream-change.ts), [`ow8b-no-successor-contract.ts`](open-world/ow8b-no-successor-contract.ts)).**
- **Operator:** Frankfurter, which is open source and independently operated.
- **Genuine change:** its own v1 → v2 redesign. v1's `/latest` returns a currency-keyed `rates` map; v2's `/rate/{base}/{quote}` returns one number.
- **What is real:** both contracts are the operator's own published ones, every response is live, and the operator's real root index links both versions.
- **What is simulated:** only the moment of v1's retirement. The operator still serves v1 as "frozen", so v1 returns 410 inside the customer's environment only.
- **The customer's requirements,** fixed in the file before any run:
  - correctness: a value in range, independently within 1.5% of ExchangeRate-API v6;
  - security: read-only, with data sent only to `https://api.frankfurter.dev`.
- **Second case (OW8b):** ExchangeRate-API's own v4 → v6 move. Its successor has no published contract and sits on another host. The pre-registered expectation was to fail closed.

| Run | Build | Result |
|---|---|---|
| OW8, 5 trials × 5 currencies, plus controls | freeze-8, -9, -10 | **PASS** each time. Before the change: 25/25. After it, with no intervention: 25/25, served by the operator's v2 (found from its root index). 0 requests outside the policy; 0 wrong answers. Fail-closed control (v1 and v2 both retired): 5/5 refused. |
| OW8 no-policy control | freeze-8, -9, -10 | Correct answers, but RightClick X routed the customer's requests to another operator (ExchangeRate-API), even before the change. That is why the customer's policy has to be enforceable. |
| OW8b attempt 1 | freeze-8 | **FAIL.** It failed closed correctly, but repair re-read the customer's contract on its APIs.guru mirror and probed that host. No customer data was sent, but this was outside the policy: the policy covered only the data plane. |
| OW8b attempt 2 | freeze-9 | **FAIL.** The successor search at the approved API origin got a 301 to `www.exchangerate-api.com`, and the client followed it. |
| OW8b | freeze-10 | **PASS (the expected limit).** 15/15 correct before; after the change, no answers, 0 wrong, 0 requests outside the policy. |

**General fixes this question forced (each with a regression test):**
1. **Keyed maps.** A typed JSON Schema map (`additionalProperties` + `propertyNames`) gets a "(one entry)" operation. On v1, "USD → EUR" had returned v1's `amount` field (1): a plausible, wrong answer.
2. **Distinct bindings.** Two ports of one operation no longer share one value when another fits ("USD → USD").
3. **Successor discovery.** Discovery follows contract links in a JSON root index. When an operation or contract is gone, repair looks for the successor at the contract's origin and at the API's own origin.
4. **Customer egress policy.** `origins` on compose and publish restricts every plan and repair, and is saved with the goal.
5. **Policy enforcement everywhere.** The policy covers repair traffic and every redirect hop, through a scoped network handle that also covers witness checks and MCP sessions.

Earlier, also found while answering this: example-value typing and fixed goal inputs (OW7, freeze-7).

**Corroboration from the life-science study ([report](life-science/REPORT.md)).** RCSB Search's real 2022 v1 → v2 breaking change: from a stale 2022 graph, `context_compose` self-healed on first use and returned exactly the independent truth, in 1.7 s. It also found a gap that matters here. OLS really did repoint an operation id at a different operation. A direct call then returns a *successful, empty* result, and only the drift report signals it. A customer-owned check (for example `length_gt 0`) would refuse it; without one, it is silent.

**What this does not show.**
- **No live change was observed.** The retirement moments were simulated; the operators have not retired v1/v4. Seeing a genuine change happen live needs a standing monitor over weeks, which was deliberately not set up.
- **The customer is not independent.** The requirements were written by us, in the customer's role. No independent developer has used RightClick X, and none has been asked to pay.
- **Two operators, one domain (exchange rates),** plus the RCSB and OLS cases in the life-science study. That is consistent behaviour across a small number of real changes, not a rate across many.
- **Unsupported change kinds:** a change whose successor has no machine-readable contract can only fail closed, as can a change that moves to an unapproved host. Silent semantic repointing (the OLS case) needs customer-owned checks.

## Limitations (verified, not hypothetical)

- **Two AI clients, four models.** Claude Code (default model, Sonnet 5.5, Haiku 5.5) and Codex (`gpt-6-astra`). Other MCP clients (Cursor, VS Code, Gemini CLI) were not available here, and Codex with a ChatGPT login offers only its default model. A third vendor, Mistral Vibe, is installed and now supported by the lab harness (`--clients vibe`), but its run is **BLOCKED**: the Mistral account returns HTTP 429 to every request, so no Mistral model reached RightClick X ([evidence](open-world/evidence/vibe-third-vendor-blocked.json)).
- **Friendly providers.** The real services used publish clean machine-readable contracts with conventional field names. Cryptic names are covered only when the contract describes the field (lab domain *accounts*); cryptic names with no description, and interfaces with no machine-readable contract at all, are not covered.
- **Keys limit acquisition.** In OW5 phase 3, RightClick X found real alternative translation services, but they required credentials it did not have. It reported unavailability correctly; it did not obtain access.
- **Directory quality.** Discovery without addresses depends on what APIs.guru and the MCP Registry list and how well their descriptions match the objective.
- **Front-door discovery needs a published catalog.** Given only an environment's gateway, RightClick X finds the services listed in its RFC 9727 `/.well-known/api-catalog`. An environment without a catalog, or a service it does not list, is not found this way. This was tested on local synthetic environments only.
- **Prompts name the shape of the output** (and, in OW1/OW5, ask for a Wikipedia MCP server from the registry, to ensure protocol diversity). The workflow itself was never given.
- **Peers are configured, not discovered.** Cross-host federation (OW6) works between instances an operator connects; RightClick X does not search networks for peers.
- **Single runs.** Each experiment ran once (plus the recorded re-runs); no statistics across many runs.
- **No claim of a first.** No prior-art review was done.
