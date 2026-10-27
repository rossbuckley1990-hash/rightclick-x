#!/usr/bin/env python3
"""Fail-closed inventory for a future inheritance experiment.

This tool is deliberately incapable of launching an agent or certifying a
sandbox. Input is untrusted operator-supplied JSON, not security evidence.
"""

import argparse
import json
import pathlib
import sys

MAX_MANIFEST_BYTES = 65536
FIELDS = (
    "execution_environment",
    "separate_identity_and_filesystem",
    "network_egress",
    "resource_limits",
    "capability_transfer",
    "owner_approved_attempt_budget",
    "platform_approval",
    "negative_test_evidence",
    "independent_review",
)


def inventory(manifest):
    """Report supplied fields without treating them as established facts."""
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    unknown = set(manifest).difference(FIELDS)
    if unknown:
        raise ValueError("manifest contains unknown fields")
    for key, value in manifest.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{key} must be a nonempty string")
        if len(value) > 4096:
            raise ValueError(f"{key} is too long")

    return {
        "schema": "rcx-inheritance-isolation-inventory-v1",
        "model_execution_authorized": False,
        "isolation_verified": False,
        "ready": False,
        "disposition": "BLOCKED",
        "checks": [
            {"requirement": key, "status": "UNVERIFIED" if key in manifest else "MISSING"}
            for key in FIELDS
        ],
        "blockers": [
            "This inventory does not run or independently verify isolation tests.",
            "There is no implemented trusted attestation verifier or authorized execution route.",
            "A declared budget or approval is not proof of enforcement or platform authorization.",
        ],
    }


def read_manifest(path):
    # Limit the bytes read. Do not include manifest contents in receipts: they
    # may contain personal information or credentials despite instructions.
    with pathlib.Path(path).open("rb") as stream:
        data = stream.read(MAX_MANIFEST_BYTES + 1)
    if len(data) > MAX_MANIFEST_BYTES:
        raise ValueError("manifest exceeds size limit")
    try:
        return json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("manifest is not valid UTF-8 JSON") from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", help="optional untrusted local JSON inventory")
    args = parser.parse_args(argv)
    try:
        manifest = read_manifest(args.manifest) if args.manifest else {}
        report = inventory(manifest)
    except (OSError, ValueError) as error:
        # Do not echo arbitrary manifest values or file contents on failure.
        report = {"schema": "rcx-inheritance-isolation-inventory-v1", "ready": False,
                  "model_execution_authorized": False, "isolation_verified": False,
                  "disposition": "BLOCKED", "error": type(error).__name__}
    print(json.dumps(report, indent=2))
    return 1


if __name__ == "__main__":
    sys.exit(main())
