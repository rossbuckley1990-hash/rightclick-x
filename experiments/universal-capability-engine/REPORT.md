# Universal Capability Engine: final report

| | |
|---|---|
| Branch | `feature/universal-capability-engine` |
| Worktree | `/Users/ross/src/rightclick-x-uce` |
| Status | Not merged, not pushed |
| Baseline | `3f1fbcc` |
| Final freezes | `uce-freeze-7` (challenge), `lifesci-satisfy-8` (goal satisfaction), both at `202bcaf` |
| Report commit | the commit that adds this file |

Companion documents:

- [SPEC.md](SPEC.md): architecture, investigation, synthesis, satisfaction, verification, reproduction.
- [SECURITY.md](SECURITY.md): the seven risks and the four authorities.
- [PREREGISTRATION.md](PREREGISTRATION.md): stages, controls, baselines and scoring, fixed before any run.
- [README-PROPOSED.md](README-PROPOSED.md): a proposed README section (the current README is unchanged).
- [LAUNCH-VIDEO.md](LAUNCH-VIDEO.md): a launch-video brief for /brag.

## Verdict in one paragraph

RightClick X can now be given the path of a command-line program it has never seen, contains no code for, and has no MCP server for. Under operator authority it:

- investigates the program in a sandbox (no network, no home reads, temp-dir writes only);
- turns what it observes into typed capabilities with graded evidence;
- composes them with other providers;
- runs them;
- has the result checked independently;
- publishes the result as a reusable operation that a fresh agent uses with two tool calls;
- withdraws it when the program disappears or changes incompatibly.

That chain passed end to end on the frozen build (challenge stages A–E, 0 wrong outcomes since freeze-3).

Two of the twelve acceptance gates **are not met**:

- **Generalisation to unseen programs (Gate 9):** 3 of 12 randomly drawn holdout programs passed across six freezes, with 7 wrong outcomes before the final freeze.
- **A measurable benefit over a simpler baseline (Gate 11):** on the measured task, an agent with a raw sandboxed program runner was equally correct, faster and cheaper.

**Recommendation:** do not merge the branch as a product claim. Merge the security fixes separately. Keep the engine on the branch until Gates 9 and 11 are met (see the end of this report).

## Acceptance gates

| Gate | Result | Evidence |
|---|---|---|
| 1. Unfamiliar capability discovered without application-specific code | **PASS** | `challenge-uce-freeze-7.json` Stage A: `tidy` drawn at random (seeded selection, `selection-ac.json`); 7 capabilities from 44 sandboxed runs; `integrationCodeLines: 0`. The investigator contains no program names (`src/reflectors/cli.ts`). |
| 2. Capability executed successfully | **PASS** | Stage A compose, Stage B run, holdout `base64` (and `expand` and `mandoc` on earlier freezes). |
| 3. Required outcome independently verified | **PASS** | The harness's own checks (tag balance, word preservation, closed `p`/`li`; exact base64; exact tab expansion), never the program's own report. |
| 4. Reusable operation on the stable MCP interface | **PASS** | `goal:correct-html`, published through `context_compose`, is found with `context_actions`/`context_graph` and run with `context_run`. No new tools: still 13 `context_*`. |
| 5. A fresh agent uses it on new data | **PASS (same vendor)** | Stage B: a new Claude Code session with only the RightClick X server; 2 tool calls (`context_actions`, `context_run`); did not re-learn the program; independent check passed. |
| 5b. Different vendor (Stage F) | **BLOCKED** | Codex CLI returned "You've hit your usage limit … try again at Oct 22nd". Recorded as blocked, not as a pass or a RightClick X failure. |
| 6. Multi-provider composition executed and independently verified | **PASS** | Stage C: the published `tidy` goal composed with a separately investigated `sdiff` (corrected vs original, side by side); line order, change markers, closed tags and words all checked. Life-science H1 on `lifesci-satisfy-8`: ecosyste.ms advisories → OSV vulnerabilities, joined by identifier evidence, fan-out bounded at 4 of 8, scored against independent truth. |
| 7. Environment change: correct adaptation or explicit withdrawal | **PASS** | Stage D. Adapted correctly to a renamed option, input moved from stdin to a file operand, and output nested in JSON. Refused to run, with nothing presented, for an incompatible semantic change and a temporary outage. Correct again after re-investigation. Stage E: program removed → capability withdrawn (0 left, "nothing was run"); restored → correct again. |
| 8. Security boundaries remain enforced | **PASS** | `test/security-boundaries.test.ts` (5 risks, written failing on the baseline: `stage2-adversarial-on-baseline-3f1fbcc.txt`). `test/investigation.test.ts`: sandbox escape, no-sandbox refusal, injected help text treated as data, revoked authority. Controls N1 (silent program → nothing learned) and N2 (unregistered program → refused). Goal-satisfaction controls N1–N3 pass. |
| 9. Generalises to an unrelated holdout | **NOT MET** | Across six freezes: 3 of 12 holdout programs passed (`expand`, `mandoc`, `base64`). Every holdout draw was seeded from that freeze's commit hash. 7 wrong outcomes before freeze-7 (each fixed generally, with a test), 0 on freeze-7. The goal-satisfaction holdout (H1, a different domain) passed for the first time on `lifesci-satisfy-8`. One pass on the last freeze is not evidence of generalisation. |
| 10. Existing regression suite passes | **PASS** | 152/152 tests; `tsc` clean. Lab: 30/30 and 30/30 (direct and gateway). Negative controls 6/6. Proof 28/28. |
| 11. Measurable benefit over a strong simpler baseline | **NOT MET** | `baselines-uce-freeze-7.json`: all four arms were correct on first use and on reuse. RightClick X used the most tokens and time (see below). Baseline 4, a coding agent, was not run: it needs arbitrary code execution, which the safety rules exclude. |
| 12. Every advertised claim backed by inspectable evidence | **PASS** | Every number in this report comes from a committed file under `experiments/…/evidence/` or a command in SPEC.md. The demo's evidence bundle is regenerated by each run, not committed. |

## The ten questions

### 1. What could RightClick X do before?

On `3f1fbcc`, RightClick X learned providers that **describe themselves in a machine-readable contract**: OpenAPI/Swagger (JSON), GraphQL introspection, MCP servers, peer runtimes and the local platform. It planned typed compositions across them, ran them, checked stored predicates and witnesses, and published goals.

It could not learn anything that has no contract. Five security weaknesses were present (SECURITY.md):

- a symlink escape from the workspace;
- re-sending a non-idempotent POST on retry;
- writing goals reachable through GET;
- unannotated MCP tools treated as safe;
- an agent's own confirmation counted as operator approval.

### 2. What can it do now?

- **Learn undescribed software.** Command-line programs the operator registers are learned from their usage text and manual page, plus bounded experiments in a sandbox. Every claim gets an evidence grade, and unsupported behaviour is never auto-composed.
- **Plan for an outcome, not a type.** `require` terms are covered by declared result fields. Joins are classified as caller, evidence, declared or generic. Only *established* plans run; otherwise the outcome is explicit (*unverified*, *incomplete* or *unavailable*), and the result is checked again after the run.
- **Produce capability cards** for every capability: purpose, contracts, assumptions, side effects, authority, verification, limitations and provenance. Each card carries a `verified`/`unverified` trust label, and an operator can require verified-only publication.
- **Adapt or withdraw.** Programs are pinned by SHA-256 and re-checked against authority on every run. Removal means withdrawal.
- **YAML OpenAPI contracts** and contract links are now learned.
- The five security risks are fixed. Authority is enforced outside the LLM.

### 3. What new capability did it discover?

In the pre-registered challenge (`tidy` and `sdiff` were drawn by seed, not chosen):

- **"Correct HTML"**: `tidy` learned and published as `goal:correct-html` (verified by stored predicate).
- **HTML correction review**: the published goal composed with `sdiff` to show the corrected document side by side with the original. Neither program knows the other.
- **Upper-case text** (Stage D, a synthetic program), with a second investigated program (`casecheck`) as its independent witness.

On random holdout draws:

- **`base64` encoding** (freeze-7);
- **tab expansion** with `expand` (freeze-2);
- **manual-page rendering** with `mandoc` (freeze-5).

In the web domain, H1 found a vulnerability lookup by package URL across two independent public APIs (ecosyste.ms → OSV).

### 4. How do we know it was not preprogrammed?

- **Programs drawn by seed.** The challenge programs were drawn by a seeded selection over 312 suitable programs on this Mac:
  - A and C were seeded from the pre-registration commit;
  - each holdout set was seeded from the frozen build's own commit hash, so it could not be known when the code was written.
- **No program names in the engine.** `grep -w` of `src/` for every drawn program name finds only the generic word `expand`, used as a function name and in a field-name pattern. The investigator's samples are generic (HTML, XML, JSON, CSV, text).
- **Frozen builds.** Every evaluation runs from a `git archive` export of a tag, not from the working tree.
- **Code written after a failure is general.** Each fix after a failed run is a rule stated generally, has its own regression test, and was followed by a new freeze and a new holdout draw. The failed run is kept.
- **Negative controls.** N1, a program with no observable behaviour, yields nothing. N2, an unregistered program, is refused.
- **The weak holdout record is itself evidence.** A preprogrammed system would not fail 9 of 12 random draws.

### 5. How was the result verified?

- **By the harness's own code, never by the program under test or by RightClick X's report:**
  - tag balance;
  - word preservation;
  - closed elements;
  - side-by-side line order and markers;
  - byte-exact tab expansion;
  - byte reconstruction from an `od` dump;
  - an exact base64 comparison;
  - for the web domain, truth queries made directly against each database.
- **Wrong outcomes counted first.** A run that completes but fails its check is a *wrong outcome*, counted separately and reported first.
- **Checks fixed before each run.** Checks were pre-registered. Each holdout check was written after the draw and before execution: `TASKS_FREEZE3`–`TASKS_FREEZE7` in `holdout-phase2.ts`, with commit history.

### 6. Can another AI reuse it?

**Yes, within one vendor.** In Stage B a fresh Claude Code session, connected only to RightClick X and never told the program's name, found the goal and ran it in 2 tool calls without re-learning (15.1 s). The baseline harness repeated this as "reuse" on new input: correct, 2 tool calls.

**Across vendors, not yet shown.** The cross-vendor run (Codex) was blocked by that client's usage limit.

### 7. What happens when the environment changes?

| Change | Behaviour |
|---|---|
| Renamed option, changed input channel, nested output | Correct result again (Stage D) |
| Behaviour changed incompatibly | Not run; error states that the program changed since it was investigated (sha256 old vs new); no output presented |
| Temporary outage | Not run; no output presented |
| Program removed | Capability withdrawn; graph holds 0 of its capabilities; "nothing was run" (Stage E) |
| Program restored, then re-investigated | Correct again |
| Operator revokes authority | Existing capabilities stop running (test) |

There have been 0 wrong outcomes in Stages D and E since freeze-3.

### 8. How does it perform against a simpler alternative?

Same task, model, budgets and unseen inputs (`baselines-uce-freeze-7.json`):

| Arm | First use | Reuse (fresh session) |
|---|---|---|
| RightClick X (capability learned in Stage A) | correct · 2 calls · 4 turns · 24.8 s · 128,780 tokens | correct · 2 calls · 4 turns · 25.6 s · 128,707 tokens |
| Baseline 1: a raw sandboxed `run_program` tool | correct · 2 calls · 4 turns · 20.7 s · 111,484 tokens | correct · 2 calls · 4 turns · 22.2 s · 110,998 tokens |
| Baseline 2: runner + RightClick X's investigation transcript | correct · 1 call · 3 turns · 12.0 s · 101,362 tokens | correct · 1 call · 3 turns · 16.2 s · 101,492 tokens |
| Baseline 3: runner + the generated capability card | correct · 1 call · 3 turns · 12.9 s · 86,834 tokens | correct · 1 call · 3 turns · 14.7 s · 86,838 tokens |
| Baseline 4: coding agent that writes integration code | not run (needs arbitrary code execution) | |

On this task RightClick X is **not** better. `tidy` is a well-known program that the model already knows how to drive, and the larger tool surface (13 tools) costs tokens.

Arm 3 is the cheapest of all. This suggests the generated card is useful *as documentation*, even outside RightClick X.

The benefits RightClick X is designed for were **not measured as benefits** in this study:

- software the model has never seen;
- reuse by an agent that doesn't know which program to call;
- governance;
- withdrawal and change safety.

### 9. What remains unsolved?

- **Generalisation (Gate 9).** Most holdout failures were programs the investigator misread:
  - usage text taken as output (cups-config);
  - an error report taken as output (zipinfo);
  - an operand grammar misparsed (htmltree);
  - an unsupported mode composed (mp2bug);
  - an interactive prompt (net-snmp);
  - a dump that does not round-trip (od).

  Each was fixed in general, but every new draw found a new class.
- **Not investigable.** Many draws could not be investigated at all: daemons, DTrace scripts, programs with no stdin/file mode. The pre-registered exclusion rules did not filter them, which wasted draws.
- **Documentation that disagrees with behaviour.** `tab2space` behaves differently from its documentation. Without an independent witness, RightClick X cannot tell which is right.
- **Goal satisfaction over the web (criteria A and B).** The pre-registered task requires a multi-provider plan that is established and unanchored *and* scores correct. It was never met in 8 runs.
  - **Q03:** the established plans failed at run time; the result had no identifier, and no answer was presented.
  - **Q07:** "label" was matched to an unrelated field (`ligand.label`). The post-run check caught it and reported *incomplete*, so no wrong answer was presented, but a read-only call was spent.
  - **Lesson:** term coverage by field name alone is too weak.
- **Benefit over baseline (Gate 11).** Not shown; see question 8.
- **Cross-vendor reuse.** Blocked (usage limit). The coding-agent baseline was not run, by the safety rules.
- **Platforms.** Only macOS `sandbox-exec` was exercised. The Linux bubblewrap path is untested. No sandbox → unavailable.
- **Programs only.** Investigation covers read-only programs on text input. Programs that write state, need a network, or take binary input are out of scope by design.

### 10. Why would developers or companies pay for this?

**The case is not yet made with evidence.** The measured task shows no advantage. The product's hypothetical value lies where the baseline arms can't go:

- **Governance outside the model.** Operator-set discovery and execution authority, a sandbox, binaries pinned by hash, verified-only publication, and receipts. A raw `run_program` tool is an arbitrary-execution surface; RightClick X is not. Security teams pay for this kind of control; whether they would pay *here* is untested.
- **Internal and unfamiliar software.** Programs the model has never seen. The challenge's synthetic programs (`textkit`, `casecheck`) are the closest evidence, but they were not run in the baseline comparison.
- **Reuse across agents.** One investigation, many clients, plus withdrawal and change detection. This is shown to work (Stages B, D, E), but its value was not quantified.

See "Commercial viability" below.

## Performance

| Measure | Value | Source |
|---|---|---|
| Time to first capability (`tidy`, 44 sandboxed runs) | 434 ms | challenge freeze-7 metrics |
| Time to first verified capability | 454 ms | same |
| `sdiff` investigation | 36 sandboxed runs | Stage C |
| Investigation budget | ≤ 60 runs, 5 s and 1 MB each | `src/reflectors/cli.ts` |
| Compose and run of the published goal (demo) | 14 ms | `npm run demo:unknown` |
| Fresh-agent reuse (Stage B) | 2 tool calls, 4 turns, 15.1 s | challenge freeze-7 |
| Agent tokens per task | 128.8k (vs 86.8k–111.5k for the baselines) | baselines freeze-7 |
| Integration code written per program | 0 lines | challenge metrics |

## Failed experiments (all preserved)

**Challenge.**

- Freeze-1: every stage failed, with 1 wrong outcome. In C, an unrelated builtin was chosen and a file was compared with itself.
- Freeze-2: 1 wrong outcome, the same C defect.
- Run 2's Stage B was first credited from stale receipts. It was re-scored as FAIL, and the harness was fixed.
- F was blocked on every freeze. On freezes 1–4 it ran only same-vendor or was blocked.

**Holdout (phase 2).**

| Freeze | Program | Result | Cause |
|---|---|---|---|
| 2 | cups-config | wrong outcome | usage text |
| 3 | zipinfo | wrong outcome | error report |
| 3 | xmllint | fail | words lost |
| 4 | htmltree | wrong outcome | operand parse |
| 4 | mp2bug | wrong outcome | unsupported mode composed |
| 5 | od | wrong outcome | output did not round-trip |
| 6 | net-snmp-create-v3-user | wrong outcome | prompt |
| 6 | tab2space | wrong outcome | behaviour contradicts documentation; unfixed by design |
| 7 | uuname | fail | nothing run |

Programs that could not be investigated are listed in `holdout-phase1-*.json`.

**Goal satisfaction.**

| Run | Criteria (A, B, C, D, E, F) |
|---|---|
| satisfy-1 | F F F F T T |
| satisfy-2 | F F F T T T |
| satisfy-3, -4, -6 | T F F T T T |
| satisfy-7 | partial run (an OLS 500 stopped it; retry added) |
| satisfy-8 | F F T T T T |

The fan-out criterion was first scored against listed items and re-scored against items actually run. That change is recorded in the run's evidence, and the criterion was not changed.

**Harness defects found and fixed during the challenge.**

- Copied Apple binaries are killed (exit 137): changed to symlinks, recorded as a deviation.
- Number(null) coercion.
- An upstream 500 crashed the run.
- Output was withheld by the result budget: `view.full` added.

## Comparison with existing approaches

No claim of a first is made; prior art was not surveyed systematically.

- **Hand-written MCP servers per tool.** These are exact and reviewed, but need code for each program. RightClick X needs none. It is less exact (Gate 9), and its investigation evidence is weaker than a human-written schema.
- **A generic shell or "run any command" MCP tool.** This is the baseline arms. It is flexible and, here, cheaper. The difference is that the authority to execute anything lies with the model. RightClick X keeps execution authority, sandboxing and change detection outside the model.
- **Contract-to-MCP generators (OpenAPI → tools).** These need a contract. RightClick X also learns from contracts, and adds programs that have none, outcome-based planning, and withdrawal.
- **An agent that reads `--help` and writes a wrapper.** This was not run (Baseline 4), for safety reasons. It is likely to be strong on well-known programs.

## Commercial viability

**Who would buy.** Platform or security teams that let several AI agents use internal command-line tooling, and that need operator-set authority, an audit trail and safe failure on change. Not individual developers using well-known tools: the baselines show that a frontier model with a runner is already sufficient there.

**What is defensible today:**

- authority and sandboxing outside the LLM;
- pinning and withdrawal;
- graded evidence on every capability, with a capability card;
- explicit "not established" outcomes instead of guesses;
- 0 wrong outcomes in the challenge since freeze-3.

**What blocks a sale:**

- No measured benefit over the cheapest baseline.
- Holdout reliability: 3 of 12. A customer's own programs would fail most of the time today.
- macOS-only sandbox evidence.
- No customer evidence, no willingness-to-pay data, and no adoption figures. None were collected; none are claimed.

**Next evidence that would change this assessment:**

1. A baseline study on software the model cannot know: synthetic or internal programs, with cross-agent reuse where the reusing agent is not told which program to use.
2. A holdout pass rate above an agreed threshold on two consecutive freezes, with zero wrong outcomes.
3. The Linux sandbox exercised.

## Merge / no-merge recommendation

**Do not merge `feature/universal-capability-engine` into `main` as it stands.** Gates 9 and 11 are not met. A merge would put claims in front of users that the evidence does not support.

Instead:

1. **Merge the security fixes on their own**, after review. They fix real defects on `main`, and each has an adversarial test:
   - the workspace symlink check;
   - no re-send of state-changing calls;
   - GET 405 for writing goals;
   - unannotated MCP tools treated as destructive;
   - operator approval kept separate from agent confirmation;
   - retry-safety classification.
2. **Optionally merge the off-by-default engine for further evaluation.** With no `RCX_INVESTIGATE`, nothing is investigated. Goal satisfaction (`require`) is opt-in. If merged, keep the README unchanged and label the feature experimental.
3. **Do not apply README-PROPOSED.md** until Gates 9 and 11 pass on a fresh freeze.

The decision is the operator's. This branch has not been pushed, and nothing has been merged.

## Deviations from the pre-registration (recorded)

- **Symlinks instead of copies.** Copied Apple-signed binaries are killed by the OS, so programs are introduced as symlinks in the registered directory.
- **Stage F.** Run with a different vendor where available. It was blocked by Codex's usage limit; earlier freezes used same-vendor isolation, labelled as such.
- **Baseline 4** was not run: it needs arbitrary code execution.
- **Holdout tasks.** Written per draw, after phase 1 and before phase 2, as the pre-registration allows. Each one's commit precedes its execution.
