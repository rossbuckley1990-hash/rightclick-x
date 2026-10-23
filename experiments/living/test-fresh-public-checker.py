"""Synthetic checker regression only. No provider requests or model calls."""
import copy
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-fresh-public-reuse.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
config = json.loads(Path(__file__).with_name("fresh-public-reuse.json").read_text())
rows, expected = [], {}
for index, task in enumerate(config["sessions"]):
    positive = task["expected"] == "publication"
    value = {"entry_id": task["entryId"], "doi": "10.0000/synthetic", "title": ["Synthetic"], "publisher": "Synthetic"}
    reply = "BEGIN\n" + json.dumps(value) + "\nEND" if positive else "UNABLE: synthetic refusal"
    expected[task["id"]] = {k: v for k, v in value.items() if k != "entry_id"} if positive else {"status": 404}
    rows.append({"session": {"task": task, "exit": 0, "reply": reply, "tokens": 15, "seconds": 1},
        "audit": {"threadId": str(index), "violations": [], "contexts": [{"model": task["model"]}]},
        "events": [{"type": "item.completed", "item": {"type": "agent_message", "text": reply}},
                   {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 5}}],
        "mcp": [{"tool": "context_run", "args": {"id": "goal:structure-primary-publication-metadata", "args": {"entry_id": task["entryId"]}},
                 "outcome": {"status": "completed" if positive else "failed"}}],
        "network": [{"discovery": False, "url": "https://" + host + "/item", "status": 200} for host in ["a.test", "b.test"]] if positive else []})
assert checker.verify(rows, expected)["freshThreads"] == 4
rejected = []
for mode in ["no-goal", "wrong-input", "completed-negative", "duplicate-session", "discovery", "tokens", "wrong-publication"]:
    changed = copy.deepcopy(rows)
    if mode == "no-goal":
        changed[0]["mcp"][0]["args"]["id"] = "other"
    elif mode == "wrong-input":
        changed[0]["mcp"][0]["args"]["args"]["entry_id"] = "XXXX"
    elif mode == "completed-negative":
        changed[2]["mcp"][0]["outcome"]["status"] = "completed"
    elif mode == "duplicate-session":
        changed[1]["audit"]["threadId"] = changed[0]["audit"]["threadId"]
    elif mode == "discovery":
        changed[0]["network"][0]["discovery"] = True
    elif mode == "tokens":
        changed[0]["session"]["tokens"] = 16
    else:
        value = json.loads(changed[0]["session"]["reply"].splitlines()[1])
        value["doi"] = "10.0000/wrong"
        reply = "BEGIN\n" + json.dumps(value) + "\nEND"
        changed[0]["session"]["reply"] = reply
        changed[0]["events"][0]["item"]["text"] = reply
    try:
        checker.verify(changed, expected)
    except ValueError:
        rejected.append(mode)
    else:
        raise ValueError("corruption accepted: " + mode)
print(json.dumps({"status": "PASS", "corruptionsRejected": rejected, "modelCalls": 0, "providerRequests": 0}))
