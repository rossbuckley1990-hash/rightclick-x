"""Controlled asynchronous provider: a real child process creates gzip artifacts.

No authority lives here. The resource service calls this fixture only inside
its native Actenon gate. Not an application integration in RightClick.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


class AsyncCompression:
    def __init__(self, private, output, release_file=None):
        self.private, self.output = private, output
        self.release_file = Path(release_file) if release_file else None
        self.jobs = {}
        (output / "artifacts").mkdir(exist_ok=True)
        (output / "publications").mkdir(exist_ok=True)

    def release(self):
        release = self.release_file.read_text() if self.release_file else "original"
        if release not in {"original", "compatible", "incompatible"}:
            raise ValueError("unknown controlled provider release")
        return release

    def result(self, value):
        return {"artifact": value} if self.release() != "original" else value

    def spec(self, origin):
        parameter = [{"in": "path", "name": "label", "required": True, "schema": {"type": "string"}}]
        final = {"200": {"description": "Compressed artifact",
            "content": {"application/json": {"schema": {"type": "object", "properties": {
                "sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                "size": {"type": "integer"}, "label": {"type": "string"}}}}}}}
        release = self.release()
        if release != "original":
            schema = final["200"]["content"]["application/json"]["schema"]
            final["200"]["content"]["application/json"]["schema"] = {"type": "object", "properties": {"artifact": schema}}
        contract = {"openapi": "3.1.0", "info": {"title": "Protected compression", "version": "1" if release == "original" else release},
            "servers": [{"url": origin}], "paths": {
                "/jobs": {"post": {"operationId": "compress", "summary": "Compress a document",
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["label", "document"],
                        "properties": {"label": {"type": "string"}, "document": {"type": "string"}}}}}},
                    "responses": {**final, "202": {"description": "Job accepted; artifact not yet established"}}}},
                "/jobs/{label}": {"get": {"operationId": "monitor", "parameters": parameter,
                    "responses": {"202": {"description": "Worker running"}, "303": {"description": "See artifact"}}}},
                "/artifacts/{label}": {"get": {"operationId": "artifact", "parameters": parameter, "responses": final}},
                "/artifacts-moved/{label}": {"get": {"operationId": "movedArtifact", "parameters": parameter, "responses": final}},
                "/publications/{label}": {"post": {"operationId": "publish", "summary": "Publish a verified artifact digest",
                    "parameters": parameter, "requestBody": {"required": True, "content": {"application/json": {"schema": {
                        "type": "object", "required": ["sha256"], "properties": {
                            "sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"}}}}}}, "responses": final}},
            }}
        if release != "original":
            contract["paths"]["/jobs"]["post"]["operationId"] = "compressDocument"
        if release == "incompatible":
            contract["paths"]["/deliveries"] = contract["paths"].pop("/jobs")
        return contract

    def dispatch(self, method, path, body, proof_id):
        if method == "POST" and re.fullmatch(r"/publications/[a-z0-9-]{1,40}", path):
            label = path.split("/")[-1]
            value = json.loads(body)
            data = (self.output / "artifacts" / f"{label}.gz").read_bytes()
            if set(value) != {"sha256"} or value["sha256"] != hashlib.sha256(data).hexdigest():
                raise ValueError("publication does not match actual artifact")
            row = {"kind": "publication", "label": label, "sha256": value["sha256"], "proof": proof_id}
            with (self.output / "publications" / f"{label}.json").open("x") as publication:
                publication.write(json.dumps(row) + "\n"); publication.flush(); os.fsync(publication.fileno())
            with (self.output / "provider.jsonl").open("a") as journal:
                journal.write(json.dumps(row) + "\n"); journal.flush(); os.fsync(journal.fileno())
            return 200, {}, {"label": label, "sha256": value["sha256"], "size": len(data)}
        job_path = "/deliveries" if self.release() == "incompatible" else "/jobs"
        if method == "POST" and path == job_path:
            value = json.loads(body)
            if set(value) != {"label", "document"} or not re.fullmatch(r"[a-z0-9-]{1,40}", value["label"]):
                raise ValueError("unsupported job parameters")
            label, document = value["label"], value["document"]
            if not isinstance(document, str) or len(document.encode()) > 16384 or label in self.jobs:
                raise ValueError("invalid or duplicate job")
            config = self.private / f"job-{label}.json"
            config.write_text(json.dumps({"label": label, "document": document, "output": str(self.output / "artifacts")}))
            worker = subprocess.Popen([sys.executable, str(Path(__file__).with_name("async_worker.py")), str(config)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"})
            self.jobs[label] = worker
            with (self.output / "provider.jsonl").open("a") as journal:
                journal.write(json.dumps({"label": label, "document": document, "worker": worker.pid, "proof": proof_id}) + "\n")
                journal.flush()
                os.fsync(journal.fileno())
            return 202, {"location": f"/jobs/{label}", "retry-after": "0"}, {"accepted": True, "label": label}
        if method == "GET" and re.fullmatch(r"/(jobs|artifacts|artifacts-moved)/[a-z0-9-]{1,40}", path):
            label = path.split("/")[-1]
            worker = self.jobs.get(label)
            if not worker:
                return 404, {}, {"error": "unknown job"}
            if worker.poll() is None:
                return 202, {"location": f"/jobs/{label}", "retry-after": "1"}, {"pending": True}
            if worker.returncode != 0:
                return 500, {}, {"error": "worker failed"}
            if path.startswith("/jobs/"):
                prefix = "/artifacts-moved/" if label == "moved" else "/artifacts/"
                return 303, {"location": prefix + label, "retry-after": "0"}, {}
            data = (self.output / "artifacts" / f"{label}.gz").read_bytes()
            return 200, {}, self.result({"label": label, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
        raise ValueError("unsupported resource operation")

    def close(self):
        for worker in self.jobs.values():
            if worker.poll() is None:
                worker.terminate()
            worker.wait(timeout=5)
