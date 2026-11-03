# Evaluation freeze and separate-evaluator protocol

The original 50 scenarios, services, reports, runner and scorer remain byte-for-byte unchanged. They are development fixtures. They are not independent held-out material. Original scorer output must not be presented as a new product score. The replacement boundary is `experiments/aspirin/evaluate.ts`.

## Corrections

- An arm receives only public invocation input. Expected outputs, other arms' scores, evaluator decisions and private observations never enter its input. In particular, Arm E must use the public `RecoveringWorkflow`, never branch on the scorer's verdict for D.
- An explicit completed claim contradicted by observation is false success for **any** value, not a hardcoded list of bad numbers. Unknown observations remain unresolved. Structured refusals count only when refusal is required and the observer establishes no effect. Exceptions and subprocess failures are harness failures, not correct refusals. Prose is never guessed into a business answer.
- Every arm starts from evaluator-reset service state. Reset and observation failures are separate. Endpoint response acceptance does not establish the intended database effect. Duplicate and uncertain effects are recorded. Checks are never supplied by the arm.
- All reported model turns are aggregated. Missing usage is null, never zero. Cached input is a subset of input, not an extra token charge. Reasoning tokens, where reported, are a subset of output; do not add them twice. Actual pricing must be frozen by model, service tier, date and currency.
- Local subprocess elapsed time and I/O bytes are measured. Reported internal MCP/model metrics retain their adapter-reported label until transport evidence corroborates them. Monetary cost remains null if usage or price is missing. An opaque adapter claiming zero tokens is not independent evidence of zero customer cost.

The local runner takes a JSON manifest containing `classification: "development"`, a 40-character `sourceCommit`, evaluator name, exactly five operator-owned `arms` (A–E, each `argv` and `timeoutMs`), and `cases` (`id`, `publicInput`, `reset`, `observe`). Reset emits `{ready:true}`; an arm emits `{claim:{status,output},metrics?}`; the observer emits `{outcome,refusalRequired,effect,duplicates,evidenceHash}`. Status is `completed|refused|unresolved|ambiguous`. Outcome is `correct|incorrect|unknown`; effect is `confirmed|absent|uncertain`. The witness digest is an evidence reference, not cryptographic attestation of truth. Commands run with PATH only; model access must be provisioned explicitly by the evaluator. Outputs are hashes and byte counts by default. The output file is created exclusively, refusing overwrites.

```sh
node experiments/aspirin/evaluate.ts evaluator-manifest.json fresh-results.json
```

The runner regression actually launches all five subprocess arms and proves that process failure does not become refusal and that only public input is delivered. Those tiny commands test the runner, not product performance. No new five-arm business leaderboard is claimed.

## Required external evaluation

1. Freeze the engineering branch's immutable commit, package lock, commands, model versions, budgets, prices and machine images. Verify checksums. Engineering stops changing acceptance logic at freeze.
2. A separate evaluator authors and seals cases and independent service observers after engineering freeze. Keep private cases/oracles outside the engineering and agent execution environments. The local runner explicitly refuses to certify `independently-sealed`; a shared filesystem does not enforce secrecy.
3. Pre-register supported change classes, refusal requirements, end-to-end budget (including deterministic attempts), safe effect handling, human intervention definitions, success thresholds and stopping conditions. Use the same public business requirement, credentials/scopes, service reset and time/cost budget across arms.
4. A is a maintained static integration; B is representative deterministic generation/integration tooling with current contracts; C is Codex alone; D is RightClick X alone; E is the public bounded hybrid. A/B must be realistic maintained implementations, not hardcoded first-path scripts. Select tooling independently, not to manufacture weak baselines.
5. Freeze the independent business oracle. Do not expose it, expected values or scores to an agent. Test multi-step stateful effects, misleading schemas, semantic ambiguity, outages, response loss, idempotency conflicts, concurrency, revocation, storage failure and stale witness contracts.
6. Repeat each recovered operation after cold worker and fresh agent sessions. Give the fresh agent the same public invocation surface and original operator contract only. Test new identities and values, not just replaying the demonstration input. Record discovery, fallback and revalidation costs separately.
7. Instrument the entire client/model boundary: descriptions/schema bytes and exact tokenizer counts; every tool response; full context submitted per model turn; validated provider input, cached input, output and reasoning details; retries; process exit/timeout; wall latency; model/service charges; duplicate/uncertain effects; repair persistence; human setup, investigation and maintenance minutes. Hash sensitive bodies, never publish credentials or customer transcripts. No undisclosed conversation inheritance.
8. Publish every case, refusal, false success, unresolved case and harness failure with denominators and uncertainty. Keep original failures and reruns linked. Independent evaluator attacks must precede a customer reliability claim.

Remaining blockers: independent evaluator and sealed cases, provisioned model access and reviewed price schedule, representative A/B implementations, and customer intervention-time observations. No internally written fixture can substitute for these.
