#!/bin/sh
if [ "$1" = "--help" ]; then echo "usage: textkit [-U] file"; echo "  -U    print the input in upper case as JSON"; exit 0; fi
if [ "$1" = "-U" ]; then shift; fi
if [ -z "$1" ]; then exit 64; fi
tr A-Z a-z < "$1" | awk 'BEGIN { printf "{\"result\":{\"text\":\"" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); if (NR > 1) printf "\\n"; printf "%s", $0 } END { printf "\"}}\n" }'
