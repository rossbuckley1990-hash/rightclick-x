<div align="center">

<!-- The wordmark doubles as the README title. Keep the image alt text descriptive for accessibility. -->
<img src="assets/rightclick-x-banner.png" alt="RightClick X — Connect anything. Empower any agent." width="100%" />

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
