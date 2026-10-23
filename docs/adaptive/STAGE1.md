# Operator execution restrictions

Status: **mechanism implemented; full mission PARTIAL; release NO-GO**. Exact frozen source and final check results are recorded in `evidence/stage1-verification.json` after the product commit. No source change during those checks is permitted.

## What changed

`OperatorAuthority.execution` adds intersecting allowlists for risks, capability IDs, providers and immediate HTTP(S) origins, plus capability denial rules. Denial takes precedence. An omitted list is unrestricted; an empty list permits nothing in that dimension. ID patterns support only an exact value or a trailing `*`. Unknown configuration fields, malformed lists and non-origin URLs are errors, rather than ignored settings. Configuration is cloned and cannot be modified through returned audit data.

Operator configuration example (implemented):

```sh
export RCX_EXECUTION_POLICY='{"allowedRisks":["read"]}'
node bin/rcx.ts audit
node bin/rcx.ts mcp
```

An operator may add `deniedCapabilities`, `allowedCapabilities`, `allowedProviders` or `allowedOrigins` to that JSON. The programmatic equivalent is `RightClick.create({ authority: { execution: policy } })`. No MCP call accepts policy updates. The initial experiment must explicitly set read-only policy; omission retains the existing runtime's compatibility behaviour and does not imply read-only execution.

`rcx audit` and `context_graph {"op":"authority"}` report the same analysis. `context_explain` includes the capability's policy assessment. No MCP operation was added: the interface still has thirteen tools.

## Boundary and coverage

| Path | Enforcement |
|---|---|
| Direct library / MCP / HTTP run | Check before dispatch; confirmation cannot override policy |
| Composed and retained pipelines | Preflight every known dependency before the first step; check each dispatch again |
| Saved goals | Check goal identity, then the newly selected plan and every dispatched leaf |
| Generated REST / GraphQL endpoints | Check the goal even though these routes enter below `run()` |
| Independent witnesses | Apply policy and read-only transport lower bounds before accepting witness obligations |
| Automatic repair | Re-check the newly discovered successor at the low-level dispatcher |
| Network discovery and redirects | Intersect operator and caller origin restrictions; an empty intersection stays empty |
| Opaque host bindings | Unknown destinations; refuse them when origins are restricted |
| Other agent tools / shell / provider internals | **Outside coverage**; do not claim prevention or complete visibility |

Risk declarations are not proof of business effects. The analysis adds conservative lower bounds for HTTP mutations/DELETE and GraphQL mutations. It does not infer an arbitrary service's hidden semantics. Known local filesystem bindings and sandboxed CLI operations have no immediate network destination; host-injected cloud bindings are unknown. An allowed remote origin can have internal effects that RightClick X cannot observe or constrain.

Dependency analysis is bounded to 32 levels and 1024 visited nodes per root. Missing, cyclic or oversized dependencies fail closed. This is a bounded dependency/policy mechanism, **not yet the mission's complete chained-consequence intelligence engine**. The audit reports dynamic plans and scope limitations explicitly. Existing destructive approvals, executable authority, sandboxing and verification remain additional checks.

Policy is supplied at runtime construction; a fresh runtime applies changed permissions to retained capabilities. Immediate live revocation, short-lived authority, authenticated principals and resource-level grants remain future work. State files and operator configuration must be protected from agents with unmediated filesystem access.

## Tests and failures retained

1. Six baseline tests fail: five exercise the proposed policy not previously present; one reproduces caller origins widening the existing network policy. [Before](evidence/execution-policy-before.log).
2. The first implementation had an unsupported TypeScript parameter-property syntax and was rejected by Node/typecheck. [Failure](evidence/execution-policy-after-initial.log).
3. Expanded tests found a real generated REST/GraphQL goal-denial bypass. Two other initial failures used incorrect fixture provider IDs; they were corrected to the reflector's actual IDs, with assertions on the premise. The same denial and zero-effect criteria were retained. [Initial](evidence/execution-policy-expanded-before.log), [corrected fixtures, still failing the real bypass](evidence/execution-policy-expanded-corrected-fixtures.log).
4. An opaque platform binding was incorrectly considered local-only under an origin restriction. A separate effect counter demonstrated the bypass. [Failure](evidence/opaque-binding-before.log). It is now refused before calling the binding.
5. Restricted proof execution could not bind loopback (`EPERM`); raw failure retained. Re-running with host access restored the actual local-services proof. This is an environment limitation, not a semantic pass or product failure. [Failure](evidence/stage1-proof-restricted-failure.json).
6. The first performance harness attempted to assign a getter-only field; no workload executed. [Failure](evidence/policy-cost-attempt1-failed.log). The corrected harness retains the same workload and checks.
7. The first package attempt could not write the shared npm cache. The successful run uses a fresh writable cache; no host ownership or permission changes were made. [Failure](evidence/stage1-package-attempt1.json).

The adversarial tests use disposable in-memory providers and effect counters outside the policy decision. They establish what was dispatched in these cases. They are authored by this programme and do not constitute an external security audit or a new independent holdout.

## Performance and developer checks

`node experiments/north-star/measure-policy.ts [runtime.ts]` measures 100 fake HTTP operations, 100 warmup calls and 900 measured calls for each configuration, retaining predicates and receipt hashing. The baseline ignores the new policy field; its second case is another baseline sample, not enforced-policy evidence. Raw batches are retained. The early measurement found approximately 0.059 ms/run for baseline without policy and 0.067 ms/run with this stage's read-only policy. This is small absolute runtime overhead in an in-memory fixture, **not agent-cost evidence or a competitive advantage**. It is a single-process pilot with order/JIT effects, not a statistical regression guarantee.

`node ci/adaptive-package-smoke.ts` (after `npm run build`) packs locally, installs offline into a clean directory/cache, verifies policy inspection and all thirteen MCP tools, then uninstalls. This is not independent-developer usability validation. The package has no new runtime dependency or required cloud service.

## Remaining acceptance work

The Verified Capability Contract extension, graph-wide consequence precision/recall, live authority revocation, deterministic saved-goal hot path, semantic transfer, real model swap, corrected full benchmark gates, sealed holdouts, Capability Plane Challenge, independent review, final documentation/video/economics/scorecard and external commercial validation remain open. Existing 199 baseline regressions remain mandatory. A passing stage does not prove completion of those requirements.
