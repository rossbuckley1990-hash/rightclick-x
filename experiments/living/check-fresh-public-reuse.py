"""Separate public readback and result interpretation; same author, no model calls."""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def require(ok, message):
    if not ok:
        raise ValueError(message)


def jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def answer(reply):
    match = re.search(r"^BEGIN\s*\n([\s\S]*?)^END\s*$", reply, re.M)
    if not match:
        return None
    return json.loads(match[1])


def verify(rows, expected):
    require(len(rows) == 4, "four completed sessions required")
    identities = set()
    for row in rows:
        session, task = row["session"], row["session"]["task"]
        require(session.get("exit") == 0 and not session.get("blocked") and not session.get("timedOut"), "invalid session")
        require(row["audit"]["threadId"] not in identities, "session identity reused")
        identities.add(row["audit"]["threadId"])
        require(row["audit"]["violations"] == [], "unexpected tool route")
        require(row["audit"]["contexts"] and all(c["model"] == task["model"] for c in row["audit"]["contexts"]), "wrong model")
        messages = [e["item"]["text"] for e in row["events"] if e.get("type") == "item.completed" and e.get("item", {}).get("type") == "agent_message"]
        require(messages and messages[-1] == session["reply"], "raw answer differs")
        turns = [e["usage"] for e in row["events"] if e.get("type") == "turn.completed"]
        require(turns and sum(u["input_tokens"] + u["output_tokens"] for u in turns) == session["tokens"], "usage mismatch")
        calls = row["mcp"]
        require(not any(c["tool"] in ["context_learn", "context_compose"] for c in calls), "rediscovery or replacement")
        goal_calls = [c for c in calls if c["tool"] == "context_run" and c["args"].get("id") == "goal:structure-primary-publication-metadata"]
        require(goal_calls and all(c["args"].get("args", {}).get("entry_id") == task["entryId"] for c in goal_calls), "saved goal not invoked on requested input")
        requests = row["network"]
        require(not any(r["discovery"] or "__schema" in r.get("body", "") or "__type" in r.get("body", "") or r["url"].endswith("/swagger-docs") for r in requests), "contract rediscovery")
        value = answer(session["reply"])
        if task["expected"] == "publication":
            require(isinstance(value, dict) and set(value) == {"entry_id", "doi", "title", "publisher"}, "missing structured publication")
            truth = expected[task["id"]]
            require(value["entry_id"] == task["entryId"], "wrong input")
            require(value["doi"].lower() == truth["doi"].lower() and value["title"] == truth["title"] and value["publisher"] == truth["publisher"], "wrong primary publication")
            require(len(requests) == 2 and len({urllib.parse.urlparse(r["url"]).netloc for r in requests}) == 2, "expected exactly two producing-provider requests")
            require(all(r.get("status") == 200 and not r.get("error") for r in requests), "provider execution failure")
            require(any(c.get("outcome", {}).get("status") == "completed" for c in goal_calls), "goal did not complete")
        else:
            require(value is None and re.search(r"^\s*UNABLE:\s*\S", session["reply"], re.M), "negative control returned an answer")
            require(not any(c.get("outcome", {}).get("status") == "completed" for c in calls), "negative control completed")
            if task["expected"] == "denied":
                require(not requests, "provider request after withdrawn local permission")
            else:
                require(expected[task["id"]]["status"] == 404, "missing input not independently established")
    return {"positiveSessions": 2, "refusals": 2, "freshThreads": len(identities),
            "reportedTokens": sum(r["session"]["tokens"] for r in rows),
            "sessionSeconds": sum(r["session"]["seconds"] for r in rows),
            "providerRequests": sum(len(r["network"]) for r in rows)}


def main():
    root, destination = map(Path, sys.argv[1:])
    destination.mkdir(parents=True, exist_ok=False)
    provenance = json.loads((root / "provenance.json").read_text())
    sessions = json.loads((root / "sessions.json").read_text())
    require([s["task"] for s in sessions] == provenance["config"]["sessions"], "task selection changed")
    rows, expected = [], {}

    def get(url, name):
        request = urllib.request.Request(url, headers={"User-Agent": "RightClick-X-fresh-reuse-oracle/0.1", "Accept": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read(8 * 1024 * 1024 + 1)
            require(len(data) <= 8 * 1024 * 1024, "oracle response too large")
            (destination / (name + ".json")).write_bytes(data)
            return response.status, json.loads(data)

    for session in sessions:
        task = session["task"]; directory = root / task["id"]
        network = jsonl(directory / "network.jsonl")
        for request in network:
            if "sha256" in request:
                body = (directory / f'response-{request["id"]}.bin').read_bytes()
                require(hashlib.sha256(body).hexdigest() == request["sha256"] and len(body) == request["bytes"], "response changed")
        rows.append({"session": session, "network": network, "mcp": jsonl(directory / "mcp.jsonl"),
                     "events": jsonl(directory / "agent.stdout"), "audit": json.loads((directory / "agent-audit.json").read_text())})
        if task["expected"] == "denied":
            continue
        require(re.fullmatch("[A-Z0-9]{4}", task["entryId"]), "invalid oracle input")
        status, structure = get("https://data.rcsb.org/rest/v1/core/entry/" + task["entryId"], task["id"] + "-structure")
        if task["expected"] == "unavailable":
            expected[task["id"]] = {"status": status}
        else:
            require(status == 200, "structure oracle unavailable")
            doi = structure["rcsb_primary_citation"]["pdbx_database_id_DOI"]
            status, publication = get("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe=""), task["id"] + "-publication")
            require(status == 200, "publication oracle unavailable")
            expected[task["id"]] = {"doi": doi, "title": publication["message"]["title"], "publisher": publication["message"]["publisher"]}
    (destination / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
    try:
        checked = verify(rows, expected)
        rejected = []
        for mode in ["answer", "discovery", "hidden-request", "model", "denied-call", "tokens"]:
            changed = copy.deepcopy(rows)
            if mode == "answer":
                value = answer(changed[0]["session"]["reply"]); value["doi"] = "10.0000/incorrect"
                reply = "BEGIN\n" + json.dumps(value) + "\nEND"
                changed[0]["session"]["reply"] = reply
                [e for e in changed[0]["events"] if e.get("type") == "item.completed" and e.get("item", {}).get("type") == "agent_message"][-1]["item"]["text"] = reply
            elif mode == "discovery":
                changed[0]["network"][0]["discovery"] = True
            elif mode == "hidden-request":
                changed[0]["network"].pop()
            elif mode == "model":
                changed[0]["audit"]["contexts"][0]["model"] = "different"
            elif mode == "denied-call":
                changed[-1]["network"] = copy.deepcopy(changed[0]["network"])
            else:
                changed[0]["session"]["tokens"] += 1
            try:
                verify(changed, expected)
            except ValueError:
                rejected.append(mode)
            else:
                raise ValueError("accepted corrupted evidence: " + mode)
        result = {"status": "PASS", "checked": checked, "corruptionsRejected": rejected}
    except (ValueError, KeyError, TypeError) as error:
        result = {"status": "FAIL", "error": str(error)}
    result["scope"] = "same-author separate public readback; two models, one vendor; exposed providers, no economic or independent-author holdout claim"
    (destination / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
