# Launch-video brief (for /brag)

**Status: brief only, nothing recorded.**

Every shot is a live run of `npm run demo:unknown` or a committed evidence file. Do not stage, splice, re-time or pre-record output. If a shot fails on the day, show the failure or re-run it on camera.

**Length:** 75–90 seconds.

**Tone:** precise, not breathless. The honest limits are part of the pitch.

## Claims the video may make (each backed by evidence)

1. RightClick X learned a command-line program it had no code for, from its documentation and sandboxed experiments.
   - *Evidence:* challenge Stage A; `integrationCodeLines: 0`.
2. It turned that into a capability that a fresh agent reused with 2 tool calls.
   - *Evidence:* Stage B.
3. It composed two learned programs that know nothing of each other, and an independent check passed.
   - *Evidence:* Stage C.
4. When the program changed, it adapted; when the change was incompatible, it refused rather than guessed; when the program was removed, the capability disappeared.
   - *Evidence:* Stages D and E.
5. The operator decides what may be investigated. Everything runs sandboxed. Unregistered programs are refused.
   - *Evidence:* control N2 and SECURITY.md.

## Claims the video must not make

- **"Works with any software" or "universal".** 3 of 12 random holdout programs passed.
- **"Faster" or "cheaper" than an agent with a shell.** The baselines show the opposite on the measured task.
- **"First" or "world's first".** No prior-art survey was done.
- **Cross-vendor reuse.** It was blocked by a usage limit and not shown.
- **Any user, star or adoption figures.** None exist.

## Shot list

| # | Time | On screen (live) | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:08 | Empty terminal. `npm run demo:unknown` | "Most software your company runs has no API and no MCP server. Here's one RightClick X has never seen." |
| 2 | 0:08–0:20 | `context_learn cli:tidy -> 7 capabilities from 44 sandboxed runs` and the evidence lines with their tags | "It reads the documentation and runs bounded experiments in a sandbox: no network, no home directory. Every claim is graded: declared, or experimentally supported." |
| 3 | 0:20–0:32 | `context_compose -> completed … published goal:demo-capability`, then `independent check … PASS` | "Ask for an outcome. It plans, runs and publishes a reusable capability, and the result is checked by code that isn't the program." |
| 4 | 0:32–0:45 | A second process: `context_graph search …`, then `context_run … completed; independent check: PASS` | "A different client that has never heard of the program finds the capability and uses it on new data." |
| 5 | 0:45–0:58 | `rm` the program, then `context_run -> failed … nothing was run` and `capabilities left: 0`; restore, then PASS | "Remove the program and the capability is withdrawn, not left to fail silently. Bring it back and it re-establishes." |
| 6 | 0:58–1:10 | Cut to REPORT.md gate table, scrolling past the two **NOT MET** rows | "We pre-registered the test and kept every failure. It isn't universal yet: three of twelve random programs. The evidence is in the repo." |
| 7 | 1:10–1:20 | The 13 tools list, then the repo URL | "One MCP connection. Thirteen tools. Your environment's capabilities, under your authority." |

## Before recording

- Run `npm test` (152 pass) and `npm run demo:unknown` on the recording machine, on macOS with `/usr/bin/tidy` present.
- Keep the evidence bundle from the recorded run (`demo/evidence/unknown-*.json`) and publish it with the video.
- The branch must be merged and the README updated first. Otherwise the video advertises unmerged, unsupported claims.
