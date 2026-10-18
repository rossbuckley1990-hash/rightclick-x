"""Independent raw measurement path, same author. Native Actenon verification; no experiment/RCX imports."""
import base64
import hashlib
import json
from pathlib import Path
import random
import statistics
import sys

from actenon.models import PCCB, PartyRef
from actenon.proof.canonical import canonicalize_bytes
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier

root = Path(sys.argv[1])
read = lambda name: json.loads((root / name).read_text())
lines = lambda name: [json.loads(line) for line in (root / name).read_text().splitlines()]
design, records, result = read("design.json"), read("measurements.json"), read("result.json")
rng = random.Random(472901)
assert design["order"] == [rng.sample(["C", "D"], 2) for _ in range(21)] and design["warmPairs"] == 20
assert len(records) == 48 and len({r["phase"] for r in records}) == 48
measured = [r for r in records if r["pair"] is not None]
assert [(r["pair"], r["arm"], r["label"]) for r in measured] == [(i, arm, f"{arm}{i:02}") for i, order in enumerate(design["order"]) for arm in order]
assert len(measured) == 42
journal_bytes = (root / "provider.jsonl").read_bytes().splitlines(keepends=True)
journal = [json.loads(line) for line in journal_bytes]
assert [r["label"] for r in journal] == [r["label"] for r in measured]
assert len({r["proof"] for r in journal}) == 42
edges = lines("edge.jsonl")
assert len(edges) == 42 and all(r["outcome"]["ok"] for r in edges)
by_proof = {r["proof"]["pccb_id"]: r for r in edges}
verifier = Ed25519PublicKeyVerifier([read("issuer-public.json")])
states = {r["reference"]["effect_id"]: r for r in read("committed-effects.json")}
assert len(states) == 42
grant_ids = set()
for i, row in enumerate(journal):
    edge = by_proof[row["proof"]]
    proof = PCCB.from_dict(edge["proof"])
    assert verifier.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
    grant_ids.add(proof.extensions["authority"]["grant_id"])
    params = edge["intent"]["action"]["parameters"]
    assert params["method"] == "POST" and json.loads(base64.b64decode(params["body"])) == {"label": row["label"]}
    assert edge["intent"]["target"]["resource_id"].endswith("/entries") and row["path"] == "/entries"
    evidence = edge["outcome"]["receipt"]["extensions"]["effect"]
    digest = hashlib.sha256(b"".join(journal_bytes[:i+1])).hexdigest()
    assert evidence["outcome"] == "COMMITTED" and evidence["execution_occurred"] is True and evidence["evidence_hash"] == digest
    settled = states[evidence["effect_id"]]
    assert settled["state"] == "COMMITTED" and settled["evidence"]["evidence_hash"] == digest
assert len(grant_ids) == 1

receipt_verifier = Ed25519PublicKeyVerifier([read("public.json")])
attester = OutcomeAttestationService(signer=receipt_verifier, issuer=PartyRef(type="service", id="checker"))
attestations = lines("attestations.jsonl")
assert len(attestations) == 42
for signed in attestations:
    attester.verify_receipt_attestation(signed, verifier=receipt_verifier)
    signed["unsigned_payload"]["outcome_artifact"]["summary"] = "altered by checker"
    try: attester.verify_receipt_attestation(signed, verifier=receipt_verifier)
    except Exception: pass
    else: raise AssertionError("modified receipt accepted")

observations = lines("witness.jsonl")
assert len(observations) == 42
assert [o["labels"][0] for o in observations] == [r["label"] for r in measured]
assert all(o["response"]["present"] is True for o in observations)
timings = lines("broker-timings.jsonl")
summary = {}
for record in records:
    arm, phase, value = record["arm"], record["phase"], record["result"]
    events = lines(f"issuer/client-{phase}.jsonl")
    assert next(e for e in events if e.get("op") == "report")["results"] == value
    wire_events = [e["request"] for e in events if e.get("op") == "fetch"]
    assert wire_events == value["requests"]
    host_events = [r for r in timings if r["phase"] == phase]
    # Concurrent cold reads can complete in the opposite order, so compare their request multiset.
    assert sorted(json.dumps(e, sort_keys=True) for e in wire_events) == sorted(json.dumps(e["wire"], sort_keys=True) for e in host_events)
    contracts = sum(e["url"].endswith("/openapi.json") for e in wire_events)
    assert contracts == (2 if record["pair"] == 0 else 0)
    assert record["containerLifecycleMs"] > 0 and value["clientMs"] > 0 and value["stateBytes"] > 0
    container = read(f"issuer/container-{phase}.json")
    host = container["host"]
    assert container["image"] == read("provenance.json")["image"]
    assert host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and host["CapDrop"] == ["ALL"] and not host["Privileged"]
    assert container["user"] == "10000:10000" and "no-new-privileges" in host["SecurityOpt"]
    assert len(container["mounts"]) == 1 and not container["mounts"][0]["RW"] and container["mounts"][0]["Source"].endswith(f"/{arm}/stage")
    if record["expectedSuccess"]:
        assert value["status"] == "completed" and value["label"] == record["label"]
        assert value["digest"] == hashlib.sha256(record["label"].encode()).hexdigest() and value["independentlyObserved"] is True
        assert len(wire_events) == (4 if record["pair"] == 0 else 2) and all(e["ok"] for e in host_events)
    else:
        assert value["status"] == "failed" and len(wire_events) == 1 and not host_events[0]["ok"]
assert {r["phase"] for r in records if not r["expectedSuccess"]} == {a+"-"+p for a in ("C", "D") for p in ("duplicate", "out-of-bounds", "revoked")}
assert [e["phase"] for e in lines("operator-transitions.jsonl")] == ["authorize", "revoke"]

for arm in ("C", "D"):
    warm = [r for r in measured if r["arm"] == arm and r["pair"] > 0]
    assert len(warm) == 20
    client = statistics.median(r["result"]["clientMs"] for r in warm)
    total = statistics.median(r["containerLifecycleMs"] for r in warm)
    assert result["summary"][arm]["warmClientMs"]["median"] == client
    assert result["summary"][arm]["warmContainerLifecycleMs"]["median"] == total
    broker_ms = [sum(e["elapsedNs"] for e in timings if e["phase"] == r["phase"]) / 1e6 for r in warm]
    summary[arm] = {"warmClientMedianMs": client, "warmContainerMedianMs": total, "warmBrokerMedianMs": statistics.median(broker_ms),
                    "medianStateBytes": statistics.median(r["result"]["stateBytes"] for r in warm)}
print(json.dumps({"checkedEffects": 42, "checkedRefusals": 6, "sameGrant": True, "freshContainedProcesses": 48,
    "warmContractFetches": 0, "signedReceipts": 42, "tamperedReceiptsRejected": 42, "summary": summary,
    "scope": "same-author separate raw verification; no live model, software change, holdout or commercial advantage established"}, indent=2))
