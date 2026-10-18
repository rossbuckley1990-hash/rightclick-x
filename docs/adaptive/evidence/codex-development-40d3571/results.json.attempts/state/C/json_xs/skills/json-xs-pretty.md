# Pretty-print JSON with json_xs

Use to indent JSON from standard input. Run run_program with args ["-t", "json-pretty"] and the exact input as stdin. The option -pretty is unsupported. Check exit is 0, stderr is empty, stdout is indented JSON, and parsing stdout preserves the input structure and values. Verified for user.profile.tags containing ["admin", "dev"]: output uses three-space indentation, spaces around colons, one array item per line, and a trailing newline. Return stdout verbatim when exact output is requested.
