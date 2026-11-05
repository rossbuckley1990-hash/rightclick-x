# Binary-native artefacts for command-line capabilities

RightClick X treated every command-line input and output as UTF-8 text. An independent reduced
evaluation (six unfamiliar programs, a hardened saved-script competitor) measured the effect:
RightClick acquired 2/6 working capabilities, against 6/6 for saved scripts. This change removes
the text-only boundary generically. It does not alter or re-score that evaluation. The six
programs are used here as **development cases**, not held-out acceptance.

## Root causes (reproduced before fixing)

| # | Where | What happened |
|---|---|---|
| 1 | `sandbox.run` | `files: Record<string, string>` and `stdin: string` were written with `fs.writeFileSync`, which encodes the JS string as UTF-8. Every byte ≥ 0x80 in a binary file became two bytes. |
| 2 | `sandbox.run` | Files the program created were listed by name (`created`); the work directory was then deleted unread, so output files were lost. |
| 3 | runtime CLI path | Values went through `asContent()`, which JSON-stringifies objects, so there was no way to pass bytes. Non-UTF-8 stdout was refused with no byte-exact alternative. |
| 4 | `parseUsage` | `--opt=file` (lower-case argument after `=`) never matched the option-line pattern, so options such as `--load-trust=file` were absent from the contract. |
| 5 | `validateOptions` | Option values were passed through unchecked, so an agent could hand the sandboxed program a host path (`--keyring /some/host/file`). |
| 6 | usage acquisition | The loop stopped at the first help flag producing any usage text. A program answering `--help` with "illegal option" plus a one-line usage never had its `-h` option list read. |
| 7 | interface gates | The generic files interface was offered only when the program documented options. A program documenting file operands but no options (`<infile> <outfile>`) got no way to return a written file. A program rejecting RCX's sample by its bare name (`'input1.html': Not a zip archive`) was misread as an environmental precondition. |

## Design

**Artefact values.** Wherever a command-line capability accepts file content or stdin, three
tagged shapes are accepted in addition to a plain string (which keeps its meaning: UTF-8 text):

```json
{ "type": "bytes",    "base64": "<strict, canonical base64>" }
{ "type": "text",     "text": "…", "encoding": "utf-8" | "latin-1" | "ascii" | "utf-16le" }
{ "type": "artefact", "ref": "sha256:<64 hex>" }
```

Only these exact shapes are artefacts; any other object keeps its historical JSON-text meaning.
Malformed or non-canonical base64, characters an encoding cannot represent, unknown encodings and
oversized content are refused before anything runs.

**Store.** `ArtefactStore` is content-addressed, bounded (64 MiB per artefact, 512 MiB in total)
and, under `bin/rcx.ts`, persisted next to the state file (`<state>.artefacts/`). It re-hashes
on every read, so a modified file is refused. A reference names content, never a location: it
resolves only to bytes this runtime stored, so it grants no host read authority.

**Staging and collection.** `sandbox.run` writes bytes exactly. With `collect`, it returns the
exact bytes of the named output files before deleting the private directory. It returns them only
if they are regular files (never through a symbolic link), within the per-file limit, and only from
a run that completed cleanly (no timeout, truncation or limit), so a partial file is never a result.
Output names follow the same flat-name rules as inputs and may not collide with an input.

**File roles.** A file-valued option argument gets a role from its documentation. A `read` value
must name a staged input file; a `write` value must name a declared output. For every option, an
absolute, home-relative or parent-relative path is refused. Write-role options were previously not
offered at all (their files were discarded); they are now offered only in that confined role.

**Interface.** The generic command-line capabilities (`cli:<prog>:invoke`) gain `outputs` (flat
names of files the program creates, returned as artefacts) and `stdoutAs` (`"text"` or
`"artefact"`). In artefact mode the result is `{ exitCode, stdout, outputs }`. A declared output
the program does not create fails the run explicitly. The MCP surface stays at thirteen tools:
bytes go in inline in `context_run`, and `context_run_status {"artefact": ref, offset, length}`
reads them back in bounded slices (at most 8 MiB per read).

**Provenance.** Every command-line run records, in `cliValidity.artefacts`, the program path and
the SHA-256 of the build that was checked, every consumed file and stdin by digest, every produced
output by digest and reference, and the stdout digest. A missing program still fails with
"nothing was run", and no output is attributed to it. The runtime cannot control text an agent
writes elsewhere. The enforceable boundary is this record: a claimed result whose bytes do not
match a run record was not produced by the capability.

**Logs.** `redact()` summarises artefact values everywhere it is applied (MCP audit log, stored
records, exports): shape and size, never the payload.

## Unchanged

- Executable pinning, re-hash before and after each run, environment fingerprint checks, sandbox
  confinement, locale profiles and outcome verification.
- Plain-string inputs and text outputs for every existing capability.

## Known limits

- **Composition is by value only.** The planner does not yet type artefact ports. An artefact
  produced by one run is passed to another explicitly by reference, not composed automatically.
- **Empirical file-role acquisition is still limited by generic samples.** Roles come from
  documentation, and RCX still cannot synthesise valid binary inputs (a real MP4 or ZIP), so
  behaviour on real data is observed only when a caller runs the capability. Such capabilities
  stay `declared-only` and `unsupported`, and are never composed automatically.
- **Not independent evidence.** Everything here is development evidence on known programs. Whether
  RightClick now competes with saved scripts requires the independent evaluation described in the
  review PR, on programs chosen after the source is frozen.
