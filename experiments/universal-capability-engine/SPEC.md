# Universal Capability Engine: specification

Branch `feature/universal-capability-engine`.

| | Commit |
|---|---|
| Baseline | `3f1fbcc` (main `c27289e` + bounded fan-out `1e191f8`) |
| Final freeze | `uce-freeze-7` / `lifesci-satisfy-8` (`202bcaf`) |

## Architecture (what was added, and where)

The AI-facing interface is unchanged: the same 13 `context_*` MCP tools. `context_compose` gained one parameter, `require`. Everything new sits behind the existing reflect → graph → plan → execute → verify → persist pipeline.

```text
operator authority (configuration / env, never a tool call)
  RCX_INVESTIGATE  RCX_APPROVE  RCX_DESTRUCTIVE  RCX_RETRY  publish policy  egress origins
        │
        ▼
 cli:/path  ──► investigator (src/reflectors/cli.ts) ──► typed capabilities + evidence
        │          declared docs + bounded sandboxed experiments
        │          (src/core/sandbox.ts: no network, temp-dir writes, no home reads)
        ▼
 capability graph ◄── OpenAPI / Swagger (JSON or YAML) / GraphQL / MCP / peers / platform
        │              + contract-declared result fields (core/fields.ts, breadth-first)
        ▼
 planner (core/planner.ts)  ── goal satisfaction (core/satisfaction.ts): require-terms,
        │                       join classes, established/unverified/incomplete
        ▼
 execution (runtime.ts): sandboxed programs pinned by SHA-256; GraphQL projection of
        │                required fields; no re-send of state-changing calls
        ▼
 verification: stored predicates, independent witnesses, post-run require check
        │
        ▼
 persistence: goal:<slug> capabilities with capability cards and trust labels
              (REST /x/<slug>, GraphQL, MCP via context_graph/context_run)
```

## Capability investigation (local programs)

**Authority.** The operator registers programs or directories (`authority.investigate` / `RCX_INVESTIGATE`). Authority is checked when a program is learned **and on every run**, so revoking it stops existing capabilities. Without a host sandbox, investigation and execution are reported as *unavailable*; nothing runs unconfined.

**Sandbox.** The host sandbox is macOS `sandbox-exec`; Linux bubblewrap is implemented but not exercised here. It enforces:

- no network;
- writes only into a fresh temporary directory, deleted after each run;
- no reads under home directories;
- a scrubbed environment;
- argv only, never a shell;
- 5 s and 1 MB per run;
- at most 60 runs per investigation.

**Declared evidence.** The program's usage text and manual page give:

- its purpose (manual NAME line, or the usage prose);
- its options;
- its operands, parsed with flags and metavariables removed, nested optional groups kept optional, numbered variadic examples collapsed, and the program's own name excluded.

**Experiments.** Generic synthetic samples are used: HTML, XML, JSON, CSV, two text pairs, and a feature-rich text (tabs, repeats, blank lines, case, numbers, runs of spaces). They are given on standard input (always tried) and as file operands. Each candidate mode is run on two distinct inputs, and its first trial is repeated to test determinism.

**Rejected trials.** None of these count as output:

- usage or help text;
- interactive prompts;
- a failure exit whose output keeps less than half the input's content words (an error report).

**Typing.** Inputs are typed by the kind the program's purpose names (for example HTML), and are marked *any text* when several document kinds worked.

**Evidence statuses** per claim: declared, observed, inferred, experimentally supported, contradicted, unknown. The investigator never sets *verified*. Behaviour that is only observed, or whose output never varied with input, is tagged `unsupported`. It stays callable directly but is never chosen by automatic composition.

**Change and removal.**

- Capabilities are pinned to the program's SHA-256. A changed program is re-investigated before it runs.
- A missing program withdraws its capabilities.
- An option equivalent to the default keeps its description on the default capability.

## Capability synthesis and persistence

`context_compose` (`publish`) saves a goal as `goal:<slug>`. It is discoverable through `context_graph` and runnable through `context_run`, REST `/x/<slug>` (GET only for read-only goals) and GraphQL. It re-plans on every call, and its stored predicates and witnesses travel with it. Every capability has a **card**, built from recorded data:

- identity;
- purpose;
- input and output contracts;
- dependencies;
- semantic assumptions (bindings);
- execution plan;
- side effects;
- authority;
- verification;
- limitations;
- provenance.

A goal is published as `verified` only if an independent check passed; otherwise it is labelled `unverified`. An operator can require verified-only publication.

## Goal satisfaction

This follows `experiments/goal-satisfaction/PREREGISTRATION.md` (`1e191f8`), with four supporting mechanisms added after its evaluations:

- breadth-first declared fields;
- projection of every field carrying a required term (bounded);
- identifier evidence two array levels deep;
- optional filters do not block evidence.

**How a plan is judged.** It is judged by the declared fields of its result. Each join is classified:

- **caller**: only where the caller's value fits the port;
- **evidence**: a learned scheme;
- **declared**: a specific type;
- **generic**.

**Statuses.**

- **Established:** every required term is covered and there is no generic join.
- **Unverified:** the information is reached only through a generic join.
- **Incomplete:** a required term is missing.

Only established plans run. Otherwise the outcome is explicit and nothing runs. The output is checked again after the run.

## Planning rules added (general, each from a recorded failure)

- **Two required inputs of one step never take the same value.** (A file was compared with itself.)
- **A step that covers uncovered intent words is progress even when it preserves the type.** (HTML → corrected HTML.)
- **Words naming the requested type are not intent.** (`want: text` + "text" made "Summarize text" look relevant.)
- **A plan that strictly contains another plan's steps without covering more intent or required information is dropped.** (Text was typeset as a manual page before being dumped.)
- **A failed bound value blames its producer, not the consumer.**
- **A caller input given under a port's own name binds to it.**

## Security model

See [SECURITY.md](SECURITY.md). It covers the seven named risks (five present and fixed with adversarial tests). The four authorities are enforced outside the LLM:

| Authority | How it is enforced |
|---|---|
| Discovery | Registry, network policy, egress origins |
| Execution | Risk labels, destructive approval plus confirm, retry declarations |
| Publication | Verified-only policy |
| Verification | Witnesses must be separate, read-only providers |

Investigated programs run sandboxed only.

## Verification methodology

**Evidence before scoring.** Every evaluation was pre-registered or fixed in code before its runs:

- `PREREGISTRATION.md` (`82b4a47`);
- goal-satisfaction pre-registration (`1e191f8`);
- each holdout program's check, written after that program was drawn and before it was executed.

**Independent checks.** These are always the harness's own code, never the program under test:

- HTML: tag balance, word preservation, closed elements;
- side-by-side: line order, change markers, corrected side;
- exact tab expansion;
- byte reconstruction from an `od` dump;
- base64 encoding;
- the life-science truth queries made directly against each database.

**Wrong outcomes.** A run reported as completed whose output fails its check is counted as a *wrong outcome*. That is the worst category, and it is reported in the headline.

**Freezes.** Each general fix led to a new freeze and the complete evaluation was repeated. Failed runs are kept. Each holdout program set is drawn from the new freeze's commit hash.

## Reproduce

```bash
cd /Users/ross/src/rightclick-x-uce          # or a checkout of the branch
npm test                                     # 152 tests
npm run demo:unknown                         # live demonstration (macOS; uses /usr/bin/tidy)
node experiments/universal-capability-engine/challenge.ts uce-freeze-7
node experiments/universal-capability-engine/holdout.ts uce-freeze-7          # phase 1
node experiments/universal-capability-engine/holdout-phase2.ts uce-freeze-7   # phase 2
node experiments/universal-capability-engine/baselines.ts uce-freeze-7
RCX_FREEZE=lifesci-satisfy-8 node experiments/life-science/phase-a.ts && \
RCX_FREEZE=lifesci-satisfy-8 node experiments/life-science/links.ts && \
node --import ./experiments/life-science/polite-fetch.ts experiments/goal-satisfaction/run.ts lifesci-fanout-2 lifesci-satisfy-8
```
