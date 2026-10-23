# Zero-Integration Challenge: pre-registration

Committed **before** the capability investigator exists and before RightClick X is run on any application in the pool. Branch `feature/universal-capability-engine`. The security prerequisites are on `c90b24d`.

## Question

An AI agent is connected to RightClick X. Can it enter an environment containing software RightClick X has never seen, which exposes no machine-readable contract and has no integration, and do the following?

1. Discover a useful operation.
2. Execute it.
3. Have the result independently verified.
4. Retain it as a reusable capability that a fresh agent can find and use.
5. Compose it with a second unfamiliar provider.
6. Adapt, or withdraw explicitly, when the software changes or disappears.

All of this happens without application-specific code.

## Interaction surface (generic, authorised)

**Command-line applications** registered by the operator: discovery authority, set in configuration. Nothing else is investigated, and RightClick X never searches the filesystem for programs.

All investigation and every later execution run inside an OS sandbox:

- macOS `sandbox-exec`;
- no network;
- writes only to a fresh temporary directory, which is deleted afterwards;
- no reads under `/Users` except that directory;
- scrubbed environment;
- no shell (argv only);
- per-run limits on time (5 s), output (1 MB) and runs per investigation (≤ 60).

Where no sandbox is available, investigation is reported as **unavailable**. It is not run unsandboxed.

## Selection of unfamiliar applications

The selection is mechanical and seeded, so neither the product nor the evaluator picks favourable software.

**Pool.** Every executable in `/usr/bin` on this machine (macOS 26.4.1) that has a section-1 manual page.

**Excluded by category,** decided now:

- shells, interpreters, compilers and debuggers (arbitrary code execution);
- programs whose purpose is to change files or the system: `rm`, `mv`, `cp`, `ln`, `chmod`, `chown`, `chflags`, `touch`, `mkdir`, `rmdir`, `install`, `ditto`, `tar`, `zip`, `unzip`, `gzip`, `split`, `patch`, `dd`, `tee`, `truncate`, `xattr`, `defaults`;
- network clients and servers;
- privilege and account tools;
- process and system control;
- interactive full-screen programs and pagers;
- package, build and VCS tools;
- clipboard, audio, speech, display, UI and scripting bridges (`osascript`, `open`, `say`, `pbcopy`, `screencapture`, …);
- programs that only print system state (`ps`, `w`, `who`, `uptime`, `sysctl`, `df`, `du`, `ls`, `id`, `env`, `printenv`, `hostname`, `uname`, `sw_vers`, `system_profiler`, `ioreg`, `log`, `last`);
- any program whose name appears in RightClick X's source tree (`src/`, `bin/`).

**Suitability screen.** Mechanical, run by the harness in the same sandbox, 2 s each. A program is suitable when `--help`, `-h` or no arguments prints usage text containing at least one option or argument. The process must exit within the limit, with stdin empty.

**Draws** (SHA-256 seeded, `index = seed mod n` over the sorted suitable list, without replacement):

- **A**, the headline application, and **C**, the second provider for composition. Seed: SHA-256 of this pre-registration commit's hash.
- **G**, two holdout applications. Seed: SHA-256 of the frozen evaluation build's commit hash, drawn **after** that freeze. They are drawn from the suitable programs whose domain differs from A's and C's. The domain is the man page's first-line category word, the NAME line's description.

If a drawn program cannot be investigated at all (no observable operation), that is recorded as a failure for that program. The next draw is then used, and both are reported.

## Stages and pass criteria

Each stage is run on the frozen build, `uce-freeze-N`. Any general fix creates a new freeze, and the **complete** evaluation is repeated. Earlier runs are kept.

| Stage | Pass requires |
|---|---|
| **A** unknown application | 1. RightClick X, given only A's path as an investigation source, produces at least one capability with **experimentally supported** behaviour. 2. A fresh execution on input not used during investigation succeeds. 3. The output is checked against an **independent readback**: a different program or a property derivable from the input by the harness's own code, never A itself. 4. The capability is retained in the graph with its evidence. |
| **B** new tool | A fresh AI session (Claude Code), with only the 13 `context_*` tools, connected to the state that holds the capability. It is told what result is wanted on new input, never A's name or path. It finds and runs the capability without calling `context_learn` on A, and the answer passes the independent check. |
| **C** composition | A useful output that requires both A and C, neither of which provides it alone. It is planned and executed by `context_compose`, with no anchors naming capabilities, and checked independently. |
| **D** mutation | With a synthetic disposable program, under the operator's authority: renamed operation, changed input flag, nested output, an incompatible semantic change, and temporary unavailability. Compatible changes must be adapted to. Incompatible ones must fail explicitly. Zero wrong outputs presented as successful. |
| **E** withdrawal | Removing the installed copy of A (A is run from a copy in a disposable directory that the operator registers) withdraws A's capabilities and those depending on them. Restoring it lets the capability be re-established by investigation. |
| **F** cross-agent reuse | The agent that runs B is a different session, with a different vendor where possible (Codex), from the one that triggered construction. Same-vendor runs are labelled as such. |
| **G** holdout | On each holdout program: Stage A's criteria on the frozen build, with no changes. |

**Negative controls.** These must yield an explicit "no verified capability" or "unavailable" result, never a capability presented as verified:

- **N1:** a registered program that prints nothing and exits 1 for every input.
- **N2:** a program outside the registry.
- **N3:** a sandbox-unavailable run (simulated by the runner reporting no sandbox).
- **N4:** a program whose output is random for identical input. It must not be marked deterministic or verified.

## Baselines (Stage 6)

The same task is given to each baseline, on held-out inputs, with the same model (Claude Code default), a 40-turn budget and a 15-minute limit:

1. **Direct surface:** an agent with a sandboxed shell restricted to the same program, without RightClick X.
2. **Transcript:** an agent given RightClick X's investigation transcript as plain text and the same restricted shell.
3. **Structured docs:** an agent given the capability card (the generated description) as text and the restricted shell.
4. **Coding agent:** an agent allowed to write and keep a script that uses the program, which then answers the task.

Measured for both first use and reuse (a second task with new input): correctness against independent truth, tool calls, wall time, and tokens where the client reports them. Baselines that cannot be run with the available clients are reported as not run.

## Scoring

Mechanical, by the harness, against independent truth. A run that reports success with an output failing the independent check counts as a **wrong outcome**, the worst category. Any wrong outcome anywhere is reported in the headline.

## What will not be claimed

- That software without any accessible interface can be operated.
- That arbitrary applications are discoverable.
- That this is a first. No prior-art review is part of this programme.
