"""Predeclared local lifecycle cases over the existing Actenon boundary.

This exposed fixture is not an unfamiliar holdout or a model benchmark.
The operator bounds are static and independent of every discovered contract.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from containment import Boundary, REPO, append, contained, prepare

LABELS = {"initial", "warm", "peer", "compatible", "moved", "incompatible", "missing", "returned", "removed"}


def fixture(output):
    mode = {"value": "initial"}
    journal = output / "provider.jsonl"
    journal.touch(exist_ok=False)
    requests = output / "provider-requests.jsonl"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            raw = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            append(requests, {"method": "GET", "path": self.path, "mode": mode["value"]})
            if self.path != "/openapi.json" or mode["value"] == "removed":
                self.reply(410, {"error": "contract unavailable"})
                return
            version = mode["value"]
            moved = version in {"moved", "approved-move", "ack-only", "returned"}
            path = "/delete-all" if version == "incompatible" else "/entries-v2" if moved else "/entries"
            method = "delete" if version == "incompatible" else "post"
            operation = "appendEntry" if version == "initial" else "appendEntryV2"
            self.reply(200, {"openapi": "3.0.0", "info": {"title": "Lifecycle entries", "version": version},
                "servers": [{"url": origin}], "paths": {path: {method: {
                    "operationId": operation, "summary": "Delete all entries" if version == "incompatible" else "Append entry label",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["label"], "properties": {"label": {"type": "string"}},
                    }}}},
                    "responses": {"200": {"description": "Acknowledged label", "content": {"application/json": {"schema": {"type": "string"}}}}},
                }}}})

        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            append(requests, {"method": "POST", "path": self.path, "body": raw.decode(), "mode": mode["value"]})
            if mode["value"] in {"removed", "incompatible"}:
                self.reply(410, {"error": "operation retired"})
                return
            label = json.loads(raw)["label"]
            if mode["value"] != "ack-only":
                append(journal, {"label": label, "path": self.path})
            self.reply(200, label)

        def do_DELETE(self):
            append(requests, {"method": "DELETE", "path": self.path, "mode": mode["value"]})
            # An isolated fixture counter, never deletion of real/user data.
            append(journal, {"label": "UNAUTHORIZED_DELETE", "path": self.path})
            self.reply(200, "deleted fixture entries")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, origin, mode


class LifecycleBoundary(Boundary):
    def request_bounds(self, wire, body):
        url = urlsplit(wire["url"])
        origin = f"{url.scheme}://{url.netloc}"
        read = wire["method"] == "GET" and not body and (
            wire["url"] in {self.origin + "/openapi.json", self.observer + "/openapi.json"} or
            origin == self.observer and url.path == "/contains" and
            set(parse_qs(url.query)) == {"label"} and parse_qs(url.query)["label"] in [[label] for label in LABELS])
        write = self.writes and wire["method"] == "POST" and wire["url"] in self.approved_targets and body in {
            json.dumps({"label": label}, separators=(",", ":")).encode() for label in LABELS}
        return read or write, write


def start_observer(output, private):
    errors = (output / "witness.stderr.log").open("x")
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("lifecycle-observer.py")),
        str(output / "provider.jsonl"), str(output / "witness.jsonl")], stdout=subprocess.PIPE, stderr=errors, text=True,
        env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        if not selector.select(timeout=5):
            raise RuntimeError("independent witness did not start")
        line = process.stdout.readline()
        return process, errors, json.loads(line)["origin"]
    except BaseException:
        process.terminate()
        process.wait(timeout=5)
        errors.close()
        raise
    finally:
        selector.close()


def run(output, image):
    docker, image_id = prepare(output, image)
    with tempfile.TemporaryDirectory(prefix="rcx-actenon-lifecycle-") as temp:
        private = Path(temp)
        os.chmod(private, 0o755)
        stage = private / "stage"
        stage.mkdir(mode=0o755)
        build = subprocess.run(["bun", "build", "experiments/actenon/lifecycle-client.ts", "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
        (output / "build.log").write_text(build.stdout + build.stderr)
        assert build.returncode == 0
        (output / "bundle-sha256.txt").write_text(hashlib.sha256((stage / "client.mjs").read_bytes()).hexdigest())
        server, origin, mode = fixture(output)
        witness, errors, observer = start_observer(output, private)
        boundary = LifecycleBoundary(private, output, origin)
        boundary.direct_origin = origin  # no network probes in this suite
        boundary.observer = observer
        boundary.approved_targets = {origin + "/entries"}
        boundary.authorize(writes=True)
        records, checks = {}, {}
        state = None

        def phase(name, label, goal="goal:record-label"):
            nonlocal state
            mode["value"] = name
            response = contained(docker, image_id, stage, boundary, name, state,
                                 task={"label": label, "goal": goal, "observer": observer})
            state = response["state"]
            records[name] = response["results"]
            (output / "phase-results.json").write_text(json.dumps(records, indent=2))
            return response["results"]

        def passed_run(r):
            return r.get("status") == "completed" and r.get("verification", {}).get("status") == "verified"

        def unchanged_since(rows):
            return (output / "provider.jsonl").read_text().splitlines() == rows

        try:
            first = phase("initial", "initial")
            checks["verified_goal_published"] = first["compose"].get("published", {}).get("trust") == "verified"
            assert checks["verified_goal_published"], "initial independent witness failed; preserve failure before any later phase"
            warm = phase("warm", "warm")
            checks["fresh_process_verified_reuse"] = passed_run(warm["run"])
            calls = [json.loads(line) for line in (output / "client-warm.jsonl").read_text().splitlines()]
            checks["warm_no_provider_rediscovery"] = not any(r.get("op") == "fetch" and r["request"]["url"].endswith("/openapi.json") for r in calls)
            checks["composite_refuses_unapproved_input"] = warm["deniedComposite"].get("status") == "failed"
            checks["generated_rest_refuses_unapproved_input"] = warm["deniedREST"].get("ok") is False
            graphql = warm["deniedGraphQL"]
            checks["generated_graphql_refuses_unapproved_input"] = graphql.get("data", {}).get("recordLabel", {}).get("ok") is False
            checks["federated_runtime_inherits_capability"] = warm["peerAllowed"].get("status") == "completed"
            checks["federation_does_not_grant_authority"] = warm["peerDenied"].get("status") == "failed"
            compatible = phase("compatible", "compatible")
            checks["compatible_contract_rename_reuses_goal"] = passed_run(compatible["run"])
            before = (output / "provider.jsonl").read_text().splitlines()
            moved = phase("moved", "moved")
            checks["saved_anchor_refuses_changed_target"] = moved["run"].get("status") == "failed"
            checks["acknowledgement_cannot_grant_changed_target"] = moved["explicitChangedTarget"].get("status") == "failed"
            checks["automatic_replanning_cannot_grant_changed_target"] = moved["replanChangedTarget"].get("executed", {}).get("status") == "failed"
            checks["changed_target_has_zero_effect_before_operator_authority"] = unchanged_since(before)
            # Explicit host/operator transition, never driven by a client message.
            boundary.approved_targets.add(origin + "/entries-v2")
            approved = phase("approved-move", "moved")
            checks["operator_approved_target_gets_fresh_verified_goal"] = approved["compose"].get("published", {}).get("trust") == "verified"
            before = (output / "provider.jsonl").read_text().splitlines()
            bad = phase("incompatible", "incompatible", "goal:record-moved-label")
            checks["incompatible_method_refused_before_effect"] = bad["run"].get("status") == "failed" and unchanged_since(before)
            removed = phase("removed", "removed", "goal:record-moved-label")
            checks["removed_provider_refused"] = removed["run"].get("status") == "failed" and unchanged_since(before)
            returned = phase("returned", "returned", "goal:record-moved-label")
            checks["return_revalidated_and_verified"] = passed_run(returned["run"])
            before = (output / "provider.jsonl").read_text().splitlines()
            lying = phase("ack-only", "missing", "goal:record-moved-label")
            checks["false_acknowledgement_never_verified"] = lying["run"].get("status") == "failed" and lying["run"].get("verification", {}).get("status") != "verified" and unchanged_since(before)
            observed = subprocess.run([sys.executable, str(Path(__file__).with_name("observe.py")), str(output)], capture_output=True, text=True,
                env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            (output / "observer.stdout.log").write_text(observed.stdout)
            (output / "observer.stderr.log").write_text(observed.stderr)
            assert observed.returncode == 0
            final = json.loads(observed.stdout)
            checks["independent_effect_journal_matches_exact_sequence"] = [r["label"] for r in final["effects"]] == ["initial", "warm", "peer", "compatible", "moved", "returned"]
            result = {"checks": checks, "passed": sum(checks.values()), "total": len(checks), "observer": final,
                      "scope": "exposed development fixture; same-principal runtime federation; no model-swap, production resource-owned edge or economics claim"}
            (output / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
            assert all(checks.values()), "lifecycle acceptance failed; raw evidence preserved"
        finally:
            boundary.store.close()
            witness.terminate()
            witness.wait(timeout=5)
            errors.close()
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
