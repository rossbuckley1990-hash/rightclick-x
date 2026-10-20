# Security boundaries: five confirmed risks fixed

**Baseline:** `main` at `c27289e`, with 116/116 tests passing.

**Method:**

1. An adversarial test for each named risk was added in [`test/security-boundaries.test.ts`](../../test/security-boundaries.test.ts).
2. The tests were run against unmodified `main` first. All five fail there for the security reason, not for a missing API. The raw output is in [`evidence/adversarial-on-main-c27289e.txt`](evidence/adversarial-on-main-c27289e.txt).
3. Only then were the fixes applied.

**Provenance.** The fixes were developed on `feature/universal-capability-engine` as commit `c90b24d`, against `3f1fbcc` (`c27289e` plus the bounded fan-out branch). They are ported here on their own and applied to `main` without conflicts. None of that branch's investigation or goal-satisfaction work is included.

## Risks reviewed

| Risk | On `main` | Fix | Regression test |
|---|---|---|---|
| Cross-origin credential/header forwarding | **Not present.** Already fixed: multi-hop redirects strip pinned credentials. | No change | `security.test.ts`: credentials stay pinned across A → B → C |
| Workspace filesystem symlink escapes | **Present.** A symlink inside the workspace read a file outside it (`read through escape/secret.txt` completed). Writes went through symlinked directories and files. | Paths are judged by their real path. Writing to a symlink is refused. The nearest existing ancestor of a write target must really be inside the workspace, and this is checked again after `mkdir`. | Symlink read; write through a symlinked dir; write to a symlinked file |
| Generated GET endpoints executing writes | **Present.** `GET /x/<slug>` ran any published goal (200), so a link, prefetch or crawler could trigger writes. | GET answers only read-only goals; others return 405 with `Allow: POST`. `/openapi.json` declares writing goals as POST with a request body. | GET refused and nothing written; POST works |
| Unsafe retries of non-idempotent operations | **Present.** After a failed order POST, healing re-planned and sent a second order (the POST was sent 2 times). Run-level repair (`healRun`) re-sent failed writes after drift. | A state-changing step that may have taken effect is never re-sent or routed around. Two exceptions: (1) the error proves the request was not applied, which covers 400, 401, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422 and 429, connection refused and a policy block; (2) the operator declared the operation side-effect-free (`authority.retry` / `RCX_RETRY`). Composites are inspected step by step. | POST sent exactly once by `compose` and by `context_run` |
| Inconsistent network-policy enforcement | **Not found.** Every outbound call goes through the runtime's network handle; under an egress policy, a scoped handle is checked on every redirect hop. The only direct fetch is a fixed Cloudflare trace URL in the Durable Object entry. | No change | `upstream-change.test.ts` (redirect hop, repair traffic) |
| Ambiguous operation side effects | **Present.** An MCP tool with no annotations was classed `external` and ran without confirmation. The MCP specification defaults `destructiveHint` to true unless `readOnlyHint` is set. | Follow the MCP specification's defaults: a tool is read-only only if `readOnlyHint: true`; otherwise it is destructive unless `destructiveHint: false`. | An unannotated tool is destructive and refused |
| Agent-supplied confirmation masquerading as approval | **Present by design.** `confirm: true` from the agent was all a destructive call needed. | **Operator authority**, set outside the agent: `authority.destructive` = `operator` (default) / `agent-confirm` / `allow`, and `authority.approve` lists approved capabilities. Under `operator`, a destructive call needs an approval **and** the caller's confirm. Set by configuration or environment (`RCX_DESTRUCTIVE`, `RCX_APPROVE`), never by a tool argument. | Refused with confirm alone; approved + confirm runs; a tool argument cannot approve |

## Behaviour changes for existing users

- **Unannotated MCP tools are destructive.** They need an operator approval. Setting `RCX_DESTRUCTIVE=agent-confirm` knowingly restores the old behaviour.
- **Repair no longer re-sends POST-style operations,** unless the operator declares them side-effect-free or the failure proves they were not applied.
- **The legacy `destructive: "confirm"` option** now explicitly means `agent-confirm`. The default is `operator`.
- **Writing goals answer GET with 405.** Callers must use POST.

## Existing tests that encoded the old behaviour

These tests were changed only to state the operator authority they rely on. No assertion was removed.

- `test/drift.test.ts`: the three healing tests over the demo translation service declare it side-effect-free (`authority.retry`).
- `test/runtime.test.ts`: the consent test approves the notes service. It gained an assertion that an unapproved delete is refused even with `confirm: true`.

## After the fix

| Check | Result |
|---|---|
| Tests | 121/121 (116 + 5 adversarial) |
| Type check | clean |
| Build | `npm run build` succeeds (node and edge bundles) |
| Labs | 30/30 direct, 30/30 gateway |
| Negative controls | 6/6 |
| Proof | 28/28 |

## Authority boundaries

All of these are enforced in code, outside the LLM.

| Authority | Who holds it | Mechanism |
|---|---|---|
| Discovery | Operator (what may be learned and reached) | Network policy, egress origins |
| Execution | Operator sets the bounds; agent acts within them | Risk labels, `authority.destructive` / `approve`, `retry`, `risks` constraint |
| Verification | Independent read-only providers, never the producing provider | Outcome witnesses (separate provider, read-only, pinned contract) |
