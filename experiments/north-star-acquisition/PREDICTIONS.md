# Predeclared predictions — North Star acquisition gap closure

Authored and committed **before** any product run in this experiment is compared against them.
Committing this file first is the protocol: the previous experiment's oracle carried an
`authoredAt` that postdated the run it claimed to precede, which made its "prediction" status
unfalsifiable. This file's git commit timestamp is the predeclaration.

Independent expectations for the four Markdown fixtures are in `evidence/oracle-expected.json`,
computed by `oracle.ts` from `fixtures/` alone. That oracle imports nothing from RightClick X
and nothing from lychee, and never reads RightClick X output.

Programs under investigation, pinned by sha256 so a swapped binary cannot silently change the
result:

| program | path | sha256 |
| --- | --- | --- |
| lychee 0.24.2 | `/opt/homebrew/bin/lychee` | `257874d6cc6e98e2afa4443b7169e45c9c8f6864dd1a8c8743e2be56d5ef096b` |
| jq 1.8.2 | `/opt/homebrew/bin/jq` | `502d9df84b745b05eeac0a774ec62a29718cd9f5131472880d1012e43ee61309` |

These are the same binaries, byte for byte, that the prior experiment investigated.

---

## Part 1 — baseline: what unmodified `ddee0af` must reproduce

Each of these is a **firm** prediction: it follows from a code path I have read, and the prior
experiment logged it. If any does not reproduce, my reading of the code is wrong and I must say
so rather than proceed to fix a defect I have not observed.

- **B1 — empty result refused.** Running the acquired link-dump capability on `no-links.md`
  (oracle: zero destinations) fails with a refusal naming "without output".
  Cause: `src/runtime.ts:4031` requires `r.stdout.trim()` to be non-empty.
- **B2 — opaque output blocks typed composition.** The acquired dump capability's output port is
  the scalar type `text`, and `context_compose` from a Markdown document to `list:url` finds
  **zero** plans. Cause: `src/reflectors/cli.ts:959` types the output through `SEM`, which maps
  `text → text`; `strongly()` in `src/core/semantics.ts:82` admits only distance 0 into a `text`
  port, so `builtin:list.first-url` (wants `list:url`) is unreachable.

  > **CORRECTED AFTER MEASUREMENT — the second half of this prediction was wrong.**
  > The baseline run (`evidence/probe-baseline.json`, `checks.A2_typedComposition`) found
  > `plansFound: 1`, not zero. The first half holds: `cli:lychee:dump`'s output port really is
  > `[{"name":"","type":"text","required":true}]`. But composition to `list:url` succeeds anyway,
  > via `builtin:markdown.html → builtin:html.links`, with `usesAcquiredCapability: false`.
  >
  > The real defect is therefore **not** that composition is impossible; it is that the acquired
  > capability is **bypassed**. The planner routes around it because an opaque `text` output cannot
  > bind where `list:url` is wanted, so a builtin pair answers the goal and the empirically
  > acquired capability contributes nothing to it. That is a sharper problem than the one I
  > predicted, and it bears directly on Phase 5: if builtins already answer the goal, the marginal
  > value of acquiring the program must be demonstrated on a goal builtins cannot answer.
  >
  > The prior experiment's `chainTo_list:url {plans: 0}` measured a different question — chaining
  > *from the acquired capability's own output* — which is consistent with both results.
- **B3 — sandbox path breaks repeatability.** Two runs on `rel-links.md` return byte-different
  output, differing only in the per-run `rcx-sbx-XXXXXX` component, because lychee resolves
  relative destinations against the staged file's directory. Cause: `src/runtime.ts:4039` returns
  `r.stdout` raw; only the investigation path strips `workDir` (`src/reflectors/cli.ts:520`).
- **B4 — invalid UTF-8 silently corrupted.** A program whose stdout is not valid UTF-8 returns
  text containing U+FFFD replacement characters and reports `completed`.
  Cause: `src/core/sandbox.ts:513` `out.toString("utf8")`; the raw bytes are never retained.
- **B5 — no independent witness, so at most `checked`.** Publication of the link-enumeration goal
  reaches `checked` and never `verified`. Cause: `verified` requires a witness
  (`src/runtime.ts:3038`) that is separate from the producing providers (`:2445`); the only
  independent implementation in the graph returns `list:url`, which cannot be compared against
  newline-delimited `text`.

## Part 2 — post-fix: what the general changes must achieve

- **A1** `no-links.md` completes with an empty result. Empty is admitted **only** where the
  investigation observed the same mode return non-empty output for a different input, so a
  program that does nothing is still not a success. A non-zero exit, timeout, truncation, sandbox
  limit or application-error envelope must still fail.
- **A2** The dump capability's output port is `list:url`, established by validating every line of
  every working trial — not by guessing from the program's name or documentation.
  `context_compose` from a Markdown document to `list:url` then finds at least one plan whose
  first step is the acquired capability.
- **A3** Two runs on `rel-links.md` are byte-identical after the per-run sandbox root is
  normalised, and the raw output is still recoverable from the run's receipt. Normalisation
  applies **only** to the exact sandbox directory that run created. Any other path difference
  must still count as a meaningful output change.
- **A4** Non-UTF-8 stdout yields an explicit unsupported-encoding outcome. No U+FFFD-substituted
  string is ever returned as though it were the program's output.
- **A5** Assurance must not be inflated. If no independent witness agrees, the goal is `checked`
  and the record says so.

## Part 3 — what I deliberately do **not** predict

Stated up front so a convenient result cannot be reclassified as a prediction afterwards.

- **Whether lychee's own extraction agrees with the oracle.** lychee applies its own rules
  (notably a reserved-domain exclusion, and its own treatment of bare GFM URLs, which CommonMark
  does not autolink). The oracle's `extensionDependentBareUrls` bucket is reported and never
  scored. Any disagreement is recorded as a measured divergence, not as a failure of either side.
- **Whether an agreement witness will actually pass.** Typing the output as `list:url` makes
  `builtin:markdown.html → builtin:html.links` *comparable* with the acquired capability, but
  two independent parsers agreeing on these fixtures is an empirical question. If they disagree,
  the honest result is `checked`, and I will report that `verified` remains blocked.
- **Any commercial advantage.** Part 5 of the brief is a measurement, not a prediction. The prior
  published measurement (PR #50) found correctness ties at 10–49× token cost on HTTP APIs with
  published contracts, and its CLI arm was blocked rather than run. I do not assume either result
  transfers.

## Part 4 — falsification / NO-GO conditions

I will report NO-GO, or a split verdict, if any of these holds:

1. A fix only works because something names lychee, jq, Markdown or URLs specifically. Every
   change must be driven by the program's own documentation and observed behaviour.
2. `supported`, `direct-only`, `unsupported`, authority, sandbox, retry or witness-independence
   gates had to be weakened to get a green result.
3. The composed pipeline required a harness to invoke the steps manually. The composer must
   discover and connect them.
4. The post-fix result is only reproducible by discarding a failed attempt. All attempts,
   including failures, are preserved in `evidence/`.
5. Fresh-process or fresh-session reuse does not actually work.

---

# Part 5 — Phase 3 predeclaration (added after Parts 1–4 were measured)

Parts 1–4 have been measured; their results are in `evidence/probe-baseline-pristine.json` and
`evidence/probe-fixed.json`. This part is written **before** the breakthrough run and committed
before it, so its expectations cannot be fitted to the result.

## What the run must show

**C1 — the composer discovers a multistep pipeline through the acquired capability.**
Asked for `list:domain` from a Markdown document, with no capability named by the harness, the
planner must return a pipeline of **two or more steps** whose first step is `cli:lychee:dump`.
An exploratory query already showed such plans exist; this run must execute one, not just list it.
A harness invoking lychee and then a domain extractor itself does not count and is not what
`breakthrough.ts` does: it calls `context_compose` once and runs whatever the planner chose.

**C2 — the executed result matches the independent oracle.** For `abs-links.md` the expected
domains, in the order lychee prints the destinations, are:

```
["alpha-linkaudit.dev", "bravo-linkaudit.io", "alpha-linkaudit.dev"]
```

derived from the oracle's three absolute destinations. Duplicates are expected: nothing in the
graph deduplicates or counts, so the aggregation step is a per-item mapping and the counting is
done here, by the evaluator, not claimed as a product capability.

**C3 — the goal publishes at `checked`, not `verified`.** No independent witness has been
attached yet at publication time, so the honest ceiling is `checked`.

## What I predict about the independent witness, and why it may fail

The witness I will attempt is a **separately published builtin-only pipeline**
(`markdown → html → links → domain of each`), offered as an agreement witness. It is independent
in the sense the gate requires: its provider is `builtin:core`, which did not produce the candidate
result (`cli:lychee` did). Typing the acquired output as `list:url` is what makes the two
comparable at all — before that change they could not be, which is exactly why the prior
experiment's witness attempts were refused.

- **C4a** On `abs-links.md` I expect the witness to **agree**, because both implementations see the
  same three inline links and nothing else.
- **C4b** On `mixed.md` I expect the witness to **disagree**, for two reasons already measured and
  predeclared in Part 3: lychee excludes `example.com` under a reserved-domain rule, and lychee
  extracts the bare GFM URL `https://echo-linkaudit.dev/e`, which CommonMark does not autolink and
  so the oracle does not count. A disagreement here is **not** a defect in either implementation.

If C4a holds and C4b does not, the honest verdict is that `verified` is reachable for inputs where
two independent implementations agree and is **not** reachable in general. I will publish at
whatever level the evidence supports and say which that was.

## Reuse and revalidation

- **C5 — fresh OS process.** A newly spawned server, reading only the persisted state, must run the
  published goal and produce the same result, with a continuing receipt chain.
- **C6 — fresh agent session.** A second MCP connection (a new client, new session) must discover
  the goal without being told its id, and run it.
- **C7 — changed input.** Reuse must be exercised on a document the acquisition never saw, and the
  result must match the oracle for that document.
- **C8 — executable revalidation.** A copy of lychee whose bytes are altered after investigation
  must be **refused**, not run. This uses a fresh copy under this experiment's own directory; it
  does not resurrect the prior experiment's `/tmp/rcx-neg2` setup, and it does not touch the real
  `/opt/homebrew/bin/lychee`.

## What I do not predict

- Whether any of this is worth more than an agent using a shell. That is Part 5 of the brief and is
  measured separately, in Phase 5.
- That the planner's chosen route will always be sensible. The exploratory query already showed it
  will happily answer `want: number` for a host-summary intent with a word count of lychee's
  `--host-stats` output. Type satisfaction is not intent satisfaction, and that is recorded as a
  measured weakness rather than hidden.
