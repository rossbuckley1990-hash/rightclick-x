# Web exchange rates limitation

Use when asked to download current currency exchange rates with json_xs. The run_program sandbox has no network access. json_xs converts supplied data; an empty JSON string supplies no exchange rates.

Verified run: args ["-f", "json", "-t", "json-pretty"], stdin the exact JSON string "\"\"", exits 0 with stdout "\"\"\n" and empty stderr. This is valid JSON but does not satisfy a request for current rates. Do not invent rates or return the empty string as rates. Report UNABLE because web download is unavailable in the sandbox. --help is unsupported and exits 255 with usage.