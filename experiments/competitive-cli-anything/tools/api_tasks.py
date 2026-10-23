#!/usr/bin/env python3
"""Small terminal-arm integration: CSV + HTTP API, no RCX, no harness.

Authored for the competitive evaluation. Counted as arm integration code.
"""
import argparse
import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def get(base, path, params=None):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def invoice(base, invoice_id):
    return get(base, f"/v1/invoices/{urllib.parse.quote(invoice_id, safe='')}")


def band(base, supplier_id):
    value = get(base, f"/v1/suppliers/{urllib.parse.quote(supplier_id, safe='')}")
    if "risk_band" not in value:
        raise RuntimeError("supplier response lacks risk_band")
    return value["risk_band"]


def eur(base, amount, currency, date):
    value = get(base, "/v1/convert", {"amount": amount, "from": currency, "date": date})
    if not isinstance(value.get("eur"), (int, float)):
        raise RuntimeError("conversion response lacks eur")
    return float(value["eur"])


def t5(base):
    out = []
    for invoice_id in ("INV-1003", "INV-1008", "INV-1012"):
        row = invoice(base, invoice_id)
        out.append({
            "invoice_id": invoice_id,
            "risk_band": band(base, row["supplier_id"]),
            "eur": eur(base, row["amount"], row["currency"], row["issued_on"]),
        })
    return out


def exposure(base, path):
    with open(path, newline="", encoding="utf-8") as fh:
        rows = [
            row for row in csv.DictReader(fh)
            if row["region"] == "EMEA" and float(row["amount"]) >= 500
        ]
    bands = {}
    for row in rows:
        risk = band(base, row["supplier_id"])
        value = eur(base, float(row["amount"]), row["currency"], row["issued_on"])
        entry = bands.setdefault(risk, {"risk_band": risk, "total_eur": 0.0, "invoice_count": 0})
        entry["total_eur"] += value
        entry["invoice_count"] += 1
    for entry in bands.values():
        entry["total_eur"] = round(entry["total_eur"], 2)
    return {"bands": [bands[key] for key in sorted(bands)]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("task", choices=["t5", "t6", "t7", "n1"])
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--input")
    args = parser.parse_args()
    try:
        if args.task == "t5":
            print(json.dumps(t5(args.api_base), indent=2))
        elif args.task in ("t6", "t7"):
            print(json.dumps(exposure(args.api_base, args.input), indent=2))
        else:
            try:
                invoice(args.api_base, "INV-9999")
            except RuntimeError as exc:
                if "HTTP 404" in str(exc):
                    print(json.dumps({"refused": "invoice_not_found", "invoice_id": "INV-9999"}))
                    return 3
                raise
            raise RuntimeError("absent invoice was reported as present")
    except Exception as exc:  # noqa: BLE001 - terminal boundary
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
