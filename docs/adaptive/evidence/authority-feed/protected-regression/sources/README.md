# Reproduce the feasibility audit

The latest [ordinary composition recovery evidence](../../docs/adaptive/COMPOSE-RESUME.md) uses `workflow.py` and `check-workflow.py` with the same audited Actenon stack. The client now enters through `context_compose`; 30 controls cover exact remaining effects and deferred local goal retention. Older 28-control results remain bound to their source freezes. No production compatibility or economic advantage is claimed.

This is a source audit, not a released integration or a live model benchmark.
Use a disposable directory and Python 3.12. Install no production credentials.

For the preregistered deterministic equal-control comparison, after the same
pinned environment and cached Docker image setup below:

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/compare-reuse.py \
  --output /absolute/new-comparison-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-reuse-comparison.py \
  /absolute/new-comparison-evidence
```

This compares 20 fresh-process warm pairs against a saved script under the same
resource-owned Actenon boundary. It uses no models and does not measure authored
integration work or software-change maintenance. The first result favored the
script on warm runtime cost; see the [result](../../docs/north-star/evidence/ACTENON-EQUAL-CONTROL-RESULT.md).
Clone the five Actenon repositories beneath an audit root, then detach each at
its exact commit in `docs/north-star/evidence/actenon-source-audit.json`.
No repository source is modified by the audit.

```sh
uv venv --python python3.12 /absolute/audit-root/.venv
uv pip install --python /absolute/audit-root/.venv/bin/python \
  -r docs/north-star/evidence/actenon/audit-requirements.txt
uv pip install --python /absolute/audit-root/.venv/bin/python --no-deps \
  -e /absolute/audit-root/actenon-protocol \
  -e /absolute/audit-root/actenon-kernel \
  -e /absolute/audit-root/actenon-permit \
  -e /absolute/audit-root/actenon-scan \
  -e /absolute/audit-root/actenon-airlock
python3 experiments/actenon/audit.py /absolute/audit-root kernel
python3 experiments/actenon/audit.py /absolute/audit-root permit
python3 experiments/actenon/audit.py /absolute/audit-root protocol
python3 experiments/actenon/audit.py /absolute/audit-root scan
python3 experiments/actenon/audit.py /absolute/audit-root airlock
/absolute/audit-root/.venv/bin/python experiments/actenon/measure-verifier.py \
  /absolute/audit-root/actenon-kernel
```

The explicit `--no-deps` source step is deliberate: the audited heads are tested
together. Airlock's metadata otherwise fetches its older pinned Git dependencies.
This does not prove compatibility of that different dependency combination.
Tests use fresh child homes and an explicit environment without inherited
provider/model keys. Local loopback access is required; the macOS host sandbox
may need a host-authorised test process. No live model is invoked.

The suite writes timestamped logs, JUnit and command records into the existing
North Star evidence directory; it refuses to overwrite a log. Kernel/Scan have
known skips. Protocol's standalone `conformance/runner.py --json` covers all
161 locked vectors separately from its parametrized pytest cases.

Do not enable the original Airlock container test in this programme: its
network-denial workload includes a remote Git push attempt, which the user has
prohibited. A separately scoped local-only probe is planned. Neither its skip
nor local Docker availability is a containment pass.

The unmodified upstream verifier benchmark fails because it sets development
intent to `benchmark`. The measurement wrapper retains the benchmark functions
and sets explicit `test` intent after import. It measures pure verification
only, excluding stateful enforcement, network, inference and RightClick X.

## Run the bounded integration experiment

After the pinned source installation above, with Bun and a local Linux Docker
engine, provide an already-present trusted image containing Node >=22.18 and
`/bin/sh`. The recorded run used `rightclick-x-linux-test:latest`, whose image ID
is pinned in each result. `ci/linux.Dockerfile` describes how that test image was
built. The experiment never pulls images or installs dependencies automatically.
Docker Desktop's `host.docker.internal` is required for the read-only network
positive control. This is a development environment, not a simple release install.

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/containment.py \
  --image rightclick-x-linux-test:latest \
  --output /absolute/new-evidence-directory
```

The output directory must not exist. The runner refuses source revision drift,
records source snapshots and exact image identity, and preserves failures. It
starts a disposable loopback provider, runs three no-network containers, checks
provider state with a separate process, verifies signed receipts/refusals, and
cleans up its own containers and temporary private keys. No model, real provider,
remote Git operation or spending occurs. Inspect `result.json`, the raw bridge
and edge journals, observer output, container configuration and reconciliation.
Do not share private material from a separately configured real broker.

This experiment does not install an Actenon dependency into RightClick X. Its
generic fetch bridge and trusted fixture boundary remain under `experiments/`.
The [experiment assessment](../../docs/north-star/evidence/ACTENON-INTEGRATION-EXPERIMENT.md)
records the narrower scope and unpassed preregistered cases.

## Reproduce retained-capability lifecycle checks

Use the same pinned environment and a new output directory:

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/lifecycle.py \
  --image rightclick-x-linux-test:latest \
  --output /absolute/new-lifecycle-evidence-directory
```

The suite discovers ordinary OpenAPI surfaces, publishes a verified append-and-
fingerprint workflow, reuses it in fresh Node processes, exercises generated and
federated entry points, changes/removes/returns the provider, and checks actual
effects through a separate observer. The fixture's operator bounds are fixed
independently of discovery; only an explicit host transition approves the moved
target and installs a new grant. This uses no live models or remote resources.
See [results and limits](../../docs/north-star/evidence/ACTENON-LIFECYCLE-RESULT.md).

## Reproduce no-grant discovery and concurrent worker checks

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workers.py \
  --output /absolute/new-worker-evidence-directory
python3 experiments/actenon/check-workers.py /absolute/new-worker-evidence-directory
/absolute/audit-root/.venv/bin/python experiments/actenon/observe.py \
  /absolute/new-worker-evidence-directory
```

The same pinned environment is required. Two isolated Node processes test public
discovery without grants and later retained execution. Six trusted Python edge
processes race one proof using shared native stores; additional fresh workers test
replay, ancestor revocation, real expiry and claim-time store faults. Their
disposable grant-verification secret remains outside the agent containers.
See [results, preserved failure and trust limits](../../docs/north-star/evidence/ACTENON-WORKERS-RESULT.md).

## Reproduce the resource-owned boundary

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/resource-experiment.py \
  --output /absolute/new-resource-evidence-directory
/absolute/audit-root/.venv/bin/python experiments/actenon/check-resource.py \
  /absolute/new-resource-evidence-directory
```

This fixture uses macOS `/usr/sbin/lsof` and Docker Desktop host networking, in
addition to the pinned Python/Bun/cached-image environment above. Its resource
service owns the only business write and verifies native proofs itself. A private
Unix socket accesses native authority operations without supplying the issuer's
private keys to the resource. Host processes are trusted and run as one user;
this is not isolation against a compromised host service. Network-enabled probes
test direct HTTP, shell and socket routes against the actual protected service.
See [results and limitations](../../docs/north-star/evidence/ACTENON-RESOURCE-RESULT.md).


## Reproduce protected asynchronous continuation

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/protected-async.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-protected-async-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-protected-async.py \
  /absolute/new-protected-async-evidence
```

Uses the same macOS/Docker prerequisites and exact audited source pins. The
controlled service compresses actual document bytes in a background process.
Catalog discovery, 202/303 continuation, saved-goal new-input reuse and generated
REST execution use the ordinary runtime. The resource independently checks native
exact proofs on writes and follow-up reads. The checker reads compressed files,
request logs and native signed artifacts without importing RightClick or the
harness. It is a separate implementation by the same author, not an independent
holdout. See [results, failures, measurements and limits](../../docs/adaptive/PROTECTED-ASYNC.md).


## Reproduce protected HTTP restart recovery

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/resume.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-http-resume-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-resume.py \
  /absolute/new-http-resume-evidence
```

This uses the same pinned local environment and protected resource. Fresh Node
containers restore a pending HTTP leaf, refuse under revoked authority and
complete only after new operator authority. It is distinct from native ambiguous
effect reconciliation and from continuing a whole workflow. The real SIGKILL
and FileStore test is `node --test test/http-resume-process.test.ts`.
See [results, preserved failures and exact scope](../../docs/adaptive/HTTP-RESUME.md).


## Reproduce protected remaining workflow effects

```sh
/absolute/audit-root/.venv/bin/python experiments/actenon/workflow.py \
  --image sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  --output /absolute/new-protected-workflow-evidence
/absolute/audit-root/.venv/bin/python experiments/actenon/check-workflow.py \
  /absolute/new-protected-workflow-evidence
```

The ordinary planner selects a compression/publication route; the test client
materializes it as a retained composite through the SDK. Fresh isolated clients
exercise current authority on the remaining publication, including revocation
between steps. A separate native proof control creates one additional publication;
it is not counted as recovered workflow success. See the [source-bound report,
bypass coverage and limitations](../../docs/adaptive/PROTECTED-WORKFLOW.md).
