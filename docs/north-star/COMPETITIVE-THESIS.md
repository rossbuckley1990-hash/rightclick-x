# Competitive thesis

Stage 0 of the North Star programme. Written on 2026-10-17, before any Stage 1–7 implementation, on baseline `ns-baseline` (`bb5a983`).

## The central question

> **Why should a developer use RightClick X instead of giving Claude Code a terminal?**

A capable coding agent with a shell can already:

- read `--help` and manual pages;
- run programs and explore APIs;
- write wrappers and save scripts or skills for later.

On the one task where we measured this (`baselines-uce-freeze-7.json`), it did as well as RightClick X:

| Arm | Correct | Tokens (first use) |
|---|---|---|
| Plain sandboxed runner | correct | 111k |
| RightClick X | correct | 129k |

The runner reached the same correctness with fewer tokens. **Capability discovery by itself is therefore not a differentiator.** A frontier model already knows how to drive well-known programs.

## What competitors demonstrably support

Sources are current public material. Vendor claims are marked as such; none of them were independently tested here.

| Approach | What it demonstrably does | What it does not claim |
|---|---|---|
| **Coding agent with a terminal** (Claude Code, Codex) | Reads docs, runs commands, writes integration code, saves scripts. Measured here: correct on `tidy` with a raw runner, cheaper than RightClick X. | Retained, checked knowledge across agents. Change detection. Policy outside the model: the terminal *is* the authority. |
| **[Agent Skills](https://github.com/anthropics/skills)** (open standard, Dec 2025) | Folders with a `SKILL.md` (name and description used for triggering) plus optional scripts, loaded by progressive disclosure. Portable across compatible agents. | Evidence that a skill still works after the software changes. Independent verification of results. Execution policy: a skill runs with the agent's own permissions. |
| **[Composio](https://composio.dev/) Tool Router** | Large pre-built tool catalog (a third-party review cites 20,000+). Meta-tools for tool search and multi-execute. Managed OAuth and per-user credentials. | Learning software outside its catalog. Integrations are authored by the vendor. |
| **[Arcade.dev](https://www.arcade.dev/)** | An "MCP runtime" with per-user just-in-time authorisation, credentials kept away from the LLM, and a curated tool catalog. *Vendor claims:* SOC 2, SSO/RBAC, audit logs, on-prem. | Discovering capabilities of unfamiliar software. Tools are purpose-built by people. |
| **[superglue](https://github.com/superglue-ai/superglue)** | Builds API, DB and file integration pipelines from natural language. LLM at setup, cached transforms at run time. *Vendor claims:* "self-healing" on schema drift; "10x faster". | Local programs without an API. Independent verification of outcomes (not described in what we found). |
| **[Docker MCP Gateway](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/) (dynamic MCP)** | `mcp-find` / `mcp-add` add catalog servers mid-session; "code-mode" combines tools in JavaScript. Experimental; servers are session-scoped and not persisted. | Software outside the curated catalog (270+ servers). Learned capabilities. |
| **Research: tool learning** ([AutoManual](https://arxiv.org/abs/2405.16247), [AutoTools / "Tool Learning in the Wild"](https://arxiv.org/abs/2405.16533), [Voyager](https://arxiv.org/abs/2305.16291), LATM) | LLMs construct manuals or callable functions from documentation and interaction. Skill libraries accumulate as code. | Operator-enforced execution policy, sandboxed evidence grades, and withdrawal on change, as product properties. (We did not survey this systematically; no novelty claim is made.) |

**What we did not find** in the material reviewed: an approach that combines all of the following as one runtime behind a fixed MCP interface:

1. learning **local programs that have no API**, in a sandbox, with **graded evidence**;
2. a **retained capability** another agent can use without the first agent's context;
3. **independent outcome checks**;
4. **withdrawal or refusal** when the software changes.

This is an observation from a limited search, **not a claim that nobody does it**.

## Where RightClick X could plausibly win

Each row is a hypothesis to test, not a result.

| # | Advantage | Why a terminal agent may not have it | How it will be measured (EVALUATION-PLAN.md) |
|---|---|---|---|
| 1 | **Reusable capability knowledge** | A second agent re-derives how to call the program, or relies on an unvalidated saved note. | Reuse correctness, time and cost in fresh sessions (arms A–D) |
| 2 | **Correctness and independent verification** | The agent judges its own output. | Incorrect outcomes presented as correct, per arm |
| 3 | **Safety and policy outside the model** | Terminal authority belongs to the agent. | Unauthorised executions and egress in the adversarial suite (zero tolerated) |
| 4 | **Cross-agent portability** | Saved scripts assume a shell and the author's context. | Reuse by a fresh session with no conversation history |
| 5 | **Recovery after environment change** | Saved scripts keep running a changed program and may return wrong output. | Change phase: compatible change, incompatible change, removal |
| 6 | **Less repeated reasoning** | Each session re-plans. | Tokens and turns per reuse task |
| 7 | **Less integration maintenance** | Scripts and skills are authored and maintained. | Integration lines and files authored per arm |
| 8 | **Discovery across heterogeneous software** | Ad hoc per program. | Programs drawn by an independent evaluator after the freeze |
| 9 | **Explicit uncertainty and safe refusal** | Agents tend to answer. | Refusals vs wrong answers on infeasible and changed cases |
| 10 | **Knowledge accumulating across installations** | Nothing transfers except files. | Stage 6: exported capability revalidated in a second environment (cold vs warm cost) |

## The claim RightClick X must prove

> **On software and tasks chosen by someone else after the build is frozen, an agent using RightClick X's retained capabilities:**
>
> 1. is **at least as correct** as the strongest simple baseline (an agent with the same execution surface plus saved skills);
> 2. **never presents a wrong result as correct**, including after the software changes;
> 3. **makes repeated use measurably cheaper**: at least 2× lower median time or model cost per reuse task, *or* at least 50% less authored integration material over the lifecycle;
> 4. **keeps every execution inside operator authority**.

**If (1) or (2) fails, RightClick X has no product advantage, whatever (3) shows.**

If only (2) and (4) hold, the honest positioning is narrower: **a governance and correctness layer for agents using internal software**, not a productivity tool. That would point to selling to platform and security teams rather than individual developers.

## What would *not* be enough

- A curated demonstration on one well-known program. This has already been done.
- Discovery that a model's prior knowledge makes unnecessary.
- Savings that only appear after many uses, without the break-even count reported.
- Verification that only checks that output is non-empty.
