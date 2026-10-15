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
- **APIs that write themselves**: publish a goal (`context_compose` with `publish`) and it becomes an endpoint in the instance's own OpenAPI API, with no handler or schema written. In E11, instance A fused the countries GraphQL API with an exchange-rate API it found on its own into a *Country money* endpoint; instance B learned A's API and published one on top of it; instance C called B: C → B → A → the internet, driven only through MCP ([E11](experiments/EXPERIMENTS.md)).
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
| Cloudflare Workers | `src/entry/edge.ts` + `wrangler.toml` (KV for state; KV/AI bindings become capabilities) |
| Deno / Vercel / Netlify edge | the same `export default { fetch }` module |
| Containers | `Dockerfile` |
| As a library | `import { RightClick } from "rightclick-x"` |

## Safety model

There are no approval gates: write and destructive capabilities run when called, and nothing is hidden or held for confirmation. Risk is a *label* (`read`, `write`, `external`, `destructive`) that callers can use — `context_compose` accepts an optional `risks` constraint such as `["read"]` when the caller wants it. What does remain are locks that keep other people out, not you:

- HTTP endpoints require a bearer token unless bound to loopback; a public deploy without `RCX_TOKEN` keeps its API locked.
- Credentials are origin-pinned (`RCX_AUTH`), stripped on cross-origin redirects, and never reflected into capabilities.
- Workspace file capabilities cannot escape their root.
- OS-level permission prompts are untouched.

## Develop

```bash
npm install
npm test             # 40 offline tests (node:test)
npm run typecheck
npm run demo         # seven-act offline demo
node experiments/cloud.ts   # live-internet experiments (read-only)
```

## Status

v0.1.0. Verified: tests, typecheck, Node 24 and Bun 1.3, MCP Inspector over stdio and HTTP, live experiments in `experiments/results/`. Not yet verified: an actual Cloudflare / Deno Deploy deployment, YAML-only OpenAPI specs (not parsed), OAuth-protected remote MCP servers, and npm publishing.

Apache-2.0.
