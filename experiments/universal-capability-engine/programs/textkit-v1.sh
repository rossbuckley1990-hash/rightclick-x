#!/bin/sh
if [ "$1" = "--help" ]; then echo "usage: textkit [-u] [file]"; echo "  -u    print the input in upper case"; exit 0; fi
if [ "$1" = "-u" ]; then shift; cat "$@" | tr a-z A-Z; else cat "$@"; fi
