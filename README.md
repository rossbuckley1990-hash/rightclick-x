# RightClick X

**An MCP server that becomes whatever its environment can do.**

Plug it into any AI client once. Point it at anything with a contract — an OpenAPI or Swagger spec, a GraphQL endpoint, another MCP server, a web page with forms, another RightClick X instance, the platform it is running on — and those capabilities become typed nodes in one live graph. The agent never gets a new tool. It gets the same thirteen `context_*` tools, and the graph behind them changes shape to match wherever it is.

Because every capability's inputs and outputs carry *semantic* types (a `place`, a `geo.lat`, an `account`, an `id.release`, not just "string"), capabilities from unrelated providers and protocols connect to each other. Ask for what you have and what you want; RightClick X finds the pipeline, runs it, verifies it, heals it when a provider dies, and saves it as a new capability when it works.

```text
any spec · endpoint · MCP server · page · peer · platform
                          │  reflect (no per-provider code)
                          ▼
             one semantically typed, live capability graph
                          │  plan · run · verify · heal · crystallize
                          ▼
         13 context_* MCP tools, the same for every AI client
```

## Plug it into any AI

RightClick X speaks MCP over **stdio** (local clients) and **Streamable HTTP** (remote clients). `rcx connect` prints the exact configuration for your client:

```bash
node bin/rcx.ts connect
```

```bash
claude mcp add rightclick-x --scope user -- node /path/to/rightclick-x/bin/rcx.ts mcp
```

Cursor, Claude Desktop, Windsurf (`mcpServers` JSON), VS Code (`.vscode/mcp.json`), Codex (`~/.codex/config.toml`) and any HTTP MCP client (`https://<host>/mcp` + bearer token) are covered by `rcx connect <client>`. Interoperability is checked with the official MCP Inspector over both transports.

## The thirteen tools

| Tool | What it does |
|---|---|
| `context_research` | Survey the environment: runtime, platform bindings, which types the graph produces and consumes, unfed inputs, and — given a topic — candidate sources worldwide (APIs.guru's ~2,500 OpenAPI specs, the official MCP Registry). `learn: N` acquires the top N immediately. |
| `context_learn` | Point it at any URL. It works out what is there and reflects it, reporting new capabilities and new composite powers. |
| `context_compose` | `have` + `want` (+ `intent`, optional `through` anchors, optional `risks` constraint) → ranked multi-provider pipelines; `run: true` executes, self-heals, verifies and crystallizes; `acquire: true` goes and finds missing capabilities in public directories; `publish: "<name>"` turns the goal into an endpoint of this instance's synthesized API. |
| `context_run` | Run one capability, with optional verification predicates. |
| `context_actions` | What can be done with a value: direct capabilities plus every type it can become through pipelines. |
| `context_inspect` | Classify any value into the semantic type lattice. |
| `context_explain` | Ports, provider, invocation, graph neighbours, observed reliability, example args. |
| `context_graph` | Query the graph: stats, types, search, neighbors, paths, edges, export. |
| `context_providers` | Everything contributing capabilities right now. |
| `context_run_status` | Past runs and the integrity of the receipt chain. |
| `context_watch` | Follow the graph as it changes (long-poll). |
| `context_forget` | Remove a provider. |
| `context_runtime` | Identify this instance, its runtime, region and graph size. |

## What it does, in practice

From the live-internet experiments in [`experiments/`](experiments/EXPERIMENTS.md), all against real public services, none of which RightClick X has specific code for:

- **The whole GitHub REST API from GitHub's own spec:** 1,238 operations reflected in under 3 seconds alongside Wikipedia's REST API and DeepWiki's MCP server; 103 million composite powers.
- **GitHub user → real name → Wikipedia**: `{username: "gvanrossum"}` → GitHub `users/get` → `name` → Wikipedia page summary → *"Guido van Rossum is a Dutch programmer…"*. The pipeline crystallized and was reused for `torvalds`.
- **Repository → homepage → the live site**: `{owner: "denoland", repo: "deno"}` → GitHub `repos/get` → `homepage` (a `url`) → fetch → readable text → summary.
- **GraphQL → REST**: `{country: "PT"}` → countries GraphQL API → `capital` → Wikipedia → verified summary of Lisbon, for five countries; then reused as one crystallized capability.
- **Kubernetes, with no MCP server written**: the live cluster's whole API (799 operations) reflected in 210 ms; RightClick X installed a new CRD through a capability it had just reflected, then grew that resource's 8 operations into its own graph 1.2 s later, and filled it with live internet knowledge (countries GraphQL → Wikipedia → `Insight` objects), confirmed independently by kubectl.
- **APIs that write themselves**: publish a goal (`context_compose` with `publish`) and it becomes an endpoint in the instance's own OpenAPI API, with no handler or schema written. In E11, instance A fused the countries GraphQL API with an exchange-rate API it found on its own into a *Country money* endpoint; instance B learned A's API and published one on top of it; instance C called B: C → B → A → the internet, driven only through MCP. Then the same across three continents on Cloudflare: A in Amsterdam, B in Newark, C in Hong Kong, each pinned by location hint and authenticated to the next ([E11, E11-cloud](experiments/EXPERIMENTS.md)).
- **Every API becomes every protocol**: whatever an instance learns, in any protocol, is published as REST (`/x/…` + `/openapi.json`), GraphQL (`/graphql`, with introspection) and MCP. Live: an MCP-only server answered GraphQL queries, a GraphQL-only API answered REST and MCP, a REST-only API answered GraphQL and MCP: 9/9, no adapters ([E13](experiments/EXPERIMENTS.md)).
- **Joining systems that never met**: *Issue Oracle* fuses GitHub's REST API and DeepWiki's MCP server into one published endpoint with no integration code: an issue and its repository are fetched in parallel and joined into a question about the codebase. Live on Cloudflare, called from another region ([E12](experiments/EXPERIMENTS.md)).
- **Integrations that maintain themselves**: an integration is a goal plus a check, not hard-coded calls. When a provider ships a breaking release, RightClick X re-reflects it, detects the drift, retires stale pipelines, re-plans and re-verifies. Across REST v1 → renamed REST v2 → GraphQL → MCP → rollback, a hand-written client broke three times; the RightClick X integration stayed verified with 0 lines changed ([E10](experiments/EXPERIMENTS.md)).
- **It published itself**: through capabilities reflected from GitHub's spec, RightClick X created [`rossbuckley1990-hash/rightclick-x`](https://github.com/rossbuckley1990-hash/rightclick-x) and uploaded its own source; GitHub's tree hash is identical to the checkout's `git write-tree`.
- **Acquisition on demand**: start with nothing, ask for something it can't do (`acquire: true`), and it researches APIs.guru and the MCP Registry, learns an API or MCP server it has never seen, and completes the goal: live EUR exchange rates, a Wikipedia summary through a third-party MCP server, Ontario's public holidays ([X5](experiments/STRESS.md)).
- **Under stress**: 20,014 capabilities and 156.7 M typed links in one graph with 197 ms planning; 100% availability through 373 breaking releases across 50 providers; 1,000 concurrent MCP calls with 0 errors; routing that learns which vendors to trust as their reliability changes ([STRESS.md](experiments/STRESS.md)).
- **Self-healing under real failure**: a pipeline whose output failed verification was routed around automatically; with a provider's route cut, compose re-planned through a federated peer.

And the offline demo (`npm run demo`), which spins up four local services in four protocols:

```text
━━ Act 3 ━━ Compose: what I have → what I want, across providers
  have {"place":"Lisbon","language":"es"}  want text  intent "weather translated"
  ▶ Geocode → Weather forecast → Translate text  [graphql, mcp:skycast, openapi:polyglot]
  result   Se esperan ligera lluvia cielos con una máxima de 10°C y una suave brisa hoy.
  verified ✓ verified  3ms, 3 receipts
  ✦ crystallized Weather translated: Geocode → Weather forecast → Translate text  +66 powers
━━ Act 6 ━━ Self-healing: a provider dies mid-flight
  ✗ Weather translated: Geocode → Weather forecast → Translate text  failed at mcp:skycast:forecast → route around it, re-plan
  ▶ Geocode @graphql → Weather forecast @peer:eu-west → Translate text @openapi:polyglot
```

`npm run serve` opens a live dashboard where the graph grows, nodes light up as they run, and compose/learn/research are one click away.

## The Open-World Proof

Against real, independently operated services, with a frozen build and two AI clients from different vendors (Claude Code, OpenAI Codex), each connected only to RightClick X ([experiments/OPEN-WORLD-PROOF.md](experiments/OPEN-WORLD-PROOF.md)):

- **Discovery without addresses:** given only an objective, both agents had RightClick X find the Canada Holidays API and an exchange-rate API in public directories and answer correctly.
- **Three providers, three protocols:** countries GraphQL + an exchange-rate REST API + a Wikipedia **MCP server from the official MCP Registry**, combined and saved; after a restart, the other agent reused the saved capabilities for a new country in 8 MCP calls.
- **Real network adaptation:** an owned service on Cloudflare changed contract four times (renamed REST, GraphQL, MCP, rollback); RightClick X recovered each time in ~0.3 s, withdrew it honestly when deleted, and rediscovered it when restored.
- **Across real machines:** an agent connected only to an instance in Newark completed a task whose GitHub step ran on a peer instance in Amsterdam, using a credential that never left Amsterdam.
- **Negative controls:** 6/6, e.g. it will not return an order total as a tax rate, or plan a write in a read-only task.
- 0 lines of product code changed during the experiments. Limitations are listed in the report.

## The Chameleon Lab

One command answers the product's central question: *can an unchanged MCP server discover unfamiliar, authorised software capabilities, compose a useful workflow, verify its result, and adapt when the underlying software changes?*

```bash
npm run lab
```

The product build is frozen (git tag `gauntlet-freeze-4`). Each run then generates a new environment from `lab/fixtures.json` with a fresh seed: service names, operation titles, field spellings and the protocol of every service (OpenAPI, GraphQL or MCP) are random, and RightClick X knows none of it. The harness starts RightClick X as a separate process and talks to it only as an MCP client. It gives it the services' root addresses and a business objective (*for an invoice, find the tax rate that applies in its customer's country*), then checks every answer against its own copy of the data. Mid-run, the tax service ships a breaking release on a different protocol, is removed, and is replaced by a different provider.

**Real AI agents, not just a harness** ([lab/AI-CLIENTS.md](lab/AI-CLIENTS.md)): Claude Code (Anthropic) and Codex (OpenAI), each given only RightClick X as their MCP server, the addresses and the objective, solved freshly generated environments in both domains: 4/4 correct against ground truth, every service reached through RightClick X.

Latest report ([lab/RESULTS.md](lab/RESULTS.md)): **30 of 30 freshly generated environments, across three unrelated business domains (invoicing, logistics, and an accounts domain with cryptic field names whose meaning is only in their descriptions; all pure fixture data), passed all 14 steps** on the frozen build: discovery from addresses alone (31 ms), a three-provider workflow planned in 2.2 ms and executed in 4.4 ms, correct against independent data, reused, recovered from a breaking cross-protocol release in 8 ms with no code change, honest withdrawal when the provider disappeared, and recovery through a newly introduced provider. What the lab does *not* prove is listed in the report.

**Only the front door** ([lab/RESULTS-GATEWAY.md](lab/RESULTS-GATEWAY.md)): with `--gateway`, RightClick X is given one address, the environment's gateway, which publishes a standard RFC 9727 `/.well-known/api-catalog`. It is given no service address. Result: 30 of 30 environments across the three domains passed all 14 steps. Claude Code and Codex, given only the gateway, answered correctly in all three domains (6/6 after a harness scoring fix, recorded; 5/6 under the original strict scoring). RightClick X finds what the environment lists; it does not scan networks.

## How it works

- **Reflectors** turn contracts into typed capabilities: OpenAPI 3.x and Swagger 2.0 (`$ref`, `allOf`/`oneOf`, servers, path/query/header/body), GraphQL (introspection with a depth-limited fallback; selections generated), remote MCP over Streamable HTTP (sessions, SSE responses, output schemas, annotations), HTML forms (hidden fields become constants; password fields are never reflected), RightClick X peers (federation), and the platform itself (Cloudflare KV / Workers AI bindings, a sandboxed workspace filesystem on servers).
- **Semantic types** come from names, formats, descriptions and context: `lat` → `geo.lat`, `target` + "ISO 639-1" → `language`, `code` on field `country` → `country`, `release_id` → `id.release`, `owner` → `account`. A lattice says what may flow where; ids of different things never mix.
- **The planner** is a best-first search over typed values, ranked by how fully it uses the caller's inputs, intent coverage, result quality and the experience ledger. Agents can pin `through` anchors and the planner wires the rest.
- **Self-maintenance**: every capability has a contract signature; crystallized pipelines carry the signatures they were proven on. When a step fails, compose re-reflects that provider's source; if the contract drifted (even to another protocol), stale pipelines are retired and the goal is re-planned against the new contract.
- **Execution** records every run in a SHA-256 hash-chained receipt log, updates per-capability reliability and latency, checks optional predicates (`verified` / `refuted` / honestly `unverified`), re-plans around failures, and crystallizes successful multi-step pipelines into new capabilities.
- **Powers** = capabilities + typed links + 3-step chains. It is the number that shows why a graph beats a tool list: one new provider adds far more powers than capabilities.

## Runs anywhere

| Where | How |
|---|---|
| Any machine with Node ≥ 22.18 | `node bin/rcx.ts …` (TypeScript runs natively) or the bundled `node dist/rcx.mjs …` (any Node, 155 KB) |
| Bun | `bun bin/rcx.ts …`; `npm run build:bin` makes a single self-contained binary |
| Cloudflare, region-pinned | `node deploy/cloud.ts` deploys Durable Object instances with location hints and per-instance tokens (`src/entry/durable.ts`) |
| Cloudflare Workers | `src/entry/edge.ts` + `wrangler.toml` (KV for state; KV/AI bindings become capabilities) |
| Deno / Vercel / Netlify edge | the same `export default { fetch }` module |
| Containers | `Dockerfile` |
| As a library | `import { RightClick } from "rightclick-x"` |

## Safety model

Authorised operations run without unnecessary friction; the user keeps authority over anything destructive.

- **Read and write capabilities run when called.** Risk is a label (`read`, `write`, `external`, `destructive`) that callers can also use as a constraint: `context_compose` with `risks: ["read"]` plans only with read-only capabilities.
- **Destructive capabilities need consent:** they run only when the caller passes `confirm: true` to `context_run` or `context_compose`. Without it nothing executes, and compose routes around the step if a non-destructive alternative exists. An operator can opt out for their own environment (`destructive: "allow"`).
- **Self-healing preserves meaning:** a recovery plan may never cover less of the goal than the plan it replaces, so a missing capability is reported as a failure rather than answered with a plausible substitute.
- **Credentials are origin-pinned** (`RCX_AUTH`), never reflected into capabilities, and never forwarded across origins, including on multi-hop redirects.
- **Network policy:** when the server is exposed beyond loopback (and at the edge), outbound requests to private, loopback, link-local and cloud-metadata addresses are refused, including via DNS and redirects.
- **HTTP endpoints** require a bearer token unless bound to loopback, with per-caller rate limits and request-size limits.
- Workspace file capabilities cannot escape their root. Operating-system permissions are untouched.

## Develop

```bash
npm install
npm test             # 64 offline tests (node:test)
npm run lab          # the Chameleon Lab: one generated environment, end to end
npm run lab:report   # ten fresh environments → lab/RESULTS.md
node lab/report.ts 10 --gateway   # same, given only the environment's api-catalog gateway → lab/RESULTS-GATEWAY.md
npm run typecheck
npm run demo         # seven-act offline demo
node experiments/cloud.ts   # live-internet experiments (read-only)
```

## Status

v0.1.0. Verified: 64 tests, typecheck, the Chameleon Lab on a frozen build (30/30 generated environments in three domains), the Open-World Proof against real services with Claude Code and Codex (four models), Node 24 and Bun 1.3, MCP Inspector over stdio and HTTP, live experiments in `experiments/results/`. Also verified earlier: region-pinned Cloudflare deployment (E11-cloud, E12, E13). Not yet verified: Deno Deploy, YAML-only OpenAPI specs (not parsed), OAuth-protected remote MCP servers, and npm publishing.

Apache-2.0.
