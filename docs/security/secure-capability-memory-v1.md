# Capability memory: security boundary and current limitations

Status: **development work; no independent human security review or production approval**.
This document distinguishes tested behavior from a desired boundary. It does not assert that
the pre-existing state format, knowledge export, or runtime is confidential.

## Trust model

The embedding host authenticates each invoking principal and configures its authority and
credential resolver. Agent input and provider-controlled contracts, metadata, descriptions,
responses and errors are untrusted. A capability or a protected-value slot describes what is
needed; it is never a grant to retrieve the creator's credentials or execute as the creator.
A resolver must bind the current host-authenticated principal, operation and scope at use time,
and refuse revoked or missing grants. A caller-controlled principal name is not authentication.

Only host-approved data classifications can make a field portable. A value whose name looks
ordinary can still be confidential, and no pattern matcher can identify every protected value.
Provider titles, descriptions, examples, paths, nested objects and errors can carry arbitrary
data. A host that explicitly declassifies a value is responsible for that decision. A portable
artifact must not contain bearer handles or implicitly supply a credential binding.

## Reproduced legacy risks

At main `278d66c`, synthetic controls show that arbitrary provider metadata can appear in a
runtime graph, saved snapshot and legacy knowledge export. An opaque fixed input can also be
retained. The legacy receipt chain hashes raw input/output and the legacy origin credential
fingerprint uses an unkeyed truncated SHA-256 hash; a short secret can be guessed offline.
Run `node experiments/secure-memory/low-entropy-negative-control.ts` to reproduce the latter
two cases with synthetic values. Exit 1 indicates the unsafe legacy behavior was observed; it is
an intentional negative control, not a passing security test. A digest is not encryption or a
confidentiality guarantee.

The existing snapshot may contain published goals, reflections, checkpoints, receipts, ledger
entries, activity and identity observations. The old knowledge export omits some fields but is
not a secret-free artifact. Snapshot backups, old versions, repository history and any already
exported copies may retain values after software changes. Do not silently destroy them or treat
them as classified. Operators must inventory and quarantine old snapshots without printing
suspected values, assess backups and exports, and rotate credentials where exposure is possible.

## Required execution and recovery boundary

Protected values should be resolved only after the current invoker is authenticated and
authorized for the exact operation and scope, immediately before dispatch. Secrets necessarily
exist in the trusted process during use; malicious code in that process, unsafe external
providers and hostile host isolation are outside a serialization guarantee. A provider may
echo secrets in outputs or errors, including under innocent names or encodings. Therefore a
protected path must structurally restrict all persisted and exported observations, including
receipts and digests; a regex or a single redacted field is not sufficient.

Without an explicitly configured protected checkpoint backend, durable protected recovery
must fail before consequential dispatch. If an external effect has already been dispatched and
its outcome is uncertain, record the uncertainty without plaintext and do not blindly replay.
Revocation can prevent later resolution or dispatch; it cannot cancel effects already accepted
by a provider. FileStore leases coordinate current cooperating local processes in a trusted
directory, not old or noncooperating processes, network filesystems or distributed systems.

This work does not establish hostile-code isolation, noncooperating-writer exclusion,
exactly-once external effects, or protection for legacy snapshots. R1, R2, independent human
security review and autonomous agent validation remain separate release gates.

## Bounded development slice

The host-only `exportPortableGoal` and `importPortableGoal` methods use
`rightclick-x/portable-goal@1`. They copy an explicitly approved goal definition, not provider
reflections or runtime receipts. A host must approve the complete definition and list each fixed
input it classifies as portable; approving a secret or sensitive title is still an operator error.
Imports do not transfer trust, create a fresh local revision, require a coordinated writable
store, and revalidate saved witness contracts against the receiver's available graph. The source
revision remains in the artifact; imported state does not currently retain provenance of it.
Legacy `exportKnowledge` is a different, non-confidential interface.

The protected execution slice supports only a single HTTP GET with one
`Authorization` or `X-Api-Key` header supplied through a versioned symbolic slot. The
embedding host supplies a per-runtime authenticated principal and a `ProtectedValueHost`
adapter. The adapter is trusted to authorize the principal, capability contract, origin,
header and scope, and to hold its revocation boundary through the supplied callback. The
runtime cannot verify that a dishonest or incorrectly implemented host actually does so.
Only an explicitly host-approved boolean may leave this boundary, which intentionally
declassifies one bit. It excludes ambient credentials and refuses redirects, 202 continuations,
protected durable recovery and automatic replay; this does not assert that GET is side-effect free.
Provider errors and non-boolean results are returned as a generic failure. Symbolic slots and
the approved boolean, not the resolved header value, enter the ordinary records for this path.

Protected goals declare `protected-value-slots@1` in persistent state. New readers refuse
missing or malformed markers, and a separate old-runtime control demonstrates that the
pre-feature reader refuses this requirement before dispatch. The format is not an encrypted
vault or migration of old data. Portable goal strings, literal checks, slots and fixed values
remain explicitly host-classified, and their accidental or malicious declassification is out of
scope. Secrets supplied through unrelated inputs, legacy endpoints, arbitrary metadata,
encoded provider output, host logs, process memory, or a malicious provider are not covered
by this bounded claim. Protected recovery with an approved checkpoint backend is not implemented.

The model-free tests exercise separate creator and consumer processes with distinct synthetic
principals and credentials, denial, revocation and a repeated independent fixture witness.
They do not authenticate an actual user, establish a hardware/process boundary, demonstrate
autonomous agent reasoning, or independently certify any provider or host adapter.
