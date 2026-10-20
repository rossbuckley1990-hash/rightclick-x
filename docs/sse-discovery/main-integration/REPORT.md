# Final core integration review

**READY FOR MAIN INTEGRATION**, subject to Ross's final merge approval. Nothing has been merged, pushed, published or released.

The current local main at `c27289e2570cc0a18512787082095ac32ba0eb80` can receive the isolated branch `integration/universal-discovery-main` as a fast-forward. Main and the other inspected development/showcase checkouts were not edited. The final before/after inventory covers eight original worktrees in total, including main. Approval applies to this recorded main revision; recheck if main advances.

## Exact provenance and scope

- Verified source HEAD: **`6b22a59333175fe25725e2631896a612da8f5f46`**, `/Users/ross/src/rightclick-x-sse-integration`.
- Verified source product correction: `f5360c5192f100afb0190590615ce71bb866c234`. The subsequent `6b22a59` changes evidence only; its `src` and `test` match that correction.
- Original experimental correction: `5265ecda95c539a33ea87d1eb80424c52bfff06d`, imported previously as `a7999391fe29e46d54d3a847a98af6999b0d1ed5`. Assessment commit: `759391e727f7fe2bd11ecdcdf7e93d91dbd5fe36`.
- Main-based import: `46b1df7ac363d2c5d568a3a4ef041cd4941d0916`.
- **Final tested product commit: `ca845e05e5909c58f068712106bbd7962ea8cbf3`.** The final evidence commit is its descendant and does not change product or test code.
- Tested Git tree: `bc6d0d7f57cd44e44a3a7a168512f2d46af9e1e4`.
- Tested `src` tree: `814720b4ce1b4dca3e9f6512ac0413c16312bc38`; `test` tree: `b2bafcf72d3ce2d3e0c72abeae8442216c65dc66`.
- Durable checkout and evidence: `/Users/ross/src/rightclick-x-main-discovery`, `docs/sse-discovery/main-integration/`. Tests ran before the unchanged worktree was moved from `/private/tmp/rcx-main-discovery-candidate`; the raw traces retain that actual execution path.

Integrate the complete branch from main, including both product commits and the evidence commit. Do not cherry-pick only `ca845e0`: its parent contains the discovery import.

The verified branch's four commits above `bfdfe0307013750c189054079fc7e7aa9e2d2451` contain four production reflector changes, two regression files, and associated verification/evidence. However, that programme baseline is **145 commits ahead of current main**. A direct merge would import unrelated development. This candidate instead has main as its parent baseline and selectively imports the correction and its narrow prerequisites.

| Production file | Exact integration choice |
|---|---|
| `src/reflectors/discover.ts` | Byte-identical to verified source: SSE disposal, MCP negotiation, GraphQL fallback, bounded reads and existing YAML contract support. |
| `src/reflectors/net.ts` | Byte-identical to verified source: request/body deadlines, bounded acquisition, cleanup and cancellation; retains the verified redirect credential/body rules from `65ae92d`. |
| `src/reflectors/mcp.ts` | Verified streaming parser and conservative default risks from `c90b24d`, plus the explicit main-compatibility guard described below. |
| `src/reflectors/openapi.ts` | Only the two response-lifecycle edits from `f5360c5`. Main's schema projection is retained; unrelated declared-field metadata from the programme is excluded. |
| `src/core/yaml.ts` | Exact verified 193-line reader from the programme's `9ad98b2` prerequisite. Required by the unchanged YAML acceptance check. |

The original discovery-stream tests, 21 recovery tests, two YAML tests and three frozen acceptance/wire drivers are byte-identical to the verified source. The four existing redirect tests A1–A4 were extracted without changing their fixtures or bodies; unrelated sandbox tests and dependencies were excluded. Two integration-specific security tests were added. All **116 existing main tests are unchanged**. No runtime, authority, persistence, schema type, GraphQL reflector, execution subsystem, package or dependency changes were imported. Provider-specific production code added: **0 lines**.

Exact review material: [production diff](production.patch), [complete product/test/harness diff from main](main-to-candidate.patch), [file import map](import-map.json), [source and environment provenance](provenance.json).

## Compatibility finding resolved before approval

The first candidate reproduced a security conflict in the older main context: `{readOnlyHint: true, destructiveHint: true}` is destructive on main but read-only under the verified programme's MCP expression. A malformed truthy destructive hint had the same problem. This could bypass main's normal destructive execution gate even though the initial standard suites passed.

[Recorded baseline/candidate classification](risk-compatibility-before.json) and [two failing full-path guards](risk-before.log) establish the conflict. `ca845e0` preserves main's destructive-hint precedence ahead of the newer read-only/default handling. It retains the more conservative default for unannotated tools. Both tests now discover the tool, assert destructive classification, attempt execution, assert refusal and verify **zero `tools/call` requests**. See [exact reconciliation](annotation-reconciliation.patch). No authority or execution privilege was expanded.

There is no remaining material conflict with current main. The ongoing security and adaptive worktrees were not merged or overwritten. Later integration of those branches should retain this annotation-precedence guard if their older risk expression produces a textual conflict.

## Final candidate verification

All results below were rerun on `ca845e0` after the compatibility correction. Counts for this main-based candidate differ from the programme because its unrelated 145 commits and tests were deliberately excluded.

| Check | Result | Evidence |
|---|---|---|
| Frozen acceptance, macOS | **24/24**, zero failures | [JSON](acceptance.json), [log](acceptance.log) |
| Same frozen acceptance, Linux | **24/24**, zero failures | [JSON](linux-acceptance.json), [log](linux-acceptance.log) |
| Complete main-based regression, macOS Node 26.12.0 | **148/148**, zero skips/failures, 4.163 s test-runner duration | [Log](full-regression.log), [command](full-regression.command.json) |
| Complete main-based regression, Linux Node 24.22.0 | **148/148**, zero skips/failures, 5.300 s | [Log](linux-regression.log), [command](linux-regression.command.json) |
| Current main control suite | **116/116**, zero skips/failures | [Log](baseline-regression.log) |
| TypeScript: product, tests, bin, demo and proof | **PASS** | [Log](typecheck.log), [command](typecheck.command.json) |
| Full lifecycle proof, seed 20261018 | **28/28**, product source unchanged during proof | [JSON](proof.json), [log](proof.log) |
| Node CLI and browser/edge bundles | **PASS** | [Log](build.log) |
| Live HTTP MCP fixtures | **4/4** exact capabilities and outputs, one execution each | [Trace](candidate-wire.json) |
| Live HTTP GraphQL fallback | **PASS**, geocode and country discovered; Tokyo → JP | [Trace](graphql-wire.json) |
| Concurrent work preservation | **PASS**, original heads, statuses and dirty-file hashes identical | [Before](worktrees-before.json), [after](worktrees-after.json) |

SSE, GraphQL fallback, REST/OpenAPI JSON/YAML, MCP Streamable HTTP, finite MCP event streams, supported web forms, stream management, cancellation and the exercised security/schema boundaries all **PASS**. Tests assert capabilities and execution outcomes, not merely a successful discovery return. Negative tests cover HTTP/RPC/malformed/stalled MCP failures without suppressing GraphQL, stalled GraphQL without suppressing MCP, and retained web forms after failed probes.

The original source's **339/339**, **38/38 Linux**, **28/28 lifecycle**, both TypeScript checks, and **24/24 acceptance** remain hash-verified in their original durable checkout: [verification output](source-evidence-verification.log). They are historical source results, not relabeled candidate results. Main has no `tsconfig.harness.json` or North Star evaluation harness; its existing TypeScript project already includes the lifecycle proof. No second programme-only TypeScript project was silently omitted or imported.

Linux runs used the cached image identified in provenance, source mounted read-only, and `--network none`. Real HTTP checks used loopback fixtures only. No additional commercial investigation was performed.

Initial `46b1df7` results are retained with `initial-` filenames (146/146 regressions on both platforms, 24/24 acceptance, 28/28 proof). They do not substitute for the final runs. `risk-before.log` retains the two expected security failures before correction. `proof-invocation-error.log` records an invalid noninteger seed rejected before any proof checks; its `.json` is merely a copy of the pre-existing proof file and is not a test result. `linux-regression-sandbox.log` records a denied Docker socket before any Linux checks ran. Neither setup error is counted as a product failure or a pass.

## Actual before/after wire measurements

The unchanged driver uses a 100 ms request timeout and an independent 1,500 ms child-process watchdog. These are individual observations, not a controlled performance benchmark.

| Fixture | Current main `c27289e` | Final candidate `ca845e0` |
|---|---|---|
| Long-lived SSE GET, JSON MCP replies | Watchdog; discovery never returns | **16.26 ms**, correct capability/output |
| MCP POST matching event without EOF | Watchdog | **20.00 ms**, correct capability/output |
| Infinite GET mislabeled JSON | Watchdog | **115.24 ms**, correct capability/output after GET deadline |
| Finite JSON MCP | 88.27 ms, correct | **21.30 ms**, correct |

Every final MCP row discovers exactly `mcp:wire-fixture:read-record`, executes successfully with `record-17`, and makes exactly one `tools/call`. Traces show disposal/closure of unused streams. The mislabeled GET consumes its deadline before later MCP requests; discovery has a per-request bound, not a global 100 ms budget. [Main trace](baseline-wire.json), [candidate trace](candidate-wire.json).

The separate GraphQL wire driver discovers both geocode and country and returns Tokyo → JP on both main (**20.17 ms**) and candidate (**19.10 ms**, learn plus run). Its historical comparison-arm label remains `imported`; the checkout identifies the final candidate. No claim of general performance improvement is made from these timings.

## Security, schema compatibility and outstanding limitations

Egress allowlists, deny rules, private/metadata address restrictions and redirect-origin checks continue through the existing request path. Tests exercise destination-pinned credentials, custom header stripping, A → B → A redirects, cross-origin body refusal, safe same-origin redirects, deadlines, caller abort, disposal and execution refusal. These boundaries pass. The extra MCP annotation guard prevents a demonstrated permission regression relative to main.

Main's OpenAPI schema projection and GraphQL typing/selection validation are unchanged. The full suite retains assertions for typed ports, required inputs, `$ref` bodies, MCP output schemas and rejection of injected GraphQL operations. Malformed/mismatched MCP envelopes and missing tools arrays fail discovery without creating false capabilities; malformed destructive annotations cannot reduce risk. This is verification of the exercised boundaries, not a claim of a newly complete JSON Schema validator or a comprehensive security audit of older main. Its separate authority/security-hardening programme remains pending.

**The baseline FileStore persistence race remains unresolved as a separate issue.** Concurrent saves use one temporary filename per destination/process and can race on rename. The earlier controls reproduced ENOENT in 3/3 baseline pairs and 3/3 corrected pairs. Those original controls are preserved here without rerunning or changing persistence: [JSON](store-race-control.json), [log](store-race-control.log), [separate issue record](PERSISTENCE-ISSUE.md). `src/entry/node-host.ts` and `src/runtime.ts` are byte-identical to current main. Passing this candidate's suite does not close that issue.

Discovery acquisition is bounded to 16 MiB per response; ordinary execution output size semantics are retained. There is no new global discovery budget, pagination redesign or DNS-resolution redesign. Fetch adapters must honor abort to clean their own transport; discovery does not await an uncooperative cancellation promise. Legacy two-endpoint SSE, stream resumption and general server-to-client MCP requests are not added. The small YAML reader retains its documented limitations, including rejection of anchors/aliases/tags and multiple documents. Edge builds were compiled, not deployed. Verification ran on the recorded Node 24/26 environments, not every supported runtime version.

## Preservation and final merge gate

All candidate evidence is committed under this durable worktree. Original showcase and universal-recovery evidence remain unchanged. [SHA-256 manifest](sha256.json) covers the new report and evidence; provenance records source, test, configuration and harness hashes. Reconcile them with:

```sh
python3 experiments/sse-discovery/verify-main.py
git diff --quiet ca845e05e5909c58f068712106bbd7962ea8cbf3 HEAD -- src test bin demo proof package.json package-lock.json tsconfig.json
git merge-base --is-ancestor c27289e2570cc0a18512787082095ac32ba0eb80 HEAD
```

Recommend the isolated candidate for main integration and the next verified release, while keeping the persistence issue and broader release/security gates open. Final merge approval is required. Stop here.
