"""Equal-boundary deterministic saved-script versus RightClick measurement. No model calls."""
import argparse
import base64
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import random
import re
import statistics
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

sys.dont_write_bytecode = True
from containment import REPO, append, contained, prepare
from lifecycle import start_observer
from actenon_permit.model import GrantStatus

spec = importlib.util.spec_from_file_location("resource_experiment", Path(__file__).with_name("resource-experiment.py"))
resource_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = resource_module
spec.loader.exec_module(resource_module)
LABELS = {f"{arm}{index:02}" for arm in ("C", "D") for index in range(22)}


class ComparisonBoundary(resource_module.ResourceBoundary):
    def request_bounds(self, wire, body):
        write = self.writes and wire["method"] == "POST" and wire["url"] == self.origin + "/entries" and body in {
            json.dumps({"label": label}, separators=(",", ":")).encode() for label in LABELS}
        return write, write

    def fetch(self, wire):
        started = time.perf_counter_ns()
        try:
            url = urlsplit(wire["url"])
            query = parse_qs(url.query)
            permitted_observation = (set(wire) == {"method", "url", "headers", "body"}
                and wire["method"] == "GET" and wire["body"] == "" and set(wire["headers"]) <= {"accept", "user-agent"}
                and f"{url.scheme}://{url.netloc}" == self.observer
                and (url.path == "/openapi.json" and not url.query or url.path == "/contains" and set(query) == {"label", "candidate"}
                    and len(query["label"]) == len(query["candidate"]) == 1 and query["label"][0] in LABELS
                    and re.fullmatch(r"[0-9a-f]{64}", query["candidate"][0])))
            if permitted_observation:
                target = urlsplit(self.observer)
                connection = http.client.HTTPConnection(target.hostname, target.port, timeout=3)
                try:
                    connection.request("GET", url.path + ("?" + url.query if url.query else ""))
                    response = connection.getresponse()
                    result = {"ok": response.status == 200, "response": {"status": response.status,
                        "headers": dict(response.getheaders()), "body": base64.b64encode(response.read(65536)).decode()}}
                finally:
                    connection.close()
            else:
                result = super().fetch(wire)
            append(self.measurement_output / "broker-timings.jsonl", {"phase": self.phase, "wire": wire,
                "ok": result["ok"], "reason": result.get("reason"), "elapsedNs": time.perf_counter_ns() - started})
            return result
        except BaseException:
            append(self.measurement_output / "broker-failures.jsonl", {"phase": self.phase, "wire": wire})
            raise


def stats(values):
    ordered = sorted(values)
    return {"n": len(values), "median": statistics.median(values), "p95": ordered[max(0, int(len(ordered) * .95 + .999999) - 1)]}


def run(output, image):
    docker, image_id = prepare(output, image)
    rng = random.Random(472901)
    order = [rng.sample(["C", "D"], 2) for _ in range(21)]
    (output / "design.json").write_text(json.dumps({"seed": 472901, "warmPairs": 20, "order": order, "labels": sorted(LABELS)}, indent=2))
    records = []
    with tempfile.TemporaryDirectory(prefix="rcx-equal-", dir="/private/tmp") as temporary:
        private = Path(temporary)
        os.chmod(private, 0o755)
        issuer, resource = private / "issuer", private / "resource"
        issuer.mkdir(mode=0o700); resource.mkdir(mode=0o700)
        stages = {arm: private / arm / "stage" for arm in ("C", "D")}
        bundles = {}
        for arm, source in (("C", "comparison-script.ts"), ("D", "comparison-rightclick.ts")):
            stage = stages[arm]
            stage.mkdir(parents=True, mode=0o755)
            build = subprocess.run(["bun", "build", "experiments/actenon/" + source, "--target", "node", "--outfile", str(stage / "client.mjs")], cwd=REPO, capture_output=True, text=True)
            (output / f"build-{arm}.log").write_text(build.stdout + build.stderr)
            assert build.returncode == 0
            raw = (stage / "client.mjs").read_bytes()
            bundles[arm] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        (output / "bundles.json").write_text(json.dumps(bundles, indent=2))
        issuer_output = output / "issuer"
        issuer_output.mkdir()
        boundary = ComparisonBoundary(issuer, issuer_output, "pending-resource-origin")
        boundary.measurement_output = output
        public = private / "issuer-public.json"
        public.write_bytes((issuer_output / "public.json").read_bytes())
        (output / "issuer-public.json").write_bytes(public.read_bytes())
        socket_path = issuer / "authority.sock"
        authority = resource_module.authority_service(boundary, socket_path, output)
        process = errors = observer = observer_errors = None
        try:
            config = {"private": str(resource), "output": str(output), "issuerPublic": str(public), "authoritySocket": str(socket_path)}
            process, errors, ready = resource_module.start_resource(private, output, config, "comparison")
            assert ready["receivedSigningEnvironment"] == [] and ready["separateReceiptKey"]
            boundary.origin = boundary.direct_origin = ready["origin"]
            observer, observer_errors, boundary.observer = start_observer(output, private)
            boundary.authorize(writes=True)
            append(output / "operator-transitions.jsonl", {"phase": "authorize", "grant": boundary.grant.model_dump(mode="json"), "labels": sorted(LABELS)})
            states = {"C": None, "D": None}

            def phase(arm, name, label, expect_success, pair=None):
                boundary.phase = name
                started = time.perf_counter_ns()
                response = contained(docker, image_id, stages[arm], boundary, name, states[arm], task={"label": label, "observer": boundary.observer})
                lifecycle_ms = (time.perf_counter_ns() - started) / 1e6
                states[arm] = response["state"]
                result = response["results"]
                record = {"arm": arm, "phase": name, "pair": pair, "label": label, "expectedSuccess": expect_success,
                          "containerLifecycleMs": lifecycle_ms, "result": result}
                records.append(record)
                (output / "measurements.json").write_text(json.dumps(records, indent=2))
                assert (result["status"] == "completed") == expect_success, name + ": " + str(result)
                if expect_success:
                    assert result["label"] == label and result["digest"] == hashlib.sha256(label.encode()).hexdigest() and result["independentlyObserved"] is True
                contract_fetches = sum(r["url"].endswith("/openapi.json") for r in result["requests"])
                assert contract_fetches == (2 if pair == 0 else 0), name + ": repeated/missing acquisition"
                return result

            for pair, pair_order in enumerate(order):
                for arm in pair_order:
                    phase(arm, f"{arm}-{pair:02}", f"{arm}{pair:02}", True, pair)
                print(json.dumps({"completedPair": pair, "of": 20}), flush=True)
            for arm in ("C", "D"):
                phase(arm, arm + "-duplicate", arm + "00", False)
                phase(arm, arm + "-out-of-bounds", "unapproved", False)
            boundary.store.set_status(boundary.grant.id, GrantStatus.REVOKED)
            append(output / "operator-transitions.jsonl", {"phase": "revoke", "grantId": boundary.grant.id})
            for arm in ("C", "D"):
                phase(arm, arm + "-revoked", arm + "21", False)
            observed = subprocess.run([sys.executable, str(Path(__file__).with_name("observe.py")), str(output)], capture_output=True, text=True,
                env={"PATH": os.environ["PATH"], "HOME": str(private), "PYTHONDONTWRITEBYTECODE": "1"})
            (output / "observer.stdout.json").write_text(observed.stdout)
            (output / "observer.stderr.log").write_text(observed.stderr)
            assert observed.returncode == 0
            observation = json.loads(observed.stdout)
            assert [e["label"] for e in observation["effects"]] == [r["label"] for r in records if r["expectedSuccess"]]
            assert observation["verified_attestations"] == {"receipt": 42, "refusal": 0}
            effects = []
            for row in [json.loads(line) for line in (output / "edge.jsonl").read_text().splitlines()]:
                reference = row["proof"]["extensions"]["effect"]
                effects.append(boundary.store.get_effect(reference["effect_id"])[0])
            (output / "committed-effects.json").write_text(json.dumps(effects, indent=2, default=str))
            summary = {}
            for arm in ("C", "D"):
                warm = [r for r in records if r["arm"] == arm and r["pair"] is not None and r["pair"] > 0]
                cold = next(r for r in records if r["arm"] == arm and r["pair"] == 0)
                summary[arm] = {"coldClientMs": cold["result"]["clientMs"], "coldContainerLifecycleMs": cold["containerLifecycleMs"],
                    "warmClientMs": stats([r["result"]["clientMs"] for r in warm]), "warmContainerLifecycleMs": stats([r["containerLifecycleMs"] for r in warm]),
                    "warmStateBytes": stats([r["result"]["stateBytes"] for r in warm]), "clientBundle": bundles[arm]}
            result = {"scope": "deterministic equal-boundary runtime overhead; not coding-agent economics, holdout or adaptation", "correctEffects": 42,
                "warmOperations": 40, "refusedControls": 6, "summary": summary,
                "rightclickToScriptWarmClientRatio": summary["D"]["warmClientMs"]["median"] / summary["C"]["warmClientMs"]["median"],
                "rightclickToScriptWarmContainerRatio": summary["D"]["warmContainerLifecycleMs"]["median"] / summary["C"]["warmContainerLifecycleMs"]["median"],
                "competitiveGate": "NOT ESTABLISHED", "releaseReadiness": "NO-GO"}
            (output / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
        finally:
            for child, stream in ((observer, observer_errors), (process, errors)):
                if child and child.poll() is None: child.terminate(); child.wait(timeout=5)
                if stream: stream.close()
            authority.shutdown(); authority.server_close()
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
