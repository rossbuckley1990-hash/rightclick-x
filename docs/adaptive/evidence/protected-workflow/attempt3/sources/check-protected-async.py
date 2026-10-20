"""Separate-process, read-only checker. Same author, not an independent holdout.

Native Actenon APIs verify historical signatures; this does not renew authority.
Business outcomes are checked from compressed file bytes, not runtime predicates.
"""
import base64
from collections import Counter
import copy
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

from actenon.models import ActionIntent, PCCB, PartyRef
from actenon.proof.canonical import canonicalize_bytes, sha256_hex
from actenon.proof.service import build_action_hash_input
from actenon.receipts import OutcomeAttestationService
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier


def check(root):
    read = lambda name: json.loads((root / name).read_text())
    lines = lambda name: [json.loads(s) for s in (root / name).read_text().splitlines()]
    key = lambda v: json.dumps(v, sort_keys=True)
    labels = ["first", "second", "blocked-monitor", "blocked-result", "revoked", "moved", "generated"]
    documents = {label: f"Authorised document for {label}. " * 100 for label in labels}
    phases = ["discover", "publish", "warm", "monitor-denied", "result-denied", "moved-denied", "revoked", "generated"]
    reports = {p: read(p + ".json") for p in phases}
    for phase, report in reports.items():
        recorded = next(r for r in lines(f"issuer/client-{phase}.jsonl") if r.get("op") == "report")
        assert report == recorded, "report differs from container output"
        container = read(f"issuer/container-{phase}.json")
        assert container["host"]["NetworkMode"] == "none"
        assert container["host"]["ReadonlyRootfs"] and container["user"] == "10000:10000"
        assert len(container["mounts"]) == 1 and not container["mounts"][0]["RW"]
        assert container["mounts"][0]["Source"].endswith("/stage")
    assert reports["discover"]["results"]["run"]["status"] == "failed"
    public = lines("issuer/public-discovery.jsonl")
    assert public and all(r["grantCount"] == 0 for r in public)
    events = lines("issuer/operator-transitions.jsonl")
    assert [r["phase"] for r in events] == ["grant", "revoke-during-poll", "new-grant-after-revocation"]
    transitions = [r for r in events if isinstance(r["grant"], dict)]
    assert transitions[0]["documents"] == documents
    assert len(transitions) == 2 and transitions[0]["grant"]["id"] != transitions[1]["grant"]["id"]
    revocation = [r for r in events if r["phase"] == "revoke-during-poll"]
    assert len(revocation) == 1 and revocation[0]["grant"] == transitions[0]["grant"]["id"]

    raw_journal = (root / "provider.jsonl").read_bytes().splitlines(keepends=True)
    journal = [json.loads(s) for s in raw_journal]
    assert Counter(r["label"] for r in journal) == Counter(labels), "unexpected or missing effects"
    assert len({r["worker"] for r in journal}) == len(labels)
    digests = {}
    for row in journal:
        label = row["label"]
        artifact = (root / "artifacts" / (label + ".gz")).read_bytes()
        assert row["document"] == documents[label]
        assert gzip.decompress(artifact).decode() == documents[label], "wrong compressed contents"
        digests[label] = hashlib.sha256(artifact).hexdigest()
    published = reports["publish"]["results"]["compose"]
    assert published["published"] and published["executed"]["verification"]["status"] == "checked"
    assert published["executed"]["output"] == digests["first"]
    warm = reports["warm"]["results"]["run"]
    assert warm["status"] == "completed" and warm["output"] == digests["second"]
    assert warm["verification"]["status"] == "checked"
    assert not any(r.get("request", {}).get("url", "").endswith(("/catalog", "/openapi.json"))
                   for r in lines("issuer/client-warm.jsonl"))
    generated = reports["generated"]["results"]["generated"]
    assert generated["status"] == 200 and generated["body"]["ok"] and generated["body"]["result"] == digests["generated"]
    for phase in ["monitor-denied", "result-denied", "moved-denied", "revoked"]:
        run = reports[phase]["results"]["run"]
        assert run["status"] == "pending" and run["verification"]["status"] == "unverified" and "output" not in run
        assert run["httpContinuation"]["stopped"] == "denied"

    edges = lines("edge.jsonl")
    issuer = Ed25519PublicKeyVerifier([read("issuer-public.json")])
    received = Counter(key(r["wire"]) for r in lines("resource-requests.jsonl"))
    successes = {}
    valid_proofs = 0
    for row in edges:
        intent = ActionIntent.from_dict(row["intent"])
        wire = {**row["intent"]["action"]["parameters"], "url": row["intent"]["target"]["resource_id"]}
        assert received[key(wire)] > 0, "edge lacks a received request"
        received[key(wire)] -= 1
        if not row.get("proof"):
            assert row["outcome"]["reason_code"] == "PCCB_REQUIRED"
            continue
        proof = PCCB.from_dict(row["proof"])
        valid = issuer.verify(canonicalize_bytes(proof.unsigned_payload()), proof.signature)
        assert valid or row["outcome"]["reason_code"] == "SIGNATURE_INVALID"
        valid_proofs += int(valid)
        if row["outcome"]["ok"]:
            assert valid and proof.action_hash.value == sha256_hex(build_action_hash_input(intent))
            assert row["proof"]["action"] == row["intent"]["action"] and row["proof"]["target"] == row["intent"]["target"]
            assert proof.pccb_id not in successes, "proof executed twice"
            successes[proof.pccb_id] = row
            path = wire["url"].split("://", 1)[1].split("/", 1)[1]
            assert path not in ["jobs/blocked-monitor", "artifacts/blocked-result", "artifacts-moved/moved", "artifacts/revoked"]
    assert sum(received.values()) == 3
    assert all(json.loads(k)["url"].endswith(("/catalog", "/openapi.json")) for k, n in received.items() if n)
    reasons = Counter(r["outcome"]["reason_code"] for r in edges if not r["outcome"]["ok"])
    assert reasons == {"PCCB_REQUIRED": 12, "SCOPE_CAPABILITY_MISMATCH": 1, "TARGET_MISMATCH": 2,
                       "ACTION_MISMATCH": 2, "SIGNATURE_INVALID": 1, "DUPLICATE_REPLAY": 1}
    commitments = read("committed-effects.json")
    assert len(commitments) == len(labels)
    for i, row in enumerate(journal):
        edge = successes[row["proof"]]
        body = json.loads(base64.b64decode(edge["intent"]["action"]["parameters"]["body"]))
        assert body == {"label": row["label"], "document": documents[row["label"]]}
        evidence = edge["outcome"]["receipt"]["extensions"]["effect"]
        prefix = hashlib.sha256(b"".join(raw_journal[:i + 1])).hexdigest()
        assert evidence["outcome"] == "COMMITTED" and evidence["execution_occurred"] is True
        assert evidence["evidence_hash"] == prefix, "enqueue evidence hash differs"
        committed = next(c for c in commitments if c["reference"]["effect_id"] == evidence["effect_id"])
        assert committed["state"] == "COMMITTED" and committed["evidence"]["evidence_hash"] == prefix
        assert committed["action_hash"] == edge["proof"]["action_hash"]["value"]
    assert sum(e["intent"]["action"]["parameters"]["method"] == "POST" for e in successes.values()) == len(labels)

    receipt_key = read("public.json")
    assert receipt_key != read("issuer-public.json")
    verifier = Ed25519PublicKeyVerifier([receipt_key])
    attester = OutcomeAttestationService(signer=verifier, issuer=PartyRef(type="service", id="checker"))
    expected = Counter(key(r["outcome"][kind]) for r in edges for kind in ["receipt", "refusal"] if r["outcome"].get(kind))
    artifacts = lines("attestations.jsonl")
    for record in artifacts:
        kind = record["unsigned_payload"]["artifact_type"]
        getattr(attester, f"verify_{kind}_attestation")(record, verifier=verifier)
        artifact_key = key(record["unsigned_payload"]["outcome_artifact"])
        assert expected[artifact_key] > 0
        expected[artifact_key] -= 1
    assert not any(expected.values())
    ids = {r["proof"]["pccb_id"] for r in edges if r.get("proof")} | {t["grant"]["id"] for t in transitions}
    for report in reports.values():
        saved = key(report["state"])
        assert not any(v in saved for v in ids)
        assert "x-actenon-proof" not in saved.lower() and "x-actenon-intent" not in saved.lower()

    probes = read("direct-probes.json")["results"]
    assert probes["publicDocument"]["status"] == 200
    for r in [probes["direct"], probes["changedMethod"], *probes["aliases"].values(), *probes["reads"].values()]:
        assert r["status"] == 403 and json.loads(r["body"])["reason"] == "PCCB_REQUIRED"
    assert set(probes["reads"]) == {"/jobs/first", "/artifacts/first", "/artifacts-moved/moved"}
    assert probes["shell"]["exit"] == 0 and json.loads(probes["shell"]["stdout"])["status"] == 403
    assert probes["rawSocket"].startswith("HTTP/1.0 403")
    assert probes["duplicateHeader"].startswith("HTTP/1.0 400") and probes["transferEncoding"].startswith("HTTP/1.0 400")
    assert not probes["secrets"] and not probes["dockerSocket"] and not probes["authorityStore"]
    probe_container = read("network-probe-container.json")
    assert probe_container["host"]["NetworkMode"] == "bridge" and probe_container["host"]["ReadonlyRootfs"]
    assert probe_container["user"] == "10000:10000" and len(probe_container["mounts"]) == 1 and not probe_container["mounts"][0]["RW"]
    ready, listeners = read("resource-async.ready.json"), read("listeners.json")
    assert ready["receivedSigningEnvironment"] == [] and ready["separateReceiptKey"]
    assert listeners["code"] == 0 and [s[1:] for s in listeners["stdout"].splitlines() if s.startswith("n")] == [ready["origin"].removeprefix("http://")]
    for name, digest in read("provenance.json")["sources"].items():
        assert hashlib.sha256((root / "sources" / name).read_bytes()).hexdigest() == digest
    return {"effects": len(journal), "compressedArtifactsChecked": len(digests), "validHistoricalProofs": valid_proofs,
            "exactSuccessfulRequestProofs": len(successes), "signedArtifacts": len(artifacts),
            "businessSuccesses": 3, "honestlyPending": 4, "scope": "same author, separate implementation/process; local fixture only"}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    result = check(root)
    refused = []
    for case in ["artifact", "extra-effect", "missing-request", "proof", "attestation"]:
        with tempfile.TemporaryDirectory(prefix="rcx-async-check-") as temporary:
            target = Path(temporary) / "copy"
            shutil.copytree(root, target)
            if case == "artifact":
                (target / "artifacts/first.gz").write_bytes(gzip.compress(b"wrong contents"))
            elif case == "extra-effect":
                journal = target / "provider.jsonl"
                journal.write_bytes(journal.read_bytes() + journal.read_bytes().splitlines(keepends=True)[0])
            elif case == "missing-request":
                path = target / "resource-requests.jsonl"
                path.write_text("\n".join(path.read_text().splitlines()[1:]) + "\n")
            else:
                path = target / ("edge.jsonl" if case == "proof" else "attestations.jsonl")
                rows = [json.loads(s) for s in path.read_text().splitlines()]
                if case == "proof":
                    rows[0]["proof"]["target"]["resource_id"] += "/changed"
                else:
                    rows[0]["unsigned_payload"]["outcome_artifact"]["summary"] = "forged"
                path.write_text("".join(json.dumps(r) + "\n" for r in rows))
            try:
                check(target)
            except Exception:
                refused.append(case)
            else:
                raise AssertionError(f"checker accepted corrupted {case}")
    print(json.dumps({**result, "corruptEvidenceRefused": refused}, indent=2))
