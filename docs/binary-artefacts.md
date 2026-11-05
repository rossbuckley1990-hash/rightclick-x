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
{ "type": "artefact", "ref": "sha256:<64 hex>.<grant>" }
```

Only these exact shapes are artefacts; any other object keeps its historical JSON-text meaning.
Malformed or non-canonical base64, characters an encoding cannot represent, unknown encodings and
oversized content are refused before anything runs.

**Store.** `ArtefactStore` is content-addressed and, under `bin/rcx.ts`, persisted next to the
state file (`<state>.artefacts/`).

- **Bounds.** At most 64 MiB per artefact and 512 MiB in total, counted from the content actually
  on disk under a lock file, so the bound holds across restarts and between concurrent processes.
- **Writes.** Content goes to a temporary file. It is flushed, read back and hashed, then renamed
  into place, and only then acknowledged.
- **Existing files.** A file already at the address is trusted only if its bytes hash to its name.
  A truncated or tampered file, or a link, is replaced.
- **Interrupted writes and dead locks.** A temporary file left by a write that never finished
  counts against the quota until it is swept. It is swept once its writer is gone. A lock left by
  a dead process is broken.
- **Reads.** Every read re-hashes the content, so a modified file is refused. The in-process read
  cache is bounded (64 MiB).

**Grants, holds and retention.** A digest (`sha256:<hex>`) is the content's identity. It appears
in provenance records, receipts and exports, and anyone can compute it from bytes they guess, so it
never reads anything.

- **Grants.** A run's result carries a read grant, `sha256:<hex>.<grant>`: 128 random bits tied to
  one hold on the content.
- **Holds.** Each hold has a holder (the run) and an expiry: `RCX_ARTEFACT_RETENTION_DAYS`,
  default 7.
- **Ending a hold.** An expired or released hold stops reading at once. `context_run_status
  {"artefact": ref, "release": true}` ends a hold early.
- **Deletion.** Content no live hold keeps is deleted: at once on release, otherwise when the store
  is swept, which it is at start-up and under quota pressure.
- **Inline inputs.** Bytes or text passed inline are staged for the run, not stored, because the
  caller already has them. Only run outputs are kept.
- **No host paths.** A reference never names a location, so it grants no host read authority.

**Staging and collection.** `sandbox.run` writes bytes exactly. With `collect`, it reads the
exact bytes of the named output files before deleting the private directory.

- It reads only regular files, never through a symbolic link, within the per-file limit.
- It reads them only from a run that finished cleanly: no timeout, truncation or limit.
- Output names follow the same flat-name rules as inputs and may not collide with an input.

Whether those bytes become a result is the exit-status contract's decision, below.

**Exit-status contract.** Every command-line run records, in `cliValidity`:

- **`exitStatus`:**
  - `process`: `completed`, `timed-out`, `limit` or `truncated`.
  - `code`: the exit code.
  - `classification`: one of
    - `success`: exit 0;
    - `semantic-nonzero`: a nonzero code with a demonstrated meaning;
    - `reported-error`: anything else.
  - `basis`: the evidence for the classification.
- **`outcome`:** `result-established` or `not-established`.
- **`failure`:** for a run whose result is not established, the reason, a stderr preview, and the
  digest and size of its stdout and of every file it wrote. Never the bytes. Nothing from a failed
  run is stored or returned, so a partial TIFF or an empty digest cannot be read back as a result.

Exit 0 is success by convention. A nonzero code N is a success for an operation only with an entry
in `exitSemantics`. One is recorded only when the investigation saw all three of these:

- every trial that exited N printed output and wrote nothing to standard error;
- at least one of those trials printed output derived from its input;
- the same operation exited 0 on another input.

That is diff's "differences found". Appearing during acquisition is not enough. Every run
re-checks the observable part: exit N with a diagnostic on standard error, or with no output, is a
reported error. A declared interface was never observed, so its contract is exit 0 only. State
learned before this contract (`okExit [0,1]` with no evidence) cannot turn a nonzero exit into a
result. Whether the outcome the caller wanted was achieved is a separate question, answered by the
run's verification status. A transport-complete exit-0 run with output nothing checked stays
`unverified`.

**File roles.** A file-valued option argument gets a role from its documentation.

- **Read role:** the value must name a staged input file.
- **Write role:** the value must name a declared output.
- **Host paths:** for every option, an absolute, home-relative or parent-relative path is refused.
- **Write-role options** were previously not offered at all, because their files were discarded.
  They are now offered only in that confined role.
- **Program and directory values:** an option whose value is a program or command
  (`--compress-program=PROGRAM`) is never offered. A directory value is not a file role.

**Option grammar.** Each spelling on an option line gets its own argument.

- **A value fixed by its spelling.** In `-n, --numeric-sort, --sort=numeric`, `--sort=numeric` is
  an alias with its value fixed, and `-n` takes nothing.
- **A placeholder shared by the short spelling.** In `-k, --key=KEYDEF`, `-k` takes the argument
  too.
- **Several values.** An option documented with several placeholders (`-crop <x> <y> <w> <h>`)
  takes that many separate items, each checked. Values may be negative numbers.
- **Other argument forms.** `#`, lower-case values with bracketed parts (`lzw[:opts]`), dot leaders
  and `-o output, --output=output` are read as documented.

**Interface.** The generic command-line capabilities (`cli:<prog>:invoke`) gain `outputs` (flat
names of files the program creates, returned as artefacts) and `stdoutAs` (`"text"` or
`"artefact"`).

- In artefact mode the result is `{ exitCode, stdout, outputs }`.
- A declared output the program does not create fails the run explicitly.
- The MCP surface stays at thirteen tools. Bytes go in inline in `context_run`.
- `context_run_status {"artefact": ref, offset, length}` reads them back in bounded slices (at most
  8 MiB per read), and `{"artefact": ref, "release": true}` ends the grant's hold.

**Provenance.** Every command-line run records, in `cliValidity.artefacts`:

- the program path and the SHA-256 of the build that was checked;
- every consumed file and stdin, by digest;
- every produced output, by digest and content identity, never a read grant;
- the stdout digest. A missing program still fails with
"nothing was run", and no output is attributed to it. The runtime cannot control text an agent
writes elsewhere. The enforceable boundary is this record: a claimed result whose bytes do not
match a run record was not produced by the capability.

**Logs.** `redact()` summarises artefact values everywhere it is applied (MCP audit log, stored
records, exports): shape and size, never the payload, and the content identity of a reference,
never its grant.

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
- **One principal per runtime.** Grants are capabilities, not identities. Whoever holds a run's
  result can read its outputs, and the runtime's own state file keeps the results it returned.
  Binding reads to separate authenticated callers is not implemented, because the runtime serves
  one token.
- **Not independent evidence.** Everything here is development evidence on known programs. Whether
  RightClick now competes with saved scripts requires the independent evaluation described in the
  review PR, on programs chosen after the source is frozen.
