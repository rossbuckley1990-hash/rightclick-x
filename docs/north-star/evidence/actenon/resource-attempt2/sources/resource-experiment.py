"""Run the preregistered resource-owned boundary fixture, offline/local only."""
import argparse
import base64
import copy
from datetime import UTC, datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import selectors
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
from containment import NAMESPACE, REPO, append, contained, prepare
from workers import PublicDiscoveryBoundary
from actenon.execution.effects import EffectReference
from actenon.models import ActionIntent, AudienceRef, DynamicContextInput, PCCB, PartyRef, PolicyDecision
from actenon.proof import PCCBMinter
from actenon_permit.ed25519_signer import resolve_signer
from actenon_permit.kernel_bridge import claim_effect_at_edge
from actenon_permit.model import GrantStatus
from actenon_permit.revocation import StoreRevocationChecker


class ResourceBoundary(PublicDiscoveryBoundary):
    def request_bounds(self, wire, body):
        allowed, write = super().request_bounds(wire, body)
        write = write or (self.writes and wire["method"] == "POST" and wire["url"] == self.origin + "/entries" and body in {
            b'{"label":"proof-control"}', b'{"label":"stale"}', b'{"label":"outage"}'})
        return allowed or write, write

    def execute(self, wire, intent, proof, edge=None):
        # No gate here: the provider itself must enforce the supplied proof.
        target = urlsplit(wire["url"])
        connection = http.client.HTTPConnection(target.hostname, target.port, timeout=4)
        headers = {**wire["headers"], "x-actenon-intent": base64.b64encode(json.dumps(intent.to_dict()).encode()).decode(),
                   "x-actenon-proof": base64.b64encode(json.dumps(proof.to_dict() if hasattr(proof, "to_dict") else proof).encode()).decode()}
        try:
            connection.request(wire["method"], (target.path or "/") + ("?" + target.query if target.query else ""),
                               body=base64.b64decode(wire["body"], validate=True), headers=headers)
            r = connection.getresponse()
            body = r.read(65536)
            value = json.loads(body)
            result = {"ok": r.status == 200, "response": {"status": r.status, "headers": dict(r.getheaders()), "body": base64.b64encode(body).decode()},
                      "reason": value.get("reason", value.get("error"))}
        except (OSError, http.client.HTTPException) as error:
            result = {"ok": False, "reason": "resource response unavailable", "exception": type(error).__name__}
        finally:
            connection.close()
        append(self.output / "forwarded.jsonl", {"wire": wire, "intent": intent.to_dict(),
            "proof": proof.to_dict() if hasattr(proof, "to_dict") else proof, "reply": result})
        return result


def authority_service(boundary, socket_path, output):
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            op = "unknown"
            try:
                raw = self.rfile.readline(65537)
                if len(raw) > 65536 or not raw.endswith(b"\n"):
                    raise ValueError("invalid frame")
                request = json.loads(raw)
                op = request["op"]
                proof = PCCB.from_dict(request["proof"])
                if op == "revocation":
                    value = StoreRevocationChecker(boundary.store)(proof, None)
                elif op in {"claim", "settle"}:
                    intent = ActionIntent.from_dict(request["intent"])
                    if op == "claim":
                        value = claim_effect_at_edge(EffectReference.from_dict(proof.extensions["effect"]),
                            SimpleNamespace(pccb=proof, intent=intent), store=boundary.store)
                    else:
                        evidence = request["evidence"]
                        value = boundary.store.settle_effect(reference=proof.extensions["effect"],
                            grant_id=proof.extensions["authority"]["grant_id"], principal=intent.requester.id,
                            action_hash=proof.action_hash.value, outcome=evidence["outcome"], execution_occurred=evidence["execution_occurred"],
                            evidence_hash=evidence["evidence_hash"], observer="resource-owned-durable-journal")
                else:
                    raise ValueError("unsupported authority operation")
                reply = {"ok": True, "value": value}
            except Exception as error:
                reply = {"ok": False, "errorType": type(error).__name__}
            append(output / "authority-ipc.jsonl", {"op": op, "reply": reply})
            self.wfile.write((json.dumps(reply, default=str) + "\n").encode())
    server = socketserver.ThreadingUnixStreamServer(str(socket_path), Handler)
    os.chmod(socket_path, 0o600)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start_resource(private, output, config, name):
    path = private / "resource-config.json"
    path.write_text(json.dumps(config))
    errors = (output / f"resource-{name}.stderr.log").open("x")
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("resource-service.py")), str(path)],
        stdout=subprocess.PIPE, stderr=errors, text=True,
        env={"PATH": os.environ["PATH"], "HOME": config["private"], "PYTHONDONTWRITEBYTECODE": "1"})
    selector = selectors.DefaultSelector()
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(timeout=10):
            raise RuntimeError("resource startup timed out")
        line = process.stdout.readline()
        (output / f"resource-{name}.ready.json").write_text(line)
        ready = json.loads(line)
        return process, errors, ready
    except BaseException:
        process.kill()
        process.wait(timeout=5)
        errors.close()
        raise
    finally:
        selector.close()


def run(output, image):
    docker, image_id = prepare(output, image)
    checks = {}
    def checkpoint():
        (output / "checks.json").write_text(json.dumps(checks, indent=2))
    # macOS Unix socket paths have a small fixed limit; use this short local root.
    with tempfile.TemporaryDirectory(prefix="rcx-resource-", dir="/private/tmp") as temp:
        private = Path(temp)
        os.chmod(private, 0o755)
        issuer, resource, stage = [private / name for name in ["issuer", "resource", "stage"]]
        issuer.mkdir(mode=0o700); resource.mkdir(mode=0o700); stage.mkdir(mode=0o755)
        issuer_output = output / "issuer"
        issuer_output.mkdir()
        boundary = ResourceBoundary(issuer, issuer_output, "pending-resource-origin")
        public = private / "issuer-public.json"
        public.write_bytes((issuer_output / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket_path = issuer / "authority.sock"
        service = authority_service(boundary, socket_path, output)
        config = {"private": str(resource), "output": str(output), "issuerPublic": str(public), "authoritySocket": str(socket_path)}
        process = errors = None
        try:
            process, errors, ready = start_resource(private, output, config, "first")
            boundary.origin = ready["origin"]
            boundary.direct_origin = boundary.origin
            checks["resource_receives_no_issuer_signing_environment"] = ready["receivedSigningEnvironment"] == [] and ready["separateReceiptKey"]
            checks["single_resource_listener_no_raw_backend"] = ready["listeners"] == [boundary.origin] and ready["backendListener"] is None
            build = subprocess.run(["bun", "build", "experiments/actenon/contained-client.ts", "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
            (output / "build.log").write_text(build.stdout + build.stderr)
            assert build.returncode == 0
            (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())
            shutil.copyfile(Path(__file__).with_name("resource-probe.mjs"), stage / "probe.mjs")
            discovered = contained(docker, image_id, stage, boundary, "discover", None)
            checks["discovery_with_zero_grants_cannot_write"] = len(boundary.store.list_grants()) == 0 and discovered["results"]["run"]["status"] == "failed" and not (output / "provider.jsonl").read_text()
            boundary.authorize(writes=True)
            append(output / "operator-transitions.jsonl", {"phase": "grant", "grant": boundary.grant.model_dump(mode="json")})
            executed = contained(docker, image_id, stage, boundary, "execute", discovered["state"])
            r = executed["results"]
            checks["retained_capability_executes_with_operator_grant"] = r["run"]["status"] == "completed"
            checks["retained_capability_needs_no_rediscovery"] = not any(json.loads(line).get("request", {}).get("url", "").endswith("/openapi.json") for line in (issuer_output / "client-execute.jsonl").read_text().splitlines())
            checks["runtime_acknowledgement_not_semantic_verification"] = r["run"]["verification"]["status"] != "verified"
            checks["duplicate_changed_body_generated_route_refused"] = r["duplicate"]["status"] == "failed" and r["changedBody"]["status"] == "failed" and '"failed"' in r["generatedAPI"]
            checks["lost_response_fresh_retry_refused"] = r["lostResponse"]["status"] == "failed" and r["lostRetry"]["status"] == "failed"
            checks["agent_cannot_issue_grant_or_reconcile"] = all("error" in r[k] for k in ["selfGrant", "selfReconcile"])
            checks["agent_has_no_secret_mount_or_docker_socket"] = not r["secretEnvironment"] and not r["dockerSocket"] and not r["trustedState"] and r["readOnlyInput"]
            probes = docker.call(["run", "--rm", "--pull", "never", "--network", "bridge", "--read-only", "--user", "10000:10000",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--mount", f"type=bind,src={stage},dst=/input,readonly",
                "--entrypoint", "node", image_id, "/input/probe.mjs", boundary.origin.replace("127.0.0.1", "host.docker.internal")])
            (output / "direct-probes.json").write_text(probes)
            p = json.loads(probes)["results"]
            checks["network_enabled_agent_reaches_same_resource"] = p["publicDocument"]["status"] == 200
            checks["direct_http_and_unlisted_routes_require_proof"] = p["direct"]["status"] == 403 and p["changedMethod"]["status"] == 403 and all(v["status"] == 403 for v in p["aliases"].values())
            checks["shell_request_reaches_resource_and_is_refused"] = p["shell"]["exit"] == 0 and json.loads(p["shell"]["stdout"])["status"] == 403
            checks["raw_socket_request_refused_at_resource"] = p["rawSocket"].startswith("HTTP/1.0 403")
            checks["ambiguous_framing_refused"] = p["duplicateHeader"].startswith("HTTP/1.0 400") and p["transferEncoding"].startswith("HTTP/1.0 400")
            def rows():
                return [json.loads(line) for line in (output / "provider.jsonl").read_text().splitlines()]
            checks["all_direct_bypass_probes_have_zero_effect"] = [r["label"] for r in rows()] == ["approved", "lost"]
            checkpoint()
            wire = {"method": "POST", "url": boundary.origin + "/entries", "headers": {"content-type": "application/json"}, "body": base64.b64encode(b'{"label":"proof-control"}').decode()}
            intent, proof = boundary.issue(wire)
            mutations = {"method": {"method": "DELETE"}, "path": {"url": boundary.origin + "/other"},
                "query": {"url": boundary.origin + "/entries?extra=true"}, "body": {"body": base64.b64encode(b'{"label":"unauthorized"}').decode()},
                "semantic_header": {"headers": {"content-type": "text/plain"}}, "host": {"headers": {**wire["headers"], "host": "other.invalid"}}}
            expected = {"method": "SCOPE_CAPABILITY_MISMATCH", "path": "TARGET_MISMATCH", "query": "TARGET_MISMATCH", "body": "ACTION_MISMATCH", "semantic_header": "ACTION_MISMATCH", "host": "TARGET_MISMATCH"}
            mutation_results = {}
            for name, patch in mutations.items():
                response = boundary.execute({**wire, **patch}, intent, proof)
                mutation_results[name] = response
                checks["actual_request_binds_" + name] = not response["ok"] and response["reason"] == expected[name]
            damaged = proof.to_dict()
            damaged["signature"]["value"] = "A" * len(damaged["signature"]["value"])
            response = boundary.execute(wire, intent, damaged)
            checks["forged_signature_refused_at_resource"] = response["reason"] == "SIGNATURE_INVALID" and not response["ok"]
            unsupported = copy.deepcopy(proof.to_dict())
            unsupported["extensions"]["effect"]["profile"] = "unsupported-profile"
            response = boundary.execute(wire, intent, unsupported)
            checks["unsupported_profile_refused"] = not response["ok"]
            foreign = PCCBMinter(signer=resolve_signer(), issuer=PartyRef(type="service", id="actenon-permit")).mint(intent,
                PolicyDecision(outcome="allow", summary="disposable wrong-audience test", rule_evaluations=()),
                DynamicContextInput(request_id="wrong-audience", audience=AudienceRef(type="service", id="other-boundary"), scope_capabilities=("http.post",), now=datetime.now(UTC)),
                extensions=proof.extensions)
            response = boundary.execute(wire, intent, foreign)
            checks["valid_foreign_audience_proof_refused"] = response["reason"] == "AUDIENCE_MISMATCH" and not response["ok"]
            checks["mutated_proofs_have_zero_effect"] = [r["label"] for r in rows()] == ["approved", "lost"]
            (output / "mutation-results.json").write_text(json.dumps(mutation_results, indent=2))
            response = boundary.execute(wire, intent, proof)
            checks["unchanged_proof_executes_once"] = response["ok"] and [r["label"] for r in rows()] == ["approved", "lost", "proof-control"]
            checkpoint()
            process.terminate(); process.wait(timeout=5); errors.close()
            config["port"] = urlsplit(boundary.origin).port
            process, errors, restarted = start_resource(private, output, config, "restart")
            response = boundary.execute(wire, intent, proof)
            checks["resource_process_restart_keeps_replay_state"] = restarted["pid"] != ready["pid"] and not response["ok"] and response["reason"] == "DUPLICATE_REPLAY"
            stale = {**wire, "body": base64.b64encode(b'{"label":"stale"}').decode()}
            stale_intent, stale_proof = boundary.issue(stale)
            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
            response = boundary.execute(stale, stale_intent, stale_proof)
            checks["resource_refuses_revoked_preissued_proof"] = response["reason"] == "AUTHORITY_REVOKED" and not response["ok"]
            boundary.authorize(writes=True)
            outage = {**wire, "body": base64.b64encode(b'{"label":"outage"}').decode()}
            outage_intent, outage_proof = boundary.issue(outage)
            service.shutdown(); service.server_close(); service = None
            socket_path.unlink()
            response = boundary.execute(outage, outage_intent, outage_proof)
            checks["authority_service_outage_fails_closed"] = response["reason"] == "AUTHORITY_REVOKED" and not response["ok"]
            checks["exactly_three_authorized_effects"] = [r["label"] for r in rows()] == ["approved", "lost", "proof-control"]
            commitments = []
            for row in rows():
                matching = [entry for line in (output / "edge.jsonl").read_text().splitlines() if (entry := json.loads(line)).get("proof") and entry["proof"].get("pccb_id") == row["proof"]]
                native = next(r for r in matching if r["outcome"]["ok"])
                ref = native["proof"]["extensions"]["effect"]
                effect = boundary.store.get_effect(ref["effect_id"])[0]
                commitments.append(effect)
            (output / "committed-effects.json").write_text(json.dumps(commitments, indent=2, default=str))
            checks["resource_owned_commit_evidence_settled_each_effect"] = len(commitments) == 3 and all(r["state"] == "COMMITTED" for r in commitments)
            checkpoint()
            observed = subprocess.run([sys.executable, str(Path(__file__).with_name("observe.py")), str(output)], capture_output=True, text=True,
                env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            (output / "observer.stdout.log").write_text(observed.stdout)
            (output / "observer.stderr.log").write_text(observed.stderr)
            assert observed.returncode == 0
            observation = json.loads(observed.stdout)
            checks["separate_observer_confirms_exact_journal"] = observation["effects"] == rows()
            checks["separate_observer_verifies_native_artifacts"] = all(observation["verified_attestations"].values()) and observation["tampered_attestations_refused"] == sum(observation["verified_attestations"].values())
            result = {"checks": checks, "passed": sum(checks.values()), "total": len(checks), "observer": observation,
                      "scope": "local resource-owned fixture, trusted same-user host processes; not production isolation, live models, independent-author review or arbitrary-environment containment"}
            (output / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
            assert all(checks.values()), "resource experiment failed; preserve evidence"
        finally:
            if process is not None and process.poll() is None:
                process.terminate(); process.wait(timeout=5)
            if errors is not None:
                errors.close()
            if service is not None:
                service.shutdown(); service.server_close()
            boundary.store.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--image", default="rightclick-x-linux-test:latest")
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    try:
        run(args.output, args.image)
    except BaseException:
        import traceback
        (args.output / "failure.log").write_text(traceback.format_exc())
        raise
