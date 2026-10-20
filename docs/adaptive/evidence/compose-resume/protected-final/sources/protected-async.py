"""Protected asynchronous HTTP development check; no remote providers or models."""
import argparse
import base64
import gzip
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from uuid import uuid4

sys.dont_write_bytecode = True
from containment import REPO, append, contained, prepare
from actenon_permit.model import GrantStatus

spec = importlib.util.spec_from_file_location("resource_experiment", Path(__file__).with_name("resource-experiment.py"))
resource = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resource)

DOCUMENTS = {name: f"Authorised document for {name}. " * 100 for name in
             ["first", "second", "blocked-monitor", "blocked-result", "revoked", "moved", "generated"]}


class AsyncBoundary(resource.ResourceBoundary):
    def request_bounds(self, wire, body):
        url = urlsplit(wire["url"])
        label = url.path.split("/")[-1]
        read = wire["method"] == "GET" and not body and not url.query and wire["url"].startswith(self.origin + "/") and (
            url.path == "/openapi.json" or label in DOCUMENTS and
            (url.path == "/jobs/" + label and label != "blocked-monitor" or
             url.path == "/artifacts/" + label and label != "blocked-result"))
        write = self.writes and wire["method"] == "POST" and wire["url"] == self.origin + "/jobs" and body in {
            json.dumps({"label": label, "document": document}, separators=(",", ":")).encode() for label, document in DOCUMENTS.items()}
        return read or write, write

    def fetch(self, wire):
        # Operator-selected public metadata; no agent URL or grant is inferred.
        if wire["method"] == "GET" and wire["url"] == self.origin + "/catalog" and wire["body"] == "" and set(wire["headers"]) <= {"accept", "user-agent"}:
            url = urlsplit(self.origin)
            connection = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
            try:
                connection.request("GET", "/catalog")
                reply = connection.getresponse()
                result = {"ok": True, "response": {"status": reply.status, "headers": dict(reply.getheaders()),
                    "body": base64.b64encode(reply.read()).decode()}}
                append(self.output / "public-discovery.jsonl", {"request": wire, "reply": result, "grantCount": len(self.store.list_grants())})
                return result
            finally:
                connection.close()
        result = super().fetch(wire)
        if wire["method"] == "GET" and wire["url"] == self.origin + "/jobs/revoked" and result.get("response", {}).get("status") in {202, 303}:
            self.store.set_status(self.grant.id, GrantStatus.REVOKED)
            append(self.output / "operator-transitions.jsonl", {"phase": "revoke-during-poll", "grant": self.grant.id})
        return result


def run(output, image):
    docker, image_id = prepare(output, image)
    checks = {}
    with tempfile.TemporaryDirectory(prefix="rcx-async-", dir="/private/tmp") as temporary:
        private = Path(temporary)
        os.chmod(private, 0o755)
        issuer, provider, stage = [private / n for n in ["issuer", "provider", "stage"]]
        issuer.mkdir(mode=0o700); provider.mkdir(mode=0o700); stage.mkdir(mode=0o755)
        issued = output / "issuer"; issued.mkdir()
        boundary = AsyncBoundary(issuer, issued, "pending")
        public = private / "issuer-public.json"
        public.write_bytes((issued / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket_path = issuer / "authority.sock"
        service = resource.authority_service(boundary, socket_path, output)
        config = {"private": str(provider), "output": str(output), "issuerPublic": str(public),
            "authoritySocket": str(socket_path), "asyncCompression": True}
        process = errors = None
        try:
            process, errors, ready = resource.start_resource(private, output, config, "async")
            boundary.origin = boundary.direct_origin = ready["origin"]
            checks["resource_has_separate_receipt_key_no_issuer_environment"] = ready["separateReceiptKey"] and ready["receivedSigningEnvironment"] == []
            listeners = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(ready["pid"]), "-iTCP", "-sTCP:LISTEN", "-F", "pn"], capture_output=True, text=True)
            (output / "listeners.json").write_text(json.dumps({"code": listeners.returncode, "stdout": listeners.stdout, "stderr": listeners.stderr}))
            checks["sole_protected_resource_listener"] = listeners.returncode == 0 and [s[1:] for s in listeners.stdout.splitlines() if s.startswith("n")] == [boundary.origin.removeprefix("http://")]
            build = subprocess.run(["bun", "build", "experiments/actenon/async-client.ts", "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
            (output / "build.log").write_text(build.stdout + build.stderr)
            assert build.returncode == 0
            (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())

            def task(phase, state, label):
                started = time.perf_counter_ns()
                report = contained(docker, image_id, stage, boundary, phase, state,
                    task={"label": label, "document": DOCUMENTS[label]})
                (output / f"{phase}.json").write_text(json.dumps(report, indent=2))
                append(output / "measurements.jsonl", {"phase": phase, "containerWallMs": (time.perf_counter_ns() - started) / 1e6,
                    **report["results"].get("measurements", {})})
                return report

            discovered = task("discover", None, "first")
            checks["public_discovery_creates_no_authority"] = not boundary.store.list_grants() and not (output / "provider.jsonl").read_text()
            checks["no_grant_execution_refused"] = discovered["results"]["run"]["status"] == "failed"
            boundary.authorize(writes=True)
            append(issued / "operator-transitions.jsonl", {"phase": "grant", "grant": boundary.grant.model_dump(mode="json"),
                "documents": DOCUMENTS, "blockedMonitors": ["blocked-monitor"], "blockedResults": ["blocked-result"], "movedResultApproved": False})
            published = task("publish", discovered["state"], "first")
            outcome = published["results"]["compose"]
            checks["protected_async_workflow_completed"] = outcome.get("executed", {}).get("status") == "completed"
            checks["checked_goal_retained"] = bool(outcome.get("published")) and outcome["executed"]["verification"]["status"] == "checked"
            assert checks["protected_async_workflow_completed"] and checks["checked_goal_retained"], "protected async execution failed; preserve evidence"
            state = published["state"]
            warm = task("warm", state, "second")
            checks["fresh_process_reuses_without_discovery"] = warm["results"]["run"]["status"] == "completed" and not any(
                json.loads(s).get("request", {}).get("url", "").endswith(("/openapi.json", "/catalog"))
                for s in (issued / "client-warm.jsonl").read_text().splitlines())
            for phase, label in [("monitor-denied", "blocked-monitor"), ("result-denied", "blocked-result"), ("moved-denied", "moved"), ("revoked", "revoked")]:
                report = task(phase, state, label)
                checks[phase + "_stays_pending"] = report["results"]["run"]["status"] == "pending"
            boundary.authorize(writes=True)
            append(issued / "operator-transitions.jsonl", {"phase": "new-grant-after-revocation", "grant": boundary.grant.model_dump(mode="json")})
            generated = task("generated", state, "generated")
            checks["generated_api_uses_same_protected_path"] = generated["results"]["generated"]["status"] == 200 and generated["results"]["generated"]["body"]["ok"]
            shutil.copyfile(Path(__file__).with_name("resource-probe.mjs"), stage / "probe.mjs")
            name = "rcx-async-probe-" + uuid4().hex[:12]
            docker.call(["create", "--name", name, "--network", "bridge", "--read-only", "--user", "10000:10000",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
                "--mount", f"type=bind,src={stage},dst=/input,readonly", "--entrypoint", "node", image_id, "/input/probe.mjs",
                boundary.origin.replace("127.0.0.1", "host.docker.internal"), "/jobs", '{"label":"bypass","document":"attempt"}',
                '["/jobs/first","/artifacts/first","/artifacts-moved/moved"]'])
            try:
                info = docker.json(["inspect", name])[0]
                (output / "network-probe-container.json").write_text(json.dumps({"image": info["Image"], "host": info["HostConfig"],
                    "mounts": info["Mounts"], "user": info["Config"]["User"]}, indent=2))
                checks["network_probe_has_no_trusted_mounts"] = info["HostConfig"]["NetworkMode"] == "bridge" and info["HostConfig"]["ReadonlyRootfs"] and info["Config"]["User"] == "10000:10000" and len(info["Mounts"]) == 1 and info["Mounts"][0]["Source"] == str(stage) and not info["Mounts"][0]["RW"]
                probes = docker.call(["start", "-a", name])
            finally:
                docker.call(["rm", "-f", name])
            (output / "direct-probes.json").write_text(probes)
            p = json.loads(probes)["results"]
            checks["network_enabled_agent_reaches_resource"] = p["publicDocument"]["status"] == 200
            checks["direct_writes_reads_aliases_require_proof"] = p["direct"]["status"] == p["changedMethod"]["status"] == 403 and all(v["status"] == 403 for v in [*p["aliases"].values(), *p["reads"].values()])
            checks["shell_and_raw_socket_require_proof"] = p["shell"]["exit"] == 0 and json.loads(p["shell"]["stdout"])["status"] == 403 and p["rawSocket"].startswith("HTTP/1.0 403")
            checks["ambiguous_framing_refused"] = p["duplicateHeader"].startswith("HTTP/1.0 400") and p["transferEncoding"].startswith("HTTP/1.0 400")
            checks["network_probe_has_no_credentials_or_issuer_access"] = not p["secrets"] and not p["dockerSocket"] and not p["authorityStore"]

            wire = {"method": "GET", "url": boundary.origin + "/jobs/first", "headers": {}, "body": ""}
            intent, proof = boundary.issue(wire)
            mutations = {"method": {"method": "POST"}, "target": {"url": boundary.origin + "/jobs/second"},
                "query": {"url": boundary.origin + "/jobs/first?different=true"},
                "body": {"body": base64.b64encode(b"changed").decode()}, "headers": {"headers": {"content-type": "text/plain"}}}
            reasons = {"method": "SCOPE_CAPABILITY_MISMATCH", "target": "TARGET_MISMATCH", "query": "TARGET_MISMATCH",
                "body": "ACTION_MISMATCH", "headers": "ACTION_MISMATCH"}
            controls = {}
            for label, patch in mutations.items():
                reply = boundary.execute({**wire, **patch}, intent, proof)
                controls[label] = reply
                checks["exact_followup_binds_" + label] = not reply["ok"] and reply["reason"] == reasons[label]
            damaged = proof.to_dict()
            damaged["signature"]["value"] = "A" * len(damaged["signature"]["value"])
            controls["forged"] = boundary.execute(wire, intent, damaged)
            checks["forged_followup_proof_refused"] = controls["forged"]["reason"] == "SIGNATURE_INVALID"
            controls["original"] = boundary.execute(wire, intent, proof)
            checks["unchanged_followup_proof_accepted_once"] = controls["original"]["response"]["status"] == 303
            controls["replay"] = boundary.execute(wire, intent, proof)
            checks["followup_replay_refused"] = controls["replay"]["reason"] == "DUPLICATE_REPLAY"
            (output / "mutation-results.json").write_text(json.dumps(controls, indent=2))
            rows = [json.loads(s) for s in (output / "provider.jsonl").read_text().splitlines()]
            edges = [json.loads(s) for s in (output / "edge.jsonl").read_text().splitlines()]
            commitments = []
            for row in rows:
                edge = next(e for e in edges if e["outcome"]["ok"] and e["proof"]["pccb_id"] == row["proof"])
                commitments.append(boundary.store.get_effect(edge["proof"]["extensions"]["effect"]["effect_id"])[0])
            (output / "committed-effects.json").write_text(json.dumps(commitments, indent=2, default=str))
            checks["enqueue_reservations_settled_with_resource_evidence"] = len(commitments) == len(DOCUMENTS) and all(c["state"] == "COMMITTED" for c in commitments)
            checks["one_enqueue_per_authorised_input_no_replay"] = len(rows) == len(DOCUMENTS) and {r["label"] for r in rows} == set(DOCUMENTS)
            checks["artifact_bytes_match_authorised_documents"] = all(gzip.decompress((output / "artifacts" / f"{r['label']}.gz").read_bytes()).decode() == DOCUMENTS[r["label"]] for r in rows)
        finally:
            (output / "result.json").write_text(json.dumps({"checks": checks, "scope": "controlled resource-owned native Actenon fixture; not independent-author holdout or universal containment"}, indent=2))
            if process:
                process.terminate(); process.wait(timeout=10)
            if errors:
                errors.close()
            service.shutdown(); service.server_close()
            boundary.store.close()
        assert all(checks.values()), "protected asynchronous checks failed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=False)
    run(output, args.image)
