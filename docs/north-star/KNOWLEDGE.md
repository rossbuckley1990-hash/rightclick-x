# Capability knowledge: a privacy-conscious transfer format, and whether it transfers

## The format (implemented)

[`src/core/knowledge.ts`](../../src/core/knowledge.ts) defines the format `rightclick-x/capability-knowledge@1`. It is produced by `context_graph {op: "knowledge"}` or `rcx knowledge export`. **Export needs the operator's evidence-sharing authority** (`RCX_SHARE_EVIDENCE=1`); it is off by default.

| Exported | Never exported |
|---|---|
| Program identity: name, path, version, SHA-256, OS, architecture | Credentials of any kind |
| Learned capabilities: contracts, invocation templates, documented options | Caller inputs and outputs |
| Behaviour fingerprints and evidence claims with their status | Run records and receipts |
| Two conformance examples per capability, made of the investigator's **synthetic** inputs | Fixed goal values; checks bound to someone's data |
| Published goals' shape (inputs, intent), not their data | |

## Import trusts nothing

`rcx knowledge import <file>` (or `importKnowledge`) accepts a capability only if all of these hold:

1. The program exists **here**, on a path **this** operator authorised.
2. **This** host has a working sandbox.
3. Every stored conformance example reproduces **here**, with byte-identical output.

Anything else is refused, with the reason recorded. Imported capabilities carry the evidence `imported …; revalidated by N examples on this host`. Goals are not imported as such: they are recomposed on the revalidated capabilities.

## Does knowledge transfer? (measured)

These are pilot and `ns-freeze-1` results. Full numbers are in `evidence/transfer-*.json`.

| Program | Mac → Linux (BSD/Apple tool → Debian tool) | Linux → Linux (two fresh installations) | Cold learning vs warm revalidation (container) |
|---|---|---|---|
| expand (pilot) | **accepted**; 4/4 tasks correct against the container's own truth | accepted | 24 runs → 4 runs |
| base64 (pilot) | **refused**: GNU output differs | accepted | 28 → 6 |
| od (pilot) | **refused**: output format differs | accepted | 29 → 4 |
| sum | **refused**: column spacing differs | accepted | 24 → 4 |
| json_xs | accepted; 0/4 tasks (the frozen investigator had not learned its `-t` option; fixed in cycle 1) | accepted | 24 → 2 |
| autom4te | accepted; 1/4 tasks (the `--trace=MACRO[:FORMAT]` grammar was not read; fixed in cycle 1) | accepted | 34 → 6 |
| exiftool | **refused**: version 13.55 vs 12.57, different output | accepted | 10 → 2 |
| xsubpp5.34 | not attempted: Debian names it `xsubpp` (same-name rule) | — | — |

**What this shows:**

- **Revalidation catches cross-platform differences.** Every Mac capability whose behaviour differs on Debian was refused before use. **Zero imported capabilities were used without revalidation, and zero wrong outcomes were produced.**
- **Transfer between installations of the same environment works and is cheaper.** Linux → Linux imports were accepted in every case, with 2–6 sandboxed runs instead of 10–34. This is the case a private capability registry would serve.
- **Cross-platform reuse is rare.** Most knowledge learned on macOS does not transfer to Linux, because the "same" program behaves differently. **The moat hypothesis is therefore unproven:** knowledge transfer helps only between near-identical environments, and the measured saving is a few hundred milliseconds of sandboxed runs. It is not the agent's reasoning cost, which dominates.

## What would make this a moat (not shown)

- Revalidated knowledge measurably reducing **agent** cost or failures on unseen tasks in a new environment. Not measured: the transfer experiment measures runtime cost only.
- A registry where many installations contribute independently reproduced capabilities. Requires real users.
- Failure knowledge (counterexamples) preventing the same class of mistake elsewhere. Counterexamples are recorded in contracts, but no experiment has measured their effect yet.
