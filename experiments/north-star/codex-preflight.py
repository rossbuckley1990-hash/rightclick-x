#!/usr/bin/env python3
"""Read installed Codex auth/allowance/model metadata; never start a model turn.

Outputs omit email, account identifiers and credentials. This is a time-bounded
preflight, not a guarantee that future account/billing settings stay unchanged.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    env = {k: os.environ[k] for k in ("PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM") if k in os.environ}
    command = ["codex", "app-server", "--stdio", "-c", 'forced_login_method="chatgpt"']
    for feature in ("shell_tool", "apps", "plugins", "hooks", "multi_agent", "browser_use", "computer_use"):
        command.extend(["--disable", feature])
    result = {"schema": 1, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "mode": "read-only metadata; no thread or turn created", "command": command,
              "environmentKeys": sorted(env), "responses": {}}
    version = subprocess.run(["codex", "--version"], env=env, capture_output=True, text=True, check=True)
    result["version"] = version.stdout.strip()
    with (output / "stderr.log").open("w") as stderr:
        process = subprocess.Popen(command, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        def call(number, method, params):
            process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": number, "method": method, "params": params}) + "\n")
            process.stdin.flush()
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError("app-server exited")
                item = json.loads(line)
                if item.get("id") == number:
                    if "error" in item:
                        raise RuntimeError(f"{method}: {item['error']}")
                    return item["result"]
            raise TimeoutError(method)
        try:
            call(1, "initialize", {"clientInfo": {"name": "rcx_preflight", "title": None, "version": "1"}, "capabilities": {"experimentalApi": True}})
            process.stdin.write('{"jsonrpc":"2.0","method":"initialized"}\n')
            process.stdin.flush()
            account = call(2, "account/read", {"refreshToken": False})
            result["responses"]["account/read"] = {"type": (account.get("account") or {}).get("type"), "planType": (account.get("account") or {}).get("planType")}
            limits = call(3, "account/rateLimits/read", {"excludeResetCreditDetails": True, "supportsLunaReserve": False})
            account_id = limits.pop("accountId", None)
            limits["accountIdSha256"] = hashlib.sha256(account_id.encode()).hexdigest() if account_id else None
            result["responses"]["account/rateLimits/read"] = limits
            models = call(4, "model/list", {"includeHidden": False})
            result["responses"]["model/list"] = [{k: model.get(k) for k in ("id", "model", "isDefault", "defaultReasoningEffort", "supportedReasoningEfforts")} for model in models.get("data", [])]
            result["passed"] = result["responses"]["account/read"]["type"] == "chatgpt"
        except Exception as error:
            result["passed"] = False
            result["error"] = str(error)
        finally:
            selector.close()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    (output / "preflight.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
