#!/usr/bin/env python3
"""Offline transport regression: notification + response in one pipe read.
Fake account data never qualifies for the live pilot's no-spend preflight.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix="rcx-preflight-test-") as directory:
    root = Path(directory)
    fake = root / "codex"
    fake.write_text(f"#!{sys.executable}\n" + '''import sys,json,os
if "--version" in sys.argv:
 print("FAKE TRANSPORT TEST; NO MODEL")
 raise SystemExit()
for line in sys.stdin:
 request=json.loads(line)
 if "id" not in request: continue
 method=request["method"]
 result={}
 if method=="account/read": result={"account":{"type":"chatgpt","email":"PRIVATE_TEST_EMAIL","planType":"test"}}
 if method=="account/rateLimits/read": result={"ordinaryUsageAllowed":False,"accountId":"PRIVATE_TEST_ID"}
 if method=="model/list": result={"data":[]}
 notification=json.dumps({"method":"test/notification"})+"\\n"
 response=json.dumps({"id":request["id"],"result":result})+"\\n"
 os.write(sys.stdout.fileno(),(notification+response).encode())
''')
    fake.chmod(0o755)
    output = root / "output"
    run = subprocess.run([sys.executable, str(Path(__file__).with_name("codex-preflight.py")), str(output)], env={**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"]}, capture_output=True, text=True, timeout=8)
    assert run.returncode == 0, run.stderr + run.stdout
    result = json.loads((output / "preflight.json").read_text())
    assert len(result["responses"]) == 3
    assert result["responses"]["account/rateLimits/read"]["ordinaryUsageAllowed"] is False
    assert "PRIVATE_TEST_EMAIL" not in run.stdout and "PRIVATE_TEST_ID" not in run.stdout
    print(json.dumps({"test": "synthetic pipe framing and metadata redaction", "passed": True, "modelCalls": 0}))
