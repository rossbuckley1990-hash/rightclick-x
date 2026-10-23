# Pretty-print JSON using json_xs

Use to make compact JSON readable with indentation.

Run run_program with args ["-f", "json", "-t", "json-pretty"] and pass the exact JSON input as stdin. The -p flag is unsupported.

Check exit is 0, stderr is empty, and stdout is valid indented JSON preserving the input's keys, nesting, array order and values. Verified successfully for {"user":{"profile":{"tags":["admin","dev"]}}} followed by a newline: output retains the nested user.profile.tags array with admin then dev, uses three-space indentation, and ends with a newline. Return program stdout exactly when requested.