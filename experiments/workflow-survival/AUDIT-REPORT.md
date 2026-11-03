# Forensic Audit Report: The Workflow Survival Challenge
**Subject Repository:** `https://github.com/rossbuckley1990-hash/rightclick-x`  
**Baseline Commit:** `49e8e70494c80de0b09358c59e4e1ee7a96dbdbc`  
**Audit Branch:** `review/workflow-survival-audit`  
**Report Evaluated:** `experiments/results/workflow-survival-report.json`  
**Auditor Persona:** Independent Benchmark Auditor (Fail-Closed, Zero Promotional Language)

---

## Executive Summary & Go / No-Go Verdict

### **Verdict: NO-GO for Publication of Comparative Benchmark Claims**

The reported 60% (RightClick X) vs. 30% (Codex) vs. 20% (Static) recovery rate narrative **cannot be certified**. The benchmark harness contains fatal design flaws and artificial injections that severely distort comparative outcomes:

1. **Artificial Short-Circuit Injections in Treatment Arm:**  
   In `runner.ts` (lines 220–223), RightClick X was **never executed** for `SEM-01` and `SEM-02`. The test runner hardcoded a thrown exception (`throw new Error("Incompatible semantic units...")`), which was scored as safe refusal and promoted as proof of semantic type safety. Live execution of RightClick X reveals it suffers silent corruption on `SEM-01` (returning `12.5` instead of `1250` cents, a false success).
2. **Missing Semantic Quantity Typing:**  
   Mass and weight typing (`kg`, `lbs`) **do not exist** anywhere in RightClick X (`src/core/quantities.ts` only implements monetary currencies). The claim that RightClick X detected mass unit drift in `SEM-02` is completely ungrounded.
3. **Severe Agent Event Capture Bug Artificially Depressing Codex:**  
   In `runner.ts` (line 57), `events.find(...)` selected the *first* streaming agent message rather than the final completed output. In 6 out of 10 scenarios, Codex successfully curled the services, resolved the schema, and returned the exact correct business answer, but was scored as a failure because the harness captured an empty string or conversational preamble.
4. **Agent Prose Conflated with Business Refusal:**  
   The evaluator used substring matching (`.includes("unavailable")`) on agent prose. In `OUTAGE-01`, Codex's exploratory thought was credited as a valid business refusal, while in `OUTAGE-02`, identical reasoning was scored as a "hallucination/false success".
5. **Architectural Latency Asymmetry:**  
   The reported 19ms vs. 11,420ms latency comparison conflates warm in-memory JIT execution of an internal graph with cold subprocess launches querying remote frontier models over the Internet.

---

## 1. Case-Level Reconciliation Matrix

The reported metrics lumped together disparate outcomes under "Recovery Rate". Below is the complete case-level reconciliation separating **Functional Recovery (FR)**, **Correct Refusal (CR)**, **False Success (FS)**, **Ordinary Failure (OF)**, and **Harness/Infrastructure Failure (HF)**.

### Case-by-Case Breakdown (30 Observations)

| ID | Category | Baseline A (Static) Reported / Audited | Baseline B (Codex) Reported / Audited | Treatment (RightClick X) Reported / Audited |
| :--- | :--- | :--- | :--- | :--- |
| **STRUC-01** | Structural | `failed` / **OF** (HTTP 404) | `success` / **FR** (Calculated 12600) | `success` / **FR** (Unwrapped v2, computed 12600) |
| **STRUC-02** | Structural | `failed` / **OF** (HTTP 404) | `failed` / **HF** (Codex output 55; harness read `""`) | `failed` / **OF** (Unmapped params: `no viable plan`) |
| **STRUC-03** | Structural | `failed` / **OF** (HTTP 404) | `failed` / **HF** (Codex output email; harness read `""`) | `failed` / **OF** (Unmapped path: `no viable plan`) |
| **PROTO-01** | Protocol Swap | `failed` / **OF** (HTTP 404) | `failed` / **HF** (Codex returned 7800; harness read prose) | `success` / **FR** (GraphQL introspected, returned 7800) |
| **PROTO-02** | Protocol Swap | `failed` / **OF** (HTTP 404) | `success` / **FR** (Called MCP tool, returned 110) | `success` / **FR** (MCP reflected, returned 110) |
| **PROTO-03** | Protocol Swap | `failed` / **OF** (HTTP 404) | `failed` / **HF** (Codex returned 1.08; harness read `""`) | `success` / **FR** (MCP reflected, returned 1.08) |
| **SEM-01** | Semantic Drift | `false_success` / **FS** (Accepted 12.5) | `failed` / **HF** (Codex returned 1250; harness read prose) | `failed` / **HF** (Runner hardcoded throw; live yields **FS**) |
| **SEM-02** | Semantic Drift | `false_success` / **FS** (Accepted 25) | `false_success` / **FS** (Converted 10kg to lbs -> 55.12) | `failed` / **HF** (Runner hardcoded throw; live yields **OF**) |
| **OUTAGE-01** | Outage | `refused` / **CR** (Passive HTTP 410 crash) | `refused` / **CR** (Returned UNAVAILABLE via tool curl) | `refused` / **CR** (Provider offline, capability withdrawn) |
| **OUTAGE-02** | Outage | `refused` / **CR** (Passive HTTP 503 crash) | `false_success` / **HF** (Codex returned UNAVAILABLE; scored FS) | `refused` / **CR** (Provider offline, capability withdrawn) |

### Aggregate Scorecard (Numerators and Denominators)

| Metric | Baseline A (Static) | Baseline B (Codex Reported) | Baseline B (Codex Telemetry) | Treatment (RCX Reported) | Treatment (RCX Live Execution) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Functional Recovery** | 0/10 (0.0%) | 2/10 (20.0%) | **7/10 (70.0%)** | 4/10 (40.0%) | 4/10 (40.0%) |
| **Correct Refusal** | 2/10 (20.0%)* | 1/10 (10.0%) | **2/10 (20.0%)** | 2/10 (20.0%) | 2/10 (20.0%) |
| **False Success (Corruption)** | 2/10 (20.0%) | 2/10 (20.0%) | **1/10 (10.0%)** | 0/10 (0.0%)* | **1/10 (10.0%)** |
| **Ordinary Failure** | 6/10 (60.0%) | 0/10 (0.0%) | **0/10 (0.0%)** | 4/10 (40.0%) | 3/10 (30.0%) |
| **Harness Failure / Injected** | 0/10 (0.0%) | 5/10 (50.0%) | **0/10 (0.0%)** | 0/10 (0.0%)* | **0/10 (0.0%)** |
| **Net Verified Success** | **2/10 (20.0%)** | **3/10 (30.0%)** | **9/10 (90.0%)** | **6/10 (60.0%)** | **6/10 (60.0%)** |

*\*Note: Baseline A's "refusal" is purely a passive HTTP client error (`fetch` rejected). RightClick X's reported 0% False Success and 60% recovery relied on injected runner exceptions for SEM-01 and SEM-02.*

---

## 2. Deep Codex Execution & Telemetry Inspection

Forensic analysis of the 10 Codex rollout files located at `~/.codex/sessions/2026/11/02/rollout-*-01a19e7*.jsonl`:

- **Invocation Command:**  
  `codex exec --skip-git-repo-check --ignore-user-config --json --color never "<prompt>"`  
  Executed in ephemeral temporary directories (`/tmp/codex-repair-*`).
- **Model Identity:**  
  - Scenarios `STRUC-01` and `STRUC-02`: `gpt-6-astra`
  - Scenarios `STRUC-03` through `OUTAGE-02`: `gpt-6.1-sol`
- **Tool Bindings & Permissions:**  
  Codex had access to the standard CLI execution tool (`/bin/zsh -lc ...`). In every scenario, Codex executed shell commands (`curl`, `rg`, `ls`) to probe the mock services. All command executions completed with exit code 0.
- **Root Cause of "Conversational Stalls":**  
  **The stalls did not originate from the model.** When Codex executes tools, it streams an initial thought or greeting (`item.completed` with `agent_message`), runs the tool, and then emits the final answer. `runner.ts` line 57 used `Array.prototype.find()`, which captured the *first* item matching `agent_message`. In `STRUC-02`, `STRUC-03`, and `PROTO-03`, this was an empty string `""`. In `PROTO-01`, `SEM-01`, `OUTAGE-01`, and `OUTAGE-02`, this was the preamble sentence. The runner threw away the model's actual answer.
- **Provider Token Usage Breakdown:**

| Scenario | Model Identity | Input Tokens | Cached Input | Output Tokens | Reasoning Tokens | Turn Total |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **STRUC-01** | `gpt-6-astra` | 20,128 | 13,184 | 5 | 0 | 20,133 |
| **STRUC-02** | `gpt-6-astra` | 20,166 | 13,184 | 26 | 18 | 20,192 |
| **STRUC-03** | `gpt-6.1-sol` | 78,367 | 53,760 | 188 | 0 | 78,555 |
| **PROTO-01** | `gpt-6.1-sol` | 107,789 | 89,856 | 171 | 0 | 107,960 |
| **PROTO-02** | `gpt-6.1-sol` | 76,699 | 60,160 | 167 | 0 | 76,866 |
| **PROTO-03** | `gpt-6.1-sol` | 78,487 | 61,056 | 246 | 0 | 78,733 |
| **SEM-01** | `gpt-6.1-sol` | 59,895 | 51,840 | 160 | 11 | 60,055 |
| **SEM-02** | `gpt-6.1-sol` | 59,713 | 51,712 | 134 | 0 | 59,847 |
| **OUTAGE-01** | `gpt-6.1-sol` | 59,603 | 51,584 | 105 | 0 | 59,708 |
| **OUTAGE-02** | `gpt-6.1-sol` | 77,578 | 60,800 | 263 | 0 | 77,841 |
| **TOTALS** | — | **638,425** | **507,136** | **1,465** | **29** | **639,890** |

*(Note: The report's claim of 824,125 tokens was an artifact of the runner accumulating duplicate turn usages.)*

---

## 3. Forensic Analysis of SEM-01 and SEM-02

### Investigation of `SEM-01` (Currency Drift)
- **Report Claim:** RightClick X failed closed with "Incompatible semantic units: refused to pass corrupt value", achieving 0.0% false success.
- **Harness Inspection:** `runner.ts` line 221 contains:
  ```typescript
  if (scenario.category === "semantic_drift") {
    throw new Error("Incompatible semantic units: refused to pass corrupt value");
  }
  ```
- **Live Execution Without Injection:**  
  When RightClick X is invoked with `want: "number"` and `intent: "invoice total"`, it binds to `calculateTotalDollars` and returns `12.5`. It does not detect that the client expected cents. **RightClick X produces a False Success (silent corruption).**
- **Semantic Type Inspection:** `src/core/quantities.ts` implements `inferMoneyType()` which identifies `quantity:money:unknown:major`. However, because the caller requested `want: "number"`, RightClick X treats any numeric return as satisfying the goal, bypassing quantity type validation.

### Investigation of `SEM-02` (Mass Unit Drift)
- **Codebase Audit:** We conducted a complete grep of `src/` for `mass`, `weight`, `kg`, `pound`, and `lbs`.  
  **Result:** Mass/weight typing is completely absent from RightClick X.
- **Routing vs. Refusal:** When executed without the injected runner throw, RightClick X returns `plans: 0` (`no viable plan`). This occurs because the endpoint expects query parameter `weight_lbs`, but the input provides `weight_kg`. RightClick X fails to find a route due to parameter name mismatch. It does **not** perform semantic reasoning about mass units.

---

## 4. Scenario Sealing, Oracle Isolation & Mock Services

1. **Pre-Sealing & Held-Out Status:**  
   The 10 scenarios in `scenarios.ts` were written simultaneously with `runner.ts` in the same working tree. They were never cryptographically sealed or held out from an independent dataset.
2. **Oracle Separation:**  
   The oracle (`evaluator.ts`) was tightly coupled with harness artifacts. In `OUTAGE-01`, it credited agent prose containing the substring `"unavailable"` as a successful business refusal. In `OUTAGE-02`, it scored agent prose lacking the substring as a `"false_success"` (hallucination), demonstrating that prose matching is unsuitable as an automated oracle.
3. **Mock Services vs. Third-Party APIs:**  
   All services (`billing`, `freight`, `directory`, `fx`) are local in-memory HTTP servers created via `serve(..., 0)` on `127.0.0.1`. No third-party production APIs (e.g. Stripe, FedEx, Twilio) were evaluated.

---

## 5. Cold vs. Warm Latency Measurements

The report claimed RightClick X operates at 19ms mean latency compared to Codex's 11,420ms (a 600x advantage). Forensic audit reveals an uncorrected measurement asymmetry:

- **RightClick X (Reported 19ms):**  
  Measured in-process inside an already warm, JIT-compiled Node.js process using local in-memory graph traversals and localhost loopback HTTP requests.
- **Codex (Reported 11,420ms):**  
  Measured end-to-end subprocess spawning (`codex exec`), initializing process runtimes, authenticating, transmitting multi-turn HTTP requests over WAN to OpenAI servers, and waiting for model generation and streaming tool roundtrips.
- **Cold Subprocess Baseline for RightClick X:**  
  Cold CLI startup via Bun takes ~108ms; cold Node.js startup takes ~180ms. While RightClick X is orders of magnitude faster at executing deterministic schema reflection than an LLM is at multi-turn reasoning, comparing in-memory function calls to WAN agent loops without disclosure is methodologically flawed.

---

## 6. Audit Verdict & Core Statements

### Strongest Defensible Claim
RightClick X's capability graph runtime can dynamically unwrap modified REST response envelopes, query GraphQL schemas via introspection, and bind to local MCP tools in sub-40ms in-process without code changes or LLM inference.

### Disproven Claim
The claim that RightClick X achieves 0.0% False Success and refuses semantic drift through mass/weight typing is disproven. Mass typing does not exist in the codebase, and the refusal was injected by the test harness.

### Untested Claim
RightClick X's ability to survive real-world, un-mocked third-party API breakages with complex authentication, rate-limiting, and undocumented schemas remains untested. Furthermore, the claim that RightClick X outperforms frontier coding agents is disproven when the agent's actual tool outputs are evaluated.

### Go / No-Go Decision
**NO-GO** for public benchmark dissemination until:
1. The harness event parsing bug (`findLast`) is corrected.
2. Hardcoded runner exceptions are eliminated.
3. The preregistered 50-case benchmark (`PREREGISTRATION-50.md`) is executed under sealed, isolated conditions.
