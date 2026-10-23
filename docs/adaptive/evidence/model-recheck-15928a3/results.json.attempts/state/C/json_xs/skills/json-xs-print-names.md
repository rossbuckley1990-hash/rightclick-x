# Print names from a JSON array as plain text

Use when extracting each person’s name, one per line, from a JSON array of objects. Run run_program with args ["-f","json","-t","none","-e","print \"$_->{name}\\n\" for @$_"] and the JSON text on stdin. The -e Perl code sees the decoded JSON in $_; -t none suppresses serialized output while print emits plain text.

Verified input: [{"name":"Ann","age":30},{"name":"Bob","age":25},{"name":"Cy","age":41}] followed by newline. Result: exit 0, empty stderr, stdout "Ann\nBob\nCy\n". Check that every input name appears once in original array order, with no ages, JSON punctuation, or extra output. Return stdout exactly.