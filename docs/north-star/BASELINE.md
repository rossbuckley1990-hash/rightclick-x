# Stage 0: repository audit and baseline

Audited on 2026-10-17.

| | |
|---|---|
| Programme branch | `programme/rightclick-x-north-star` |
| Worktree | `/Users/ross/src/rightclick-x-north-star` |
| Baseline tag | **`ns-baseline` = `bb5a983`** |

## Repository inventory

| Ref | Commit | State | Contents |
|---|---|---|---|
| `main` (= `origin/main`) | `c27289e` | Pushed 2026-10-17 | Life-science work: identifier links, output views, run-drift repair |
| `fix/security-boundaries` (= origin) | `9e76f00` | Pushed; PR #1 open | `main` + the five security fixes (one commit) |
| `feature/universal-capability-engine` | `0c3b3aa` | Local only | `main` + bounded fan-out (`Ross/gallant-mendel-7f183f`) + the same security patch (`c90b24d`) + CLI investigation, capability cards, goal satisfaction, the UCE challenge and its evidence |
| `Ross/gallant-mendel-7f183f` | `1e191f8` | Local only | Bounded fan-out and the goal-satisfaction pre-registration (contained in the UCE branch) |

- **Worktrees:** the main checkout, `rightclick-x-security`, `rightclick-x-uce`, `.claude/worktrees/gallant-mendel-7f183f`, and this one. None has uncommitted changes. This programme touches none of them.
- **Tags:** freezes `uce-freeze-1…7` and `lifesci-*`. No `v*` release tags.
- **Release configuration:**
  - `package.json` is version 0.1.0 and declares the `rcx` bin as `dist/rcx.mjs`.
  - `package-lock.json` exists and there is a `Dockerfile`.
  - There is **no CI** (`.github/` absent), no CHANGELOG, no CONTRIBUTING, and no security disclosure policy.
  - The package description says "Reflects **any** API", which is an overclaim (Stage 7).

## Baseline choice

**`ns-baseline` = `feature/universal-capability-engine` (`0c3b3aa`) merged with `fix/security-boundaries` (`9e76f00`).**

- **Why the UCE branch.** It is the only branch containing every component the brief says to preserve: CLI investigation, bounded fan-out, goal satisfaction, learned identifier relationships, operator authority, capability cards, and the security fixes. `main` lacks the last five.
- **Security patches identical.** The security patch on `fix/security-boundaries` is byte-identical in `src/` and `bin/` to `c90b24d` on the UCE branch (diff checked).
- **What the merge added.** Only the README execution-risk bullet, `experiments/security-boundaries/` (the record and the adversarial run on `main`), and regenerated lab and proof result files. It is a reconciliation merge with no code changes.

## Baseline results on `ns-baseline`

| Suite | Result |
|---|---|
| `npm test` | **152/152** (11.0 s) |
| Type check (`tsc`) | clean |
| Build (`npm run build`) | `dist/rcx.mjs` 0.33 MB; `dist/edge.js` **1.23 MB** (main: 0.24 MB; see below) |
| Security suites (`security-boundaries`, `security`) | 9/9 |
| Lab, direct and gateway | 30/30, 30/30 |
| Open-world negative controls | 6/6 |
| Lifecycle proof | 28/28 |
| UCE acceptance (`challenge.ts ns-baseline`) | A, B, C, D, E **PASS**; **F BLOCKED** (Codex usage limit until 22 Oct); N1, N2 PASS; 0 wrong outcomes. Time to first capability 505 ms. Evidence: `challenge-ns-baseline.json` |
| Stress (performance) | See [Performance baseline](#performance-baseline) |

## Historical findings, checked against the current source

| # | Finding | Status on `ns-baseline` | Where |
|---|---|---|---|
| 1 | UCE investigated certain unfamiliar CLI programs | **Confirmed.** Re-run today: `tidy` (7 capabilities, 44 runs) and `sdiff`. | `challenge-ns-baseline.json` |
| 2 | Fresh-agent reuse | **Confirmed**, same vendor: Stage B, 2 tool calls, no re-learning. | same |
| 3 | Cross-application composition in controlled environments | **Confirmed**: Stage C, `tidy` → `sdiff`, independently checked. | same |
| 4 | Only 3 of 12 holdout programs passed | **Confirmed**. Historical evidence unchanged. | `holdout-phase2-uce-freeze-*.json` |
| 5 | Simpler direct-execution or documentation approaches did better in the benchmark | **Confirmed.** All arms correct; RightClick X used the most tokens (129k vs 87–111k). | `baselines-uce-freeze-7.json` |
| 6 | mandoc → od completed with the wrong outcome | **Confirmed historically and still structurally possible.** Re-running the historical task on `uce-freeze-5` reproduces it: the plan is `mandoc → od -b` and the bytes do not round-trip. **The successful-but-wrong plan was then crystallised automatically, and reused for three later intents.** On `ns-baseline` the task now runs `od -b` alone, with bytes round-tripping, **only because of a heuristic** (`planner.ts:251`, which drops "bloated" plans when a shorter plan exists). Nothing enforces input lineage, and crystallisation still records any completed run. | Probe in Stage 2 evidence |
| 7 | Cross-vendor acceptance blocked by usage limits | **Confirmed** again today (Codex: "usage limit … Oct 22"). | `challenge-ns-baseline.json` F |
| 8 | Custom credential headers survive cross-origin redirects | **Confirmed present.** `src/reflectors/net.ts:151-156` removes only `authorization` and `cookie` on a cross-origin hop. Any other caller-supplied header (`X-Api-Key`, `Proxy-Authorization`, …) is forwarded to the new origin. A request body is re-sent across origins on 307/308. | Stage 1 |
| 9 | Executable-directory allowlist accepts `..` traversal | **Confirmed present.** `src/runtime.ts:841-843` `mayRunProgram` is a string-prefix test (`bin.startsWith(dir)`), so `/allowed/../usr/bin/x` passes. A symlink inside an authorised directory is followed anywhere. The file is hashed by path and then executed by path, which leaves a time-of-check/time-of-use window. | Stage 1 |

## Further findings from the audit

- **Parameterised options are never investigated.** `src/reflectors/cli.ts:310` keeps only options **without** an argument, and at most eight of them. Any task needing a value (a width, a delimiter, a field number) cannot be satisfied. This is a likely large share of generalisation failures (Stage 3).
- **Weak verification can be labelled verified.** In challenge Stage A, `goal:correct-html` is published as `verified` on the strength of a stored predicate (`contains </html>`). The brief requires that a predicate pass is not called verified (Stage 2).
- **Footprint regression.** `dist/edge.js` grew from 0.24 MB on `main` to 1.23 MB. The edge (browser-target) bundle pulls polyfills for the `node:` imports added by CLI investigation and the sandbox (Stage 7).
- **Failed cases.** The UCE `D` stage's incompatible change is refused because the program's hash changed (HTTP 409 equivalent). That is not a judgement about compatibility: compatible and incompatible changes both change the hash. Adaptation in D works because healing re-learns the program. There are no retained behavioural reproduction tests to tell a compatible change from an incompatible one (Stage 4 and adaptation).
- **CLI.** `rcx` has `connect`, `demo`, `mcp`, `serve`, `learn`, `actions`, `explain`, `run`, `compose`, `graph`, `status`, `watch` and others. There is no `doctor`, no `investigate` and no `capabilities` command (Stage 7).

## Performance baseline

Stress benchmarks are in progress; results are appended below when complete.

## Initial North Star scorecard (before any programme change)

Scores are out of 10 and are earned by evidence. Each later stage updates this table.

| # | Dimension | Score | Evidence | Main limitation |
|---|---|---|---|---|
| 1 | Architectural differentiation | 4 | Unique combination in the material reviewed (COMPETITIVE-THESIS.md) | No measured advantage over a terminal agent |
| 2 | Discovery | 4 | `tidy`, `sdiff`, `base64`, `expand`, `mandoc` learned without integration code | Options with arguments ignored; many programs not investigable |
| 3 | Semantic correctness | 3 | 0 wrong outcomes in the challenge since freeze-3 | 7 holdout wrong outcomes; mandoc → od guarded only by a heuristic; Q07 field-name match |
| 4 | Generalisation | 2 | 3/12 holdout programs | Weak; evaluator was the developer |
| 5 | Verification | 4 | Independent witnesses exist; post-run `require` check | A trivial predicate can earn "verified" |
| 6 | Security | 4 | Operator authority outside the LLM, sandbox, 5 fixed risks | Two confirmed open weaknesses (8, 9); macOS sandbox only; no independent audit |
| 7 | Portability | 3 | macOS tested; edge build compiles | Linux sandbox untested; Windows none |
| 8 | Reusability | 5 | Fresh-agent reuse, 2 tool calls | Same vendor only; no behavioural conformance tests retained |
| 9 | Performance | 4 | First capability 0.5 s | Agent tokens worse than the baselines |
| 10 | Developer experience | 4 | `npm run demo:unknown` | No `doctor`/`investigate`; long README |
| 11 | Commercial differentiation | 2 | — | No measured benefit |
| 12 | Defensibility | 1 | — | No knowledge-transfer evidence |
| 13 | Distribution | 2 | Public repo | No CI, release, or npm package |
| 14 | Production readiness | 3 | 152 tests, labs, proof | v0.1; no CI; one platform |
| 15 | Commercial validation | 0 | — | No external users, partners or pilots |
