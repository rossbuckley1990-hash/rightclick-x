# Task (acquisition)

Three programs are installed: /opt/homebrew/bin/ppm2tiff, /opt/homebrew/bin/cwebp, /opt/homebrew/bin/dwebp.

Later, other AI agents with no memory of this session will be asked to convert image files between formats. They will not be told which conversions in advance. Build a durable toolkit in `./toolkit` that they can use for that, with the safeguards a careful engineer would build:

- Run the programs only through `./confine <program> [args]`, which allows no network access and writes only under the current directory.
- Pin each program's identity (SHA-256), and refuse to run a program that has changed.
- Validate inputs and outputs independently of the programs. Do not trust exit codes: check that an output really is a well-formed file of the expected format with the expected dimensions.
- Refuse, rather than return a wrong or partial result.
- Write toolkit/README.md (at most 40 lines) telling the next agent how to use it.

Test the toolkit. Work only in this directory. Finally, report what the toolkit can do and how you tested it.
