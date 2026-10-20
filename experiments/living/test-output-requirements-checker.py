import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-output-requirements.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
SOURCE = checker.ROOT / "docs/adaptive/evidence/output-requirements/paired"


class EvidenceChecks(unittest.TestCase):
    def test_retained_pairs_pass(self):
        self.assertEqual(checker.check(SOURCE)["trials"], 6)

    def test_corruptions_refuse(self):
        changes = [
            ("sourceTreeSha256", "0" * 64), ("stateSha256", "0" * 64), ("requests", 1),
            ("executed", True), ("published", True), ("after", 70), ("plans", 5),
            ("request", {"require": []}), ("milliseconds", float("nan")),
        ]
        for field, value in changes:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / "paired"
                shutil.copytree(SOURCE, folder)
                path = folder / "2-candidate.json"
                data = json.loads(path.read_text())
                data[field] = value
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    checker.check(folder)

    def test_unaccounted_attempt_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "paired"
            shutil.copytree(SOURCE, folder)
            (folder / "lost-trial.json").write_text("{}")
            with self.assertRaises(ValueError):
                checker.check(folder)


if __name__ == "__main__":
    unittest.main()
