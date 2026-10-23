"""Separate outcome/trace checker and bounded public oracle; no model calls.

Same author and exposed providers. Native adaptation checking remains unchanged.
"""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location("fresh_model_check", Path(__file__).with_name("check-fresh-public-reuse.py"))
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
require = prior.require


def verify(rows, expected, tools, requests):
    require(len(rows) == 3, "three fresh sessions required")
    identities = set()
    previous = None
    for row in rows:
        session = row["session"]; task = session["task"]
        require(session.get("exit") == 0 and not session.get("blocked") and not session.get("timedOut"), "invalid session")
        audit = row["audit"]
        require(audit["threadId"] not in identities and audit["violations"] == [], "reused thread or unexpected route")
        identities.add(audit["threadId"])
        require(audit["contexts"] and all(c["model"] == task["model"] for c in audit["contexts"]), "model mismatch")
        require(next(e["thread_id"] for e in row["events"] if e["type"] == "thread.started") == audit["threadId"], "thread mismatch")
        messages = [e["item"]["text"] for e in row["events"] if e.get("type") == "item.completed" and e.get("item", {}).get("type") == "agent_message"]
        require(messages and messages[-1] == session["reply"], "answer differs from raw trace")
        usage = [e["usage"] for e in row["events"] if e["type"] == "turn.completed"]
        require(usage and sum(u["input_tokens"] + u["output_tokens"] for u in usage) == session["tokens"], "usage mismatch")
        before, after = session["before"], session["after"]
        require(previous is None or previous == before, "noncontiguous runtime observations")
        previous = after
        calls = session["tools"]
        require(calls == tools[before["toolCalls"]:after["toolCalls"]], "tool evidence mismatch")
        require(len(calls) == after["toolCalls"] - before["toolCalls"], "unaccounted tool")
        require(not any(c["tool"] in {"context_research", "context_learn", "context_compose", "context_forget"} for c in calls), "rediscovery or replacement")
        goal_calls = [c for c in calls if c["tool"] == "context_run"]
        require(goal_calls and all(c["args"].get("id") == "goal:structure-primary-publication-metadata" and
            c["args"].get("args", {}).get("entry_id") == task["entryId"] for c in goal_calls), "retained goal not used on requested input")
        public = session["publicRequests"]
        wires = requests[before["totalRequests"]:after["totalRequests"]]
        require(len(wires) == len(public) == after["totalRequests"] - before["totalRequests"], "unaccounted provider request")
        for wire, request in zip(wires, public, strict=True):
            require(wire["url"] == request["url"] and wire["method"] == request["method"] and
                base64.b64decode(wire["body"]).decode() == request.get("body", ""), "provider wire mismatch")
            require(not request["discovery"] and "__schema" not in request.get("body", "") and "__type" not in request.get("body", ""), "contract discovery")
        require(public and public[0]["url"] == "https://data.rcsb.org/graphql" and
            json.loads(public[0]["body"])["variables"]["entry_id"] == task["entryId"], "wrong resource request")
        value = prior.answer(session["reply"])
        if task["expected"] == "publication":
            require(isinstance(value, dict) and set(value) == {"entry_id", "doi", "title", "publisher"}, "missing structured answer")
            truth = expected[task["id"]]
            require(value["entry_id"] == task["entryId"] and value["doi"].lower() == truth["doi"].lower() and
                value["title"] == truth["title"] and value["publisher"] == truth["publisher"], "wrong primary publication")
            require(len(public) == 2 and all(r["status"] == 200 for r in public), "expected two successful public operations")
            require(public[1]["url"].startswith("https://api.crossref.org/works/") and
                urllib.parse.unquote(public[1]["url"].split("/works/", 1)[1]).lower() == truth["doi"].lower(), "wrong publication request")
            require(any(c.get("outcome", {}).get("status") == "completed" for c in goal_calls), "saved goal not completed")
        else:
            require(task["expected"] == "unavailable" and expected[task["id"]]["status"] == 404, "missing resource not independently established")
            require(value is None and re.search(r"^\s*UNABLE:\s*\S", session["reply"], re.M), "false answer for missing resource")
            require(len(public) == 1 and not any(c.get("outcome", {}).get("status") == "completed" for c in goal_calls), "missing resource executed downstream")
    return {"freshThreads": len(identities), "distinctModels": len({r["session"]["task"]["model"] for r in rows}),
        "positiveOutcomes": 2, "missingResourceRefusals": 1,
        "reportedTokens": sum(r["session"]["tokens"] for r in rows),
        "sessionSeconds": sum(r["session"]["seconds"] for r in rows),
        "providerRequests": sum(len(r["session"]["publicRequests"]) for r in rows),
        "toolCalls": sum(len(r["session"]["tools"]) for r in rows)}


def main():
    root, destination = map(Path, sys.argv[1:3])
    offline = "--offline" in sys.argv[3:]
    if not offline:
        destination.mkdir(parents=True, exist_ok=False)
    read = lambda path: json.loads(path.read_text())
    provenance = read(root / "models/provenance.json")
    sessions = read(root / "models/sessions.json")
    require([s["task"] for s in sessions] == provenance["tasks"] == read(root / "provenance.json")["config"]["modelReuse"], "changed cases")
    tools = read(root / "tool-calls.json")
    journal = prior.jsonl(root / "session.jsonl")
    require(sum(r.get("op") == "reply" and r.get("value", {}).get("ready") is True for r in journal) == 1, "replacement runtime")
    requests = [r["request"] for r in journal if r.get("op") == "fetch"]
    require([r["row"] for r in journal if r.get("op") == "tool-observation"] == tools, "runtime tool journal mismatch")
    require(provenance["endpoint"] == read(root / "presentation.json")["url"] + "/mcp", "model endpoint differs")
    require(read(root / "models/effects-before.json") == read(root / "models/effects-after.json"), "model changed protected resource")
    start, end = read(root / "models/before.json"), read(root / "models/after.json")
    goals = lambda snapshot: {g["slug"]: {k: v for k, v in g.items() if k in
        {"slug", "have", "want", "intent", "verify", "require", "witnesses", "origins", "risks", "through", "anchors", "publishedAt"}} for g in snapshot["state"]["published"]}
    require(goals(start) == goals(end) and len(goals(start)) == 2, "goal obligations changed")
    expected, rows = {}, []

    def get(url, name):
        path = destination / (name + ".json")
        if offline:
            return read(destination / (name + "-status.json"))["status"], read(path)
        request = urllib.request.Request(url, headers={"User-Agent": "RightClick-X-session-reuse-oracle/0.1", "Accept": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(8 * 1024 * 1024 + 1)
            require(len(body) <= 8 * 1024 * 1024, "oversized oracle response")
            path.write_bytes(body)
            (destination / (name + "-status.json")).write_text(json.dumps({"status": response.status, "url": url}))
            return response.status, json.loads(body)

    public = read(root / "public-network.json")
    for session in sessions:
        task = session["task"]; directory = root / "models" / task["id"]
        require(re.fullmatch("[A-Z0-9]{4}", task["entryId"]), "invalid oracle input")
        require("goal:structure-primary-publication-metadata" not in (directory / "prompt.txt").read_text(), "manual goal ID supplied")
        for request in session["publicRequests"]:
            require(request in public, "public journal differs")
            data = (root / f'public-response-{request["id"]}.bin').read_bytes()
            require(len(data) == request["bytes"], "response bytes differ")
        status, structure = get("https://data.rcsb.org/rest/v1/core/entry/" + task["entryId"], task["id"] + "-structure")
        if task["expected"] == "unavailable":
            expected[task["id"]] = {"status": status}
        else:
            require(status == 200, "structure oracle unavailable")
            doi = structure["rcsb_primary_citation"]["pdbx_database_id_DOI"]
            status, publication = get("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe=""), task["id"] + "-publication")
            require(status == 200, "publication oracle unavailable")
            expected[task["id"]] = {"doi": doi, "title": publication["message"]["title"], "publisher": publication["message"]["publisher"]}
        rows.append({"session": session, "events": prior.jsonl(directory / "agent.stdout"), "audit": read(directory / "agent-audit.json")})
    checked = verify(rows, expected, tools, requests)
    rejected = []
    for case in ["answer", "discovery", "hidden-request", "model", "thread", "tokens", "goal"]:
        bad = copy.deepcopy(rows)
        if case == "answer":
            bad[0]["session"]["reply"] = "BEGIN\n{}\nEND"
        elif case == "discovery":
            bad[0]["session"]["publicRequests"][0]["discovery"] = True
        elif case == "hidden-request":
            bad[0]["session"]["publicRequests"].pop()
        elif case == "model":
            bad[0]["audit"]["contexts"][0]["model"] = "other"
        elif case == "thread":
            bad[1]["audit"]["threadId"] = bad[0]["audit"]["threadId"]
        elif case == "tokens":
            bad[0]["session"]["tokens"] += 1
        else:
            next(c for c in bad[0]["session"]["tools"] if c["tool"] == "context_run")["args"]["id"] = "another"
        try:
            verify(bad, expected, tools, requests)
        except ValueError:
            rejected.append(case)
        else:
            raise ValueError("accepted corruption: " + case)
    if not offline:
        (destination / "models-result.json").write_text(json.dumps({"status": "PASS", "checked": checked,
            "corruptionsRejected": rejected, "scope": "Model acts only; this does not establish combined-session completion"}, indent=2) + "\n")
    adaptation = json.loads(subprocess.check_output([sys.executable, "-B", str(Path(__file__).with_name("check-adaptation.py")), str(root)]))
    result = {"status": "PASS", "models": checked, "modelCorruptionsRejected": rejected, "adaptation": adaptation,
        "scope": "same-author separate public/native checking; same persistent runtime and same-vendor fresh models; no independent holdout or comparative economics"}
    if not offline:
        (destination / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    else:
        require(result == read(destination / "result.json"), "offline result differs")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
