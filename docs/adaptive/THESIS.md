# The commercial hypothesis to test

Research checked 2026-10-18. Vendor documentation is evidence of positioning and documented features, not independent proof of customer outcomes. No interviews or willingness-to-pay observations were obtained.

**Proposed buyer:** the enterprise AI platform lead responsible for multiple agents accessing private, changing software. **Proposed reason to pay:** lower total engineering and review cost per reusable, independently checked operation, including its software-change lifecycle. The product must beat a capable agent with documentation and saved scripts, not a deliberately weak tool caller.

## Alternatives that already solve part of this problem

| Alternative | Relevant existing strength | What RightClick X must test, rather than assume |
|---|---|---|
| Direct coding agents | Existing tools, code execution, permission systems and sandbox boundaries. Claude documents explicit tool permissions; the installed Codex CLI exposes sandbox/approval configuration. [Claude permissions](https://code.claude.com/docs/en/permissions), [OpenAI environment security](https://developers.openai.com/api/docs/guides/agents-api/environments/security) | Compare with properly isolated agents. Do not frame every shell agent as uncontrolled. |
| Agent Skills | Portable instructions, scripts and progressively loaded resources. [Specification](https://agentskills.io/specification) | A retained note or script is a strong reuse baseline. Measure what executable validity checks add beyond it. |
| MCP integrations | Standard discovery and invocation with tool descriptions and annotations. [Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | A fixed tool count alone is not differentiation or an assurance boundary. |
| Model-native tool search/composition | Anthropic documents tool search, programmatic tool calling and examples to reduce context and improve calling. [Engineering article](https://www.anthropic.com/engineering/advanced-tool-use) | Smaller context and fewer calls must be compared with these techniques. Models will keep improving. |
| Composio | Managed user authentication, tool search, MCP sessions and execution across a large integration catalog. [Documentation](https://docs.composio.dev/docs) | Do not compete merely on tool count, authentication or intent-based discovery. Test unfamiliar private software and validated reuse. |
| superglue | Enterprise implementation agents, self-hosting, governed data access and proposed fixes for API changes. [Product](https://superglue.ai/) | Dynamic integration and maintenance are already contested. Test independent outcome verification and the cost of maintaining valid capabilities. |
| Arcade | Per-action authorization, tool execution, credential isolation and policy hooks. [Product](https://www.arcade.dev/product/), [authorization](https://docs.arcade.dev/en/learn/server-level-vs-tool-level-auth) | Governance alone is insufficient differentiation. Demonstrate retained behaviour plus useful outcome checks and adaptation. |
| Temporal | Durable workflow execution and recovery across process failures and waits. [Durable AI](https://docs.temporal.io/ai) | Use existing orchestration where needed. A successful retry is not proof of semantic compatibility or exactly-once external effects. |
| Invariant / Langfuse | Trace-based policy evaluation and agent observability, respectively. [Invariant](https://github.com/invariantlabs-ai/invariant), [Langfuse data model](https://langfuse.com/docs/observability/data-model) | Runtime monitoring and logs are useful, but measure pre-execution coverage and independently observed effects separately. |
| Capability-learning research | Voyager retains executable skills and reuses them in new environments. [Paper](https://arxiv.org/abs/2305.16291) | Skill accumulation is prior art. RightClick X must establish enterprise validity, authority and economic advantages outside that domain. |

## Incident lesson: a catalog does not bound effective authority

Hugging Face's incident reconstruction describes actions crossing multiple trust boundaries: a permitted intermediary, a separate execution environment, data processing, local files, credentials and downstream infrastructure. It correlates recovered agent records with platform observations. The relevant defensive lesson is that intended use and named tools do not describe every effect those tools can enable. A network allowlist alone does not constrain local-file or code effects inside an allowed service. [Technical timeline](https://huggingface.co/blog/agent-intrusion-technical-timeline).

Design implication (our inference): distinguish declared operations, plausible typed paths, observed execution and independently observed consequences. Unknown provider internals, host privileges and credential reach must remain unknown. An operator policy can constrain mediated operations; it cannot assert control over an agent's separate shell or a compromised remote provider. The first experiment therefore uses disposable, instrumented services and explicitly reports coverage.

## Smallest defensible wedge

A retained operation that a new model can find and invoke cheaply, with the same outcome obligations and operator restrictions, and whose validity can be re-established after change. The reusable unit combines existing contracts, plans, authority and evidence. Building another orchestration stack or integration marketplace would not test this hypothesis.

Primary technical target remains the pre-registered competitive gate: comparable correctness and no extra wrong outcomes, with at least 2× lower median reuse time/model cost or at least 50% less authored integration material when the strongest baseline actually authors material. Report amortised acquisition and verification costs. The mission's larger holdout targets add evidence requirements; they do not relax this gate.

Falsifiers: strong saved-script baselines remain as correct and cheaper; revalidation costs erase reuse savings; private-software discovery is too unreliable; existing governance products already solve the buyer's problem; or prospective buyers will not adopt/pay. Current benchmark evidence supports caution, not a product-advantage claim.

Pricing, margins, support load, adoption and retention remain assumptions pending the requested economic model and real design-partner work. No network effect is established by the current near-identical-environment knowledge transfers.

The subsequent [equal-control runtime experiment](../north-star/evidence/ACTENON-EQUAL-CONTROL-RESULT.md) found additional RightClick overhead against a saved script under the same Actenon boundary: median warm client time 26.80 ms versus 19.67 ms across 20 pairs, with both arms correct and equally verified. This is not a coding-agent benchmark, but it contradicts any claim that retained execution alone is necessarily faster. The commercial case now needs demonstrated acquisition or maintenance savings; do not infer them from governance fixtures or a fixed tool count.
