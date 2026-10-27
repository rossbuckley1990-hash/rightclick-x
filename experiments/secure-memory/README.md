# Portable goal fresh-process acceptance

`node --test experiments/secure-memory/portable-process.test.ts` uses three separate Node
processes and disposable, separate FileStore files. A synthetic creator learns a mock OpenAPI
producer and independent mock witness, publishes a witnessed ordinary goal, and explicitly
approves its portable projection. The artifact alone is given to two new runtimes, which each
independently learn the fixture's providers. One consumer's current policy denies the producer;
another imports the artifact, executes a different input and repeats the saved witness.

The provider's description contains a synthetic metadata canary; this particular description
must not appear in the exported goal artifact. Goal fields that are included in the artifact
are explicitly approved by the host; arbitrary metadata and values cannot be classified by
their bytes. The creator's pre-existing state, graph and legacy export may still retain untrusted
metadata. The saved goal's imported trust is not a transfer of the creator's authority or proof.

This is an ordinary non-confidential ability test; it does **not** supply protected credentials,
prove secret-free execution, establish safe secret recovery, or claim autonomous AI discovery.
The provider and witness are deterministic, author-controlled test doubles, not independent
external attestors. Each process is a model-free synthetic runtime actor.

## Bounded protected-header acceptance

`node --test test/protected-process.test.ts` exercises the protected header path through the
actual runtime using separate creator and consumer processes and distinct fixture credentials.
The creator process publishes a witnessed protected GET capability. Its state is inspected,
then its temporary workspace is removed; only the classified portable artifact is copied into
new consumer stores. A consumer whose resolver grant is denied cannot dispatch, and an execution
policy denial prevents resolution. An authorized consumer executes on another input using its
own credential and repeats the stored independent witness. The same consumer then revokes its
fixture grant; the next call must recheck the resolver and refuse before dispatch.

Additional controls check a provider echo, a low-entropy credential and directly guessable
digest candidates in the captured process output, runtime views, state files and artifacts.
Durable protected recovery without a backend must refuse before resolution. One intentionally
misbinding fixture host is supplied the creator's value to demonstrate that the mock provider
detects the wrong consumer credential; that negative control intentionally violates the host
contract. Another intentionally defective host ignores revocation and demonstrates a second
dispatch; a trusted host must enforce the grant itself. A separate control demonstrates guessing
a known unkeyed low-entropy digest.

These checks cover particular synthetic canaries and candidate hashes, not all possible
information channels or arbitrary secret encodings. The result is limited to the supported
single-header read-only HTTP GET, boolean-result path and the injected trusted host's stated
scope. The runtime cannot authenticate an arbitrary embedding host, prevent a compromised
resolver from returning the wrong value, guarantee revocation after dispatch, or isolate hostile
code in another process. Provider and witness are author-controlled mocks; the test does not
claim external independent attestation or autonomous AI discovery.
