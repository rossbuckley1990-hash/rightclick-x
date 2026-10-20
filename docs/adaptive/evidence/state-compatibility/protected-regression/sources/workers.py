"""No-grant discovery and separate-process edge checks; local development only.

Uses audited Actenon implementations. No cryptography or authority semantics are
implemented here. The host supervisor and its worker processes remain trusted.
"""
from __future__ import annotations

import argparse
import base64
from datetime import UTC, datetime, timedelta
import hashlib
import http.client
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
from containment import Boundary, NAMESPACE, REPO, append, contained, prepare, provider
from actenon.execution.effects import EffectProtector
from actenon.models import ActionIntent, PCCB, PartyRef
from actenon.receipts import OutcomeAttestationService
from actenon.replay import ReplayProtector
from actenon_permit import Budget, Grant, Scopes, SQLiteStore
from actenon_permit.model import GrantStatus
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier
from actenon_permit.ed25519_signer import resolve_signer


class PublicDiscoveryBoundary(Boundary):
    def authorize(self, *, writes):
        if writes:
            super().authorize(writes=True)
        else:
            self.writes, self.grant = False, None

    def issue(self, wire):
        if self.grant is None:
            raise ValueError("operator has installed no grant")
        return super().issue(wire)

    def request_bounds(self, wire, body):
        allowed, write = super().request_bounds(wire, body)
        # Static operator-selected fixture inputs, never discovered authority.
        write = write or (self.writes and wire["method"] == "POST" and wire["url"] == self.origin + "/entries" and body in {
            json.dumps({"label": label}, separators=(",", ":")).encode()
            for label in ("race", "ancestor", "expired", "revocation-outage", "replay-outage", "effect-outage")})
        return allowed or write, write

    def fetch(self, wire):
        # Only this exact public discovery document is accessible without a
        # grant. Never forward a client-selected destination or write here.
        if (set(wire) == {"method", "url", "headers", "body"} and wire["method"] == "GET"
                and wire["url"] == self.origin + "/openapi.json" and wire["body"] == ""
                and set(wire["headers"]) <= {"accept", "user-agent"}):
            url = urlsplit(self.origin)
            connection = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
            try:
                connection.request("GET", "/openapi.json")
                r = connection.getresponse()
                result = {"ok": True, "response": {"status": r.status, "headers": dict(r.getheaders()), "body": base64.b64encode(r.read()).decode()}}
                append(self.output / "public-discovery.jsonl", {"request": wire, "reply": result, "grantCount": len(self.store.list_grants())})
                return result
            finally:
                connection.close()
        return super().fetch(wire)


def worker(payload_path):
    payload = json.loads(payload_path.read_text())
    private, output = Path(payload["private"]), Path(payload["output"])
    # Reconstruct only the edge side, without running Boundary's issuer setup.
    boundary = Boundary.__new__(Boundary)
    boundary.private, boundary.output, boundary.origin = private, output, payload["origin"]
    boundary.store = SQLiteStore(str(private / "authority.db"))
    boundary.verifier = Ed25519PublicKeyVerifier([json.loads((private / "public.json").read_text())])
    # Disposable attestation signing material belongs to the trusted edge.
    os.environ["ACTENON_ED25519_KEY_FILE"] = str(private / "key.json")
    # Permit verifies the native HMAC grant when claiming its reservation.
    # These workers are trusted authority processes, not public-key-only edges.
    os.environ["ACTENON_SIGNING_KEY"] = (private / "grant-signing-key").read_text()
    boundary.attester = OutcomeAttestationService(signer=resolve_signer(), issuer=PartyRef(type="service", id="experiment-edge"))
    intent, proof = ActionIntent.from_dict(payload["intent"]), PCCB.from_dict(payload["proof"])
    boundary.grant = boundary.store.get_grant(proof.extensions["authority"]["grant_id"])
    boundary.dispatches = 0
    boundary.edge, boundary.effect_edge = boundary.make_edge(), boundary.make_edge(effects=True)
    options = {}
    fault_calls = []
    def unavailable(*_args, **_kwargs):
        fault_calls.append(payload["fault"])
        raise ConnectionError("PRIVATE_FAULT_MARKER")
    if payload.get("fault") == "revocation-outage":
        options["revocation_checker"] = unavailable
    elif payload.get("fault") == "replay-outage":
        class FailedReplay:
            claim_once = unavailable
        options["replay_protector"] = ReplayProtector(FailedReplay())
    elif payload.get("fault") == "effect-outage":
        options["effect_protector"] = EffectProtector(NAMESPACE, unavailable, lambda request: boundary.descriptor(request.intent))
    edge = boundary.make_edge(effects=True, **options)
    print(json.dumps({"ready": True, "pid": os.getpid()}), flush=True)
    if sys.stdin.readline().strip() != "go":
        raise RuntimeError("supervisor did not release worker")
    started = time.perf_counter_ns()
    try:
        result = boundary.execute(payload["wire"], intent, proof, edge)
        result.update(pid=os.getpid(), dispatches=boundary.dispatches, elapsed_ns=time.perf_counter_ns() - started, fault_calls=fault_calls)
        (output / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    finally:
        boundary.store.close()


def workers(boundary, private, output, name, wire, intent, proof, *, count=1, fault=None):
    processes = []
    records = []
    started = time.perf_counter_ns()
    try:
        for index in range(count):
            directory = output / "workers" / f"{name}-{index}"
            directory.mkdir(parents=True, exist_ok=False)
            payload = {"private": str(private), "output": str(directory), "origin": boundary.origin,
                       "wire": wire, "intent": intent.to_dict(), "proof": proof.to_dict(), "fault": fault}
            path = directory / "request.json"
            path.write_text(json.dumps(payload, indent=2))
            errors = (directory / "stderr.log").open("x")
            p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", str(path)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True,
                env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            processes.append((p, directory, errors))
        # All processes have independent initialized connections before release.
        for p, directory, _ in processes:
            selector = selectors.DefaultSelector()
            try:
                selector.register(p.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=15):
                    raise RuntimeError("worker readiness timed out")
                line = p.stdout.readline()
                (directory / "ready.json").write_text(line)
                assert json.loads(line)["ready"] is True
            finally:
                selector.close()
        for p, _, _ in processes:
            p.stdin.write("go\n")
            p.stdin.flush()
        for p, directory, _ in processes:
            out, _ = p.communicate(timeout=15)
            (directory / "stdout.log").write_text(out)
            (directory / "exit.json").write_text(json.dumps({"exit": p.returncode}))
            assert p.returncode == 0, f"worker failed: {directory}"
            records.append(json.loads(out))
        append(output / "worker-groups.jsonl", {"name": name, "count": count, "elapsed_ns": time.perf_counter_ns() - started, "results": records})
        return records
    finally:
        for p, _, errors in processes:
            if p.poll() is None:
                p.kill()
                p.wait(timeout=5)
            errors.close()


def run(output, image):
    docker, image_id = prepare(output, image)
    checks = {}
    with tempfile.TemporaryDirectory(prefix="rcx-actenon-workers-") as temp:
        private = Path(temp)
        os.chmod(private, 0o755)
        stage = private / "stage"
        stage.mkdir(mode=0o755)
        build = subprocess.run(["bun", "build", "experiments/actenon/contained-client.ts", "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
        (output / "build.log").write_text(build.stdout + build.stderr)
        assert build.returncode == 0
        (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())
        server, origin = provider(output)
        boundary = PublicDiscoveryBoundary(private, output, origin)
        boundary.direct_origin = origin
        (private / "public.json").write_bytes((output / "public.json").read_bytes())
        secret_fd = os.open(private / "grant-signing-key", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(secret_fd, "w") as stream:
            stream.write(os.environ["ACTENON_SIGNING_KEY"])
        def wire(label):
            return {"method": "POST", "url": origin + "/entries", "headers": {"content-type": "application/json"},
                    "body": base64.b64encode(json.dumps({"label": label}, separators=(",", ":")).encode()).decode()}
        def rows():
            return [json.loads(line) for line in (output / "provider.jsonl").read_text().splitlines()]
        def checkpoint():
            (output / "checks.json").write_text(json.dumps(checks, indent=2))
        try:
            checks["initial_grant_store_empty"] = len(boundary.store.list_grants()) == 0
            discovered = contained(docker, image_id, stage, boundary, "discover", None)
            checks["public_discovery_learns_write_capability"] = bool(discovered["results"]["capability"]["id"])
            checks["discovery_does_not_create_grant_or_proof"] = len(boundary.store.list_grants()) == 0 and not (output / "edge.jsonl").exists()
            checks["no_grant_effect_refused"] = discovered["results"]["run"]["status"] == "failed" and rows() == []
            checkpoint()
            boundary.authorize(writes=True)
            append(output / "operator-transitions.jsonl", {"phase": "explicit-grant", "grant": boundary.grant.model_dump(mode="json")})
            retained = contained(docker, image_id, stage, boundary, "retained", discovered["state"])
            checks["fresh_contained_process_uses_retained_capability_after_grant"] = retained["results"]["run"]["status"] == "completed"
            checks["retained_execution_no_rediscovery"] = not any(json.loads(line).get("request", {}).get("url", "").endswith("/openapi.json") for line in (output / "client-retained.jsonl").read_text().splitlines())
            request = wire("race")
            intent, proof = boundary.issue(request)
            raced = workers(boundary, private, output, "race", request, intent, proof, count=6)
            checks["six_distinct_ready_processes"] = len({r["pid"] for r in raced}) == 6
            checks["one_concurrent_dispatch"] = sum(r["dispatches"] for r in raced) == 1 and sum(r["ok"] for r in raced) == 1
            checks["five_concurrent_replay_refusals"] = sum(r["reason"] == "DUPLICATE_REPLAY" for r in raced) == 5
            restarted = workers(boundary, private, output, "restart", request, intent, proof)[0]
            checks["new_edge_process_cannot_replay"] = restarted["reason"] == "DUPLICATE_REPLAY" and restarted["dispatches"] == 0
            checks["exactly_one_race_effect"] = sum(r["label"] == "race" for r in rows()) == 1
            checkpoint()
            boundary.grant = Grant(agent_id="second-principal", scopes=Scopes(allow=["http.post"]), budget=Budget(limit=10, remaining=10), expires_at=datetime.now(UTC) + timedelta(minutes=10)).sign()
            boundary.store.put_grant(boundary.grant)
            try:
                boundary.issue(request)
                duplicate = {"issued": True}
            except ValueError as error:
                duplicate = {"issued": False, "reason": str(error)}
            (output / "second-principal.json").write_text(json.dumps(duplicate, indent=2))
            checks["second_principal_cannot_remint_owned_effect"] = duplicate["issued"] is False
            boundary.authorize(writes=True)
            parent = boundary.grant
            child = parent.attenuate(agent_id="delegated-principal", scopes_allow=["http.post"])
            boundary.store.put_grant(child)
            boundary.grant = child
            request = wire("ancestor")
            intent, proof = boundary.issue(request)
            boundary.store.set_status(parent.id, GrantStatus.REVOKED)
            r = workers(boundary, private, output, "ancestor", request, intent, proof)[0]
            checks["revoked_ancestor_blocks_preissued_child_proof"] = r["reason"] == "AUTHORITY_REVOKED" and r["dispatches"] == 0
            boundary.grant = Grant(agent_id="expiring-principal", scopes=Scopes(allow=["http.post"]), budget=Budget(limit=10, remaining=10), expires_at=datetime.now(UTC) + timedelta(seconds=2)).sign()
            boundary.store.put_grant(boundary.grant)
            request = wire("expired")
            intent, proof = boundary.issue(request)
            while datetime.now(UTC) <= boundary.grant.expires_at:
                time.sleep(.05)
            r = workers(boundary, private, output, "expired", request, intent, proof)[0]
            checks["real_grant_expiry_blocks_preissued_proof"] = not r["ok"] and r["reason"] in {"AUTHORITY_REVOKED", "PROOF_EXPIRED"} and r["dispatches"] == 0
            checkpoint()
            boundary.authorize(writes=True)
            for fault in ("revocation-outage", "replay-outage", "effect-outage"):
                request = wire(fault)
                intent, proof = boundary.issue(request)
                r = workers(boundary, private, output, fault, request, intent, proof, fault=fault)[0]
                checks[fault + "_refuses_without_dispatch"] = not r["ok"] and r["dispatches"] == 0 and r["fault_calls"] == [fault]
                artifacts = (output / "workers" / f"{fault}-0" / "edge.jsonl").read_text()
                checks[fault + "_does_not_expose_private_error"] = "PRIVATE_FAULT_MARKER" not in artifacts
            checks["only_two_operator_authorized_effects"] = rows() == [{"path": "/entries", "label": "approved"}, {"path": "/entries", "label": "race"}]
            # Preserve per-worker logs, aggregate native artifacts for the separate observer.
            for directory in sorted((output / "workers").iterdir()):
                for name in ("edge.jsonl", "attestations.jsonl"):
                    with (output / name).open("a") as stream:
                        stream.write((directory / name).read_text())
            observed = subprocess.run([sys.executable, str(Path(__file__).with_name("observe.py")), str(output)], capture_output=True, text=True,
                env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            (output / "observer.stdout.log").write_text(observed.stdout)
            (output / "observer.stderr.log").write_text(observed.stderr)
            assert observed.returncode == 0
            observation = json.loads(observed.stdout)
            checks["separate_observer_confirms_effects"] = observation["effects"] == rows()
            checks["separate_observer_verifies_and_tampers_artifacts"] = all(observation["verified_attestations"].values()) and observation["tampered_attestations_refused"] == sum(observation["verified_attestations"].values())
            checkpoint()
            result = {"checks": checks, "passed": sum(checks.values()), "total": len(checks), "observer": observation,
                      "scope": "bounded local shared-store worker experiment; no independent author, live model, resource-owned edge or multi-host containment claim"}
            (output / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
            assert all(checks.values()), "acceptance failed; evidence preserved"
        finally:
            boundary.store.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--image", default="rightclick-x-linux-test:latest")
    args = parser.parse_args()
    if args.worker:
        worker(args.worker)
    else:
        if args.output is None:
            parser.error("--output required")
        args.output = args.output.resolve()
        args.output.mkdir(parents=True, exist_ok=False)
        try:
            run(args.output, args.image)
        except BaseException:
            import traceback
            (args.output / "failure.log").write_text(traceback.format_exc())
            raise
