"""Exercise retained remaining effects through the existing resource-owned gate."""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

sys.dont_write_bytecode = True
from containment import REPO, append, contained, prepare
from actenon_permit.model import GrantStatus

spec = importlib.util.spec_from_file_location("protected_async", Path(__file__).with_name("protected-async.py"))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)


class WorkflowBoundary(fixture.AsyncBoundary):
    publications = False
    revoke_after_result = False

    def request_bounds(self, wire, body):
        allowed, write = super().request_bounds(wire, body)
        publish = False
        if self.writes and self.publications and wire["method"] == "POST":
            for label in ["first", "second", "generated"]:
                artifact = self.artifact_root / f"{label}.gz"
                if artifact.exists():
                    expected = json.dumps({"sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}, separators=(",", ":")).encode()
                    publish |= wire["url"] == self.origin + "/publications/" + label and body == expected
        return allowed or publish, write or publish

    def fetch(self, wire):
        result = super().fetch(wire)
        if self.revoke_after_result and wire["method"] == "GET" and wire["url"] == self.origin + "/artifacts/second" and result.get("response", {}).get("status") == 200:
            self.store.set_status(self.grant.id, GrantStatus.REVOKED)
            append(self.output / "operator-transitions.jsonl", {"phase": "revoke-between-steps", "grant": self.grant.id})
        return result


def run(output, image):
    docker, image_id = prepare(output, image)
    checks = {}
    with tempfile.TemporaryDirectory(prefix="rcx-workflow-", dir="/private/tmp") as temporary:
        private = Path(temporary); os.chmod(private, 0o755)
        issuer, provider, stage = [private / n for n in ["issuer", "provider", "stage"]]
        issuer.mkdir(mode=0o700); provider.mkdir(mode=0o700); stage.mkdir(mode=0o755)
        issued = output / "issuer"; issued.mkdir()
        boundary = WorkflowBoundary(issuer, issued, "pending")
        boundary.artifact_root = output / "artifacts"
        public = private / "issuer-public.json"
        public.write_bytes((issued / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket = issuer / "authority.sock"
        service = fixture.resource.authority_service(boundary, socket, output)
        process = errors = None
        try:
            process, errors, ready = fixture.resource.start_resource(private, output, {"private": str(provider),
                "output": str(output), "issuerPublic": str(public), "authoritySocket": str(socket), "asyncCompression": True}, "workflow")
            boundary.origin = boundary.direct_origin = ready["origin"]
            checks["resource_signer_separate_from_issuer"] = ready["separateReceiptKey"] and ready["receivedSigningEnvironment"] == []
            listeners = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(ready["pid"]), "-iTCP", "-sTCP:LISTEN", "-F", "pn"], capture_output=True, text=True)
            (output / "listeners.json").write_text(json.dumps({"code": listeners.returncode, "stdout": listeners.stdout, "stderr": listeners.stderr}))
            checks["sole_resource_listener"] = listeners.returncode == 0 and [s[1:] for s in listeners.stdout.splitlines() if s.startswith("n")] == [boundary.origin.removeprefix("http://")]
            built = subprocess.run(["bun", "build", "experiments/actenon/async-client.ts", "--target", "node",
                "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
            (output / "build.log").write_text(built.stdout + built.stderr); assert built.returncode == 0
            (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())

            def task(phase, state, label, name=None):
                started = time.perf_counter_ns()
                report = contained(docker, image_id, stage, boundary, phase, state,
                    task={"label": label, "document": fixture.DOCUMENTS[label]})
                name = name or phase
                (output / f"{name}.json").write_text(json.dumps(report, indent=2))
                # contained writes phase-based files; preserve repeated phases separately.
                for p in issued.glob(f"*{phase}*"):
                    if name != phase: p.rename(p.with_name(p.name.replace(phase, name)))
                append(output / "measurements.jsonl", {"phase": name, "containerWallMs": (time.perf_counter_ns() - started) / 1e6,
                    **report["results"]["measurements"]})
                return report

            def grant(phase, publications):
                boundary.publications = publications
                boundary.authorize(writes=True)
                append(issued / "operator-transitions.jsonl", {"phase": phase, "grant": boundary.grant.model_dump(mode="json"),
                    "publications": publications, "documents": {k: fixture.DOCUMENTS[k] for k in ["first", "second", "generated"]}})

            discovered = task("discover", None, "first")
            checks["discovery_grants_no_authority"] = not boundary.store.list_grants() and discovered["results"]["run"]["status"] == "failed"
            grant("initial", False)
            paused = task("workflow-pause", discovered["state"], "first", "first-pause")
            original = paused["results"]["run"]
            checks["ordinary_plan_retained_pending"] = original["status"] == "pending" and original["pending"]["resumeId"] == "resume:" + original["runId"]
            assert checks["ordinary_plan_retained_pending"]
            changed = task("workflow-resume-changed", paused["state"], "first")
            checks["changed_remaining_target_stops_before_fetch"] = changed["results"]["run"]["status"] == "pending" and not any(
                json.loads(s).get("op") == "fetch" for s in (issued / "client-workflow-resume-changed.jsonl").read_text().splitlines())
            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
            append(issued / "operator-transitions.jsonl", {"phase": "revoke-pending", "grant": boundary.grant.id})
            revoked = task("workflow-resume-revoked", paused["state"], "first")
            checks["revoked_grant_cannot_resume"] = revoked["results"]["run"]["status"] == "pending" and revoked["results"]["run"]["verification"]["status"] == "unverified"
            grant("renew-for-remaining-action", True)
            done = task("workflow-resume-authorised", revoked["state"], "first")
            completed = done["results"]["run"]
            checks["new_authority_completes_exact_remaining_effect"] = completed["status"] == "completed" and completed["verification"]["status"] == "checked" and completed["resumes"] == original["runId"]
            checks["completed_parent_and_child_checkpoints_removed"] = done["state"]["workflowContinuations"] == done["state"]["httpContinuations"] == []

            for label, name in [("generated", "publication-denied"), ("second", "revoked-between")]:
                grant(name, False if label == "generated" else True)
                pending = task("workflow-pause", discovered["state"], label, name + "-pause")
                boundary.revoke_after_result = label == "second"
                result = task("workflow-resume-" + name, pending["state"], label)
                boundary.revoke_after_result = False
                outcome = result["results"]["run"]
                checks[name + "_has_no_publication"] = outcome["status"] == "failed" and outcome["verification"]["status"] == "unverified" and not (output / "publications" / f"{label}.json").exists()
                checks[name + "_no_replanning"] = not outcome.get("healing") and not outcome.get("attempts")

            rows = [json.loads(s) for s in (output / "provider.jsonl").read_text().splitlines()]
            checks["one_enqueue_each_no_replay"] = sorted(r["label"] for r in rows if r.get("kind") != "publication") == ["first", "generated", "second"]
            checks["one_workflow_publication"] = [r["label"] for r in rows if r.get("kind") == "publication"] == ["first"]
            checks["actual_business_artifact_verified"] = completed["output"] == hashlib.sha256((output / "artifacts/first.gz").read_bytes()).hexdigest() and gzip.decompress((output / "artifacts/first.gz").read_bytes()).decode() == fixture.DOCUMENTS["first"]
            resume_names = ["workflow-resume-changed", "workflow-resume-revoked", "workflow-resume-authorised",
                "workflow-resume-publication-denied", "workflow-resume-revoked-between"]
            checks["fresh_resume_zero_metadata_or_enqueue"] = all(not any(
                r.get("op") == "fetch" and (r["request"]["url"].endswith(("/catalog", "/openapi.json")) or
                    r["request"]["method"] == "POST" and r["request"]["url"].endswith("/jobs"))
                for s in (issued / f"client-{name}.jsonl").read_text().splitlines() if (r := json.loads(s))) for name in resume_names)

            # A separate explicitly authorized native proof control publishes the
            # previously refused label. It is not a recovered workflow success.
            grant("native-proof-controls", True)
            sha = hashlib.sha256((output / "artifacts/generated.gz").read_bytes()).hexdigest()
            wire = {"method": "POST", "url": boundary.origin + "/publications/generated", "headers": {},
                "body": base64.b64encode(json.dumps({"sha256": sha}, separators=(",", ":")).encode()).decode()}
            intent, proof = boundary.issue(wire)
            mutations = {"method": {"method": "GET"}, "target": {"url": boundary.origin + "/publications/second"},
                "query": {"url": wire["url"] + "?other=true"}, "body": {"body": base64.b64encode(b'{"sha256":"wrong"}').decode()},
                "headers": {"headers": {"content-type": "text/plain"}}}
            controls = {name: boundary.execute({**wire, **patch}, intent, proof) for name, patch in mutations.items()}
            for name, reason in {"method": "SCOPE_CAPABILITY_MISMATCH", "target": "TARGET_MISMATCH", "query": "TARGET_MISMATCH",
                                 "body": "ACTION_MISMATCH", "headers": "ACTION_MISMATCH"}.items():
                checks["exact_publication_" + name] = controls[name]["reason"] == reason and not controls[name]["ok"]
            damaged = proof.to_dict(); damaged["signature"]["value"] = "A" * len(damaged["signature"]["value"])
            controls["forged"] = boundary.execute(wire, intent, damaged)
            controls["original"] = boundary.execute(wire, intent, proof)
            controls["replay"] = boundary.execute(wire, intent, proof)
            checks["forged_publication_refused"] = controls["forged"]["reason"] == "SIGNATURE_INVALID"
            checks["native_control_accepted_once"] = controls["original"]["response"]["status"] == 200 and controls["replay"]["reason"] == "DUPLICATE_REPLAY"
            (output / "mutation-results.json").write_text(json.dumps(controls, indent=2))

            shutil.copyfile(Path(__file__).with_name("resource-probe.mjs"), stage / "probe.mjs")
            name = "rcx-workflow-probe-" + uuid4().hex[:12]
            docker.call(["create", "--name", name, "--network", "bridge", "--read-only", "--user", "10000:10000", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
                "--mount", f"type=bind,src={stage},dst=/input,readonly", "--entrypoint", "node", image_id, "/input/probe.mjs",
                boundary.origin.replace("127.0.0.1", "host.docker.internal"), "/publications/second", '{"sha256":"unapproved"}',
                '["/artifacts/first","/publications/first"]'])
            try:
                info = docker.json(["inspect", name])[0]
                (output / "network-probe-container.json").write_text(json.dumps({"image": info["Image"], "host": info["HostConfig"],
                    "mounts": info["Mounts"], "user": info["Config"]["User"]}, indent=2))
                probes = json.loads(docker.call(["start", "-a", name]))
            finally: docker.call(["rm", "-f", name])
            (output / "direct-probes.json").write_text(json.dumps(probes, indent=2))
            p = probes["results"]
            checks["direct_publication_and_aliases_refuse"] = p["publicDocument"]["status"] == 200 and p["direct"]["status"] == p["changedMethod"]["status"] == 403 and all(v["status"] == 403 for v in [*p["aliases"].values(), *p["reads"].values()])
            checks["shell_socket_publication_refuse"] = p["shell"]["exit"] == 0 and json.loads(p["shell"]["stdout"])["status"] == 403 and p["rawSocket"].startswith("HTTP/1.0 403")
            checks["probe_has_no_credentials_or_authority_mount"] = not p["secrets"] and not p["dockerSocket"] and not p["authorityStore"] and len(info["Mounts"]) == 1 and not info["Mounts"][0]["RW"]
            checks["ambiguous_framing_refused"] = p["duplicateHeader"].startswith("HTTP/1.0 400") and p["transferEncoding"].startswith("HTTP/1.0 400")
            rows = [json.loads(s) for s in (output / "provider.jsonl").read_text().splitlines()]
            edges = [json.loads(s) for s in (output / "edge.jsonl").read_text().splitlines()]
            commitments = [boundary.store.get_effect(next(e for e in edges if e["outcome"]["ok"] and
                e["proof"]["pccb_id"] == row["proof"])["proof"]["extensions"]["effect"]["effect_id"])[0] for row in rows]
            (output / "committed-effects.json").write_text(json.dumps(commitments, indent=2, default=str))
            checks["five_native_effect_reservations_committed"] = len(commitments) == 5 and all(c["state"] == "COMMITTED" for c in commitments)
        finally:
            (output / "result.json").write_text(json.dumps({"checks": checks, "scope": "same-author local retained-workflow experiment; native proof control is a separate publication; not independent holdout or universal containment"}, indent=2))
            if process: process.terminate(); process.wait(timeout=10)
            if errors: errors.close()
            service.shutdown(); service.server_close(); boundary.store.close()
        assert all(checks.values()) and len(checks) == 28


if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--image", required=True); p.add_argument("--output", required=True)
    args = p.parse_args(); output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=False)
    run(output, args.image)
