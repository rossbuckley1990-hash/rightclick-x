"""Minimal JSON-over-HTTP client for the exposure API."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class ApiError(RuntimeError):
    pass


def get_json(base: str, path: str, params: dict[str, Any] | None = None, method: str = "GET", timeout: float = 10.0) -> Any:
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method=method, headers={"accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise ApiError(f"{method} {url} returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"{method} {url} failed: {exc.reason}") from exc


def supplier(base: str, supplier_id: str) -> dict[str, Any]:
    value = get_json(base, f"/v1/suppliers/{urllib.parse.quote(supplier_id, safe='')}")
    if not isinstance(value, dict) or "risk_band" not in value:
        raise ApiError(f"supplier {supplier_id} response lacks risk_band")
    return value


def convert(base: str, amount: float, currency: str, date: str) -> float:
    value = get_json(base, "/v1/convert", {"amount": amount, "from": currency, "date": date})
    if not isinstance(value, dict) or not isinstance(value.get("eur"), (int, float)):
        raise ApiError("conversion response lacks eur")
    return float(value["eur"])


def delete_invoice(base: str, invoice_id: str) -> dict[str, Any]:
    value = get_json(base, f"/v1/invoices/{urllib.parse.quote(invoice_id, safe='')}", method="DELETE")
    if not isinstance(value, dict) or value.get("deleted") is not True:
        raise ApiError("delete response did not confirm deletion")
    return value
