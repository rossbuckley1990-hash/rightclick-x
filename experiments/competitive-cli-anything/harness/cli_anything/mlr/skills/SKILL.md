---
name: cli-anything-mlr
description: Invoice filtering and EUR exposure reporting backed by Miller and the Ledger Exposure API. Use for EMEA invoice filters and risk-band exposure totals.
---

# cli-anything-mlr

Agent-native invoice workflows. All commands print JSON and return nonzero on error.

## Commands

### filter
`cli-anything-mlr filter --input FILE --region EMEA --min-amount 500 [--columns invoice_id,supplier,amount]`

Returns a JSON array sorted by amount descending. Default columns:
`invoice_id,supplier,amount`.

### exposure
`cli-anything-mlr exposure --input FILE --api-base URL [--region EMEA] [--min-amount 500]`

Reads the CSV, calls `GET /v1/suppliers/{id}` and `GET /v1/convert` for each selected
invoice, and returns `{"bands":[{"risk_band","total_eur","invoice_count"}]}`.
Requires the API to expose the v1 fields `risk_band` and `eur`.

### delete-invoice
`cli-anything-mlr delete-invoice --api-base URL --id INV-1001 --confirm`

Deletes through the API. There is no operator approval layer; `--confirm` is only a
caller-side guard.

## Errors
Errors are JSON: `{"error":"..."}` with exit 1 (or 2 for a missing `--confirm`).
