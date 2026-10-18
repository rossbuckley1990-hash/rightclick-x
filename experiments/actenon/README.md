# Reproduce the feasibility audit

This is a source audit, not a released integration or a live model benchmark.
Use a disposable directory and Python 3.12. Install no production credentials.
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
