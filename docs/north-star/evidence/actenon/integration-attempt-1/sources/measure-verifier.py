"""Run upstream pure-verifier benchmark with explicit development signing intent.
The untouched upstream CLI fails because it sets ACTENON_ENV=benchmark.
No resource execution, replay state, ledger, model or cloud service is measured.
"""
import importlib.util
import json
import os
from pathlib import Path
import platform
import sys
root=Path(sys.argv[1]).resolve()
spec=importlib.util.spec_from_file_location('actenon_audit_benchmark',root/'benchmarks/verify_benchmark.py')
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)
os.environ['ACTENON_ENV']='test'
print(json.dumps({'scope':'stateless verifier only; no replay/ledger/broker/transport/RightClick X; ephemeral development signing keys','adjustment':'unmodified upstream benchmark functions, explicit test intent after module import','python':platform.python_version(),'platform':platform.platform(),'results':[module.benchmark_symmetric(),module.benchmark_asymmetric()]},indent=2))
