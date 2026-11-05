# Image conversion toolkit

Converts an image between formats using three installed programs
(`ppm2tiff`, `cwebp`, `dwebp`), each run through `../confine` (no network,
writes confined to the current directory). It chains them automatically and
**refuses rather than return a wrong or partial result.**

## Use (run from the lane directory that contains `confine`)

    toolkit/convert INPUT OUTPUT         # target format from OUTPUT's extension
    toolkit/convert in.png out.tif       # e.g. PNG -> TIFF (chained via WebP)
    toolkit/convert in.jpg out.x --to webp   # --to forces format; --force overwrites

    toolkit/convert --list       # every from->to it can do
    toolkit/convert --probe F... # independently report each file's format + WxH
    toolkit/convert --check      # verify the 3 program pins
    toolkit/selftest.sh          # full self-test (builds its own fixtures)

Exit 0 means the output was written and independently validated. Non-zero means
**nothing was written**; the reason prints as `REFUSED: ...`.

## What it converts

Inputs:  `ppm pgm pbm pam png jpeg tiff webp`
Outputs: `webp png ppm pam bmp tiff`
Any input reaches any output; dimensions are always preserved (`--list` prints
the matrix). Converting to a format without alpha (ppm/pgm/pbm/bmp) drops
transparency; dimensions are kept.

## Why you can trust the output

- **Pinned identity**: each program's SHA-256 is in `pins.json` and re-hashed
  before every run; a changed/replaced binary is refused.
- **Confined**: programs run only via `../confine`; intermediates go in a temp
  dir under the cwd that is deleted afterward.
- **Independent validation**: `imgfmt.py` re-parses every intermediate and the
  final file from its own bytes (not via the converters) and checks format +
  dimensions. Exit codes are advisory only.
- **All-or-nothing**: output is written atomically only after the whole chain
  validates; any failure => no output, non-zero exit.
