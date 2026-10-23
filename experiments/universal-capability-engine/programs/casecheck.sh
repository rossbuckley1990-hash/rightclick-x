#!/bin/sh
if [ "$1" = "--help" ]; then echo "usage: casecheck original candidate"; echo "  report whether candidate is the original in upper case, as JSON"; exit 0; fi
if [ "$(tr a-z A-Z < "$1" | tr -d '\n')" = "$(tr -d '\n' < "$2")" ]; then echo '{"valid":true}'; else echo '{"valid":false}'; fi
