# Verified Integration Continuity: read-only reconciliation

This is a narrow development product for comparing one account's settled balance in one closed accounting period. It returns **VERIFIED MATCH**, **VERIFIED MISMATCH**, or **UNRESOLVED/UNVERIFIED**. A verified mismatch is an established discrepancy, not a failed execution. No money moves and no ledger corrections are dispatched.

It supports HTTP GET observations and explicitly approved GraphQL Query endpoints with a compatible canonical observation shape. It can discover a replacement REST/GraphQL interface, repeat the original checks, save the resulting operation, and reuse it in another process. Unknown conversions, changed checkers, missing observations, unsupported shapes and uncertain completion remain unresolved. This is not a general semantic-correctness guarantee.

## Use the product

The public `VerifiedReconciliation.create(contract, options)` API owns a restricted runtime. Call `reconcile({account, period})`. Use `FileStore` from `rightclick-x/node`, a private state path, and separate read-only credentials for the secondary source and checker. The constructor rejects volatile/unspecified stores, missing goal leases, missing pins and same-origin checkers. A custom store's `durability: "persistent"` is an operator assertion, not proof of physical durability.

The repository CLI is also usable:

```sh
npm ci --ignore-scripts
node bin/reconcile.ts contract.json private-state.json ACCOUNT CLOSED-PERIOD
```

Set `RCX_SECONDARY_TOKEN` and `RCX_CHECKER_TOKEN` in the process environment. Never put tokens in the contract file. The CLI prints hashes, status, exact difference in minor units, rejected check names and measurements. It exits 0 for either verified outcome and 2 for an unresolved/configuration result. Applications should inspect `outcome`, not treat exit 0 as a match.

Example operator configuration (replace both digests with reviewed values; placeholders deliberately fail admission):

```json
{
  "name": "settlement-reconciliation",
  "secondarySource": "https://gateway.example/",
  "approvedOrigins": ["https://gateway.example", "https://checker.example"],
  "approvedGraphqlEndpoints": ["https://gateway.example/graphql"],
  "expected": {"currency": "USD", "unit": "minor", "basis": "settled"},
  "checker": {
    "source": "https://checker.example/openapi.json",
    "capability": "openapi:operator-checker:observe",
    "owner": "operator",
    "contract": "sha256:REVIEWED_CHECKER_CONTRACT_DIGEST",
    "rulesDigest": "sha256:REVIEWED_CHECKER_IMPLEMENTATION_DIGEST"
  }
}
```

`RightClick.pinOutcomeWitnesses([reconciliationWitness(contract)])`, after learning the operator's checker, exposes its current SHA-256 contract pin without executing it. At enrollment only, leave `checker.contract` empty to inspect the current pin; review the checker and then supply that returned pin to the product. Do not automatically approve a replacement pin when a check fails. The fixture's `setup.ts` demonstrates enrollment for developer-owned synthetic services, not a production approval process.

The independent checker accepts **account** and **period**, never the proposed answer. Its response is:

```json
{
  "authoritative": {"account":"ACCOUNT","period":"CLOSED-PERIOD","currency":"USD","unit":"minor","basis":"settled","amountMinor":12551},
  "secondary": {"account":"ACCOUNT","period":"CLOSED-PERIOD","currency":"USD","unit":"minor","basis":"settled","amountMinor":12500},
  "rulesDigest":"sha256:REVIEWED_CHECKER_IMPLEMENTATION_DIGEST"
}
```

The secondary integration must return the same six observation fields. The product checks both observations against the invocation's account/period and operator-owned currency/unit/basis; amounts must be safe integers. The independent secondary observation must exactly match the candidate. It compares authoritative minus secondary using integer arithmetic and returns the exact difference as a decimal string. A changed or unavailable checker blocks dispatch/publication. The saved goal retains the same checks for every new account; no first-example answer is stored as a repair.

## Execution and authority boundary

Both planner and execution enforce `read` risk and HTTP/GraphQL/composite/goal invocation kinds. HTTP POST/DELETE and GraphQL mutations remain denied even if labelled `read`. The transport also guards discovery: only GET/HEAD and exact approved introspection or runtime-generated Query documents may cross it. MCP discovery/commands, arbitrary POSTs, generated executable code and undeclared GraphQL destinations are unsupported. Origin restrictions also apply to redirects. Restrict provider credentials themselves to read scopes.

A dishonest remote GET or GraphQL Query resolver can still commit an external write. A client cannot prove remote implementation honesty from a schema. Post-commit witnesses do **not** prevent or undo external writes. The generic `RightClick` / `RecoveringWorkflow` APIs retain their broader operator-configurable behavior; choose this product API for the enforced read-only mode.

Pinned API contracts and returned rules digests are not cryptographic attestation of a remote checker implementation. Operator ownership and independent data access must actually be established outside provider descriptions. The customer must maintain an independently accessible authoritative ledger and secondary snapshot/export. Using the very same broken API to check itself defeats that assumption. Closed-period snapshot consistency is an operator obligation; rolling balances, pagination/completeness proofs, transaction-level matching, FX, tax, time-zone conversion and autonomous corrections are unsupported.

## Persistence, unresolved work and costs

Fresh sessions relearn current contracts before reusing a saved operation. Pins, admission and business checks run again. Pending reads and incomplete dispatches retain checkpoints; a restart reports ambiguity and refuses automatic replay. Operator investigation is required for those checkpoints; automatic retirement/retry of failed reads is not implemented in this first mode. Concurrent state writers may lose a lease and return unresolved; no success is invented. Publication failures never return durable success.

Runtime state retains bounded business inputs/observations for recovery and is not encrypted by this product. Keep the store private and apply your retention policy. Public reconciliation evidence uses hashes and rejected rule names, but the underlying local runtime state is sensitive business data. Do not publish it from real deployments.

Pass the existing `CodexResponsesFallback` through `options.fallback` only with explicit API authority, reviewed model/prices and a reservation. Proposals cannot modify the checker or execute code. The adapter reservation is accounting, not a provider billing cap. The live Responses gate remains **NOT ESTABLISHED** in this engineering session because no API key is available. A ChatGPT-authenticated CLI control is separately documented and does not establish this adapter.

Direct SDK transactions have no MCP interaction. That does not imply zero total delivery cost: discovery, persistence, checker maintenance, compute, credentials and engineering remain. See [DECISION.md](DECISION.md) and the raw evidence before making an economic claim.

## Reproduce

```sh
npm run typecheck
npx tsc -p tsconfig.reconciliation.json
npm test
node experiments/reconciliation/run.ts /tmp/rcx-reconciliation-new-run
# Optional, one real CLI model call through your existing legitimate login:
node experiments/reconciliation/run.ts /tmp/rcx-reconciliation-live --codex
# Replay the recorded real proposal without buying inference:
node experiments/reconciliation/run.ts /tmp/rcx-reconciliation-replay --codex-replay docs/reconciliation/evidence/codex-control-events.jsonl
```

Use a **new** output directory for every run; an existing directory is refused. The runner uses synthetic credentials/data, separate fault and fresh worker processes, authenticated local services, persistent SQLite, a read-only independent database connection, and service-side request/effect accounting. Tests exercise refusals, concurrent leases, response loss, pending state, missing pins, publication failure and changed checker contracts. This is development evidence, not held-out evaluation or customer validation.
