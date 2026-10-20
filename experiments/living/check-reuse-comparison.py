"""Same-author independent implementation of observation checks; no product imports."""
import hashlib
import json
from pathlib import Path
import re
import statistics
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(s) for s in path.read_text().splitlines() if s]


def answer(reply):
    matches = re.findall(r"^BEGIN\s*\n([\s\S]*?)^END\s*$", reply, re.M)
    if len(matches) != 1:
        return None
    try:
        return json.loads(matches[0])
    except ValueError:
        return None


def children(value):
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from children(item)
    if isinstance(value, list):
        for item in value:
            yield from children(item)


def assess(task, reply, network, payloads, truth):
    """Wrong answers remain scored failures rather than corrupting trial accounting."""
    entry = task["entryId"]
    producing = []
    for row, payload in zip(network, payloads):
        parsed = urllib.parse.urlparse(row["url"])
        if parsed.hostname != "data.rcsb.org" or row.get("discovery"):
            continue
        if parsed.path == "/rest/v1/core/entry/" + entry or (row["method"] == "POST" and re.search(r'"' + re.escape(entry) + r'"', row.get("body", "").replace('\\"', '"'))):
            producing.append((row, payload))
    value = answer(reply)
    if task["expected"] == "unavailable":
        missing = any(row.get("status") == 404 or isinstance(payload, dict) and isinstance(payload.get("data"), dict) and payload["data"].get("entry", "not-null") is None for row, payload in producing)
        correct = truth.get("status") == 404 and missing and value is None and bool(re.search(r"^\s*UNABLE:\s*\S", reply, re.M))
        return {"correct": correct, "answered": value is not None, "observedInput": bool(producing), "observedPrimary": False, "observedPublication": False}
    shape = isinstance(value, dict) and set(value) == {"entry_id", "doi", "title", "publisher"}
    exact = shape and value["entry_id"] == entry and isinstance(value["doi"], str) and value["doi"].lower() == truth["doi"].lower() and value["title"] == truth["title"] and value["publisher"] == truth["publisher"]
    primary = any(row.get("status") == 200 and any(isinstance(obj, dict) and isinstance(obj.get("rcsb_primary_citation"), dict) and str(obj["rcsb_primary_citation"].get("pdbx_database_id_DOI", "")).lower() == truth["doi"].lower() for obj in children(payload)) for row, payload in producing)
    publication = any(urllib.parse.urlparse(row["url"]).hostname == "api.crossref.org" and row.get("status") == 200 and isinstance(payload, dict) and isinstance(payload.get("message"), dict) and str(payload["message"].get("DOI", "")).lower() == truth["doi"].lower() and payload["message"].get("title") == truth["title"] and payload["message"].get("publisher") == truth["publisher"] for row, payload in zip(network, payloads))
    return {"correct": bool(exact and primary and publication), "answered": value is not None, "observedInput": bool(producing), "observedPrimary": primary, "observedPublication": publication}


def accounting(session, events, audit, model):
    require(session.get("exit") == 0 and not session.get("blocked") and not session.get("timedOut"), "invalid session")
    require(audit["violations"] == [] and audit["contexts"] and all(c["model"] == model for c in audit["contexts"]), "tool/model audit failed")
    messages = [e["item"]["text"] for e in events if e.get("type") == "item.completed" and e.get("item", {}).get("type") == "agent_message"]
    require(messages and messages[-1] == session["reply"], "raw reply mismatch")
    usage = [e["usage"] for e in events if e.get("type") == "turn.completed"]
    require(usage and all(isinstance(u.get(k), int) and u[k] >= 0 for u in usage for k in ["input_tokens", "output_tokens"]), "missing usage")
    require(sum(u["input_tokens"] + u["output_tokens"] for u in usage) == session["tokens"], "token mismatch")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("oracle redirect refused")


def oracle(config_path, destination):
    config = load(config_path)
    destination.mkdir(parents=True, exist_ok=False)
    opener = urllib.request.build_opener(NoRedirect())
    result = {}

    def get(url, name):
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "RightClick-X-reuse-comparison-oracle/0.1"})
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read(8 * 1024 * 1024 + 1)
            require(len(data) <= 8 * 1024 * 1024, "oracle response bound exceeded")
            (destination / (name + ".json")).write_bytes(data)
            (destination / (name + "-status.json")).write_text(json.dumps({"url": url, "status": response.status, "sha256": hashlib.sha256(data).hexdigest()}))
            return response.status, json.loads(data)

    for entry in dict.fromkeys(t["entryId"] for t in config["tasks"]):
        status, structure = get("https://data.rcsb.org/rest/v1/core/entry/" + entry, entry + "-structure")
        if status == 404:
            result[entry] = {"status": status}
        else:
            require(status == 200, "structure oracle unavailable")
            doi = structure["rcsb_primary_citation"]["pdbx_database_id_DOI"]
            status, publication = get("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe=""), entry + "-publication")
            require(status == 200, "publication oracle unavailable")
            result[entry] = {"doi": doi, "title": publication["message"]["title"], "publisher": publication["message"]["publisher"]}
    (destination / "expected.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"oracleInputs": len(result)}))


def verify(root, oracle_dir, destination):
    provenance = load(root / "provenance.json")
    config = provenance["config"]
    for name, digest in provenance["sources"].items():
        frozen = subprocess.check_output(["git", "show", provenance["revision"] + ":" + name])
        require(hashlib.sha256(frozen).hexdigest() == digest, "source freeze mismatch: " + name)
    frozen_config = subprocess.check_output(["git", "show", provenance["revision"] + ":experiments/living/reuse-comparison.json"])
    require(json.loads(frozen_config) == config, "configuration changed")
    expected = load(oracle_dir / "expected.json")
    # Verify the separate oracle projection from retained original responses.
    for entry, truth in expected.items():
        structure = load(oracle_dir / (entry + "-structure.json"))
        status = load(oracle_dir / (entry + "-structure-status.json"))
        require(hashlib.sha256((oracle_dir / (entry + "-structure.json")).read_bytes()).hexdigest() == status["sha256"], "oracle bytes changed")
        if "doi" in truth:
            publication = load(oracle_dir / (entry + "-publication.json"))["message"]
            pstatus = load(oracle_dir / (entry + "-publication-status.json"))
            require(hashlib.sha256((oracle_dir / (entry + "-publication.json")).read_bytes()).hexdigest() == pstatus["sha256"], "publication oracle bytes changed")
            require(status["status"] == pstatus["status"] == 200 and truth == {"doi": structure["rcsb_primary_citation"]["pdbx_database_id_DOI"], "title": publication["title"], "publisher": publication["publisher"]}, "oracle projection mismatch")
        else:
            require(truth == {"status": 404} and status["status"] == 404, "missing oracle mismatch")
    sessions = load(root / "sessions.json")
    require([r["task"] for r in sessions] == config["tasks"], "incomplete or altered task order")
    identities, retained, scores = set(), {}, []
    for row in sessions:
        task = row["task"]; directory = root / task["id"]
        audit = load(directory / "agent-audit.json")
        accounting(row, lines(directory / "agent.stdout"), audit, config["model"])
        require(audit["threadId"] not in identities, "fresh thread reused"); identities.add(audit["threadId"])
        require(load(directory / "before.json") == retained.get(task["arm"]), "state not retained from own previous session")
        after = load(directory / "after.json"); retained[task["arm"]] = after["state"]
        require(after["rss"] == row["rss"], "RSS snapshot mismatch")
        container = load(directory / "container.json"); host = container["host"]
        require(container["image"] == config["image"] and host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and not host["Privileged"] and container["user"] == "10000:10000" and host["CapDrop"] == ["ALL"] and "no-new-privileges" in host["SecurityOpt"], "container boundary mismatch")
        require(len(container["mounts"]) == 1 and not container["mounts"][0]["RW"] and container["mounts"][0]["Destination"] == "/input", "unexpected mount")
        network = lines(directory / "network.jsonl"); calls = lines(directory / "mcp.jsonl"); denied = lines(directory / "refusals.jsonl")
        require(len(calls) == row["tools"] and len(network) == row["requests"] and len(denied) == row["refusals"], "observation counts differ")
        require(sum(bool(r["discovery"]) for r in network) == row["discoveryRequests"], "discovery count differs")
        require(len(network) <= 24, "request budget exceeded")
        payloads = []
        for request in network:
            require(urllib.parse.urlparse(request["url"]).netloc in ["data.rcsb.org", "api.crossref.org"], "unexpected public route")
            if "sha256" in request:
                data = (directory / f'response-{request["id"]}.bin').read_bytes()
                require(hashlib.sha256(data).hexdigest() == request["sha256"] and len(data) == request["bytes"], "response bytes differ")
                try:
                    payloads.append(json.loads(data))
                except ValueError:
                    payloads.append(None)
            else:
                payloads.append(None)
        score = assess(task, row["reply"], network, payloads, expected[task["entryId"]])
        score.update({k: row[k] for k in ["seconds", "tokens", "tools", "requests", "discoveryRequests", "refusals", "startupMilliseconds", "teardownMilliseconds", "retainedBytes", "rss"]})
        score["task"] = task; scores.append(score)
    aggregate = {}
    for arm in ["C", "D"]:
        rows = [r for r in scores if r["task"]["arm"] == arm]
        warm = [r for r in rows if r["task"]["phase"] == "warm"]
        aggregate[arm] = {"correct": sum(r["correct"] for r in rows), "sessions": len(rows), "tokens": sum(r["tokens"] for r in rows), "modelSeconds": sum(r["seconds"] for r in rows), "warmMedianSeconds": statistics.median(r["seconds"] for r in warm), "warmMedianTokens": statistics.median(r["tokens"] for r in warm), "providerRequests": sum(r["requests"] for r in rows)}
    result = {"status": "PASS" if all(r["correct"] for r in scores) else "FAIL", "integrity": "PASS", "scores": scores, "aggregate": aggregate,
              "scope": "same-author, exposed, two-arm development diagnostic; no independent holdout or statistical superiority claim"}
    destination.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "aggregate": aggregate}, indent=2))


if __name__ == "__main__":
    if sys.argv[1] == "oracle":
        oracle(Path(sys.argv[2]), Path(sys.argv[3]))
    elif sys.argv[1] == "verify":
        verify(*map(Path, sys.argv[2:]))
    else:
        raise ValueError("expected oracle CONFIG NEW_DIRECTORY or verify ATTEMPT ORACLE RESULT_FILE")
