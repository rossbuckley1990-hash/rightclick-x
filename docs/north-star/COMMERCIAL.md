# Commercial thesis and validation plan

**Status: unvalidated.**

- No interviews, design partners, pilots, users, willingness to pay or revenue exist.
- Nothing below should be read as evidence of demand.
- Everything here is a hypothesis to test with real external people.

## Who might have the most expensive version of this problem

These are hypotheses. Each would be tested in discovery.

| Segment | Their pain (hypothesis) | Why RightClick X might matter | What would falsify it |
|---|---|---|---|
| **Enterprise AI platform teams** running agents against internal tools | Every internal CLI or API needs a reviewed integration. Agents with shells are a security-review problem. | Operator authority outside the model, a sandbox, behaviour-pinned capabilities, refusal on change, audit receipts | They already accept "agent + shell in a container" and don't need finer control, or they standardise on vendor catalogs |
| **Agent infrastructure teams** (many agents, many machines) | Capabilities learned by one agent aren't available to the next, and drift silently | Retained capabilities with contracts, revalidation, portable knowledge | Saved skills and scripts are good enough. The benchmark asks exactly this |
| **Software vendors** exposing their product to AI | Writing and maintaining an MCP server per product | Their existing CLI or OpenAPI becomes MCP capabilities without new code | They prefer hand-written, curated MCP servers for quality and branding |
| **Teams maintaining many integrations** | Breakage when upstream changes | Detecting change and refusing or adapting (OW8, Stage D, change phase) | Change is rare enough, or caught by their own tests |

## Value proposition (to test, not to claim)

> Point your agents at the software you already have. RightClick X works out what it can safely do, runs it under your rules, checks the results, and keeps what works for every other agent. It refuses when things change.

## A commercial model that keeps a useful open-source core

| Open source (Apache-2.0) | Possible paid offerings (only after validation) |
|---|---|
| The runtime, the 13 tools, all reflectors and the investigator, sandboxing, outcome contracts, local knowledge export/import | Managed runtime (operated MCP endpoint, regions, uptime commitments) |
| | Private capability registry: an organisation-wide store of revalidated capabilities and knowledge |
| | Monitored capability validity: scheduled revalidation and alerts on change |
| | Enterprise identity and policy: SSO, per-team authority, approval workflows |
| | Evidence and compliance exports: receipts, audit logs, attestation by an external signer |
| | Support and SLAs |

**Do not build** billing, a marketplace or enterprise features until the discovery programme below shows demand. **Do not build** a central capability marketplace until knowledge transfer has been shown to improve results (Stage 6 measures this).

## Customer discovery programme

Each target requires real external people. These are the brief's minimums.

1. **At least 5 independent developers** test RightClick X on software they choose and know, with no help from the author beyond the README. Recorded per developer:
   - time to first useful capability;
   - did they reach the headline flow;
   - what failed;
   - would they use it again, and for what.
2. **At least 3 serious design-partner conversations** with platform or security teams. Recorded per conversation:
   - their current approach (shell agents, curated MCP, vendor catalogs);
   - the cost of integrations and of security review;
   - whether operator-enforced authority and change refusal would change a decision.
3. **At least 1 paid-pilot opportunity:** a written scope and price, even if small.

**Exit criteria.**

- **Positive:** a design partner names a concrete internal workflow where RightClick X removes integration or review work, and agrees to a pilot.
- **Negative:** platform teams say a sandboxed shell agent plus saved skills already meets their needs. If so, re-scope to the governance layer alone, or stop.

## Outreach material (prepared, not sent)

> **Subject:** Letting AI agents use your internal CLIs without writing MCP servers — 30 minutes of feedback?
>
> We're building an open-source MCP runtime that learns command-line programs and APIs from their documentation and sandboxed experiments. It runs them under operator-set authority and refuses when they change. We've published a reproducible benchmark against agents with a plain shell, and so far the shell agent is just as correct and cheaper on well-known tools. We'd like to learn whether controlled, reusable capabilities matter for your team. No sales pitch: we want to know whether this solves a real problem.

No message has been sent. Sending one needs the owner's approval and real recipients.
