import copy
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlencode

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-reuse-comparison.py"))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)


class Checks(unittest.TestCase):
    def test_real_execution_required(self):
        task = {"entryId": "ABCD", "expected": "publication"}
        truth = {"doi": "10.123/x", "title": ["A paper"], "publisher": "A press"}
        reply = "BEGIN\n" + json.dumps({"entry_id": "ABCD", **truth}) + "\nEND"
        rows = [{"url": "https://data.rcsb.org/graphql", "method": "POST", "status": 200, "body": '{"variables":{"id":"ABCD"}}'}, {"url": "https://api.crossref.org/works/10.123/x", "method": "GET", "status": 200}]
        data = [{"data": {"entry": {"rcsb_primary_citation": {"pdbx_database_id_DOI": truth["doi"]}}}}, {"message": {"DOI": truth["doi"], "title": truth["title"], "publisher": truth["publisher"]}}]
        self.assertTrue(c.assess(task, reply, rows, data, truth)["correct"])
        get_rows = copy.deepcopy(rows)
        get_rows[0].update(method="GET", body="", url="https://data.rcsb.org/graphql?" + urlencode({"query": '{entry(entry_id:"ABCD"){rcsb_primary_citation{pdbx_database_id_DOI}}}'}))
        self.assertTrue(c.assess(task, reply, get_rows, data, truth)["correct"])
        get_rows[0]["url"] = get_rows[0]["url"].replace("ABCD", "WXYZ")
        self.assertFalse(c.assess(task, reply, get_rows, data, truth)["correct"])
        get_rows[0]["url"] = "https://data.rcsb.org/graphql?" + urlencode({"query": 'query($id:String!){entry(entry_id:$id){rcsb_primary_citation{pdbx_database_id_DOI}}}', "variables": json.dumps({"id": "ABCD"})})
        self.assertTrue(c.assess(task, reply, get_rows, data, truth)["correct"])
        get_rows[0]["url"] = get_rows[0]["url"].replace("ABCD", "WXYZ")
        self.assertFalse(c.assess(task, reply, get_rows, data, truth)["correct"])
        for mode in ["memory", "wrong-input", "dataset-doi", "wrong-title", "failed-transport", "wrong-answer"]:
            altered, payloads, text = copy.deepcopy(rows), copy.deepcopy(data), reply
            if mode == "memory":
                altered, payloads = [], []
            elif mode == "wrong-input":
                altered[0]["body"] = '{"variables":{"id":"WXYZ"}}'
            elif mode == "dataset-doi":
                payloads[0]["data"]["entry"]["rcsb_primary_citation"]["pdbx_database_id_DOI"] = "10.123/dataset"
            elif mode == "wrong-title":
                payloads[1]["message"]["title"] = ["Wrong"]
            elif mode == "failed-transport":
                altered[1]["status"] = 500
            else:
                text = reply.replace("A paper", "Wrong")
            self.assertFalse(c.assess(task, text, altered, payloads, truth)["correct"], mode)

    def test_missing_requires_observed_null(self):
        task = {"entryId": "0000", "expected": "unavailable"}
        row = {"url": "https://data.rcsb.org/graphql", "method": "POST", "status": 200, "body": '{"variables":{"id":"0000"}}'}
        self.assertTrue(c.assess(task, "UNABLE: missing", [row], [{"data": {"entry": None}}], {"status": 404})["correct"])
        self.assertFalse(c.assess(task, "UNABLE: missing", [], [], {"status": 404})["correct"])

    def test_usage_and_raw_answer(self):
        session = {"exit": 0, "reply": "answer", "tokens": 12}
        events = [{"type": "item.completed", "item": {"type": "agent_message", "text": "answer"}}, {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2, "cached_input_tokens": 8}}]
        audit = {"violations": [], "contexts": [{"model": "model"}]}
        c.accounting(session, events, audit, "model")
        for change in [{"tokens": 20}, {"reply": "changed"}, {"blocked": "quota"}, {"timedOut": True}]:
            with self.assertRaises(ValueError):
                c.accounting({**session, **change}, events, audit, "model")


unittest.main()
