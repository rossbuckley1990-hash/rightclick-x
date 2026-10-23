import json
import os
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FIX = ROOT / "env" / "fixtures"


def _resolve_cli(name="cli-anything-mlr"):
    found = shutil.which(name)
    if not found:
        raise AssertionError(f"{name} not installed")
    return [found]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/v1/suppliers/"):
            sid = self.path.rsplit("/", 1)[-1]
            body = {"id": sid, "name": sid, "country": "NL", "risk_band": {"SUP-NW": "B", "SUP-AC": "A", "SUP-KT": "C"}.get(sid, "A")}
        elif self.path.startswith("/v1/convert"):
            body = {"amount": 1, "from": "GBP", "date": "2026-07-03", "eur": 1.25}
        else:
            self.send_response(404)
            self.end_headers()
            return
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def run(args, env=None):
    return subprocess.run(_resolve_cli() + args, capture_output=True, text=True, env={**os.environ, **(env or {})}, timeout=30)


def test_installed_filter_matches_fixture():
    proc = run(["filter", "--input", str(FIX / "invoices.csv"), "--region", "EMEA", "--min-amount", "500"])
    assert proc.returncode == 0, proc.stderr
    rows = json.loads(proc.stdout)
    assert len(rows) == 7
    assert rows[0] == {"invoice_id": "INV-1001", "supplier": "Northwind Logistics", "amount": 1250.0}
    assert all(set(r) == {"invoice_id", "supplier", "amount"} for r in rows)


def test_installed_exposure_uses_both_sources(monkeypatch=None):
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        proc = run(["exposure", "--input", str(FIX / "invoices.csv"), "--api-base", base, "--region", "EMEA", "--min-amount", "500"])
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert [b["risk_band"] for b in out["bands"]] == ["A", "B", "C"]
        assert sum(b["invoice_count"] for b in out["bands"]) == 7
    finally:
        server.shutdown()


def test_delete_requires_confirm():
    proc = run(["delete-invoice", "--api-base", "http://127.0.0.1:9", "--id", "INV-1001"])
    assert proc.returncode == 2
    assert "confirm" in json.loads(proc.stdout)["error"]
