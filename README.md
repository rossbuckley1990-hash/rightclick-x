# RightClick X

### Your AI should adapt to software. Not the other way around.

**One MCP connection. Thirteen tools. A living map of what your environment can do.**

Discover capabilities. Connect APIs that have never met. Turn working workflows into reusable APIs. **Keep them working when compatible upstream interfaces change.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.18-43853d.svg)](#get-started)
[![Protocol](https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-555.svg)](#connect-your-ai)

[**Get started**](#get-started) · [**Watch an integration heal**](#the-demo-an-api-breaks-the-capability-doesnt) · [**See the evidence**](#show-me-the-evidence) · [**Understand the architecture**](#why-this-is-different)

</div>

---

Your agent can use tools. But every unfamiliar API, application, protocol, or machine is another integration someone has to build and maintain.

**RightClick X turns supported software contracts into capabilities on demand.** Give it an OpenAPI spec, GraphQL endpoint, MCP server, web form, peer runtime, or supported platform binding. It reflects the available operations into a semantically typed graph. Your agent keeps using the same **13 `context_*` MCP tools** even as that graph grows, changes, and disappears.

Then comes the interesting part: the runtime can **compose operations across providers, execute them, check results, save successful goals as new endpoints, and re-plan when a previously working contract changes.** No GitHub-specific or Wikipedia-specific adapter needs to be written for the examples below.

> **Not an integration marketplace. An integration runtime.** It discovers what your environment actually exposes, under the access you already have.

## The demo: an API breaks. The capability doesn't.

Two different AI agents. One saved capability. A protocol-breaking change in between.

```text
  CLAUDE CODE · fresh session
  "Build a sourced destination brief for Portugal. Save what works."
       │
       ├─ Countries API (GraphQL) → capital
       ├─ Wikipedia (REST)       → current article extract
       ├─ Formatter              → sourced Markdown
       └─ Separate auditor       → checks the answer against the sources
       │
       └─ ✓ verified → published as goal:destination-brief

             ┌──────────────────────────────────┐
             │  The owned formatter API breaks  │
             │  REST v1 → MCP                   │
             │  Operation and inputs renamed    │
             │  RightClick X process restarted  │
             └──────────────────────────────────┘

  CODEX · new session, no Claude conversation
  "Create the destination brief for Iceland."
       │
       └─ discovers goal:destination-brief
            └─ old route fails → contract re-learned → workflow re-planned
                 └─ auditor checks the NEW answer
                      └─ ✓ verified Iceland brief

  1 saved-goal invocation · 1.67 s recovery · 0 integration-code changes
```

This ran on **16 October 2026** using real Countries and Wikipedia data, an owned Cloudflare formatter deliberately changed from REST to MCP, a separate read-only auditor, and fresh Claude Code and Codex sessions. **The public APIs were not the ones changed.** The second agent needed three MCP calls total (find, inspect, invoke); the repair happened inside that one invocation.

**[Read the actual Iceland brief](proof/results/real-ai-2026-10-16T10-54-39-863Z/reuser-brief.md)** · **[Inspect the full trace](proof/results/real-ai-2026-10-16T10-54-39-863Z/manifest.json)** · **[Inspect the separate evidence audit](proof/results/real-ai-2026-10-16T10-54-39-863Z/independent-evidence-audit.json)**

That is the product we're building: **capabilities that survive beyond the agent that discovered them.**

## Get started

Requires **Node.js 22.18+**. No API key is needed for the local demo.

```bash
git clone https://github.com/rossbuckley1990-hash/rightclick-x.git
cd rightclick-x
npm install
npm run demo
```

The seven-act local demo starts services speaking different protocols, discovers their capabilities, builds a multi-provider workflow, saves it, and demonstrates recovery when a provider goes away. It uses controlled fixtures; **it does not call a live weather service**.

Want to see the capability graph grow in a browser?

```bash
npm run serve
# Open http://127.0.0.1:8787
```

Want to reproduce the complete, checked lifecycle instead?

```bash
npm run proof       # isolated local services, outcome witness, drift, restart, receipts
npm test            # regression tests
npm run typecheck   # TypeScript check
```

## Connect your AI

RightClick X is an **MCP server** over stdio and Streamable HTTP. It works with any client that supports the corresponding transport.

**Claude Code**, from the cloned repository:

```bash
claude mcp add rightclick-x --scope user -- node "$PWD/bin/rcx.ts" mcp
```

**Codex, Cursor, Claude Desktop, VS Code, Windsurf, or another MCP client:**

```bash
node bin/rcx.ts connect        # prints supported client configurations
node bin/rcx.ts connect codex  # example: copy-ready Codex TOML
```

For an HTTP MCP client, run `node bin/rcx.ts serve` locally and connect to `http://127.0.0.1:8787/mcp`. Non-loopback deployments require authentication; see [Security and trust](#security-and-trust).

**Give your agent a task, not a list of preinstalled integrations:**

> Use RightClick X to discover a public API for Canadian holidays. Find the next holiday in Ontario, show the source, and explain which capability you used. Don't invent an answer if a source is unavailable.

Public-directory discovery requires internet access, and third-party API availability can vary. Start with `npm run demo` for a deterministic local experience.

## Why this is different

Most agent integrations expose **a fixed list of tools somebody already wrote**. RightClick X exposes a fixed *way to discover and use capabilities* — while the capabilities themselves change with the environment.

```text
    Claude  ·  Codex  ·  Cursor  ·  any MCP-compatible AI
                            │
                      ONE MCP CONNECTION
                            │
                     13 context_* tools
                            │
                      RIGHTCLICK X
                            │
            discover  →  type  →  plan  →  execute
                 ↑                       │
                 └──── re-plan ← check ←─┘
                            │
                  persist / publish goals
                            │
      ┌──────────────┬──────────────┬──────────────┐
      │              │              │              │
   OpenAPI         GraphQL         MCP           Peers
   / Swagger       endpoints       servers       / runtime
      │              │              │              │
      └─────── web forms · supported platforms ──────┘
```

The graph contains operations and their input/output *semantic* types — for example, a `place`, `geo.lat`, `id.release`, or `account`, not merely a `string`. A planner searches for useful routes between what you have and what you need. It can learn missing public sources, execute a compatible route, and retain a successful workflow as another capability.

A published goal is available through **MCP, REST (`/x/...` and `/openapi.json`), and GraphQL (`/graphql`)**. Other RightClick X instances can discover that new API in turn. This does **not** mean arbitrary protocols or business semantics can be translated losslessly.

## Things we've actually run

These are recorded experiments, not illustrations of features we intend to build someday.

| Experiment | Observed result | Evidence |
|---|---|---|
| **The API writes another API** | Instance A combined public GraphQL and REST services into a published endpoint. B learned A's API and published another. C called B → A → the internet, including a deployment spanning **Amsterdam → Newark → Hong Kong** on Cloudflare. | [E11 / cloud](experiments/EXPERIMENTS.md) |
| **Every supported source, three faces** | An MCP-only tool was called via GraphQL and REST; a GraphQL-only API via REST and MCP; a REST-only API via GraphQL and MCP. **9/9** tested source/client combinations worked, without per-provider adapters. | [E13](experiments/EXPERIMENTS.md) |
| **Kubernetes learns a new kind of resource** | Reflected **799 operations** from a disposable local `kind` cluster; installed a CRD via its reflected API; then discovered that CRD's **8 new operations**. Separate `kubectl` readback confirmed four created objects. | [E9](experiments/EXPERIMENTS.md) |
| **No GitHub integration written** | Reflected **1,238 GitHub REST operations** from GitHub's published spec in under 3 seconds, then composed GitHub and Wikipedia operations into workflows. | [E7](experiments/EXPERIMENTS.md) |
| **Self-maintenance under protocol drift** | In a controlled provider experiment, a hand-written client broke at three contract changes; a goal-based RightClick X workflow was re-reflected, re-planned, and checked without changes to integration code. | [E10](experiments/EXPERIMENTS.md) |
| **Discover without an address** | Claude Code and Codex found unfamiliar holidays and exchange-rate APIs from public directories and answered against independently checked source data. | [Open-World Proof](experiments/OPEN-WORLD-PROOF.md) |

**One more:** RightClick X used GitHub operations learned from GitHub's own spec to create [its own repository](https://github.com/rossbuckley1990-hash/rightclick-x) and upload its source. The remote Git tree hash matched the local checkout. [See E8](experiments/EXPERIMENTS.md).

### What about scale?

On one Apple Silicon laptop, synthetic stress tests recorded **20,014 capabilities**, **156.7 million typed links**, and **197 ms planning** on the generated graph. Another controlled test completed **1,500/1,500** calls while 50 simulated providers produced 373 breaking releases. A 1,000-call concurrency test had zero errors. These are **local/synthetic workload measurements**, not production uptime or a guarantee of useful routes. [Methods and limitations](experiments/STRESS.md).

## The thirteen tools

**The agent's interface does not grow when the environment does.**

| MCP tool | What the agent gets |
|---|---|
| `context_research` | Survey the environment and find candidate public capability sources. |
| `context_learn` | Reflect a URL, spec, endpoint, MCP server, page, or peer into the graph. |
| `context_compose` | Find a route from `have` to `want`; optionally execute, verify, acquire, save, and publish it. |
| `context_run` | Execute a capability, including a saved goal. |
| `context_actions` | Discover what can be done with a given value. |
| `context_inspect` | Classify values into semantic types. |
| `context_explain` | Inspect ports, invocation, provenance, risk, and observed behaviour. |
| `context_graph` | Search nodes, paths, connections, and graph statistics. |
| `context_providers` | See which providers contribute capabilities right now. |
| `context_run_status` | Inspect execution results and receipt-chain status. |
| `context_watch` | Follow live graph changes. |
| `context_forget` | Remove a provider and its reflected capabilities. |
| `context_runtime` | Identify the runtime, region, and capability graph. |

One powerful pattern is `context_compose` with `publish: "<name>"`: an outcome becomes `goal:<slug>`, exposed through MCP and as a generated HTTP API. Saved goals can be found and used by another agent after restart; they retain their declared checks and re-plan when compatible implementations change.

## Show me the evidence

Don't take a demo transcript on faith. The repository keeps **scripts, manifests, source snapshots, independent truth checks, and failures** next to the results.

| Start here | What you can inspect or reproduce |
|---|---|
| [`npm run proof`](proof/results/latest.json) | A deterministic, end-to-end local lifecycle: gateway discovery, independent read-only witness, units, persistence, API changes, restart, false-result rejection. The recorded run passed **28/28** checks. |
| [Claude → Codex proof](proof/results/real-ai-2026-10-16T10-54-39-863Z/manifest.json) | Real public data, owned Cloudflare protocol drift, separate outcome auditor, new session, saved-goal reuse, raw MCP exchanges; **52 phase checks** passed in the recorded run. |
| [Open-World Proof](experiments/OPEN-WORLD-PROOF.md) | Fresh agents, real third-party APIs, discovery from public registries, controlled drift over a real network, and negative controls. |
| [Chameleon Lab](lab/RESULTS.md) | Frozen-runtime tests over randomly generated environments; **30/30** in the recorded run. These are synthetic services with independent ground truth. |
| [Internet experiments](experiments/EXPERIMENTS.md) | Provider protocols, generated APIs, Cloudflare federation, Kubernetes, GitHub, and recorded limitations. |
| [Stress tests](experiments/STRESS.md) | Generated workloads, request volumes, observed latency, and known benchmark biases. |

For the full cross-vendor reproduction you need authenticated Claude/Codex CLIs and an authenticated Cloudflare account; see [the proof instructions](#reproduce-the-cross-agent-proof).

## Security and trust

Discovering an operation **does not grant permission to use it**. RightClick X operates with the credentials and capabilities made available to its runtime; it does not bypass an application's authentication or operating-system controls.

- **Execution risk:** `read`, `write`, `external`, and `destructive` labels can constrain planning. Destructive operations require an explicit `confirm: true` argument by default; this is a *caller-side confirmation mechanism*, **not** an independent human-approval system. Ordinary writes can execute when invoked.
- **Credentials:** origin-pinned headers are not reflected into the graph or forwarded to a different origin on redirects. Cloud peers can keep their credentials local.
- **Network boundaries:** exposed servers block private, loopback, link-local, and cloud-metadata targets, including checks around DNS and redirects; intentional local deployments can use explicitly configured exceptions.
- **Verification:** user-defined predicates and optional separate read-only witnesses can reject incorrect results. A receipt proves what was executed and checked — **not that every unverified result is true**.
- **Saved goals:** their risk constraints and required checks are retained during replanning; changed or missing outcome-checker contracts fail closed in the recorded workflow.

This is **v0.1.0, experimental infrastructure**, not a transactional write-recovery engine or a comprehensive enterprise policy system. See [current limits](#current-limits).

<a id="current-limits"></a>

<details>
<summary><strong>Current limits (read before relying on it in production)</strong></summary>

- **Contracts are required.** Discovery uses exposed descriptions, public registries, known URLs, gateway catalogs, and supported platform bindings. It does not magically understand arbitrary software or scan private networks.
- **Semantic compatibility is hard.** Two operations can share types and names but have different meanings. Contract matching and checks reduce risk; they do not establish arbitrary business equivalence. Treat high-impact changes as needing independent verification.
- **Large results and identifier schemes** can require additional tooling or more precise semantics. An exploratory life-science exercise exposed both limitations.
- **A recovered response is not automatically a correct business outcome.** Use independent checks, especially for payments, data writes, and decisions with real-world consequences.
- **Destructive confirmation is not human identity verification.** Deploy your own authorisation and approval boundary around sensitive uses.
- **Transactions, rollback of external writes, and exactly-once execution** are not established by the current read-workflow proofs.
- **Not yet verified in the recorded README baseline:** Deno Deploy, YAML-only OpenAPI descriptions, OAuth-protected remote MCP servers, and npm publishing.

</details>

## Run it your way

| Environment | Entry point |
|---|---|
| Node.js ≥22.18 | `node bin/rcx.ts mcp` or `node bin/rcx.ts serve` |
| Bundled Node.js application | `npm run build` (requires Bun for bundling) → `dist/rcx.mjs` |
| Bun | `bun bin/rcx.ts mcp` |
| Single compiled binary | `npm run build:bin` (Bun required) |
| Cloudflare Workers / Durable Objects | [`deploy/cloud.ts`](deploy/cloud.ts) and [`src/entry/edge.ts`](src/entry/edge.ts) |
| Docker | [`Dockerfile`](Dockerfile) |
| JavaScript/TypeScript library | `import { RightClick } from "rightclick-x"` |

### Reproduce the cross-agent proof

This creates two disposable owned Cloudflare Workers, uses authenticated AI CLI sessions (consuming model quota), and deletes the test Workers afterwards. No credentials belong in the repository.

```bash
node proof/real-environment.ts --deploy --manifest .rcx-deploy/real-current.json
node proof/real-environment.ts --preflight --manifest .rcx-deploy/real-current.json
npm run proof:real -- --deployment .rcx-deploy/real-current.json --clients claude,codex
node proof/real-environment.ts --cleanup --manifest .rcx-deploy/real-current.json
```

## Build with us

We're exploring a simple question with big consequences:

> **What if every AI agent could discover the capabilities available in its environment — and pass on working, checked capabilities to the next agent — without everyone maintaining a separate integration for every system?**

Try the [demo](#get-started). Run a [proof](#show-me-the-evidence). Break something we thought worked and [open an issue](https://github.com/rossbuckley1990-hash/rightclick-x/issues) with a reproducible case. **Failures that teach the runtime to generalise are as valuable as new features.**

If this is the layer you want AI agents to have, **star the repository** and help test it against software we've never seen.

[Apache-2.0](LICENSE) · [Source](src/) · [Experiments](experiments/) · [Issues](https://github.com/rossbuckley1990-hash/rightclick-x/issues)
ayer: an agent discovers what is available, acts through the same interface, and leaves reusable capabilities for the next agent. Supported contracts and the operator's existing authority define what it can access. A missing contract, credential, conversion or required check remains a real limitation.

```text
any spec · endpoint · MCP server · page · peer · platform
                          │  reflect (no per-provider code)
                          ▼
             one semantically typed, live capability graph
                          │  plan · run · verify · heal · crystallize
                          ▼
         13 context_* MCP tools, the same for every AI client
```

## A complete capability, checked and retained

```bash
npm run proof       # offline, separate local services and MCP processes
npm run proof:ai -- --clients codex,codex   # two isolated AI sessions; uses model quota
npm run proof:ai -- --clients claude,codex  # optional cross-vendor run
```

The reproducible proof starts with one environment gateway and a fresh graph. It discovers an order service, a calculation service and an independent auditor. The requested outcome is a checked order-tax amount, using a **synthetic** 20% rule:

```text
gateway -> discover environmental capabilities
order identifier -> subtotal in USD cents -> explicit cents-to-dollars conversion
                 -> tax service -> proposed USD amount
                 -> independent auditor checks against its own order records
                 -> goal:order-tax-usd, reusable by another AI
```

The runtime infers monetary currency and scale from published contracts. It cannot silently wire cents into dollars, discard known units into a generic numeric input, or invent currency exchange. Explicit conversion capabilities currently cover USD, EUR and GBP. Unknown or conflicting currency/unit declarations do not establish a safe connection.

`context_compose` accepts `witnesses`: read-only capabilities from a separate provider that check the proposed result. Their argument bindings refer to the current invocation's inputs and output, so the checks apply to new orders instead of memorizing the first answer. The checker contract is pinned; a changed or unavailable checker fails closed. Evidence includes the checker run and its receipt. This establishes that the selected checks passed, not that an arbitrary checker is trustworthy.

Publishing also adds a searchable `goal:<slug>` capability. Another agent uses `context_graph` and `context_run` to call it. The saved goal retains its checks and re-plans its implementation after upstream API changes. Required steps retain their discovery source, operation title, risk and semantic input/output types. Renamed fields, paths and protocols can bind to one compatible replacement from that source within the same call; a missing, ambiguous or incompatible replacement fails explicitly. Fixed crystallized pipelines retain their checks too. Caller-supplied predicates add checks; they cannot remove saved ones.

The deterministic proof changes paths, parameter names and response nesting, migrates REST to MCP, injects a wrong result without changing the schema, removes a provider, and restores it. It checks the actual outcome, exercises a fresh MCP process and the stable REST endpoint, and hashes all product source before and after. Raw evidence is saved to `proof/results/latest.json`. The separate two-AI proof records prompts, complete MCP exchanges, independent service events and restart evidence in a timestamped folder under `proof/results/`.

Observed on **2026-10-16**, with product source frozen throughout each proof:

| Check | Result | Evidence |
|---|---|---|
| Regression suite, type checking, CLI and edge builds | 83 tests passed; typecheck and both builds passed | `npm test && npm run typecheck && npm run build` |
| Complete deterministic lifecycle, seed 839171 | 28/28 checks passed, including automatic and explicitly anchored composition, wrong-result rejection, API changes, process restarts and receipt integrity | [Raw lifecycle evidence](proof/results/latest.json) |
| Two independent Codex sessions, seed 472901 | 36/36 checks passed; the second agent discovered and invoked the saved goal once after REST-to-MCP drift | [Live AI manifest and traces](proof/results/ai-clients-2026-10-16T10-19-52-759Z-472901/manifest.json) |

The first AI built and checked a **$61.80** outcome in 7 MCP calls. A new AI conversation and RightClick X process then used the persisted goal for an unseen order: search, inspect, **one goal invocation**, returning a checked **$154.43**. The runtime repaired the obsolete REST operation inside that invocation. The second AI made no learning, composition or repair calls and had no access to the first conversation. Both agents used only RightClick X for environment actions.

Earlier attempts remain in `proof/results/`, including a witness-plumbing failure and an AI handoff that required a retry. The stricter proof counts that retry attempt as a failure; it exposed the obsolete-anchor bug fixed before the final frozen run. Claude hit its account session limit before using a tool, so this run demonstrates two isolated Codex agents, **not cross-vendor reuse**.

These are controlled services and a bounded read-only workflow. They prove an end-to-end mechanism; they do not establish general understanding of every environment, arbitrary business semantics, or transactional recovery of writes.

## Live public services: Claude builds, Codex inherits

**Passed on 2026-10-16, with no product changes from the preceding proof.** A fresh Claude session received only RightClick X, one environment gateway and an outcome: create a sourced destination brief from current public data and save it for another AI.

The gateway listed the existing [Countries GraphQL API](https://countries.trevorblades.com/), [Wikimedia's own REST contract](https://en.wikipedia.org/api/rest_v1/?spec), and two disposable owned Cloudflare services. RightClick X discovered their contracts and assembled **country → capital → current Wikipedia extract → sourced Markdown → separate outcome audit**. The formatter contains no country facts or canned article text. The separately deployed auditor fetches both public sources again and returns a boolean verdict.

| Phase | Observed result |
|---|---|
| Fresh Claude builds | Verified Lisbon brief and saved `goal:destination-brief`; 8 MCP calls, 32.7 seconds. Claude also checked France. |
| Operator changes owned service | Retired REST v1 and replaced it with MCP, including new operation/input names and nested output. Public services were untouched. |
| Fresh Codex reuses after restart | Given only a new country code, found the saved goal and produced the verified Iceland brief: search, inspect, **one goal invocation**; 3 MCP calls, 20.5 seconds. |
| Recovery inside that invocation | Old REST route returned 404; RightClick X re-discovered the contract, retired the stale pipeline, re-planned and audited the result in **1.67 seconds**. No agent retry or manual reconstruction. |
| Independent verification | All 52 phase checks passed; both receipt chains intact; saved goal requirements and checks unchanged; wrong-country and corrupted-summary candidates rejected by the cloud auditor. A separate local oracle also rejected an incorrect source URL. |

Read the actual [Iceland brief](proof/results/real-ai-2026-10-16T10-54-39-863Z/reuser-brief.md), [complete manifest](proof/results/real-ai-2026-10-16T10-54-39-863Z/manifest.json), and [supplemental evidence audit](proof/results/real-ai-2026-10-16T10-54-39-863Z/independent-evidence-audit.json). The same folder contains prompts, full MCP exchanges, client transcripts, Codex execution wrappers, contract snapshots, public response bodies, cloud telemetry and saved states. The frozen `src`/`bin` hash is `2662563dc3019b9f745ed40aba430037e833b85e5217bb9b6d98266315b9f473`.

This is one cross-vendor read workflow with real public data and a deliberately controlled, semantically compatible cloud API change. Discovery used an operator-curated catalog. It is not a claim that an unrelated public provider changed its API, or that arbitrary environments and write workflows are solved.

To reproduce with authenticated Cloudflare, Claude and Codex CLIs:

```bash
node proof/real-environment.ts --deploy --manifest .rcx-deploy/real-current.json
node proof/real-environment.ts --preflight --manifest .rcx-deploy/real-current.json
npm run proof:real -- --deployment .rcx-deploy/real-current.json --clients claude,codex
node proof/real-environment.ts --cleanup --manifest .rcx-deploy/real-current.json
```

The deployment command creates two uniquely named test Workers. The proof uses the authenticated AI clients' model quota; the cleanup command removes only those new Workers. No model overrides are applied.

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
| Any machine with Node ≥ 22.18 | `node bin/rcx.ts …` (TypeScript runs natively) or the bundled `node dist/rcx.mjs …` (bundled JavaScript) |
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
- **Checked recovery:** saved goals retain permitted risks, required steps and outcome checks during recovery. Intent matching also constrains planning, but word overlap alone cannot prove business correctness; independent outcome checks are needed for that.
- **Credentials are origin-pinned** (`RCX_AUTH`), never reflected into capabilities, and never forwarded across origins, including on multi-hop redirects.
- **Network policy:** when the server is exposed beyond loopback (and at the edge), outbound requests to private, loopback, link-local and cloud-metadata addresses are refused, including via DNS and redirects.
- **HTTP endpoints** require a bearer token unless bound to loopback, with per-caller rate limits and request-size limits.
- Workspace file capabilities cannot escape their root. Operating-system permissions are untouched.

## Develop

```bash
npm install
npm test             # 83 offline regression tests (node:test)
npm run lab          # the Chameleon Lab: one generated environment, end to end
npm run lab:report   # ten fresh environments → lab/RESULTS.md
node lab/report.ts 10 --gateway   # same, given only the environment's api-catalog gateway → lab/RESULTS-GATEWAY.md
npm run typecheck
npm run demo         # seven-act offline demo
node experiments/cloud.ts   # live-internet experiments (read-only)
```

## Status

v0.1.0. Current workflow validation is recorded in [`proof/results/`](proof/results/). Historical validation: the Chameleon Lab on a frozen build (30/30 generated environments in three domains), the Open-World Proof against real services with Claude Code and Codex (four models), Node 24 and Bun 1.3, MCP Inspector over stdio and HTTP, live experiments in `experiments/results/`. Also verified earlier: region-pinned Cloudflare deployment (E11-cloud, E12, E13). Not yet verified: Deno Deploy, YAML-only OpenAPI specs (not parsed), OAuth-protected remote MCP servers, and npm publishing.

Apache-2.0.
