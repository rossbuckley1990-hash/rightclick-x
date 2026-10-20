"""Read-only raw evidence checker; no imports from the experiment/runtime.

Separate implementation/process by the same author, not independent review.
Native public-key verification is performed separately by observe.py.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
read = lambda name: json.loads((root / name).read_text())
lines = lambda name: [json.loads(line) for line in (root / name).read_text().splitlines()]
expected = [{"label": "approved", "path": "/entries"}, {"label": "race", "path": "/entries"}]
assert lines("provider.jsonl") == expected, "provider journal does not show exactly the two prescribed effects"
public = lines("public-discovery.jsonl")
assert public and all(r["grantCount"] == 0 and r["request"]["method"] == "GET" and r["request"]["url"].endswith("/openapi.json") for r in public)
discovered = next(r for r in lines("client-discover.jsonl") if r.get("op") == "report")
retained = next(r for r in lines("client-retained.jsonl") if r.get("op") == "report")
assert discovered["results"]["run"]["status"] == "failed"
assert retained["results"]["run"]["status"] == "completed"
assert not any(r.get("request", {}).get("url", "").endswith("/openapi.json") for r in lines("client-retained.jsonl"))
race = [read(f"workers/race-{i}/result.json") for i in range(6)]
ready = [read(f"workers/race-{i}/ready.json") for i in range(6)]
assert len({r["pid"] for r in ready}) == 6 and all(r["ready"] for r in ready)
assert all(r["pid"] == started["pid"] for r, started in zip(race, ready))
assert sum(r["dispatches"] for r in race) == 1
assert sum(r["reason"] == "DUPLICATE_REPLAY" for r in race) == 5
winner = next(r for r in race if r["dispatches"] == 1)
assert winner["ok"] and winner["reason"] == "OUTCOME_UNKNOWN" and winner["finality"] == "AMBIGUOUS"
# A transport acknowledgement is intentionally not promoted to verified finality.
assert read("workers/restart-0/result.json")["reason"] == "DUPLICATE_REPLAY"
assert read("workers/restart-0/result.json")["dispatches"] == 0
assert not read("second-principal.json")["issued"]
assert read("second-principal.json")["reason"] == "effect already reserved, committed, or unresolved"
assert read("workers/ancestor-0/result.json")["reason"] == "AUTHORITY_REVOKED"
expired = read("workers/expired-0/result.json")
assert expired["reason"] in {"PROOF_EXPIRED", "AUTHORITY_REVOKED"} and expired["dispatches"] == 0
for name, reason in [("revocation-outage", "AUTHORITY_REVOKED"), ("replay-outage", "REPLAY_STORE_UNAVAILABLE"), ("effect-outage", "POLICY_REFUSAL")]:
    r = read(f"workers/{name}-0/result.json")
    assert not r["ok"] and r["dispatches"] == 0 and r["reason"] == reason and r["fault_calls"] == [name]
    assert "PRIVATE_FAULT_MARKER" not in (root / f"workers/{name}-0/edge.jsonl").read_text()
edges = lines("edge.jsonl")
dispatched = [row for row in edges if row["outcome"]["reason_code"] == "OUTCOME_UNKNOWN"]
assert len(edges) == 13 and len(dispatched) == 2
assert sorted(json.loads(base64.b64decode(row["intent"]["action"]["parameters"]["body"]))["label"] for row in dispatched) == ["approved", "race"]
for phase in ["discover", "retained"]:
    container = read(f"container-{phase}.json")
    assert container["host"]["NetworkMode"] == "none" and container["host"]["ReadonlyRootfs"]
    assert container["user"] == "10000:10000" and len(container["mounts"]) == 1 and not container["mounts"][0]["RW"]
provenance = read("provenance.json")
for name, sha in provenance["sources"].items():
    assert hashlib.sha256((root / "sources" / name).read_bytes()).hexdigest() == sha
observer = read("observer.stdout.log")
assert observer["effects"] == expected and observer["verified_attestations"] == {"receipt": 13, "refusal": 13}
assert observer["tampered_attestations_refused"] == 26
print(json.dumps({"rawEvidenceChecked": True, "effects": 2, "competingProcesses": 6,
                  "nativeFinalityAfterDispatch": "AMBIGUOUS", "sourceSnapshotsChecked": len(provenance["sources"]),
                  "scope": "separate implementation by same author; public-key signature check in observer output"}))
