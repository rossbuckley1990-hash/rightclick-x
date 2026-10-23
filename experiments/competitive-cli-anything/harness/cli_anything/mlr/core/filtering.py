"""Pure invoice transformations used by the CLI harness."""
from __future__ import annotations

from typing import Any, Iterable


def filter_invoices(rows: Iterable[dict[str, Any]], region: str, min_amount: float, columns: list[str]) -> list[dict[str, Any]]:
    selected = [r for r in rows if str(r.get("region")) == region and float(r.get("amount", 0)) >= min_amount]
    selected.sort(key=lambda r: float(r.get("amount", 0)), reverse=True)
    return [{c: r[c] for c in columns} for r in selected]


def aggregate_exposure(rows: Iterable[dict[str, Any]], conversions: dict[str, tuple[str, float]]) -> dict[str, Any]:
    bands: dict[str, dict[str, Any]] = {}
    for row in rows:
        invoice_id = str(row["invoice_id"])
        if invoice_id not in conversions:
            raise KeyError(f"missing conversion for {invoice_id}")
        risk, eur = conversions[invoice_id]
        band = bands.setdefault(risk, {"risk_band": risk, "total_eur": 0.0, "invoice_count": 0})
        band["total_eur"] += eur
        band["invoice_count"] += 1
    for band in bands.values():
        band["total_eur"] = round(band["total_eur"], 2)
    return {"bands": [bands[k] for k in sorted(bands)]}
