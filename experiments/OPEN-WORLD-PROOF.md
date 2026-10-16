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
| **What remains unproven** | See *Limitations*: two AI clients only; real providers are friendly, well-described public APIs; idiosyncratic naming and interfaces without machine-readable contracts are not covered; cross-host federation was not re-run on this build. |

## Build

- Frozen build: tag **`gauntlet-freeze-1`**, commit `5945a9a` (`eb757bd` plus a host-side audit log of MCP tool calls; no behavioural change). Validated: 63/63 tests, `tsc` clean, 13 tools over stdio and Streamable HTTP confirmed with `@modelcontextprotocol/inspector --cli`. Record: [`phase0-build.json`](open-world/evidence/phase0-build.json) (Node v24.16.0, macOS 26.4.1 arm64, `dist/rcx.mjs` sha256 `9d433baa…`).
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

## Limitations (verified, not hypothetical)

- **Two AI clients.** Claude Code and Codex. Other MCP clients (Cursor, VS Code, Gemini CLI) were not available here.
- **Friendly providers.** The real services used publish clean machine-readable contracts (OpenAPI, GraphQL introspection, MCP tool lists) with conventional field names. Idiosyncratic naming and interfaces without machine-readable descriptions are not covered.
- **Keys limit acquisition.** In OW5 phase 3, RightClick X found real alternative translation services, but they required credentials it did not have. It reported unavailability correctly; it did not obtain access.
- **Directory quality.** Discovery without addresses depends on what APIs.guru and the MCP Registry list and how well their descriptions match the objective.
- **Prompts name the shape of the output** (and, in OW1/OW5, ask for a Wikipedia MCP server from the registry, to ensure protocol diversity). The workflow itself was never given.
- **Cross-host federation was not re-run on this build.** Earlier region-pinned Cloudflare runs (E11-cloud, E12, E13) are on older builds.
- **Single runs.** Each experiment ran once (plus the recorded re-runs); no statistics across many runs.
- **No claim of a first.** No prior-art review was done.
