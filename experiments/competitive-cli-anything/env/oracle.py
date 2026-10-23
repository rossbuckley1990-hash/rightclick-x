#!/usr/bin/env python3
"""Independent oracle for the competitive-cli-anything benchmark.

Imports no product code. Reads the fixture CSVs and its own rate table.
Modes:
  expected <task> [file]
  check <task> <json-file-or-dash>
Exit 0 on exact match, 1 on mismatch, 2 on oracle/setup error.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "env" / "fixtures"

RATES = {
    "2026-07-02": {"USD": 0.92, "GBP": 1.17, "EUR": 1.0},
    "2026-07-03": {"USD": 0.91, "GBP": 1.16, "EUR": 1.0},
    "2026-07-06": {"USD": 0.93, "GBP": 1.18, "EUR": 1.0},
    "2026-07-07": {"USD": 0.90, "GBP": 1.15, "EUR": 1.0},
    "2026-07-08": {"USD": 0.94, "GBP": 1.19, "EUR": 1.0},
    "2026-08-03": {"USD": 0.95, "GBP": 1.20, "EUR": 1.0},
    "2026-08-04": {"USD": 0.94, "GBP": 1.21, "EUR": 1.0},
    "2026-08-05": {"USD": 0.96, "GBP": 1.22, "EUR": 1.0},
    "2026-08-06": {"USD": 0.93, "GBP": 1.19, "EUR": 1.0},
    "2026-08-07": {"USD": 0.97, "GBP": 1.23, "EUR": 1.0},
    "2026-08-10": {"USD": 0.95, "GBP": 1.20, "EUR": 1.0},
}
RISK = {"SUP-NW": "B", "SUP-AC": "A", "SUP-KT": "C", "SUP-HL": "B"}


def load(name):
    with open(FIX / name, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["amount"] = float(r["amount"])
    return rows


def emea(rows):
    return sorted(
        [r for r in rows if r["region"] == "EMEA" and r["amount"] >= 500],
        key=lambda r: r["amount"],
        reverse=True,
    )


def t_filter(rows):
    return [
        {"invoice_id": r["invoice_id"], "supplier": r["supplier"], "amount": r["amount"]}
        for r in emea(rows)
    ]


def eur(r):
    return round(r["amount"] * RATES[r["issued_on"]][r["currency"]], 2)


def t_exposure(rows):
    bands = {}
    for r in emea(rows):
        b = bands.setdefault(RISK[r["supplier_id"]], {"risk_band": RISK[r["supplier_id"]], "total_eur": 0.0, "invoice_count": 0})
        b["total_eur"] = round(b["total_eur"] + eur(r), 2)
        b["invoice_count"] += 1
    return {"bands": [bands[k] for k in sorted(bands)]}


def t_convert(rows, ids):
    by_id = {r["invoice_id"]: r for r in rows}
    out = []
    for i in ids:
        if i not in by_id:
            return {"error": "invoice_not_found", "invoice_id": i}
        r = by_id[i]
        out.append({"invoice_id": i, "risk_band": RISK[r["supplier_id"]], "eur": eur(r)})
    return out


def expected(task):
    if task == "t1":
        return t_filter(load("invoices.csv"))
    if task == "t2":
        return t_filter(load("invoices_q3.csv"))
    if task == "t5":
        return t_convert(load("invoices.csv"), ["INV-1003", "INV-1008", "INV-1012"])
    if task == "t6":
        return t_exposure(load("invoices.csv"))
    if task == "t7":
        return t_exposure(load("invoices_q3.csv"))
    raise SystemExit(f"unknown task: {task}")


def compare(actual, want):
    if isinstance(want, list) and isinstance(actual, dict) and "result" in actual:
        actual = actual["result"]
    if actual == want:
        return True, ""
    if isinstance(want, list) and isinstance(actual, list):
        if len(actual) != len(want):
            return False, f"row count {len(actual)} != {len(want)}"
        for i, (a, b) in enumerate(zip(actual, want)):
            if a != b:
                return False, f"row {i}: {json.dumps(a, sort_keys=True)} != {json.dumps(b, sort_keys=True)}"
    return False, f"actual={json.dumps(actual, sort_keys=True)[:500]} want={json.dumps(want, sort_keys=True)[:500]}"


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    mode, task = sys.argv[1], sys.argv[2]
    want = expected(task)
    if mode == "expected":
        print(json.dumps(want, indent=2, sort_keys=True))
        return
    if mode != "check":
        raise SystemExit(__doc__)
    src = sys.argv[3] if len(sys.argv) > 3 else "-"
    raw = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
    try:
        actual = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"FAIL invalid JSON: {exc}")
        raise SystemExit(1)
    ok, why = compare(actual, want)
    print(("PASS " if ok else "FAIL ") + task + ("" if ok else f": {why}"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
