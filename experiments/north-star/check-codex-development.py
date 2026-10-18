#!/usr/bin/env python3
"""Separately recheck raw pilot data, no TS/product/scorer imports; same author.
Accepts a completed checkpoint as well as a full 32-session development run.
"""
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys
import subprocess
import tomllib


def read(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def matches(task, text):
    expected = task.get("expected", "")
    mode = task.get("compare", "trim")
    if mode == "whitespace":
        return re.sub(r"\s+", " ", text).strip() == re.sub(r"\s+", " ", expected).strip()
    if mode == "trim":
        return text.strip() == expected.strip()
    if mode == "exact":
        return text.removesuffix("\n") == expected.removesuffix("\n")
    if mode == "lines-unordered":
        return sorted(s.strip() for s in text.splitlines() if s.strip()) == sorted(s.strip() for s in expected.splitlines() if s.strip())
    if mode == "contains-all":
        return bool(task.get("expect")) and all(s in text for s in task["expect"])
    raise AssertionError("unknown comparison")


def main():
    root = Path(sys.argv[1]).resolve()
    result = read(root / "results.json")
    manifest = read(root / "manifest.json")
    assert result["schema"] == 4 and result["developmentOnly"] and result["client"] == "codex"
    assert result["commit"] == manifest["commit"]
    assert result["holdoutSha256"] == hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
    source = Path(__file__).resolve().parents[2] / manifest["sourceManifest"]["path"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest["sourceManifest"]["sha256"]
    assert read(source)["programs"] == manifest["programs"], "exposed tasks/docs/oracles must be unchanged"
    assert not result["previousAttempts"], "retry effort requires separate reconciliation"
    account_ids = set()
    for location in result["preflights"]:
        preflight = read(root / "results.json.attempts" / Path(location).name / "preflight.json")
        assert preflight["responses"]["account/read"]["type"] == "chatgpt"
        allowance = preflight["responses"]["account/rateLimits/read"]
        bucket = allowance["rateLimitsByLimitId"]["codex"]
        assert allowance["ordinaryUsageAllowed"] is True and bucket["primary"]["usedPercent"] < 90
        assert bucket["credits"] == {"hasCredits": False, "unlimited": False, "balance": "0"}
        account_ids.add(allowance["accountIdSha256"])
    assert len(account_ids) == 1 and None not in account_ids
    tasks = {t["id"]: t for p in manifest["programs"] for t in p["tasks"]}
    expected_keys = {}
    for program in manifest["programs"]:
        feasible = [t for t in program["tasks"] if t["kind"] == "feasible"]
        infeasible = next(t for t in program["tasks"] if t["kind"] == "infeasible")
        steps = [("t" + str(i + 1), t["id"]) for i, t in enumerate(feasible[:4])] + [("infeasible", infeasible["id"]), ("compatible", feasible[0]["id"]), ("incompatible", feasible[1]["id"]), ("removed", feasible[2]["id"])]
        expected_keys.update({f"{arm}|{program['name']}|{step}": task for arm in "ABCD" for step, task in steps})
    assert len({r["key"] for r in result["sessions"]}) == len(result["sessions"])
    ids = set()
    summaries = []
    for row in result["sessions"]:
        assert expected_keys[row["key"]] == row["task"]
        directory = root / "results.json.attempts" / row["attemptId"]
        assert read(directory / "result.json") == row
        request = read(directory / "request.json")
        task = tasks[row["task"]]
        assert request["task"] == task and request["key"] == row["key"] and request["commit"] == result["commit"]
        assert request["holdoutSha256"] == result["holdoutSha256"]
        assert not row.get("blocked"), "invalid session cannot be scored"
        exit_status = read(directory / "agent-exit.json")
        assert exit_status == {"code": 0, "timedOut": False}
        agent = lines(directory / "agent.stdout")
        assert not any(e["type"] in ("error", "turn.failed") for e in agent)
        audit = read(directory / "agent-audit.json")
        assert not audit["violations"] and audit["threadId"] not in ids
        ids.add(audit["threadId"])
        assert all(c["model"] == result["model"] and c["effort"] == "low" for c in audit["contexts"])
        assert audit["contexts"], "model identity must be observed"
        server = "rightclick-x" if row["arm"] == "D" else "surface"
        tool_records = lines(directory / "agent-tools.jsonl")
        assert len(tool_records) == audit["toolRecords"]
        prefix = "mcp__" + server + "__"
        def allowed(name):
            return name.startswith(prefix) or name.startswith(prefix.replace("-", "_"))
        syntax = {s["callId"]: s for s in json.loads(subprocess.check_output(["node", str(Path(__file__).with_name("codex-code-tokens.ts")), str(directory / "agent-tools.jsonl")], text=True))}
        for event in tool_records:
            call = event["payload"]
            if call["type"] not in ("function_call", "custom_tool_call") or allowed(call["name"]):
                continue
            assert call["name"] in ("exec", "functions.exec"), "non-benchmark tool"
            parsed = syntax[call["call_id"]]
            assert parsed["parseErrors"] == 0
            for fact in parsed["facts"]:
                assert not fact.get("import") and fact.get("identifier") not in {"fetch", "require", "eval", "Function", "process", "globalThis", "Deno", "Bun"}
                assert fact.get("propertyAccess") != "constructor" and fact.get("elementAccess") != "constructor"
                if fact.get("identifier") == "tools":
                    assert fact["propertyObject"] and allowed(fact["propertyName"]), "non-benchmark or dynamic tool access"
        for event in agent:
            item = event.get("item", {})
            assert item.get("type") not in ("command_execution", "file_change", "web_search", "collab_tool_call")
            if item.get("type") == "mcp_tool_call":
                assert item["server"] == server
        invocation = read(directory / "agent-invocation.json")
        assert invocation["cwd"] != str(directory) and 'forced_login_method="chatgpt"' in invocation["args"]
        assert set(invocation["environmentKeys"]) <= {"PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"}
        config = [tomllib.loads(arg)["mcp_servers"] for arg in invocation["args"] if arg.startswith("mcp_servers.")]
        assert len(config) == 1 and set(config[0]) == {server}
        configured = config[0][server]
        expected_tools = {"context_runtime", "context_research", "context_learn", "context_forget", "context_inspect", "context_actions", "context_explain", "context_run", "context_run_status", "context_compose", "context_graph", "context_providers", "context_watch"} if server == "rightclick-x" else {"run_program", "list_skills", "read_skill", "save_skill"}
        assert configured["required"] and configured["default_tools_approval_mode"] == "prompt"
        assert set(configured["enabled_tools"]) == expected_tools and set(configured["tools"]) == expected_tools
        assert all(settings == {"approval_mode": "approve"} for settings in configured["tools"].values())
        if row["phase"] in ("first", "reuse", "compatible-change"):
            preflight = read(directory / "launch-preflight.json")
            assert preflight["result"]["code"] == 0 and matches(task, preflight["result"]["stdout"])
        completed = [e for e in agent if e["type"] == "turn.completed"]
        assert completed
        tokens = sum(e["usage"]["input_tokens"] + e["usage"]["output_tokens"] for e in completed)
        assert tokens == row["tokens"]
        messages = [e["item"]["text"] for e in agent if e["type"] == "item.completed" and e.get("item", {}).get("type") == "agent_message"]
        reply = messages[-1]
        assert row["reply"] == reply[:4000]
        block = re.search(r"^BEGIN\s*$\n?(.*?)^END\s*$", reply, re.M | re.S)
        answer = None
        unable = bool(re.search(r"^\s*UNABLE:\s*.+$", reply, re.M))
        if block:
            answer = re.sub(r"^```[^\n]*\n", "", block[1])
            answer = re.sub(r"\n```\s*$", "", answer).removesuffix("\n")
            if re.search(r"^\s*UNABLE:", answer, re.M):
                unable, answer = True, None
        raw = (directory / "sandbox.jsonl").read_bytes()
        assert hashlib.sha256(raw).hexdigest() == row["observation"]["sha256"]
        records = [json.loads(line) for line in raw.splitlines()]
        target = records[0]["target"]
        assert records[0]["type"] == "ready" and records[-1]["type"] == "closed"
        assert all(r["schema"] == 1 and r["sessionId"] == row["attemptId"] and r["target"] == target and r["sequence"] == n for n, r in enumerate(records))
        starts = {r["id"]: r for r in records if r["type"] == "started"}
        ends = {r["id"]: r for r in records if r["type"] in ("finished", "error")}
        assert len(starts) == sum(r["type"] == "started" for r in records)
        assert len(ends) == sum(r["type"] in ("finished", "error") for r in records)
        assert starts.keys() == ends.keys()
        observed = False
        for identifier, start in starts.items():
            end = ends[identifier]
            if end["type"] == "error" or start["purpose"] not in ("execution", "agent-run"):
                continue
            out = end["result"]
            if start["program"] != target or not start["identity"] or start["identity"] != end["identity"] or out["code"] in (None, 126, 127) or out["timedOut"] or out["truncated"] or out.get("limit"):
                continue
            available = [start["stdin"], *start["files"].values(), *start["args"]]
            supplied = True
            for needed in [task["input"].get("stdin"), *task["input"].get("files", {}).values()]:
                if needed in (None, ""):
                    continue
                if needed not in available:
                    supplied = False
                    break
                available.remove(needed)
            stdout = out["stdout"].replace(out["workDir"], "").replace(out["workDir"].removeprefix("/private"), "")
            observed |= supplied and task["kind"] == "feasible" and task.get("valid") is True and matches(task, stdout)
        assert row["observation"]["complete"] and observed == row["observation"]["taskExecutionObserved"]
        investigation_count = sum(r["type"] == "investigation" for r in records) if row["arm"] == "D" else None
        assert investigation_count == row["investigationsStarted"]
        refusal_phase = row["phase"] in ("infeasible", "incompatible-change", "removed")
        correct = unable and answer is None if refusal_phase else answer is not None and matches(task, answer) and observed
        assert bool(correct) == row["correct"] and bool(not correct and answer is not None) == row["wrong"]
        assert len(lines(directory / "calls.jsonl")) == row["toolCalls"]
        summaries.append({"key": row["key"], "correct": bool(correct), "wrong": row["wrong"], "tokens": tokens, "seconds": row["seconds"], "investigations": investigation_count, "observed": observed})
    groups = {}
    for arm in "ABCD":
        group = [s for s in summaries if s["key"].startswith(arm + "|")]
        warm = [s for s in group if s["key"].split("|")[-1] in ("t2", "t3", "t4")]
        if group:
            groups[arm] = {"sessions": len(group), "correct": sum(s["correct"] for s in group), "wrong": sum(s["wrong"] for s in group), "tokens": sum(s["tokens"] for s in group), "seconds": sum(s["seconds"] for s in group), "warmMedianSeconds": statistics.median(s["seconds"] for s in warm) if warm else None}
    complete = {r["key"] for r in result["sessions"]} == set(expected_keys)
    print(json.dumps({"scope": "exposed development pilot; separate implementation, same author; no commercial or holdout acceptance", "sessionsChecked": len(summaries), "fullPlanned32": complete and len(summaries) == 32, "groups": groups, "sessions": summaries}, indent=2))


if __name__ == "__main__":
    main()
