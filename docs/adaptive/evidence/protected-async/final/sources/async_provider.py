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
    def __init__(self, private, output):
        self.private, self.output = private, output
        self.jobs = {}
        (output / "artifacts").mkdir(exist_ok=True)

    def spec(self, origin):
        parameter = [{"in": "path", "name": "label", "required": True, "schema": {"type": "string"}}]
        final = {"200": {"description": "Compressed artifact",
            "content": {"application/json": {"schema": {"type": "object", "properties": {
                "sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                "size": {"type": "integer"}, "label": {"type": "string"}}}}}}}
        return {"openapi": "3.1.0", "info": {"title": "Protected compression", "version": "1"},
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
            }}

    def dispatch(self, method, path, body, proof_id):
        if method == "POST" and path == "/jobs":
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
            return 200, {}, {"label": label, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
        raise ValueError("unsupported resource operation")

    def close(self):
        for worker in self.jobs.values():
            if worker.poll() is None:
                worker.terminate()
            worker.wait(timeout=5)
