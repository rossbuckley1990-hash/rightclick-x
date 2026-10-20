"""Disposable resource-owned gate; the journal has no raw HTTP backend.

This trusted host process receives only an issuer public key. Native authority
operations use a private Unix socket. It is not a production HTTP server.
"""
import base64
import dataclasses
from datetime import UTC, datetime, timedelta
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import sys
import threading
from uuid import uuid4

from actenon.execution.effects import EffectProtector
from actenon.gate import ActenonGate
from actenon.models import ActionIntent, ActionSpec, PartyRef, TargetRef, TenantRef
from actenon.receipts import OutcomeAttestationService
from actenon.replay import ReplayProtector, SqliteReplayStore
from actenon_permit.boundary.proofs import Ed25519PublicKeyVerifier
from actenon_permit.ed25519_signer import generate_ed25519_keypair, load_ed25519_keypair, resolve_signer, save_ed25519_keypair
from actenon_protocol.effects import EFFECT_PROFILE

config = json.loads(Path(sys.argv[1]).read_text())
private, output = Path(config["private"]), Path(config["output"])
NAMESPACE = "rcx-disposable-entries-v1"
LIMIT = 65536
lock = threading.Lock()
journal = output / "provider.jsonl"
journal.touch(exist_ok=True)
if config.get("asyncCompression"):
    from async_provider import AsyncCompression
    business = AsyncCompression(private, output, config.get("releaseFile"))
else:
    business = None


def append(name, row):
    with lock, (output / name).open("a") as stream:
        stream.write(json.dumps(row, sort_keys=True) + "\n")


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def decode_header(value):
    return json.loads(base64.b64decode(value, validate=True), object_pairs_hook=pairs)


def authority(op, **payload):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(3)
        sock.connect(config["authoritySocket"])
        sock.sendall((json.dumps({"op": op, **payload}) + "\n").encode())
        with sock.makefile("rb") as stream:
            raw = stream.readline(LIMIT + 1)
    if len(raw) > LIMIT or not raw.endswith(b"\n"):
        raise ConnectionError("invalid authority response")
    reply = json.loads(raw)
    if not reply.get("ok"):
        raise ConnectionError("authority operation unavailable")
    return reply["value"]


def descriptor(request):
    intent = request.intent
    return {"profile": EFFECT_PROFILE, "namespace": NAMESPACE, "kind": "semantic",
            "action_type": intent.action.capability,
            "target": {"type": intent.target.resource_type, "id": intent.target.resource_id},
            "semantic_key": {k: intent.action.parameters[k] for k in ("method", "body")}}


received_signing_environment = [k for k in os.environ if k.startswith("ACTENON_")]
assert not received_signing_environment, "resource must not inherit issuer configuration"
key_path = private / "receipt-key.json"
if not key_path.exists():
    save_ed25519_keypair(generate_ed25519_keypair(key_id="resource-receipts-only"), key_path)
os.environ["ACTENON_ED25519_KEY_FILE"] = str(key_path)
signer = resolve_signer()
receipt_public = load_ed25519_keypair(key_path).public_key_jwk
(output / "public.json").write_text(json.dumps(receipt_public))
issuer_public = json.loads(Path(config["issuerPublic"]).read_text())
assert issuer_public != receipt_public
attester = OutcomeAttestationService(signer=signer, issuer=PartyRef(type="service", id="resource-edge"))
gate = ActenonGate(verifier=Ed25519PublicKeyVerifier([issuer_public]),
    audience="service:actenon-permit-gateway", issuer="service:actenon-permit", capabilities=("http.post",),
    replay_protector=ReplayProtector(SqliteReplayStore(private / "replay.db")),
    revocation_checker=lambda proof, _context: authority("revocation", proof=proof.to_dict()),
    effect_protector=EffectProtector(NAMESPACE,
        lambda _reference, request: authority("claim", proof=request.pccb.to_dict(), intent=request.intent.to_dict()), descriptor))
read_gate = ActenonGate(verifier=Ed25519PublicKeyVerifier([issuer_public]),
    audience="service:actenon-permit-gateway", issuer="service:actenon-permit", capabilities=("http.get",),
    replay_protector=ReplayProtector(SqliteReplayStore(private / "replay.db")),
    revocation_checker=lambda proof, _context: authority("revocation", proof=proof.to_dict())) if business else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value, headers=None):
        raw = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def handle_request(self):
        header_names = [name.lower() for name in self.headers.keys()]
        # Only these framing fields are excluded from the semantic request.
        framing = {"host", "content-length", "connection", "accept-encoding", "x-actenon-intent", "x-actenon-proof"}
        semantic = {"accept", "accept-language", "content-type", "user-agent", "sec-fetch-mode"}
        try:
            if len(header_names) != len(set(header_names)) or set(header_names) - framing - semantic:
                raise ValueError("duplicate or unsupported request header")
            length = self.headers.get("content-length", "0")
            if not length.isascii() or not length.isdigit() or int(length) > LIMIT:
                raise ValueError("unsupported body length")
            body = self.rfile.read(int(length))
            if len(body) != int(length) or not self.path.startswith("/") or self.path.startswith("//"):
                raise ValueError("unsupported request framing")
            wire = {"method": self.command, "url": "http://" + self.headers.get("host", "") + self.path,
                    "headers": {name: self.headers[name] for name in header_names if name in semantic},
                    "body": base64.b64encode(body).decode()}
            append("resource-requests.jsonl", {"wire": wire, "hasProof": "x-actenon-proof" in self.headers})
            if business and self.command == "GET" and self.path == "/catalog" and not body:
                self.reply(200, {"linkset": [{"anchor": origin, "service-desc": [
                    {"href": origin + "/openapi.json", "type": "application/vnd.oai.openapi+json"}]}]})
                return
            if self.command == "GET" and self.path == "/openapi.json" and not body:
                if business:
                    self.reply(200, business.spec(origin))
                    return
                self.reply(200, {"openapi": "3.0.0", "info": {"title": "Protected disposable journal", "version": "1"},
                    "servers": [{"url": origin}], "paths": {"/entries": {"post": {
                        "operationId": "appendEntry", "summary": "Append an entry label",
                        "requestBody": {"required": True, "content": {"application/json": {"schema": {
                            "type": "object", "required": ["label"], "properties": {"label": {"type": "string"}}}}}},
                        "responses": {"200": {"description": "Acknowledgement", "content": {"application/json": {"schema": {
                            "type": "object", "properties": {"accepted": {"type": "boolean"}, "label": {"type": "string"}}}}}}}}}}})
                return
            supplied = self.headers.get("x-actenon-intent")
            proof = decode_header(self.headers["x-actenon-proof"]) if "x-actenon-proof" in self.headers else None
            now = datetime.now(UTC)
            template = ActionIntent.from_dict(decode_header(supplied)) if supplied else ActionIntent(
                intent_id="anonymous_" + uuid4().hex, issued_at=now, expires_at=now + timedelta(minutes=1),
                tenant=TenantRef(tenant_id="default"), requester=PartyRef(type="agent", id="anonymous"),
                action=ActionSpec(name="unused", capability="unused", parameters={}), target=TargetRef(resource_type="tool", resource_id=wire["url"]))
            actual = dataclasses.replace(template,
                action=ActionSpec(name="http." + self.command.lower(), capability="http." + self.command.lower(),
                                  parameters={k: wire[k] for k in ("method", "body", "headers")}),
                target=TargetRef(resource_type="tool", resource_id=wire["url"]))
        except (ValueError, TypeError, KeyError) as exc:
            append("preparse-refusals.jsonl", {"method": self.command, "path": self.path, "reason": str(exc)})
            self.reply(400, {"error": "unsupported request profile"})
            return
        executed = {}

        def effect():
            if business:
                with lock:
                    status, headers, value = business.dispatch(self.command, self.path, body, proof["pccb_id"])
                    executed["response"] = (status, headers, value)
                    digest = hashlib.sha256(journal.read_bytes()).hexdigest()
                if self.command == "POST":
                    # COMMITTED means the enqueue effect occurred. It says
                    # nothing about the worker's eventual artifact.
                    return {"effect_evidence": {**proof["extensions"]["effect"], "outcome": "COMMITTED",
                        "execution_occurred": True, "evidence_hash": digest}}
                return {"transport_status": status}
            # Sole business-effect sink in this process. No other listener,
            # route or public operation can reach the journal writer.
            if self.command != "POST" or self.path != "/entries":
                raise ValueError("unsupported resource operation")
            value = json.loads(body, object_pairs_hook=pairs)
            if set(value) != {"label"} or not isinstance(value["label"], str) or not 0 < len(value["label"]) <= 64:
                raise ValueError("unsupported resource parameters")
            row = {"path": self.path, "label": value["label"], "proof": proof["pccb_id"]}
            with lock, journal.open("a") as stream:
                stream.write(json.dumps(row, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
                digest = hashlib.sha256(journal.read_bytes()).hexdigest()
            executed.update(accepted=True, label=value["label"])
            return {"effect_evidence": {**proof["extensions"]["effect"], "outcome": "COMMITTED",
                    "execution_occurred": True, "evidence_hash": digest}}

        outcome = (read_gate if business and self.command == "GET" else gate).protect(actual, proof, effect)
        append("edge.jsonl", {"intent": actual.to_dict(), "proof": proof, "outcome": outcome.to_dict()})
        for kind in ("receipt", "refusal"):
            artifact = getattr(outcome, kind)
            if artifact:
                append("attestations.jsonl", getattr(attester, "attest_" + kind)(artifact).to_dict())
        evidence = outcome.receipt.extensions.get("effect") if outcome.receipt else None
        if evidence:
            # Trusted resource evidence, never a caller-supplied settlement.
            try:
                authority("settle", proof=proof, intent=actual.to_dict(), evidence=evidence)
            except (OSError, ValueError, ConnectionError):
                append("settlement-failures.jsonl", {"proof": proof["pccb_id"]})
                self.reply(503, {"error": "settlement unavailable; effect may have occurred"})
                return
        if executed.get("label") == "lost":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if outcome.ok and "response" in executed:
            status, headers, value = executed["response"]
            self.reply(status, value, headers)
        else:
            self.reply(200 if outcome.ok else 403, executed if outcome.ok else {"reason": outcome.reason_code})

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = handle_request


server = ThreadingHTTPServer(("127.0.0.1", config.get("port", 0)), Handler)
origin = f"http://127.0.0.1:{server.server_port}"
print(json.dumps({"origin": origin, "pid": os.getpid(), "receivedSigningEnvironment": received_signing_environment,
    "separateReceiptKey": issuer_public != receipt_public, "authorityAccess": "private Unix socket; no grant secret supplied",
    "listeners": [origin], "backendListener": None}), flush=True)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
try:
    server.serve_forever()
finally:
    server.server_close()
    if business:
        business.close()
