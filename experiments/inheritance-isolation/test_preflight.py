import contextlib
import io
import json
import pathlib
import tempfile
import unittest

import preflight


class IsolationInventoryTests(unittest.TestCase):
    def test_empty_inventory_fails_closed(self):
        report = preflight.inventory({})
        self.assertFalse(report["ready"])
        self.assertFalse(report["model_execution_authorized"])
        self.assertFalse(report["isolation_verified"])
        self.assertTrue(all(item["status"] == "MISSING" for item in report["checks"]))

    def test_populated_manifest_is_not_evidence(self):
        supplied = {field: "independently verified and approved" for field in preflight.FIELDS}
        report = preflight.inventory(supplied)
        self.assertFalse(report["ready"])
        self.assertFalse(report["model_execution_authorized"])
        self.assertFalse(report["isolation_verified"])
        self.assertTrue(all(item["status"] == "UNVERIFIED" for item in report["checks"]))

    def test_manifest_values_are_never_echoed(self):
        marker = "test-private-value-not-a-credential"
        report = preflight.inventory({"execution_environment": marker})
        self.assertNotIn(marker, json.dumps(report))

    def test_unknown_or_non_string_fields_refused(self):
        for value in ({"ready": True}, {"network_egress": True}, {"network_egress": " "}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                preflight.inventory(value)

    def test_invalid_or_missing_input_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / "invalid.json"
            file.write_text("not json", encoding="utf-8")
            for path in (file, pathlib.Path(tmp) / "missing"):
                with self.subTest(path=path), contextlib.redirect_stdout(io.StringIO()) as output:
                    status = preflight.main(["--manifest", str(path)])
                    self.assertEqual(status, 1)
                    report = json.loads(output.getvalue())
                    self.assertFalse(report["ready"])
                    self.assertEqual(report["disposition"], "BLOCKED")

    def test_manifest_is_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / "oversized.json"
            file.write_bytes(b" " * (preflight.MAX_MANIFEST_BYTES + 1))
            with self.assertRaises(ValueError):
                preflight.read_manifest(file)

    def test_cli_never_reports_success(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(preflight.main([]), 1)
        self.assertEqual(json.loads(output.getvalue())["disposition"], "BLOCKED")


if __name__ == "__main__":
    unittest.main()
