# Convert JSON to a Perl data structure

Use when asked to display JSON as Perl in Data::Dumper style. Run run_program with args ["-f", "json", "-t", "dumper"] and exact decoded JSON text on stdin.

Verified with stdin `[1, "two", null]\n`: exit 0, empty stderr, stdout is a bracketed Perl array with two-space indentation, numeric 1, double-quoted "two", and undef for JSON null, followed by a newline. The dumper format emits a bare structure without a $VAR1 assignment. Check array order, values and Perl null mapping, and return stdout exactly. --help is unsupported and exits 255 with usage.