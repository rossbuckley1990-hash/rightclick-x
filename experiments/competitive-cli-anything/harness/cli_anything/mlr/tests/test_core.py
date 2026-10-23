from cli_anything.mlr.core.filtering import aggregate_exposure, filter_invoices


def test_filter_selects_sorts_and_projects():
    rows = [
        {"invoice_id": "A", "region": "EMEA", "amount": 500.0, "supplier": "One", "extra": "x"},
        {"invoice_id": "B", "region": "EMEA", "amount": 900.0, "supplier": "Two", "extra": "y"},
        {"invoice_id": "C", "region": "AMER", "amount": 900.0, "supplier": "Three", "extra": "z"},
        {"invoice_id": "D", "region": "EMEA", "amount": 499.99, "supplier": "Four", "extra": "w"},
    ]
    assert filter_invoices(rows, "EMEA", 500.0, ["invoice_id", "supplier", "amount"]) == [
        {"invoice_id": "B", "supplier": "Two", "amount": 900.0},
        {"invoice_id": "A", "supplier": "One", "amount": 500.0},
    ]


def test_aggregate_rounds_and_counts():
    rows = [{"invoice_id": "A"}, {"invoice_id": "B"}, {"invoice_id": "C"}]
    out = aggregate_exposure(rows, {"A": ("B", 10.005), "B": ("B", 0.005), "C": ("A", 2.0)})
    assert out == {"bands": [
        {"risk_band": "A", "total_eur": 2.0, "invoice_count": 1},
        {"risk_band": "B", "total_eur": 10.01, "invoice_count": 2},
    ]}


def test_missing_conversion_is_refused():
    try:
        aggregate_exposure([{"invoice_id": "A"}], {})
    except KeyError as exc:
        assert "A" in str(exc)
    else:
        raise AssertionError("missing conversion accepted")
