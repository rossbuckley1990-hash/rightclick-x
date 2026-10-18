"""Frozen local development experiment. No network downloads or live models.

The trusted host owns Permit, Kernel, operator request bounds and a disposable
loopback provider. The untrusted Node container has only a bounded stdio bridge.
This is NOT a production launcher, HTTP proxy, or universal execution sandbox.
"""
from __future__ import annotations

import argparse
import base64
import dataclasses
import hashlib
import http.client
import json
import os
from pathlib import Path
import selectors
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

# Do not use real provider credentials even if the invoking shell has them.
for name in tuple(os.environ):
    if name not in {"PATH", "HOME", "TMPDIR", "LANG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_CONFIG"}:
        os.environ.pop(name)

from actenon.execution.effects import EffectProtector
from actenon.gate import ActenonGate
from actenon.models import PartyRef
from actenon.receipts import OutcomeAttestationService
from actenon.replay import ReplayProtector, SqliteReplayStore
from actenon_permit import PDP, Action, Budget, Grant, Ledger, Scopes, SQLiteStore
from actenon_permit.model import GrantStatus
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier
from actenon_permit.ed25519_signer import generate_ed25519_keypair, resolve_signer, save_ed25519_keypair
from actenon_permit.kernel_bridge import claim_effect_at_edge
from actenon_permit.revocation import StoreRevocationChecker
from actenon_airlock.protected import Docker
from actenon_protocol.effects import EFFECT_PROFILE

REPO = Path(__file__).resolve().parents[2]
NAMESPACE = "rcx-disposable-entries-v1"
LIMIT = 4 * 1024 * 1024


def append(path, value):
    with path.open("a") as stream:
        stream.write(json.dumps(value, sort_keys=True) + "\n")


def provider(root):
    journal = root / "provider.jsonl"
    journal.touch(exist_ok=False)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/openapi.json":
                self.respond(404, {"error": "unknown read"})
                return
            self.respond(200, {
                "openapi": "3.0.0", "info": {"title": "Disposable entries", "version": "1"},
                "servers": [{"url": origin}], "paths": {"/entries": {"post": {
                    "operationId": "appendEntry", "summary": "Append an entry label",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["label"], "properties": {"label": {"type": "string"}},
                    }}}},
                    "responses": {"200": {"description": "Transport acknowledgement; not independent verification",
                        "content": {"application/json": {"schema": {"type": "object", "properties": {
                            "accepted": {"type": "boolean"}, "label": {"type": "string"},
                        }}}}}},
                }}}})

        def do_POST(self):
            if self.path != "/entries":
                self.respond(404, {"error": "unknown write"})
                return
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            value = json.loads(raw)
            append(journal, {"path": self.path, "label": value["label"]})
            if value["label"] == "lost":
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.respond(200, {"accepted": True, "label": value["label"]})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, origin


class Boundary:
    def __init__(self, private, output, origin):
        self.private, self.output, self.origin = private, output, origin
        key = generate_ed25519_keypair(key_id="disposable-experiment")
        key_file = private / "key.json"
        save_ed25519_keypair(key, key_file)
        os.environ["ACTENON_ED25519_KEY_FILE"] = str(key_file)
        os.environ["ACTENON_SIGNING_KEY"] = os.urandom(32).hex()
        (output / "public.json").write_text(json.dumps(key.public_key_jwk))
        (output / "attestations.jsonl").touch(exist_ok=False)
        self.verifier = Ed25519PublicKeyVerifier([key.public_key_jwk])
        self.attester = OutcomeAttestationService(signer=resolve_signer(), issuer=PartyRef(type="service", id="experiment-edge"))
        self.store = SQLiteStore(str(private / "authority.db"))
        self.pdp = PDP(self.store, Ledger(self.store))
        self.dispatches = 0
        self.grant = None
        self.authorize(writes=False)
        self.edge = self.make_edge()
        self.effect_edge = self.make_edge(effects=True)

    def authorize(self, *, writes):
        # Trusted fixture operator choice. No discovery, IPC or agent claim can invoke this.
        self.writes = writes
        self.grant = Grant(agent_id="contained-node-principal", scopes=Scopes(allow=["http.get", *(["http.post"] if writes else [])]),
                           budget=Budget(limit=100, remaining=100), expires_at=datetime.now(UTC) + timedelta(minutes=10)).sign()
        self.store.put_grant(self.grant)

    def descriptor(self, intent):
        # This local provider's only effect is append(body). Negotiation headers
        # cannot create a fresh effect identity; every header still enters the proof.
        return {"profile": EFFECT_PROFILE, "namespace": NAMESPACE, "kind": "semantic",
                "action_type": intent.action.capability,
                "target": {"type": intent.target.resource_type, "id": intent.target.resource_id},
                "semantic_key": {k: intent.action.parameters[k] for k in ("method", "body")}}

    def make_edge(self, *, effects=False, **options):
        defaults = dict(verifier=self.verifier, audience="service:actenon-permit-gateway", issuer="service:actenon-permit",
                        capabilities=("http.get", "http.post"),
                        replay_protector=ReplayProtector(SqliteReplayStore(self.private / "replay.db")),
                        revocation_checker=StoreRevocationChecker(self.store))
        if effects:
            defaults["effect_protector"] = EffectProtector(NAMESPACE, partial(claim_effect_at_edge, store=self.store),
                                                        lambda request: self.descriptor(request.intent))
        return ActenonGate(**{**defaults, **options})

    def issue(self, wire):
        if set(wire) != {"method", "url", "headers", "body"}:
            raise ValueError("unsupported request profile")
        if not isinstance(wire["headers"], dict) or any(k not in {"accept", "content-type", "user-agent"} or not isinstance(v, str) for k, v in wire["headers"].items()):
            raise ValueError("unsupported header")
        body = base64.b64decode(wire["body"], validate=True)
        method, url = wire["method"], wire["url"]
        read = method == "GET" and url == self.origin + "/openapi.json" and not body
        write = self.writes and method == "POST" and url == self.origin + "/entries" and body in (b'{"label":"approved"}', b'{"label":"lost"}')
        if not (read or write):
            raise ValueError("outside operator-approved exact request bounds")
        grant = self.store.get_grant(self.grant.id)
        action = Action(grant_id=grant.id, type="http." + method.lower(), target=url,
                        params={k: wire[k] for k in ("method", "body", "headers")}, est_cost=1)
        decision, intent, proof = self.pdp.decide_and_mint_pccb(grant, action,
            **({"effect_namespace": NAMESPACE, "effect_descriptor_builder": self.descriptor} if write else {}))
        if proof is None:
            raise ValueError(decision.reason)
        return intent, proof

    def execute(self, wire, intent, proof, edge=None):
        # Bind verification to the exact bytes subsequently dispatched. Never
        # take the agent's semantic capability, risk, target or hash on trust.
        actual = dataclasses.replace(intent,
            action=dataclasses.replace(intent.action, name="http." + wire["method"].lower(), capability="http." + wire["method"].lower(),
                                       parameters={k: wire[k] for k in ("method", "body", "headers")}),
            target=dataclasses.replace(intent.target, resource_id=wire["url"]))
        response = {}

        def dispatch():
            self.dispatches += 1
            from urllib.parse import urlsplit
            url = urlsplit(wire["url"])
            connection = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
            try:
                connection.request(wire["method"], url.path, body=base64.b64decode(wire["body"], validate=True), headers=wire["headers"])
                received = connection.getresponse()
                response.update(status=received.status, headers=dict(received.getheaders()), body=base64.b64encode(received.read(LIMIT)).decode())
            finally:
                connection.close()
            if "effect" in proof.extensions:
                return {"effect_evidence": {**proof.extensions["effect"], "outcome": "AMBIGUOUS", "execution_occurred": None,
                                           "evidence_hash": hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest()}}
            return {"transport_status": response["status"]}

        outcome = (edge or (self.effect_edge if "effect" in proof.extensions else self.edge)).protect(actual, proof, dispatch)
        row = {"intent": actual.to_dict(), "proof": proof.to_dict(), "outcome": outcome.to_dict()}
        append(self.output / "edge.jsonl", row)
        for kind in ("receipt", "refusal"):
            artifact = getattr(outcome, kind)
            if artifact:
                signed = getattr(self.attester, "attest_" + kind)(artifact)
                append(self.output / "attestations.jsonl", signed.to_dict())
        if "effect" in proof.extensions:
            evidence = outcome.receipt.extensions.get("effect") if outcome.receipt else None
            if evidence:
                self.store.settle_effect(reference=proof.extensions["effect"], grant_id=self.grant.id,
                    principal=intent.requester.id, action_hash=proof.action_hash.value, outcome=evidence["outcome"],
                    execution_occurred=evidence["execution_occurred"], evidence_hash=evidence["evidence_hash"], observer="http-edge")
        return {"ok": bool(response) or outcome.ok, "response": response, "reason": outcome.reason_code,
                "finality": outcome.receipt.extensions.get("effect", {}).get("outcome") if outcome.receipt else None}

    def fetch(self, wire):
        started = time.perf_counter_ns()
        try:
            intent, proof = self.issue(wire)
            result = self.execute(wire, intent, proof)
        except (ValueError, TypeError, KeyError) as exc:
            result = {"ok": False, "reason": str(exc)}
        append(self.output / "bridge.jsonl", {"request": wire, "reply": result, "elapsed_ns": time.perf_counter_ns() - started})
        return result


def contained(docker, image, stage, boundary, phase, state):
    name = "rcx-actenon-" + uuid4().hex[:12]
    docker.call(["create", "--name", name, "-i", "--network", "none", "--read-only", "--user", "10000:10000",
                 "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
                 "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m", "--mount", f"type=bind,src={stage},dst=/input,readonly",
                 "--workdir", "/tmp", "--entrypoint", "node", image, "/input/client.mjs"])
    try:
        info = docker.json(["inspect", name])[0]
        host = info["HostConfig"]
        assert host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and host["CapDrop"] == ["ALL"]
        assert info["Config"]["User"] == "10000:10000" and host["Privileged"] is False
        assert len(info["Mounts"]) == 1 and info["Mounts"][0]["Source"] == str(stage) and not info["Mounts"][0]["RW"]
        assert not host["PidMode"] and not host["IpcMode"] == "host"
        assert "no-new-privileges" in host["SecurityOpt"]
        (boundary.output / f"container-{phase}.json").write_text(json.dumps({"image": info["Image"], "host": host, "mounts": info["Mounts"], "user": info["Config"]["User"]}, indent=2))
        with (boundary.output / f"client-{phase}.stderr.log").open("x") as errors:
            process = subprocess.Popen([docker.binary, "start", "-a", "-i", name], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, env=docker.environment)
            process.stdin.write((json.dumps({"config": {"phase": phase, "origin": boundary.origin, "state": state}}) + "\n").encode())
            process.stdin.flush()
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            buffer = b""
            deadline = time.monotonic() + 45
            report = None
            try:
                while report is None and time.monotonic() < deadline:
                    if not selector.select(timeout=1):
                        if process.poll() is not None:
                            break
                        continue
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    buffer += chunk
                    if len(buffer) > LIMIT:
                        raise ValueError("bridge frame too large")
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        request = json.loads(line)
                        append(boundary.output / f"client-{phase}.jsonl", request)
                        if request.get("op") == "report":
                            report = request
                            break
                        reply = boundary.fetch(request["request"]) if request.get("op") == "fetch" else {"ok": False, "reason": "unsupported bridge operation"}
                        process.stdin.write((json.dumps({"id": request["id"], **reply}) + "\n").encode())
                        process.stdin.flush()
                if report is None:
                    raise RuntimeError(f"contained {phase} failed or timed out; see preserved stderr")
                process.stdin.close()
                assert process.wait(timeout=5) == 0
                return report
            finally:
                selector.close()
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
    finally:
        docker.call(["rm", "-f", name])


def run(output, image):
    # This experiment uses unreleased surfaces. Refuse a different source stack
    # until it has been audited; a successful import is not a compatibility check.
    import importlib
    audited = json.loads((REPO / "docs/north-star/evidence/actenon-source-audit.json").read_text())
    pins = {}
    for name, package in (("kernel", "actenon"), ("permit", "actenon_permit"), ("protocol", "actenon_protocol"),
                          ("airlock", "actenon_airlock"), ("scan", "actenon_scan")):
        module_file = Path(importlib.import_module(package).__file__).resolve()
        checkout = next(p for p in module_file.parents if (p / ".git").exists())
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
        assert commit == next(r["commit"] for r in audited if r["repository"] == "actenon-" + name), "unaudited Actenon revision"
        assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=checkout, text=True).strip(), "modified Actenon source"
        pins[name] = {"commit": commit, "module": str(module_file)}
    docker = Docker()
    engine = docker.verify_engine()
    image_id = docker.image(image)["Id"]  # pin exact already-present bytes; never pull
    provenance = {"engine": engine, "image": image_id, "actenon": pins, "rcx_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
                  "sources": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*") if p.is_file()}}
    (output / "provenance.json").write_text(json.dumps(provenance, indent=2))
    (output / "sources").mkdir()
    for name in provenance["sources"]:
        shutil.copyfile(Path(__file__).parent / name, output / "sources" / name)
    with tempfile.TemporaryDirectory(prefix="rcx-actenon-private-") as temporary:
        private = Path(temporary)
        stage = private / "stage"
        stage.mkdir(mode=0o755)
        os.chmod(private, 0o755)
        build = subprocess.run(["bun", "build", "experiments/actenon/contained-client.ts", "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
        (output / "build.log").write_text(build.stdout + build.stderr)
        assert build.returncode == 0
        server, origin = provider(output)
        boundary = Boundary(private, output, origin)
        checks = {}
        try:
            before = contained(docker, image_id, stage, boundary, "discover", None)
            checks["discovery_without_write_authority"] = before["results"]["run"]["status"] == "failed" and not (output / "provider.jsonl").read_text()
            boundary.authorize(writes=True)
            execute = contained(docker, image_id, stage, boundary, "execute", before["state"])
            r = execute["results"]
            checks["fresh_process_reuses_without_discovery"] = not any(json.loads(line).get("request", {}).get("url", "").endswith("/openapi.json") for line in (output / "client-execute.jsonl").read_text().splitlines())
            checks["authorized_execution"] = r["run"]["status"] == "completed"
            checks["transport_success_not_verified"] = r["run"]["verification"]["status"] != "verified"
            checks["duplicate_refused"] = r["duplicate"]["status"] == "failed"
            checks["changed_parameters_refused"] = r["changedBody"]["status"] == "failed"
            checks["generated_api_refused"] = '"failed"' in r["generatedAPI"]
            checks["lost_response_retry_refused"] = r["lostResponse"]["status"] == "failed" and r["lostRetry"]["status"] == "failed"
            checks["alternate_requests_refused"] = all("error" in r[k] for k in ("rawBroker", "changedMethod", "selfGrant"))
            checks["direct_and_shell_network_refused"] = "error" in r["directAPI"] and r["shell"]["status"] == 23
            checks["trusted_material_not_mounted"] = not r["secretEnvironment"] and not r["dockerSocket"] and not r["trustedState"] and r["readOnlyInput"]
            wire = {"method": "GET", "url": origin + "/openapi.json", "body": "", "headers": {}}
            intent, proof = boundary.issue(wire)
            dispatched = boundary.dispatches
            mutations = {"target": {"url": origin + "/other"}, "parameters": {"body": "eA=="}, "method": {"method": "POST"}, "headers": {"headers": {"accept": "changed"}}}
            for label, patch in mutations.items():
                checks["proof_binds_" + label] = not boundary.execute({**wire, **patch}, intent, proof)["ok"]
            checks["proof_binds_audience"] = not boundary.execute(wire, intent, proof, boundary.make_edge(audience="service:other"))["ok"]
            checks["expired_proof_refused"] = not boundary.execute(wire, intent, proof, boundary.make_edge(clock=lambda: datetime.now(UTC) + timedelta(hours=1)))["ok"]
            def broken_revocation(_proof, _context):
                raise ConnectionError("deliberately unavailable authoritative store")
            checks["unavailable_revocation_source_refused"] = not boundary.execute(wire, intent, proof, boundary.make_edge(revocation_checker=broken_revocation))["ok"]
            damaged = dataclasses.replace(proof, signature=dataclasses.replace(proof.signature, value="A" * len(proof.signature.value)))
            checks["forged_signature_refused"] = not boundary.execute(wire, intent, damaged)["ok"]
            checks["invalid_proofs_zero_dispatch"] = boundary.dispatches == dispatched
            checks["original_proof_still_works"] = boundary.execute(wire, intent, proof)["ok"]
            checks["replay_refused_after_edge_restart"] = not boundary.execute(wire, intent, proof, boundary.make_edge())["ok"]
            intent, proof = boundary.issue(wire)
            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
            checks["revoked_preissued_proof_refused"] = not boundary.execute(wire, intent, proof)["ok"]
            revoked = contained(docker, image_id, stage, boundary, "revoked", execute["state"])
            checks["retained_capability_cannot_restore_revoked_authority"] = revoked["results"]["run"]["status"] == "failed"
            observed = subprocess.run([sys.executable, str(Path(__file__).with_name("observe.py")), str(output)], capture_output=True, text=True,
                                      env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            (output / "observer.stdout.log").write_text(observed.stdout)
            (output / "observer.stderr.log").write_text(observed.stderr)
            assert observed.returncode == 0, "independent observer failed"
            observation = json.loads(observed.stdout)
            checks["independent_provider_effects_exactly_two"] = observation["effects"] == [{"path": "/entries", "label": "approved"}, {"path": "/entries", "label": "lost"}]
            checks["signed_receipts_and_refusals_verified"] = all(observation["verified_attestations"].values())
            reconciled = []
            for line in (output / "edge.jsonl").read_text().splitlines():
                row = json.loads(line)
                proof, intent = row["proof"], row["intent"]
                reference = proof.get("extensions", {}).get("effect")
                if reference is None:
                    continue
                label = json.loads(base64.b64decode(intent["action"]["parameters"]["body"]))["label"]
                # Never infer commit from the HTTP acknowledgement, Kernel receipt
                # or caller. Only this trusted fixture journal can reconcile it.
                assert sum(e["label"] == label and e["path"] == "/entries" for e in observation["effects"]) == 1
                held = boundary.store.get_effect(reference["effect_id"])[0]
                assert held["state"] == "AMBIGUOUS"
                settled = boundary.store.settle_effect(reference=reference,
                    grant_id=proof["extensions"]["authority"]["grant_id"], principal=intent["requester"]["id"],
                    action_hash=proof["action_hash"]["value"], outcome="COMMITTED", execution_occurred=True,
                    evidence_hash=hashlib.sha256((output / "provider.jsonl").read_bytes()).hexdigest(),
                    observer="independent-fixture-journal-process", reconciliation=True)
                reconciled.append({"label": label, "before": held, "after": settled})
            (output / "reconciliation.json").write_text(json.dumps(reconciled, indent=2, default=str))
            checks["ambiguous_until_trusted_observer_reconciles"] = len(reconciled) == 2 and all(r["after"]["effect"]["outcome"] == "COMMITTED" for r in reconciled)
            result = {"checks": checks, "passed": sum(checks.values()), "total": len(checks), "observer": observation,
                      "scope": "local development fixture; no live model, general software holdout, production credential broker or commercial benchmark"}
            (output / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
            assert all(checks.values()), "experiment acceptance failed; evidence preserved"
        finally:
            boundary.store.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="rightclick-x-linux-test:latest")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    try:
        run(args.output, args.image)
    except BaseException:
        import traceback
        (args.output / "failure.log").write_text(traceback.format_exc())
        raise
