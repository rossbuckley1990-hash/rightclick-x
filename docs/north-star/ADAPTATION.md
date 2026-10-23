# Capability adaptation: what happens when software changes

RightClick X separates the six cases the brief names. Each is decided by evidence, not by names or ids.

| Case | How it is told apart | What happens | Evidence |
|---|---|---|---|
| **Same capability, compatible interface change** (web API moved, renamed, nested, protocol changed) | The contract is re-read, and the operation's identity is unchanged: method plus path with version segments removed, or the GraphQL field, or the MCP tool | Re-plans and runs; drift reported | `test/run-drift.test.ts` (moved operation), lab drift, OW8 on `main`, UCE Stage D (renamed option, changed input channel, nested output) |
| **Same capability, different implementation** (another file, a wrapper, another installation) | **Behaviour fingerprint**: the outputs on the investigator's fixed synthetic inputs are byte-identical | Re-investigated, accepted, run | Benchmark change phase (compatible shim); signature demo (macOS and Linux); import of knowledge that revalidates (Linux → Linux, expand Mac → Linux) |
| **Different capability with a similar name** (same id or flag, different behaviour) | Different behaviour fingerprint, or a different web operation behind the same id | **Refused**, naming the successor if one exists; the caller must acknowledge to run the new operation | B6 (`north-star-security.test.ts`); `run-drift.test.ts:89` (the historical OLS reassignment of an operationId from classes to individuals); incompatible shim in the benchmark and demo; knowledge import from macOS refused for `sum`, `base64`, `od`, `exiftool` on Debian |
| **Temporarily unavailable** | The program or API fails, and the contract or file is still there | Run fails; nothing withdrawn; no state-changing call re-sent | UCE Stage D ("exit 75"); `security-boundaries.test.ts` (no re-send) |
| **Permanently removed** | Program file gone, or contract gone | **Withdrawn**: capabilities removed, goals built on them fail with "not installed" | UCE Stage E; benchmark removal step; demo |
| **Insufficient evidence to decide** | Investigation sees nothing it can support, or a plan cannot be established | Not established: `unverified` / `incomplete` / `unavailable` / `violated`, and nothing runs | Semantic suite S5–S8; N1 control; `unsupported` tag |

## Re-validation on change

When a program's bytes change, RightClick X re-checks what is needed, every time:

- **Identity:** SHA-256, real path, inode; the hash pin produces "program changed since it was investigated".
- **Inputs:** a fresh investigation.
- **Outputs and semantic assumptions:** behaviour fingerprint and stored conformance examples.
- **Authority:** the operator's execute authority, on every run.
- **Sandbox:** probed at start.
- **Verification requirements:** stored predicates and witnesses re-run with saved goals.

## Two limits

- **A compatible change that alters output bytes is refused.** Examples: a version banner, or spacing. Compatibility is established only by identical behaviour on the probes, so for such programs this is conservative by design. The UCE `tab2space` case and GNU vs BSD `sum` show the cost: correct but different behaviour is not adopted without a human decision.
- **Uncertain state-changing operations are never re-executed.** A call that may have taken effect is not re-sent unless the operator declares the operation side-effect-free, or the error proves it was not applied.
