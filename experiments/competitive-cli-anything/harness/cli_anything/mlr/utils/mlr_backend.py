"""Thin, argument-safe wrapper over the Miller executable."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any


class MlrError(RuntimeError):
    pass


def resolve_mlr() -> str:
    explicit = os.environ.get("CLI_ANYTHING_MLR_BIN")
    found = explicit or shutil.which("mlr")
    if not found:
        raise MlrError("mlr not found; install Miller or set CLI_ANYTHING_MLR_BIN")
    return found


def filter_json(input_path: str, region: str, min_amount: float, columns: list[str], timeout: float = 20.0) -> list[dict[str, Any]]:
    if not columns or any(not c.replace("_", "").isalnum() for c in columns):
        raise MlrError("columns must be simple field names")
    if not region.replace("_", "").isalnum():
        raise MlrError("region must be a simple name")
    expr = f'$region=="{region}" && $amount>={float(min_amount)}'
    args = [resolve_mlr(), "--icsv", "--ojson", "filter", expr, "then", "sort", "-nr", "amount", "then", "cut", "-f", ",".join(columns), input_path]
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env={"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/tmp")})
    if proc.returncode != 0:
        raise MlrError(f"mlr exited {proc.returncode}: {proc.stderr.strip()[:300]}")
    try:
        value = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise MlrError(f"mlr returned invalid JSON: {exc}") from exc
    if not isinstance(value, list):
        raise MlrError("mlr did not return a JSON array")
    return value
