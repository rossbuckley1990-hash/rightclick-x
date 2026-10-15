# Live-internet experiments

Run with `node experiments/cloud.ts` (or `node experiments/cloud.ts E3 E7` for a subset). Every provider below is a real public service. RightClick X contains no code specific to any of them. All calls are read-only. Raw results: [`results/latest.json`](results/latest.json), console log: [`results/latest.log`](results/latest.log). Numbers below are from the run on 2026-10-16 (Node 24.16, one laptop, home network).

"Powers" = capabilities + typed links + 3-step typed chains. It measures how much *can* be wired together, not how much of it is useful; the planner's job is to find the useful part.

| # | Experiment | Result |
|---|---|---|
| E1 | **World research.** Eight topics searched live across APIs.guru (2,529 OpenAPI APIs) and the official MCP Registry. | 15 of 16 directory queries returned candidates (no MCP Registry entries for "currency exchange"); 0.4–5 s per topic. |
| E2 | **Mass reflection.** Every 21st API in APIs.guru (120 specs) learned in batches of 12. | 120/120 reflected, 0 failures. 4,359 capabilities, 4.9 M typed links, 5.9 B powers, 19.5 s. Planner over the full graph: 223 ms. Search: 73 ms. |
| E3 | **GraphQL → REST composition.** `{country}` → countries GraphQL API → `capital` → Wikipedia REST → summary. | 5/5 countries verified (PT, JP, KE, PE, NZ). First run crystallized the pipeline; runs 2–5 used it as one capability, 73–80 ms each. |
| E4 | **Remote MCP absorption.** DeepWiki's MCP server learned and used through the same 13 tools. | 3 tools absorbed in 2.7 s; `ask_wiki_question` answered and verified; composed with a builtin (`ask → detect language`). |
| E5 | **Federated mesh.** Three instances (Wikipedia, countries GraphQL, DeepWiki) federated into a hub. | 57 capabilities federated in 40 ms; `{country: "BR"}` composed across two peers → Brasília summary. |
| E6 | **Self-healing under outage.** A hub with its own crystallized route loses Wikipedia (injected fault). | The crystallized route failed at the Wikipedia step; compose re-planned through the eu-west peer and returned Cairo's summary in 275 ms. Receipt chain intact. |
| E7 | **GitHub.** GitHub's official OpenAPI description (1,238 operations) + Wikipedia + DeepWiki. | Learned in 2.9 s with 0 lines of GitHub code: 1,303 capabilities, 358 k typed links, 104 M powers. Live pipelines, all verified: latest Node.js release → summary; `gvanrossum` → GitHub user → name → Wikipedia; `denoland/deno` → repo → homepage → live site → summary. One pipeline failed verification mid-run and was routed around without being asked. The GitHub→Wikipedia pipeline crystallized and was reused for `torvalds`. 5 GitHub API calls in total, unauthenticated. |
| E8 | **Self-publish to a brand-new GitHub repo** (`experiments/github-publish.ts`, authenticated with the owner's existing `gh` login, run on explicit request). The runtime learned GitHub's spec, found the 7 operations it needed by searching its own graph, and drove them through `context_run`: create repo → get ref → 46 × create blob → create tree → create commit → update ref → read back. | [`rossbuckley1990-hash/rightclick-x`](https://github.com/rossbuckley1990-hash/rightclick-x) (private). 46/46 blob SHAs identical to the local git objects; GitHub's tree `3d08601f…` identical to the checkout's `git write-tree`; confirmed independently with `git fetch` (0-line diff). 52 receipts, chain intact. No git push, no gh, no GitHub SDK, no GitHub-specific code. |
| E9 | **Kubernetes, the chameleon test** (`experiments/kubernetes.ts`, throwaway kind cluster, v1.36.1). No Kubernetes MCP server, client library or kubectl in the loop. | Reflected the live cluster's own API (799 operations) in 210 ms. Installed a brand-new CRD (`insights.rightclick.dev`) **through a capability it had just reflected**, re-reflected, and 1.2 s later its graph had grown the CRD's 8 operations, which nobody wrote. Piped live knowledge into the new resource: `{country}` → countries GraphQL → Wikipedia → summarize → `Insight` for PT, JP, KE, BR. kubectl, as an independent witness, saw the same 4 objects with identical UIDs and summaries. Deleting the namespace (risk: destructive) ran directly, with no approval gate. 26 receipts, chain intact. |

## What the live web taught the runtime

The first live runs failed in instructive ways. Each fix is general, not provider-specific:

- **Depth-limited GraphQL servers** reject full introspection (HTTP 413) → introspection retries at shallower type-reference depths, and truncated types are treated as unknown, never as strings.
- **Generic names** (`code` on field `country`, `id` on a `release`) → semantic types use context: `country(code)` is a `country`, `release.id` is an `id.release`.
- **Identifier soup at GitHub scale** (any `*_id` flowing into any other) → qualified identifiers; `ghsa_id` and `check_run_id` never mix.
- **Name-like ports** (`title`, `name`, `q`) accept specific string types (a `place` can be a Wikipedia title) but never prose fields (`body`, `description`).
- **Plans that ignore what the caller supplied** → ranking starts with how fully a plan uses the caller's inputs; a caller's identity values beat derived ones; transformed text always takes the latest version.
- **Kubernetes `name` parameters are identifiers**, not names: "name of the Namespace" in a parameter's description now types it `id.namespace`, so a country code can never be mistaken for a resource name.
- **Ambiguous intent across 1,300 endpoints** → `through` anchors let an agent pin the capabilities it means; the planner wires the types between them.

## Not covered here

- Instances in E5/E6 run on one machine standing in for regions; their providers are real internet services, but no multi-region cloud deployment was made.
- E9 ran against a local kind cluster, not a managed cloud cluster (EKS/GKE/AKS); the mechanism is the same API server and the same `/openapi/v2`.
