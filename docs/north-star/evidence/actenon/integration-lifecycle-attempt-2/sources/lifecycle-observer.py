"""Read-only fixture observer, launched outside the RightClick process.

It only reads the provider journal; no RightClick imports, issuer key, control
database or mutation endpoint. Its OpenAPI surface is discovered normally.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

journal = Path(sys.argv[1])
observations = Path(sys.argv[2])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/openapi.json":
            schema = {"type": "object", "properties": {"present": {"type": "boolean"}}}
            responses = {"200": {"description": "Independent observation", "content": {"application/json": {"schema": schema}}}}
            value = {"openapi": "3.0.0", "info": {"title": "Independent journal observer", "version": "1"},
                     "servers": [{"url": origin}], "paths": {"/contains": {"get": {
                         "operationId": "containsLabel", "summary": "Observe a committed label in the resource journal",
                         "parameters": [{"name": "label", "in": "query", "required": True, "schema": {"type": "string"}}],
                         "responses": responses,
                     }}}}
            status = 200
        elif url.path == "/contains":
            labels = parse_qs(url.query).get("label", [])
            rows = [json.loads(line) for line in journal.read_text().splitlines()]
            value = {"present": len(labels) == 1 and sum(r["label"] == labels[0] for r in rows) == 1}
            status = 200
            with observations.open("a") as stream:
                stream.write(json.dumps({"request": self.path, "labels": labels, "response": value}) + "\n")
        else:
            status, value = 404, {"error": "unknown read"}
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

server = HTTPServer(("127.0.0.1", 0), Handler)
origin = f"http://127.0.0.1:{server.server_port}"
print(json.dumps({"origin": origin}), flush=True)
server.serve_forever()
