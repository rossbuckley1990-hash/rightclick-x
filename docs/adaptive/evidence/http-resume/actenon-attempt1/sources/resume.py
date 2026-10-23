"""Explicit HTTP resumption under the existing native resource-owned boundary."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
from containment import REPO, append, contained, prepare
from actenon_permit.model import GrantStatus

spec = importlib.util.spec_from_file_location("protected_async", Path(__file__).with_name("protected-async.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def run(output, image):
    docker, image_id = prepare(output, image)
    checks = {}
    with tempfile.TemporaryDirectory(prefix="rcx-resume-", dir="/private/tmp") as temporary:
        private = Path(temporary); os.chmod(private, 0o755)
        issuer, provider, stage = [private / name for name in ["issuer", "provider", "stage"]]
        issuer.mkdir(mode=0o700); provider.mkdir(mode=0o700); stage.mkdir(mode=0o755)
        issued = output / "issuer"; issued.mkdir()
        boundary = fixture.AsyncBoundary(issuer, issued, "pending")
        public = private / "issuer-public.json"
        public.write_bytes((issued / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket = issuer / "authority.sock"
        service = fixture.resource.authority_service(boundary, socket, output)
        process = errors = None
        try:
            process, errors, ready = fixture.resource.start_resource(private, output, {"private": str(provider),
                "output": str(output), "issuerPublic": str(public), "authoritySocket": str(socket), "asyncCompression": True}, "resume")
            boundary.origin = boundary.direct_origin = ready["origin"]
            build = subprocess.run(["bun", "build", "experiments/actenon/async-client.ts", "--target", "node",
                "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
            (output / "build.log").write_text(build.stdout + build.stderr); assert build.returncode == 0
            (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())

            def task(phase, state):
                started = time.perf_counter_ns()
                report = contained(docker, image_id, stage, boundary, phase, state,
                    task={"label": "first", "document": fixture.DOCUMENTS["first"]})
                (output / (phase + ".json")).write_text(json.dumps(report, indent=2))
                append(output / "measurements.jsonl", {"phase": phase, "containerWallMs": (time.perf_counter_ns() - started) / 1e6,
                    **report["results"]["measurements"]})
                return report

            discovered = task("discover", None)
            checks["discovery_does_not_authorise"] = not boundary.store.list_grants() and not (output / "provider.jsonl").read_text()
            boundary.authorize(writes=True)
            append(output / "operator-transitions.jsonl", {"phase": "initial", "grant": boundary.grant.model_dump(mode="json")})
            paused = task("pause", discovered["state"])
            pending = paused["results"]["run"]
            checks["one_effect_then_pending_checkpoint"] = pending["status"] == "pending" and pending["pending"]["resumeRunId"] == pending["runId"]
            assert checks["one_effect_then_pending_checkpoint"]
            original_grant = boundary.grant.id
            boundary.store.set_status(original_grant, GrantStatus.REVOKED)
            append(output / "operator-transitions.jsonl", {"phase": "revoke", "grant": original_grant})
            refused = task("resume-denied", paused["state"])
            denied = refused["results"]["run"]
            checks["fresh_process_resume_cannot_restore_revoked_authority"] = denied["status"] == "pending" and denied["httpContinuation"]["stopped"] == "denied"
            boundary.authorize(writes=True)
            append(output / "operator-transitions.jsonl", {"phase": "new-grant", "grant": boundary.grant.model_dump(mode="json")})
            completed = task("resume-authorised", refused["state"])
            result = completed["results"]["run"]
            checks["explicit_new_authority_allows_only_retained_reads"] = result["status"] == "completed" and result["resumes"] == pending["runId"]
            checks["stored_predicate_applied"] = result["verification"]["status"] == "checked"
            rows = [json.loads(s) for s in (output / "provider.jsonl").read_text().splitlines()]
            checks["no_original_action_replay"] = len(rows) == 1 and rows[0]["label"] == "first"
            data = (output / "artifacts/first.gz").read_bytes()
            checks["actual_file_matches_result_and_original_document"] = result["output"]["sha256"] == hashlib.sha256(data).hexdigest() and gzip.decompress(data).decode() == fixture.DOCUMENTS["first"]
            requests = [r["request"] for phase in ["resume-denied", "resume-authorised"]
                for s in (issued / f"client-{phase}.jsonl").read_text().splitlines() if (r := json.loads(s)).get("op") == "fetch"]
            checks["resume_has_no_discovery_or_writes"] = requests and all(r["method"] == "GET" and not r["url"].endswith(("/catalog", "/openapi.json")) for r in requests)
            checks["completion_removes_checkpoint"] = completed["state"].get("httpContinuations") == []
        finally:
            (output / "result.json").write_text(json.dumps({"checks": checks,
                "scope": "same-author controlled explicit process restart; process kill separately tested with FileStore"}, indent=2))
            if process: process.terminate(); process.wait(timeout=10)
            if errors: errors.close()
            service.shutdown(); service.server_close(); boundary.store.close()
        assert len(checks) == 9 and all(checks.values())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=False)
    run(output, args.image)
