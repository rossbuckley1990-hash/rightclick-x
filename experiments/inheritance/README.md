# Fresh-agent inheritance fixture

This development harness asks one fresh Codex client to discover authorised local programs and publish a reusable manifest fingerprint, then asks a second fresh client to use the retained goal on a different manifest. It does not seed the goal or its composition. It records the two client traces, the shared runtime state, exact MCP responses, receipt checks, independent local oracle outputs and source/program hashes.

Prerequisites are Node, installed `jq`, `sha1sum`, `json_pp` and `shasum` at the paths in `fresh-agents.ts`, a working un-widened RightClick CLI sandbox, and a Codex ChatGPT subscription with available ordinary allowance, no credits, and the configured model. Each model turn receives a fresh read-only allowance preflight. Failure stops the run; it never buys credits or falls back to an API account. Run from the repository root, using an output directory that does not yet exist:

```sh
node --test experiments/inheritance/guards.test.ts
node experiments/inheritance/fresh-agents.ts /private/tmp/rcx-fresh-agents-new
```

The local host denies all runtime network requests, allows only read-risk execution and the four authorised programs, and limits the reuser's tools. The CLI programs run in the RightClick host sandbox, which must report no network and no widened home reads or writes. These controls **do not establish OS-level containment of the entire model process**; the trace audit is supplementary. Output contains synthetic fixture inputs, model traces and local state; keep it in an appropriate private location.

`result.json` can only report `REVIEW_REQUIRED`: inspect `created-goal.json`, `creator/state.json` and the recorded MCP responses to establish that both the producing pipeline and the independent witness calculate the complete canonical fingerprint. A `verified` label alone is insufficient. The harness requires the second client to execute that same unchanged goal, matches its actual output to two separately executed local implementations, and reconciles the result with the saved receipt. Its receipt chain provides local integrity evidence, not independent authority or independent-authored review. It does not demonstrate process-kill recovery, revocation, unfamiliar holdouts, cross-vendor transfer, or economic superiority.
