# Compact JSON with json_xs

For compacting JSON, try args ["-t", "json"] with exact input text on stdin, but always validate stdout with a JSON parser and compare parsed values to the input. Exit 0 and empty stderr are insufficient.

Observed in this environment: formatted nested arrays containing numbers, a string and true produced reversed compact text (including eurt), not valid JSON, with exit 0. Explicit -f json, an -e print/exit encoder, and json-pretty did not fix corruption. If this recurs, report UNABLE rather than manually generating or repairing output when the user requires the program's result. Earlier claim that compact output was verified is not reliable for this program instance.