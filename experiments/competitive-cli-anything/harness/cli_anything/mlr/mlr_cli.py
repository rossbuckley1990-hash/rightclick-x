"""Click entry point for the independently developed CLI-Anything harness."""
from __future__ import annotations

import json
import sys

import click

from cli_anything.mlr.core.filtering import aggregate_exposure
from cli_anything.mlr.utils import api_backend, mlr_backend

VERSION = "0.1.0"
DEFAULT_COLUMNS = "invoice_id,supplier,amount"


def emit(value: object) -> None:
    click.echo(json.dumps(value, indent=2, sort_keys=True))


def fail(message: str, code: int = 1) -> None:
    emit({"error": message})
    raise SystemExit(code)


@click.group(invoke_without_command=True)
@click.option("--json/--no-json", "json_output", default=True, help="Machine-readable JSON output (default).")
@click.version_option(VERSION)
@click.pass_context
def cli(ctx: click.Context, json_output: bool) -> None:
    """Agent-native commands for invoice data backed by Miller."""
    ctx.ensure_object(dict)
    ctx.obj["json"] = json_output
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@cli.command("filter")
@click.option("--input", "input_path", required=True, type=click.Path(exists=True, dir_okay=False), help="Input CSV.")
@click.option("--region", required=True, help="Region to keep, e.g. EMEA.")
@click.option("--min-amount", required=True, type=float, help="Minimum amount, inclusive.")
@click.option("--columns", default=DEFAULT_COLUMNS, show_default=True, help="Comma-separated output fields.")
def filter_command(input_path: str, region: str, min_amount: float, columns: str) -> None:
    """Filter invoices, sort by amount descending, and project fields."""
    try:
        rows = mlr_backend.filter_json(input_path, region, min_amount, [c.strip() for c in columns.split(",") if c.strip()])
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        fail(str(exc))
    emit(rows)


@cli.command("exposure")
@click.option("--input", "input_path", required=True, type=click.Path(exists=True, dir_okay=False), help="Input CSV.")
@click.option("--api-base", required=True, help="Exposure API base URL.")
@click.option("--region", default="EMEA", show_default=True)
@click.option("--min-amount", default=500.0, show_default=True, type=float)
def exposure_command(input_path: str, api_base: str, region: str, min_amount: float) -> None:
    """Total EUR exposure by supplier risk band, using invoice and API sources."""
    try:
        rows = mlr_backend.filter_json(input_path, region, min_amount, ["invoice_id", "supplier_id", "amount", "currency", "issued_on"])
        conversions: dict[str, tuple[str, float]] = {}
        for row in rows:
            supplier = api_backend.supplier(api_base, str(row["supplier_id"]))
            eur = api_backend.convert(api_base, float(row["amount"]), str(row["currency"]), str(row["issued_on"]))
            conversions[str(row["invoice_id"])] = (str(supplier["risk_band"]), eur)
        emit(aggregate_exposure(rows, conversions))
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        fail(str(exc))


@cli.command("delete-invoice")
@click.option("--api-base", required=True, help="Exposure API base URL.")
@click.option("--id", "invoice_id", required=True)
@click.option("--confirm", is_flag=True, help="Acknowledge permanent deletion.")
def delete_invoice_command(api_base: str, invoice_id: str, confirm: bool) -> None:
    """Delete an invoice through the API. Requires --confirm; no operator gate."""
    if not confirm:
        fail("delete requires --confirm", 2)
    try:
        emit(api_backend.delete_invoice(api_base, invoice_id))
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        fail(str(exc))


def main() -> None:
    try:
        cli()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        emit({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
