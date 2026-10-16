#!/bin/sh
if [ "$1" = "--help" ]; then echo "usage: textkit [-U] file"; echo "  -U    print the input in upper case"; exit 0; fi
if [ "$1" = "-U" ]; then shift; fi
if [ -z "$1" ]; then echo "a file operand is required" >&2; exit 64; fi
tr a-z A-Z < "$1"
