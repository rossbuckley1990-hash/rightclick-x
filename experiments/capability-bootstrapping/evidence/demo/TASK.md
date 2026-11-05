# Task

`inputs/photo.png` is a photo. Produce `answers/photo.avif`: the same picture as an AVIF file, **without losing any information** (every pixel must be exactly the same).

- The only tool you have is RightClick X, reached through `./rcx` in this directory:
  `./rcx tools` lists its tools; `./rcx call <tool> '<json>'` or `./rcx call <tool> --args-file <file.json>` calls one;
  exact bytes are passed as `{"type":"bytes","base64":"..."}`; `./rcx save <artefact-ref> <path>` writes a returned artefact to a file.
- Do not run any image program yourself, and do not write a converter.
- If you cannot produce an exact result, say so rather than produce an inexact one.
- Report the steps that produced the answer and why you believe it is exact.
