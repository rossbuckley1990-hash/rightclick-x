"""Trusted development operator for the living session. No agent control channel.

Reuses the audited resource-owned native gate. The caller owns this process;
only fetch envelopes, never control operations, are relayed from the container.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import urllib.request
import urllib.error

sys.dont_write_bytecode = True
from workflow import WorkflowBoundary, fixture
from containment import append
from actenon_permit.model import GrantStatus


class ExactBoundary(WorkflowBoundary):
    approved_writes = set()

    def request_bounds(self, wire, body):
        if wire["method"] == "GET":
            return super().request_bounds(wire, body)
        key = (wire["method"], wire["url"], hashlib.sha256(body).hexdigest())
        allowed = self.writes and key in self.approved_writes
        return allowed, allowed


def main(output):
    output.mkdir(parents=True, exist_ok=False)
    issued = output / "issuer"
    issued.mkdir()
    with tempfile.TemporaryDirectory(prefix="rcx-living-boundary-", dir="/private/tmp") as temporary:
        private = Path(temporary)
        issuer, provider = private / "issuer", private / "provider"
        issuer.mkdir(mode=0o700)
        provider.mkdir(mode=0o700)
        boundary = ExactBoundary(issuer, issued, "pending")
        boundary.artifact_root = output / "artifacts"
        public = private / "issuer-public.json"
        public.write_bytes((issued / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket = issuer / "authority.sock"
        service = fixture.resource.authority_service(boundary, socket, output)
        resource = errors = None
        try:
            resource, errors, ready = fixture.resource.start_resource(private, output, {
                "private": str(provider), "output": str(output), "issuerPublic": str(public),
                "authoritySocket": str(socket), "asyncCompression": True,
            }, "living")
            boundary.origin = boundary.direct_origin = ready["origin"]
            print(json.dumps({"op": "ready", "origin": boundary.origin, "resource": ready}), flush=True)
            for raw in sys.stdin:
                command = json.loads(raw)
                identity = command["id"]
                try:
                    op = command["op"]
                    if op == "fetch":
                        result = boundary.fetch(command["request"])
                        # Missing response from native forwarding can be ambiguous.
                        # Only an explicit pre-dispatch issuer refusal is refusal.
                        value = result if result.get("response") else {
                            "refused": "exception" not in result, "reason": result.get("reason", "unresolved transport")}
                    elif op == "authorize":
                        approved = set()
                        for wire in command["requests"]:
                            if wire["method"] != "POST" or wire["url"] not in {
                                boundary.origin + "/jobs",
                                *(boundary.origin + "/publications/" + label for label in fixture.DOCUMENTS),
                            }:
                                raise ValueError("unsupported disposable effect")
                            body = base64.b64decode(wire["body"], validate=True)
                            if len(body) > 16384:
                                raise ValueError("effect body exceeds bound")
                            approved.add((wire["method"], wire["url"], hashlib.sha256(body).hexdigest()))
                        if boundary.grant is not None:
                            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
                        boundary.approved_writes = approved
                        boundary.authorize(writes=True)
                        append(output / "operator.jsonl", {"op": op, "grant": boundary.grant.model_dump(mode="json"),
                            "requests": command["requests"]})
                        value = {"grant": boundary.grant.id, "exactRequests": len(approved)}
                    elif op == "revoke":
                        if boundary.grant is not None:
                            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
                        append(output / "operator.jsonl", {"op": op})
                        value = {"revoked": True}
                    elif op == "snapshot":
                        value = {"effects": [json.loads(line) for line in (output / "provider.jsonl").read_text().splitlines()]
                            if (output / "provider.jsonl").exists() else [],
                            "artifacts": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in (output / "artifacts").glob("*.gz")}}
                    elif op == "probe":
                        # Trusted controller's disposable negative control.
                        # This channel is never relayed from the runtime.
                        request = urllib.request.Request(boundary.origin + "/jobs", method="POST",
                            data=b'{"label":"first","document":"Unauthorized control"}',
                            headers={"content-type": "application/json"})
                        try:
                            with urllib.request.urlopen(request, timeout=5) as response:
                                value = {"status": response.status}
                        except urllib.error.HTTPError as error:
                            value = {"status": error.code}
                        if value["status"] != 403:
                            raise AssertionError("unprotected resource control was not refused")
                    elif op == "close":
                        print(json.dumps({"op": "reply", "id": identity, "value": {"closed": True}}), flush=True)
                        break
                    else:
                        raise ValueError("unsupported operator command")
                    print(json.dumps({"op": "reply", "id": identity, "value": value}), flush=True)
                except Exception as error:
                    print(json.dumps({"op": "reply", "id": identity, "error": type(error).__name__ + ": " + str(error)}), flush=True)
        finally:
            if boundary.grant is not None:
                boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
            if resource is not None:
                resource.terminate()
                resource.wait(timeout=10)
            if errors is not None:
                errors.close()
            service.shutdown()
            service.server_close()
            boundary.store.close()


signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
