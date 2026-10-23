"""Reproduce the Actenon source feasibility tests, without inherited credentials.
Usage: python audit.py /absolute/actenon-audit <kernel|permit|protocol|airlock|scan>
Install the pinned sources and test dependencies in audit-root/.venv first.
Each invocation writes fresh evidence; existing results are never overwritten.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

root = Path(sys.argv[1]).resolve()
suite = sys.argv[2]
out = Path(__file__).resolve().parents[2] / 'docs/north-star/evidence/actenon'
suites = {
 'kernel': ['tests/conformance', 'tests/security', 'tests/unit/test_sqlite_concurrency.py', 'tests/unit/test_replay_store.py', 'tests/unit/test_credential_broker.py', 'tests/unit/test_boundary_verifier.py', 'tests/unit/test_outcome_attestation.py', 'tests/test_neutrality.py', 'tests/test_independence.py', 'tests/test_verification_independence.py'],
 'permit': ['tests/test_2_0_edge_authority.py', 'tests/test_effect_kernel_integration.py', 'tests/test_aggregate_delegated_budgets.py', 'tests/test_adversarial.py', 'tests/test_adversarial_round2.py', 'tests/test_adversarial_round3.py', 'tests/test_broker_security.py', 'tests/test_boundary_kit.py', 'tests/test_authority_independence.py', 'tests/test_execution_modes.py', 'tests/test_reservation_settlement.py', 'tests/test_effect_ledger.py', 'tests/test_control_plane_auth.py'],
 'protocol': ['conformance/python'],
 'airlock': ['tests'],
 'scan': ['tests/test_capability_model.py', 'tests/test_capability_completeness.py', 'tests/test_authority_evidence.py', 'tests/test_guard_state_correctness.py', 'tests/test_counterfeit_binding.py', 'tests/test_coverage_contract_gate.py', 'tests/test_unsupported_language_safety.py', 'tests/test_soundness_challenge.py', 'tests/adversarial'],
}
repo = root / ('actenon-' + suite)
run_id = time.strftime('%Y%m%dT%H%M%S', time.gmtime())
base = out / (suite + '-' + run_id)
command = [str(root / '.venv/bin/python'), '-m', 'pytest', '-q', '-ra', *suites[suite], '--junitxml=' + str(base.with_suffix('.xml'))]
# Fresh home and an explicit environment: model keys and cloud credentials are never inherited.
audit_home = tempfile.mkdtemp(prefix='rcx-actenon-test-')
env = {'PATH': str(root / '.venv/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin', 'HOME': audit_home, 'TMPDIR': tempfile.gettempdir(), 'LANG': 'en_US.UTF-8', 'ACTENON_ENV': 'test', 'PYTHONHASHSEED': '0', 'AWS_EC2_METADATA_DISABLED': 'true'}
t0 = time.monotonic()
with base.with_suffix('.log').open('x') as log:
 result = subprocess.run(command, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=300)
record = {'suite': suite, 'commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=repo, text=True).strip(), 'command': command, 'exit': result.returncode, 'seconds': time.monotonic()-t0, 'environment': 'fresh home; no inherited model/provider credentials', 'dependencyMode': 'five audited source heads installed together, not a released stack and not the older Airlock source pins', 'log': str(base.with_suffix('.log')), 'junit': str(base.with_suffix('.xml'))}
base.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
sys.exit(result.returncode)
