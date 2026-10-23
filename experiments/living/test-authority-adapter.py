"""Native adapter development controls using already exposed signed artifacts."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[2]
source = root / "docs/adaptive/evidence/living-session/protected-regression"
all_rows = [json.loads(s) for s in (source / "attestations.jsonl").read_text().splitlines()]
origin = json.loads((source / "resource-workflow.ready.json").read_text())["origin"]
rows = [row for row in all_rows if row["unsigned_payload"]["outcome_artifact"]["target"]["resource_id"].startswith(origin + "/")]
assert any(row["unsigned_payload"]["artifact_type"] == "refusal" for row in rows)
public = (source / "public.json").read_bytes()
observations = []
with tempfile.TemporaryDirectory(prefix="rcx-native-feed-") as temporary:
    folder = Path(temporary)
    key = folder / "public.json"; key.write_bytes(public)
    evidence = folder / "attestations.jsonl"
    command = [sys.executable, "-B", str(root / "integrations/actenon/authority-evidence.py"),
        "--attestations", str(evidence), "--public-key", str(key),
        "--trust-anchor", hashlib.sha256(public).hexdigest(), "--origin", origin, "--issuer", "resource-edge"]
    for case in ["valid", "changed-artifact", "changed-signature", "changed-binding", "changed-key", "wrong-issuer",
                 "foreign-target", "duplicate", "incomplete", "oversized", "unknown-version", "empty"]:
        selected = copy.deepcopy(rows)
        key.write_bytes(public)
        if case == "changed-artifact":
            selected[0]["unsigned_payload"]["outcome_artifact"]["target"]["resource_id"] += "/changed"
        elif case == "changed-signature":
            selected[0]["signature"]["value"] = "A" * len(selected[0]["signature"]["value"])
        elif case == "changed-binding":
            selected[0]["unsigned_payload"]["proof_binding"]["action_hash"] = "0" * 64
        elif case == "changed-key":
            key.write_bytes((source / "issuer-public.json").read_bytes())
        elif case == "wrong-issuer":
            selected[0]["unsigned_payload"]["issuer"]["id"] = "self-appointed"
        elif case == "foreign-target":
            selected = [row for row in all_rows if urlsplit(row["unsigned_payload"]["outcome_artifact"]["target"]["resource_id"]).netloc != urlsplit(origin).netloc]
        elif case == "duplicate":
            selected.append(selected[0])
        elif case == "unknown-version":
            selected[0]["contract"]["version"] = "v99"
        elif case == "empty":
            selected = []
        data = "".join(json.dumps(row) + "\n" for row in selected).encode()
        if case == "incomplete":
            data = data[:-1]
        if case == "oversized":
            data = b" " * (4 * 1024 * 1024 + 1)
        evidence.write_bytes(data)
        result = subprocess.run(command, text=True, capture_output=True, timeout=5)
        accepted = case in ("valid", "empty")
        assert (result.returncode == 0) == accepted, (case, result.returncode, result.stderr)
        if accepted:
            batch = json.loads(result.stdout)
            assert len(batch["records"]) == len(selected)
            assert all(word not in result.stdout for word in ["parameters", "secret_reference", "brokered_credential", "http://"])
            for original, projected in zip(selected, batch["records"]):
                artifact = original["unsigned_payload"]["outcome_artifact"]
                if artifact.get("outcome") == "refused":
                    assert projected["outcome"] == "refused", "a native refused receipt is not an unresolved outcome"
        else:
            assert result.stdout == "" and result.stderr.strip() == "native authority evidence unavailable"
        observations.append({"case": case, "exit": result.returncode, "accepted": accepted,
            **({"records": len(selected)} if accepted else {})})
print(json.dumps({"status": "PASS", "controls": observations,
    "scope": "same-author exposed native receipt/refusal fixtures; valid subset pinned to one explicit origin, no independent holdout"}, indent=2))
