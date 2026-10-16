# Security prerequisites (Stage 2)

**Baseline:** `3f1fbcc` (main `c27289e` + fan-out branch `1e191f8`). 121/121 tests, both labs 30/30, negative controls 6/6, proof 28/28.

**Method:** every risk named in the brief got an adversarial test in [`test/security-boundaries.test.ts`](../../test/security-boundaries.test.ts), run against the unmodified baseline first. The raw output is in [`evidence/stage2-adversarial-on-baseline-3f1fbcc.txt`](evidence/stage2-adversarial-on-baseline-3f1fbcc.txt). Only then were fixes made.

| Risk named in the brief | On the baseline | Fix | Regression test |
|---|---|---|---|
| Cross-origin credential/header forwarding | **Not present.** Fixed earlier (multi-hop redirects strip pinned credentials). | No change | `security.test.ts`: credentials stay pinned across A → B → C |
| Workspace filesystem symlink escapes | **Present.** A symlink inside the workspace read a file outside it; writes went through symlinked directories and files. | Paths are judged by real path; writing to a symlink is refused; the nearest existing ancestor of a write target must really be inside the workspace (checked again after `mkdir`). | symlink read, write through a symlinked dir, write to a symlinked file |
| Generated GET endpoints executing writes | **Present.** `GET /x/<slug>` ran any published goal, so a link, prefetch or crawler could trigger writes. | GET only answers read-only goals; others return 405 with `Allow: POST`. `/openapi.json` declares writing goals as POST with a request body. | GET refused, nothing written; POST works |
| Unsafe retries of non-idempotent operations | **Present.** After a failed order POST, healing re-planned and sent a second order (posts = 2). Run-level repair (`healRun`) re-sent failed writes after drift. | A state-changing step that may have taken effect is never re-sent or routed around. Exceptions: the error proves the request was not applied (400/401/403/404/405/406/410/411/413/414/415/422/429, connection refused, policy block), or the operator declared the operation side-effect-free (`authority.retry` / `RCX_RETRY`). Composites are inspected step by step. | POST sent exactly once by `compose` and by `context_run` |
| Inconsistent network-policy enforcement | **Not found.** Every outbound call goes through the runtime's network handle (and, under an egress policy, a scoped handle checked on every redirect hop, since freeze-10). The only direct fetch is a fixed Cloudflare trace URL in the Durable Object entry. | No change | `upstream-change.test.ts` (redirect hop, repair traffic) |
| Ambiguous operation side effects | **Present.** An MCP tool with no annotations was classed `external` and ran without confirmation. The MCP spec defaults `destructiveHint` to true unless `readOnlyHint` is set. | MCP spec defaults: read only if `readOnlyHint: true`; otherwise destructive unless `destructiveHint: false`. | unannotated tool is destructive and refused |
| Agent-supplied confirmation masquerading as approval | **Present by design.** `confirm: true` from the agent was all a destructive call needed. | **Operator authority**, outside the agent: `authority.destructive` = `operator` (default) / `agent-confirm` / `allow`; `authority.approve` lists approved capabilities. Under `operator`, a destructive call needs an approval **and** the caller's confirm. Set by configuration or environment (`RCX_DESTRUCTIVE`, `RCX_APPROVE`), never by a tool argument. | refused with confirm alone; approved + confirm runs; a tool argument cannot approve |

**Behaviour changes for existing users:**

- MCP tools without annotations are destructive. They need an operator approval, or `RCX_DESTRUCTIVE=agent-confirm` to restore the old behaviour knowingly.
- Repair no longer re-sends POST-style operations unless the operator declares them side-effect-free, or the failure proves they were not applied.
- `destructive: "confirm"` (legacy option) now means `agent-confirm`, explicitly; the default is `operator`.

**Existing tests that encoded the old behaviour** were changed only to state the operator authority they rely on. No assertion was removed:

- the three healing tests over the demo translation service declare it side-effect-free (`authority.retry`);
- the consent test approves the notes service. It gained an assertion that an unapproved delete is refused even with `confirm: true`.

**After Stage 2:** 126/126 tests, typecheck, both builds, both labs 30/30, negative controls 6/6, proof 28/28.

**Authority boundaries (all enforced in code, outside the LLM):**

| Authority | Who holds it | Mechanism |
|---|---|---|
| Discovery | Operator (what may be learned and reached) | network policy, egress origins, investigation registry (Stage 3) |
| Execution | Operator sets the bounds; agent acts within them | risk labels, `authority.destructive` / `approve`, `retry`, `risks` constraint |
| Publication | Operator (Stage 4) | verified-only publication (Stage 4) |
| Verification | Independent read-only providers, never the producing provider | outcome witnesses (separate provider, read-only, pinned contract) |
