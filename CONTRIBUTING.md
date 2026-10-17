# Contributing to RightClick X

Thank you for helping. RightClick X makes strong claims about safety and correctness, so contributions are judged by evidence.

## Set up

```bash
git clone https://github.com/rossbuckley1990-hash/rightclick-x && cd rightclick-x
npm ci
npm run check          # type check + full test suite
node bin/rcx.ts doctor # what this host supports (sandbox, state, authority)
```

You need Node ≥ 22.18. RightClick X has no runtime dependencies. The local-program features need a sandbox:

- **macOS:** `sandbox-exec`.
- **Linux:** bubblewrap with user namespaces.

Without a sandbox those features report "unavailable", and everything else works.

## The rules contributions are held to

1. **General mechanisms, not cases.** A fix for one program, API or task is not accepted. Name the class of failure, fix the class, and add a test with a synthetic fixture. Real programs that may later be drawn for a holdout must not be used to develop against.
2. **Security boundaries are enforced outside the model.** Nothing an agent, a provider description or a program's help text says may change authority, trust or execution.
3. **Labels mean what they say.**
   - `verified` needs an independent witness;
   - `checked` means stored predicates passed;
   - anything else is `unverified`.
   - A completed run is not a correct outcome.
4. **No weakened tests.** A test changes only when the behaviour it encodes becomes stricter or more correct, and the commit says why.
5. **Evidence is preserved.** Failed experiment runs stay in `docs/north-star/evidence/` and `experiments/*/evidence/`. Evaluation criteria are fixed before results are seen ([EVALUATION-PLAN.md](docs/north-star/EVALUATION-PLAN.md)).
6. **No new AI-facing tools.** The thirteen `context_*` tools are the stable interface. Extend what is behind them.

## Before you open a pull request

```bash
npm run check
npx tsc -p tsconfig.harness.json         # benchmark harness
node proof/run.ts                        # lifecycle proof (28 checks)
node ci/check-links.ts                   # documentation links
docker build -f ci/linux.Dockerfile -t rcx-linux . && docker run --rm --privileged rcx-linux   # Linux sandbox
```

## Reporting security issues

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
