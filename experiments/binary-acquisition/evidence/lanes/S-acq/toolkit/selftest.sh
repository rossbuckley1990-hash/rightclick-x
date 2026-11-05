#!/bin/sh
# Run the toolkit self-test.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v python3 >/dev/null 2>&1; then
    exec python3 "$dir/selftest.py" "$@"
fi
exec /opt/homebrew/bin/python3 "$dir/selftest.py" "$@"
