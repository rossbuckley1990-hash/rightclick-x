# Changelog

All notable changes. Dates are UTC.

## Unreleased: North Star programme (`programme/rightclick-x-north-star`)

### Security

- **Redirects.** A caller's headers of any name stay on their origin. A chain that leaves the origin is tainted (A → B → A gets nothing back). Request bodies are never re-sent across origins.
- **Executable authorisation** uses canonical paths and real paths; `..` is refused. A link is authorised by naming it. Programs writable by other users are refused. The executed file's identity is confirmed after each run.
- **Sandbox:**
  - CPU, memory, process-count, file-size and open-file limits;
  - the whole process group is terminated;
  - the limit that stopped a run is reported;
  - a sandbox that cannot start is reported as unavailable.
- **Permissions:** separate execute (`RCX_EXECUTE`) and evidence-sharing (`RCX_SHARE_EVIDENCE`) authorities.
- **Secrets:** credentials are redacted from the MCP audit log and from persisted errors, and cannot be fixed into published goals.
- **Breaking:** a directory authority no longer extends through symlinks to programs elsewhere. Unannotated MCP tools are destructive (MCP specification defaults). Writing goals answer GET with 405.

### Correctness

- **Outcome contracts.** Every step of a plan must be justified by the request (lineage), including the steps inside saved pipelines. A result that loses content its plan was expected to keep fails.
- **Assurance labels:**
  - `verified` means an independent witness passed;
  - `checked` means stored predicates passed (previously reported as `verified`);
  - `unverified` means no check passed.

### Capability learning

- Documented options with arguments, literal operands and multi-line manual-page descriptions are learned.
- A documented-options interface (`<program>:invoke`) validates options before running.
- Every capability card states its contract: status, environment, evidence, preconditions, invalidation conditions and conformance examples.
- A program capability's identity is its observed behaviour, so a changed program with different behaviour is refused as a different operation.
- Portable capability knowledge: export (with operator authority) and import, which revalidates every capability on the receiving host.

### Developer experience

- New commands: `rcx doctor`, `rcx investigate`, `rcx capabilities`, `rcx knowledge export|import`, `rcx uninstall`, and `rcx connect --authorise`.
- New agent sessions are told which goals are retained and which programs are authorised.

### Engineering

- CI workflow: macOS, Linux with bubblewrap, Linux without a sandbox, package smoke test, dependency review, link check.
- The edge bundle shrinks from 1.23 MB to 0.33 MB.
- Benchmark corrections recorded in `experiments/STRESS.md`.

## 0.1.0

Initial public version.
