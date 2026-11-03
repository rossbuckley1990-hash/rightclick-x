# Verified recovery development candidate

This is a bounded extension of the existing runtime, not a replacement planner or a claim of production reliability. The North Star decision and evidence limits are in [DECISION.md](DECISION.md). Historical 50-case results and scorers remain unchanged.

## Public API

`RecoveringWorkflow` (exported from `rightclick-x`) wraps an operator-owned business contract around discovery, the existing planner, independent witnesses, durable goals, checkpoints and effect ownership. Configure `RightClick` with a writable durable store, `workflowRecovery: true`, explicit origins, operator authority, and **no blanket retry grant**. Supply the invocation's semantic input types and independent witness obligations once.

```ts
const workflow = new RecoveringWorkflow(rc, {
  name: "issue-invoice",
  sources: [providerOrigin, `${observerOrigin}/openapi.json`],
  origins: [providerOrigin, observerOrigin],
  have: { invoice: "json" }, want: "json",
  intent: "create customer invoice", risks: ["write"],
  witnesses: [{ capability: "openapi:independent-audit:observeinvoice",
    args: { invoice: { input: "invoice" } },
    verify: [{ op: "exists", path: "invoice_id" }], agree: {} }],
}, boundedAgent);
const result = await workflow.execute({ invoice: originalRequest });
// Only result.status === "verified" AND result.durable confirms checked publication.
```

The observer in this example reads the service database independently, checks the original request's identity/currency/amount, and returns the observed invoice. The model never supplies that observer, its predicates or the original request. A schema's claim is not an observation. A suitable independent observer must be engineered and maintained for each supported business obligation.

A fallback is consulted only if discovery cannot produce a compatible plan **before dispatch**. It receives bounded contract descriptions and input types, not invocation values or previous conversation. Its JSON may choose one disclosed operation and alias identical semantic types. It cannot supply answers, constants, acceptance checks, credentials, arbitrary adapters or code. The existing runtime tests the proposal under the unchanged witness obligations; only independently checked, durably published results are reusable. It does not call a model on retained ordinary transactions.

A fresh instance reloads the saved goal, re-discovers current contracts, and keeps pinned witnesses. A removed producing operation may be replaced; a changed checker is refused. Any potentially committed unknown execution stops recovery and blocks new dispatch from that store. It requires operator investigation; there is no automatic compensation or unsafe replay. A writable store is a prerequisite, and a failed publication is never reported durable. Global blocking is intentionally conservative and can reduce throughput.

## Model adapter and accounting

`CodexResponsesFallback` supplies the `FallbackAgent` interface with one non-streaming Responses API call, no tools and no model-generated code execution. The operator explicitly supplies an available compatible Codex model, API key, current reviewed prices and an accounting reservation. It never loads host credentials automatically. Contract disclosure to that model is part of choosing the adapter. The exact selected model must match the returned model identity; aliases resolving to a different snapshot are refused.

MCP/context overhead is reported as null where the wrapper has no complete transport meter. Even an ordinary transaction must not claim measured zero customer context cost from zero internal inference.

The adapter bounds context bytes, output tokens, time and response bytes. It validates terminal completion and usage, including cached input and total-token arithmetic. It records only a request hash, sizes, usage, elapsed time and reserved/settled cost. It never retains credentials, prompt text, proposal text or reasoning in its accounting receipt. Unknown completion or usage retains the full reservation. A reservation is **not a provider-enforced spending cap**; usage above it is ambiguous and needs reconciliation. A provider/project spending limit is an additional operator control.

There was no API credential in this execution environment. Adapter tests used documented response shapes and synthetic prices. No paid model run or model-reasoning comparison was performed. The stateful exercise uses an explicitly labelled scripted proposal adapter. Fresh-process reuse is demonstrated; a fresh model agent session remains untested.

## Semantic compatibility

A finite unit registry constrains mass, length, volume, temperature, duration, storage, speed and ratios, alongside existing currency and identifier types. It does not infer arbitrary physical relationships from prose. Declared and inferred types remain unverified. US/imperial gallons, unknown currencies and ambiguous unit combinations do not become compatible just because both wire values are numbers.

Unchecked generic number/JSON goals cannot discard recognised quantity semantics. Existing explicit predicates may permit a projection, labelled only `checked`; independent witnesses are required by the recovery API. The plan retains the actual result type. Predicate success is not independent semantic certification. Two existing agreement-witness fixtures now explicitly request `quantity:ratio:percent`; their output, disagreement and persistence assertions are unchanged. This is an intentional compatibility tightening. Inference version 28 re-derives saved source semantics.

Automatic new physical conversions are unsupported: exact dimensions, currency, tax basis, rounding/precision and required inputs must first be established. Existing money conversions retain their explicit supported-currency and decimal-rounding rules. Dates, calendar versus elapsed durations, timezones, FX rate direction/date, tax basis, business identifier equivalence and arbitrary nested JSON semantics are **not generally established** by this work. Do not promote these classes without suitable specific checks. `SemanticEvidence` is an operator evidence reference, not authentication or attestation.

## Reproduce

Node 24+ with `node:sqlite` is needed for the development service; the executed local version is recorded in evidence. The package's broader Node minimum is unchanged.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npx tsc -p tsconfig.harness.json
npx tsc -p tsconfig.aspirin.json
node --test --test-concurrency=4 test/*.test.ts experiments/inheritance/guards.test.ts
npm run build
node experiments/aspirin/run.ts /tmp/rcx-aspirin-new-run.json
node proof/run.ts
node lab/report.ts 10
node experiments/open-world/negative-controls.ts
```

Use a fresh evidence filename. The exercise starts separate authenticated provider, read-only observer, fault controller and worker processes with temporary SQLite and FileStore state. Services remain local. Workers inherit only PATH, not ambient credentials. The fault controller removes REST and its docs and exposes a GraphQL mutation. There are no real payments. The service is a controlled protocol fixture, not a full production GraphQL server. No claim is made that separate processes constitute a security sandbox.

Original reproduction: archive `4b3d3e2`, copy the test-only reproduction from `fe60f25`, run `node --test test/semantic-continuity.test.ts`. Five original affected cases fail with the original incorrect values. The additional temperature control has no discoverable original contract and already refuses deterministically; the hybrid's historical temperature answer is not a reproduced model execution.

New source and evidence identities are in `evidence/source-identities.json` and `evidence/SHA256SUMS`. Failed development attempts are retained. Existing scripts write `latest` artifacts; this session copied new results separately and restored those historical files before committing.
