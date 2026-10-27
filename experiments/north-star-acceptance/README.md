# North Star acceptance on real, unfamiliar software

**Scripts:**
- `node experiments/north-star-acceptance/acceptance.ts [--rcx <checkout>] [--label name]` runs the eleven steps with no language model.
- `node experiments/north-star-acceptance/agents.ts [--arms rcx,rcx-seeded,shell,shell-memory]` runs fresh agents on the same task. It's billed.
- `node experiments/north-star-acceptance/summarize.ts` writes the tables to `results/SUMMARY.md`.

## Software and task

**Software.** Six real programs as installed on this Mac:
- `jq` 1.8.2;
- `json_pp` (Perl JSON::PP);
- `shasum` (Perl Digest::SHA);
- `sha1sum` (the system md5 family);
- `idn2` and `idn` (libidn2 and libidn).

None was in the pre-registered development set (`docs/north-star/evidence/development-set.json`), and none is named in RightClick X's `src/` or `bin/`. This experiment now adds all six to the development set, so no later holdout can count them as unfamiliar.

**Authority.** The operator authorises each program by its exact path in an installation directory the script owns. Every software change happens there, never to the installed programs.

**Task: fingerprint a release manifest.** The fingerprint is the SHA-1 of the manifest's canonical JSON (keys sorted, no whitespace, no trailing newline), as content-addressed stores compute it.
- **Producer:** `jq -S -c -j` then `sha1sum`.
- **Independent implementation:** `json_pp -json_opt canonical` then `shasum`. Neither of its programs, nor the implementations behind them, is part of the producer.
- **Oracle:** the script itself runs both pipelines directly. It requires them to agree, and checks every answer against them.

## The eleven steps, by build

Each build's real `rcx mcp` server is driven as an MCP client would drive it, with a fresh process per session and every call scripted. The evidence for each step is in `results/<build>/acceptance.json`.

| Step | `main` 5c1a2c0 | `main` + this PR | `main` + #20 + #22 + this PR |
|---|---|---|---|
| 1. Encounter unfamiliar supported software | PASS | PASS | PASS |
| 2. Discover its capabilities with no bespoke adapter (25 capabilities from 6 programs, about 3.5 s) | PASS | PASS | PASS |
| 3. Represent them as typed capabilities: inputs, outputs, read risk, authority | PASS | PASS | PASS |
| 4. Compose `jq` → `sha1sum`, with options pinned in the goal | PASS | PASS | PASS |
| 5. Authority and confinement: an unauthorised program and a file operand outside `files` are refused; macOS sandbox, no network | PASS | PASS | PASS |
| 6. Independently verify the outcome | **FAIL**: form check only | PASS | PASS |
| 7. Save it as a reusable goal | PASS (checked) | PASS (verified) | PASS (verified) |
| 8. Reuse it in a fresh process with no rediscovery, on an unseen manifest | PASS | PASS, verified | PASS, verified |
| 9. Survive a compatible change (`jq` rebuilt as a same-behaviour wrapper) | **FAIL**: refused | **FAIL**: refused | PASS, with the operator's standing conformance samples (#20); still refused without them |
| 10. Refuse an incompatible change (the "upgrade" stops sorting keys) | PASS | PASS | PASS: sample output differs; caller operation not dispatched |
| 11. Removal and recovery: goal retained and searchable while `jq` is gone; correct and verified once `jq` is restored and re-learned | PASS | PASS | PASS |
| **Steps passed** | **9/11** | **10/11** | **11/11** |

**Step 6.** There is no real program that accepts a candidate fingerprint and returns a verdict. So on `main`, RightClick X can only check the result's form; only the script confirms it. With agreement witnesses (this PR):
- the independent pipeline recomputes the fingerprint from the manifest alone and must agree;
- the goal is verified, and stays verified on every reuse;
- a subtly wrong producer, one that keeps `jq`'s trailing newline, is refuted: `2910…` against `aa5d…`.

**Step 9** needs #20. #20 accepts a changed program only against samples the operator authorised **before** the change. Samples supplied afterwards are not accepted, by design.

**Step 11.** Recovery after a restore is one explicit operator action: re-learning `jq`. Until then the goal fails cleanly with "unresolved required anchor"; it never runs the wrong program.

## Fresh agents on the same task

**Setup:**
- Each session is `claude -p` with claude-opus-5-5 and Claude Code 2.1.301, capped at $1 and 30 turns.
- Each arm gets only its own tools, and every session gets a new manifest.
- Each arm has two repetitions of a first session and two later ones.
- A discarded primer opens each block.

**The prompt asks every arm to confirm with a second implementation.** The script checks every answer and records how it was confirmed: from the server's audit log for RightClick X, and from the commands and saved scripts for the shell arms.

**Arms:**
- RightClick X with persistent state, where the agent itself builds the goal (`rcx`).
- RightClick X reusing the operator's complete goal from the acceptance (`rcx-seeded`).
- A stateless shell (`shell`).
- A shell with a persistent notes directory (`shell-memory`).

The `rcx` arms run this PR's build, `main` plus agreement witnesses.

| Arm | Correct | Confirmed by a second implementation | Median cost | Median time | Turns |
|---|---|---|---|---|---|
| rcx, first session | 2/2 | stored witness 1 (hash step only, see below), by hand 1 | $0.497 | 73.1 s | 18.5 |
| rcx, later sessions | 4/4 | stored witness 2 (hash step only), by hand 2 | $0.161 | 22.2 s | 5.5 |
| rcx-seeded, every session | 6/6 | **stored witness 6, the whole task** | **$0.120** | 16.7 s | 4 |
| shell, first session | 2/2 | ran both pipelines 2 | $0.080 | 12.5 s | 2 |
| shell, later sessions | 4/4 | ran both pipelines 4 | **$0.076** | **11.6 s** | 2 |
| shell + notes, first session | 2/2 | ran both pipelines 2 | $0.113 | 19.9 s | 4 |
| shell + notes, later sessions | 4/4 | saved script 2, ran both 2 | $0.089 | 18.9 s | 4 |

**No superiority is claimed.**

- **Shell agents won on cost and time.** Every arm was correct every time.
  - The stateless shell was cheapest and fastest: $0.076 and about 12 s.
  - Reusing the operator's goal cost about 58% more than that ($0.120) and about 35% more than shell with notes ($0.089).
  - An agent building the goal itself cost 5–7 times as much as a shell session.
- **The shell arms confirmed only because the prompt asked.** Both shell arms confirmed with a second implementation in every session, by running both pipelines. Their confirmation lives in the agent's own behaviour or its saved script. RightClick X's stored witness repeats on every reuse whatever the prompt says, but only if one was stored.
- **Agents did not reliably build the complete verified goal.** Neither cold RightClick X agent built it:
  - **One saved a narrower goal**, "SHA-1 of already-canonical JSON", whose agreement witness covers only the hash. In its later sessions the model wrote the sorted, compact JSON itself and passed it in. The answers were correct, but the canonicalisation was neither executed nor verified.
  - **The other saved a goal with only a form check.** It confirmed by hand, running `shasum` separately, in each session.
  - **Only the operator's scripted goal was verified end to end.** That goal had both pipelines composed and pinned.
- **Security behaviour differed:**
  - The RightClick X arms ran only the four authorised programs, in the sandbox.
  - The shell arms ran in an unconfined shell. Two shell-with-notes sessions also ran `perl`, which was not authorised, in their saved script.

## Findings for engineering

1. **Fixed in this PR: verification needed a candidate-judging checker.** Real software rarely offers one. Agreement witnesses let an independent implementation recompute the outcome instead, which fixed step 6.
2. **Fixed in this PR: option arity from synopses.** `json_pp`'s man page lists `-json_opt` alone on its own line, and the synopsis declares its argument. The option was learned as a bare flag, so the independent pipeline couldn't be composed.
3. **Open: two option-bearing CLI steps can't take different options.** Both steps' `options` ports bind the caller's single `options` value. So `jq -S -c -j | shasum -a 256` can't be composed, and this task uses SHA-1 so that each pipeline has only one option-bearing step.
4. **Open: the sandbox's `C` locale.** It stops programs that need UTF-8 from handling non-ASCII input: `idn2` fails on "bücher.example". This is recorded as an observation in step 6. Changing it would alter every CLI capability's behaviour fingerprint.
5. **Open: agents don't reliably build complete, independently verified goals unaided.** They build what's easiest and fill gaps themselves. This is the largest remaining gap between the mechanism (11/11 when an operator scripts it) and agent use.
6. **Open, by design: recovery after a restore needs an explicit re-learn.**

## Limits

- **Small samples:**
  - 2 repetitions per arm.
  - One task, on one machine, with one model and one client.
- **Not a production system.** The software is real and unfamiliar, but local. It is not a third-party production service.
- **Simulated changes.** Steps 9–11 simulate software changes with wrappers and removal, inside the script's own installation directory.
- **The agent comparison includes a seeded arm.** The `rcx-seeded` arm reuses a goal built by an operator script. Its setup is part of the acceptance and isn't in its per-session cost.
- **Release blockers remain.** R1 (Linux sandbox isolation) and R2 (hard resource containment) are unresolved. Nothing here bears on them.
