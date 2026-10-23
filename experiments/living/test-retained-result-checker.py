import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-retained-result.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
EVIDENCE = checker.ROOT / "docs/adaptive/evidence/retained-result"


class Checks(unittest.TestCase):
    def test_all_retained_batches_pass(self):
        for name in ["paired", "paired-isolated", "paired-final"]:
            self.assertEqual(checker.check(EVIDENCE / name)["trials"], 4)

    def test_corrupted_results_refuse(self):
        changes = [
            (["sourceTreeSha256"], "0" * 64), (["stateSha256"], "0" * 64),
            (["callsBeforeRestart"], 3), (["graphAfter"], 70), (["run", "output"], {}),
            (["run", "verification", "status"], "verified"), (["goalsAfter", 0, "publishedAt"], "new publication"),
            (["goalsAfter", 0, "lastResult", "fields", 0, "path"], "invented"),
            (["after", "reuse", "restrictions", "origins"], []),
            (["after", "contract", "outputSemantics", "lastResult", "status"], "matches-current-result-declaration"),
            (["bytes", "after"], 1), (["milliseconds"], float("nan")),
        ]
        for path, value in changes:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / "paired"
                shutil.copytree(EVIDENCE / "paired-final", folder)
                target = folder / "2-candidate-warm1-d.json"
                data = json.loads(target.read_text())
                cursor = data
                for key in path[:-1]:
                    cursor = cursor[key]
                cursor[path[-1]] = value
                target.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    checker.check(folder)

    def test_unaccounted_attempt_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "paired"
            shutil.copytree(EVIDENCE / "paired-final", folder)
            (folder / "lost-trial.json").write_text("{}")
            with self.assertRaises(ValueError):
                checker.check(folder)


if __name__ == "__main__":
    unittest.main()
