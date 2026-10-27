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
