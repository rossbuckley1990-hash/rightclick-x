# Preregistered 50-Case Workflow Survival Benchmark Protocol
**Document ID:** `PREREG-WFS-50-V1`  
**Status:** Preregistered / Awaiting Harness Hardening  
**Target Date:** Post-Audit Phase 2  
**Commit Baseline:** `origin/main` (`572793e`)  

---

## 1. Objective & Governance
This protocol defines a rigorous, sealed, independently verifiable 50-case benchmark designed to evaluate how modern automated integration systems survive breaking real-world API evolutions, protocol shifts, semantic unit mutations, and service failures.

The initial 10-scenario exploration identified critical harness vulnerabilities:
1. Short-circuit runner throws simulating semantic safety without executing runtime logic.
2. Premature termination of agent output inspection (`events.find` rather than reading final execution completion).
3. Evaluator conflation of agent conversational prose with business outcomes.
4. Latency measurement asymmetry (in-memory JIT vs. remote WAN subprocess).

This preregistration establishes strict controls ensuring zero harness-injected behavior, machine-checkable verification, and equal evaluation terms across all competing approaches.

---

## 2. Evaluation Arms (5 Competing Treatments)

| Arm Code | Name | Architecture | Capabilities & Tools |
| :--- | :--- | :--- | :--- |
| **ARM-1** | **Static Client** | Hardcoded typed client | Standard static `fetch()` integration, no adaptation logic. Serves as ground-truth drift vulnerability baseline. |
| **ARM-2** | **Deterministic Tooling** | OpenAPI / Schema Auto-Generator | Auto-regenerates client stubs from target `/openapi.json` upon contract change. Tests whether deterministic re-generation suffices without AI. |
| **ARM-3** | **Frontier Agent Alone** | Codex CLI (`gpt-6.1-sol`) | Autonomous coding agent with shell execution sandbox (`zsh`, `curl`, `node`, file editing). Must detect breakage, inspect schemas, write patches, and return verified output. |
| **ARM-4** | **RightClick X Alone** | Dynamic Capability Runtime | Graph-based reflection runtime without LLM reasoning. Learns from service roots, reflects OpenAPI/GraphQL/MCP, and composes dynamic plans in-memory. |
| **ARM-5** | **Hybrid Codex + RightClick X** | Agentic Planner + Dynamic Runtime | Codex acts as high-level intent orchestrator and semantic validator; RightClick X provides sub-millisecond protocol adaptation and capability unwrap. Tests synergistic frontier performance. |

---

## 3. The 50-Scenario Sealed Fault Taxonomy

The 50 scenarios are divided across four challenging fault categories. All scenario definitions and expected assertions will be sealed under SHA-256 hash `SEALED_HASH_PLACEHOLDER` prior to execution.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      50-CASE BENCHMARK TAXONOMY                        │
├─────────────────────┬───────────────────┬──────────────────────────────┤
│ Category            │ Count             │ Primary Failure Mode Tested  │
├─────────────────────┼───────────────────┼──────────────────────────────┤
│ 1. Structural Drift │ 15 Scenarios      │ Schema wrapping, renames,    │
│                     │ (STRUC-01..15)    │ param movement, pagination   │
│ 2. Protocol Swaps   │ 15 Scenarios      │ REST -> GraphQL, MCP,        │
│                     │ (PROTO-01..15)    │ gRPC-Web, SSE, WebSockets    │
│ 3. Semantic Drift   │ 10 Scenarios      │ Unit shifts (cents/$, kg/lb),│
│                     │ (SEM-01..10)      │ tax-inclusive, timezones     │
│ 4. Outages & Chaos  │ 10 Scenarios      │ HTTP 410, 503, rate limits,  │
│                     │ (OUTAGE-01..10)   │ corrupted schemas, auth drop │
└─────────────────────┴───────────────────┴──────────────────────────────┘
```

### 3.1 Category 1: Structural Schema Evolutions (15 Cases)
- `STRUC-01`: Envelope wrap (`data.result.payload`).
- `STRUC-02`: Parameter relocation (GET query string to POST JSON body).
- `STRUC-03`: Path restructuring & REST resource hierarchy migration (`/users/{id}` to `/accounts/{id}/identity`).
- `STRUC-04`: Deep camelCase to snake_case field rename cascade.
- `STRUC-05`: Array unwrap to paginated cursor object (`items[]` to `{ pageInfo, edges: [{ node }] }`).
- `STRUC-06`: Authentication token header change (`Authorization: Bearer` to `X-API-Key`).
- `STRUC-07`: Date format shift (Unix epoch seconds to ISO 8601 UTC string).
- `STRUC-08`: Composite identifier split (`id: "ORG_123:USER_456"` to `{ orgId: 123, userId: 456 }`).
- `STRUC-09`: Polymorphic variant discriminator shift (`type: "CARD"` to `paymentMethod: { kind: "credit_card" }`).
- `STRUC-10`: Error payload nesting alteration (RFC 7807 problem details wrap).
- `STRUC-11`: Required header requirement addition (`X-Client-Version` enforced).
- `STRUC-12`: Nested address restructuring (flat fields to sub-object).
- `STRUC-13`: Integer status codes converted to string enum representations.
- `STRUC-14`: Bulk batch request wrapping (single item to multi-item batch array).
- `STRUC-15`: Filtering syntax migration (LHS bracket params to RSQL string).

### 3.2 Category 2: Protocol & Transport Swaps (15 Cases)
- `PROTO-01`: REST POST to GraphQL Query.
- `PROTO-02`: REST GET to MCP Tool Call (`tools/call`).
- `PROTO-03`: MCP Tool Call to GraphQL Mutation.
- `PROTO-04`: GraphQL Query to REST v3 resource.
- `PROTO-05`: REST polling endpoint to Server-Sent Events (SSE) stream.
- `PROTO-06`: REST endpoint to WebSocket JSON-RPC channel.
- `PROTO-07`: OpenAPI REST to OpenAPI 3.1 JSON Schema specification.
- `PROTO-08`: GraphQL mutation to MCP dynamic capability tool.
- `PROTO-09`: REST batch endpoint to individual asynchronous polling task (`202 Accepted` + Status URL).
- `PROTO-10`: REST RPC style to strict HATEOAS link traversal.
- `PROTO-11`: MCP resource read (`resources/read`) to MCP tool execution.
- `PROTO-12`: REST XML response to JSON endpoint.
- `PROTO-13`: GraphQL aliased query migration.
- `PROTO-14`: Dual-stack MCP/GraphQL endpoint negotiation.
- `PROTO-15`: OpenAPI webhook callback migration.

### 3.3 Category 3: Adversarial Semantic Drift (10 Cases)
- `SEM-01`: Monetary minor-to-major shift (integer cents to decimal dollars).
- `SEM-02`: Mass unit shift (kilograms to pounds avoirdupois).
- `SEM-03`: Distance unit shift (meters to feet).
- `SEM-04`: Price tax inclusion drift (pre-tax net amount to tax-inclusive gross total).
- `SEM-05`: Temperature scale change (Celsius to Fahrenheit).
- `SEM-06`: Timestamp scale shift (epoch seconds to epoch milliseconds).
- `SEM-07`: Volume measure shift (liters to US gallons).
- `SEM-08`: Data storage unit shift (megabytes $10^6$ to mebibytes $2^{20}$).
- `SEM-09`: Speed unit shift (km/h to mph).
- `SEM-10`: Currency denomination drift (USD to EUR without FX rate declaration).

### 3.4 Category 4: Outages, Deprecations & Degraded Faults (10 Cases)
- `OUTAGE-01`: Permanent endpoint retirement (HTTP 410 Gone).
- `OUTAGE-02`: Total service unavailability (HTTP 503 Service Unavailable).
- `OUTAGE-03`: Aggressive rate limiting (HTTP 429 Too Many Requests + Retry-After).
- `OUTAGE-04`: Corrupted schema endpoint (OpenAPI JSON truncated / invalid JSON).
- `OUTAGE-05`: Silent blackhole timeout (connection accepted, headers stalled).
- `OUTAGE-06`: Revoked credentials / Authentication invalidation (HTTP 401 Unauthorized).
- `OUTAGE-07`: Upstream DNS resolution failure (NXDOMAIN simulation).
- `OUTAGE-08`: Ephemeral gateway failure (HTTP 502 Bad Gateway recovery test).
- `OUTAGE-09`: Missing capability in advertised discovery catalog.
- `OUTAGE-10`: Partial partition (service responds but downstream dependency is offline).

---

## 4. Harness Specifications & Anti-Gaming Rules

1. **Independent Process Isolation:**  
   The scenario services, treatment runners, and ground-truth oracle must execute in separate OS processes. No arm code may access scenario internals or global controller variables.

2. **Zero Harness Injections:**  
   The benchmark runner is strictly forbidden from containing `if (scenario.category === "...") throw new Error(...)` or any short-circuit logic. Every arm must invoke its actual adapter runtime or agent process.

3. **Strict Completion Resolution for Autonomous Agents:**  
   The harness must capture the agent's *final* message emitted upon turn completion (`turn.completed`), rather than grabbing the first streaming event. Intermediate thoughts or conversational pleasantries must be discarded.

4. **Prose Blacklist for Ground-Truth Evaluator:**  
   The oracle evaluator will reject all conversational prose. A valid refusal must be an explicit typed status code or machine token (`"UNAVAILABLE"`, `null` with explicit error receipt). General sentences containing substring matches like "unavailable" will be scored as **Ordinary Failure**.

5. **Symmetric Latency Accounting:**  
   All latencies will be reported across four explicitly separated components:
   - $T_{\text{boot}}$: Process launch & runtime cold boot.
   - $T_{\text{reflect}}$: Contract fetching, introspection, and graph updates.
   - $T_{\text{solve}}$: Plan formulation / LLM reasoning / token generation.
   - $T_{\text{exec}}$: Wire network request execution & verification.

---

## 5. Machine-Checkable Scoring Formula

Each scenario outcome must map unambiguously to one of four mutually exclusive terminal states:

$$\text{Scenario Outcome} \in \{ \text{Functional Recovery (FR)}, \text{Correct Refusal (CR)}, \text{False Success (FS)}, \text{Ordinary Failure (OF)} \}$$

$$\text{Verified Recovery Rate} = \frac{\sum \text{FR}}{\text{Total Scenarios (50)}} \times 100\%$$

$$\text{Refusal Accuracy} = \frac{\sum \text{CR}}{\text{Refusal Scenarios (10)}} \times 100\%$$

$$\text{False Success Rate} = \frac{\sum \text{FS}}{\text{Total Scenarios (50)}} \times 100\%$$

$$\text{Net Robustness Score} = \frac{\sum \text{FR} + \sum \text{CR} - 2 \times \sum \text{FS}}{\text{Total Scenarios (50)}} \times 100\%$$

*(Note: False successes receive a $2\times$ negative penalty due to the severe enterprise cost of silent data corruption.)*

---

## 6. Preregistration Sign-off & Execution Gate
Execution of this 50-case benchmark is gated on:
1. Merging harness bug fixes (`findLast` resolution and removal of short-circuit throws).
2. Implementing mass/weight quantity typing in `src/core/quantities.ts` if RightClick X claims unit drift detection for non-monetary domains.
3. Cryptographic sealing of scenario inputs.
