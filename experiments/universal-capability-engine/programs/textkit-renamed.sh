#!/bin/sh
if [ "$1" = "--help" ]; then echo "usage: textkit [-U] [file]"; echo "  -U    print the input in upper case"; exit 0; fi
if [ "$1" = "-U" ]; then shift; cat "$@" | tr a-z A-Z; elif [ "$1" = "-u" ]; then echo "unknown option -u" >&2; exit 64; else cat "$@"; fi
