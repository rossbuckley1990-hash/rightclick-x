# Proposed README addition (not applied)

**Status: proposal only.** The current `README.md` is unchanged. As REPORT.md recommends, do not apply this until:

- Gate 9 (holdout generalisation) and Gate 11 (benefit over a simple baseline) pass on a fresh freeze;
- the feature is merged.

Every sentence below is limited to what the committed evidence supports today. The bracketed notes say which evidence backs each claim; remove them when publishing.

It is intended as a new section after "Things we've actually run", plus one line in the hero.

---

**Hero, one line added under the existing tagline:**

> **Experimental:** point it at a command-line program with no API and no MCP server, and it works out what the program does — in a sandbox, under your authority.

---

## Software with no contract (experimental)

Most software doesn't ship an OpenAPI spec. RightClick X can now learn a command-line program you register, with no integration code, and turn what it finds into capabilities your agents reuse through the same 13 tools.

```bash
npm run demo:unknown        # macOS: learns /usr/bin/tidy live, then removes and restores it
```

```text
▶ live   context_learn cli:tidy -> 7 capabilities from 44 sandboxed runs (stdin, files; ok exit 1)
▶ live     evidence: purpose: tidy - validate, correct, and pretty-print HTML files [declared]
▶ live     evidence: accepts html/json/csv/text input via stdin and prints html [experimentally-supported]
▶ live   context_compose -> completed via tidy: validate, correct, and pretty-print HTML files; published goal:demo-capability
▶ live   independent check by this script (not the program): PASS
▶ live   context_run goal:demo-capability on new input -> completed; independent check: PASS
▶ live   context_run -> failed: cli:tidy:default: program not installed … (nothing was run)
▶ live   program capabilities left in the graph: 0
```

[`demo/unknown.ts`. The output above is from a real run on 2026-10-17; the ms timings and the temporary path are omitted.]

**How it works:**

- **You authorise.** Investigation happens only for programs or directories the operator registers (`RCX_INVESTIGATE`). The model can't widen that.
- **It investigates in a sandbox.** No network, no reads in home directories, writes only to a throwaway directory, at most 60 runs of 5 s. It reads the program's usage text and manual page, then runs bounded experiments on synthetic inputs. Help text is treated as data, never as instructions.
- **Every claim is graded:** declared, observed, experimentally supported, contradicted or unknown. Behaviour seen only once, or that ignores its input, is never composed automatically.
- **It plans for the outcome you need.** With `require`, a plan runs only if the result is established to carry that information. Otherwise you get an explicit *unverified*, *incomplete* or *unavailable* outcome, not a guess.
- **It stays honest when software changes.** Capabilities are pinned to the program's hash. If the program is removed, its capabilities are withdrawn. If it changes, they are re-checked before they run.

**What we measured** [`experiments/universal-capability-engine/REPORT.md`]:

- **Pre-registered challenge.** Programs were drawn at random by seed. RightClick X:
  - learned an unfamiliar program;
  - published it as a capability;
  - let a fresh agent reuse it in 2 tool calls;
  - composed it with a second learned program;
  - adapted to three kinds of change;
  - withdrew it when removed.

  There were 0 wrong outcomes on the last five freezes.
- **Holdout.** On random holdout programs it is **not yet reliable**: 3 of 12 passed across six builds.
- **Baseline.** On a well-known program, an agent with a plain sandboxed runner did just as well for fewer tokens.

This is why the feature is labelled experimental.
