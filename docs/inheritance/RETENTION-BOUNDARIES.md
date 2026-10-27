# Experimental retention restriction — not release ready

This patch narrows what execution data may be kept. It is intentionally
fail-closed and is not a complete credential-persistence solution.

- Saved goals and crystallized pipelines refuse opaque fixed inputs, literal
  witness values and literal result predicates; the invoker supplies values
  again. Only Boolean and null literals are allowed. This also refuses benign
  static options and data; a separately managed, authority-checked value vault
  and explicit public-value classification are not implemented.
- Durable workflow continuations refuse before dispatch, and retained legacy
  continuations refuse to load rather than being discarded. A state-changing
  HTTP request is refused before dispatch when automatic HTTP continuation is
  enabled and no secure value vault exists. Read-only HTTP 202 cursors are not
  retained or followed when a store is present. This disables previously
  supported recovery paths and is not a substitute for implementing them.
- Persisted identifier observations and ledger free-text errors are omitted.
  Existing state containing identifier observations refuses loading until a
  deliberate secure migration exists. Runtime evidence and errors can still
  exist in memory. Receipt input/output hashes may disclose low-entropy values
  through guessing and are not secret commitments.
- MCP audit records omit all argument and error text. MCP thrown-error replies
  omit details; selected error/agreement details in response envelopes are
  hidden. Authorized invocation output remains available to the caller, and
  raw SDK results, histories, provider metadata, other messages and traces have
  not been proved safe.
- Titles, names, witness paths, paths within agreement checks, schema content,
  provider metadata, input names and graph exports can hold arbitrary untrusted
  text. `experiments/inheritance-offline/metadata-secret-repro.ts` preserves an
  opaque fixture canary proving metadata currently reaches stored state, the
  graph and knowledge exports; it exits 1. There is no trustworthy shared-artifact boundary until
  operator-controlled classification or another correct mechanism exists.
- Existing saved states, test fixtures and users relying on opaque fixed inputs
  or workflow recovery are incompatible with this prototype. A representative
  46-test legacy run had 32 failures, chiefly from these deliberate refusals.
  Do not claim this patch passes the legacy suite or is ready to merge.

Run `node --test test/retention-policy.test.ts` and
`node experiments/inheritance-offline/metadata-secret-repro.ts`; the latter is
expected to fail until unclassified metadata is addressed. No model calls are
required. The test-only values are synthetic.
