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
