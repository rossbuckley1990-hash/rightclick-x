import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-graphql-contract.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
EVIDENCE = checker.ROOT / "docs/adaptive/evidence/graphql-contract"


class EvidenceChecks(unittest.TestCase):
    def test_retained_pairs_and_public_check_pass(self):
        for name in ["paired", "paired-final", "paired-complete"]:
            self.assertEqual(checker.check(EVIDENCE / name)["trials"], 6)
        self.assertEqual(checker.check_public(EVIDENCE / "public-attempt3")["requests"], 7)

    def test_replay_corruptions_refuse(self):
        changes = [
            (["sourceTreeSha256"], "0" * 64), (["invalidRequest", "args", "selection"], "{ __typename }"),
            (["invalid", "traffic"], [{"method": "POST", "kind": "invalid", "bytes": 263}]),
            (["restarted", "status"], "completed"), (["invalid", "graphqlFailure", "kind"], "execution-errors"),
            (["invalid", "providerExperience"], {"failed": 1}), (["corrected", "output"], {}),
            (["finalGraphSize"], 50), (["schemaBytes"], 0), (["invalid", "invalidMs"], float("nan")),
        ]
        for keys, value in changes:
            with self.subTest(keys=keys), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / "paired"
                shutil.copytree(EVIDENCE / "paired-complete", folder)
                path = folder / "2-candidate.json"
                data = json.loads(path.read_text())
                target = data
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    checker.check(folder)

    def test_public_corruptions_refuse(self):
        changes = [(["requests"], 6), (["afterInvalid"], 6), (["restartedDiscovery"], 1),
                   (["valid", "output"], []), (["warm", "verification", "status"], "verified"),
                   (["server"], {"data": {}})]
        for keys, value in changes:
            with self.subTest(keys=keys), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / "public"
                shutil.copytree(EVIDENCE / "public-attempt3", folder)
                path = folder / "result.json"
                data = json.loads(path.read_text())
                target = data
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    checker.check_public(folder)

    def test_unaccounted_attempts_refuse(self):
        for name, check in [("paired-complete", checker.check), ("public-attempt3", checker.check_public)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp) / "evidence"
                shutil.copytree(EVIDENCE / name, folder)
                (folder / "lost-trial.json").write_text("{}")
                with self.assertRaises(ValueError):
                    check(folder)


if __name__ == "__main__":
    unittest.main()
