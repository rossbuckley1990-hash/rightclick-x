# Native authority evidence and installed-package checkpoint

**PARTIAL milestone; release remains NO-GO.** The ordinary dashboard now displays historical Actenon receipts and refusals verified outside the isolated runtime. They confer no permission. In the same persistent session, revoking the grant blocks an identical previously successful action while its historical evidence remains visible. An actual tarball installation exposed and then verified the correction of a Node package-export defect.

The branch remains `programme/adaptive-capability-plane` in `/Users/ross/src/rightclick-x-adaptive`. Starting commit: **`b38f18abdd4869a8482e690828311bc3ea498b94`**. Product evidence feed: `952711c`; receipt-classification correction: **`6d543e38a62d422ff54ce207d5a63da4851010c2`**. Package correction: **`65368207c5a537a2ca08151d51859f37d75a1919`**. Session/checker freeze: `7070393`; final engineering/audit freeze: **`596c5ccf02346656c68f770095c8acf7ffa8047d`**. No branch switch, merge, push, publication, spending, model subprocess or outreach occurred.

## Invariants and implementation

Historical evidence must never become execution authority. A host-owned `AuthorityEvidenceSource` supplies a bounded, explicitly projected read-only view through authenticated `GET /api/authority-evidence`. It has no tool setter, graph mutation, persistence field, planner hook or dispatch authority. Missing, stale, malformed, failed and timed-out responses produce unavailable evidence with no stale-success fallback. One in-flight read prevents an uncooperative callback from accumulating subprocesses. The thirteen `context_*` tools remain unchanged.

The optional `rightclick-x/actenon-evidence` adapter imports the existing native Actenon verifier in a separately provisioned Python environment. It pins public-key bytes, issuer and one resource origin. It accepts native receipt/refusal attestations only, verifies their signature and bindings through Actenon, and projects artifact kind, outcome, digests, actor and time. It exposes no raw bodies, proof tokens, credentials or target URLs. No cryptographic implementation, grant issuer, effect store or credential broker was copied into RightClick X. All five audited Actenon checkouts remain unchanged.

The host reader permits at most 100 records and a five-second configured deadline; the optional adapter uses a three-second host deadline, 2.5-second subprocess timeout, 256 KiB output limit and 4 MiB input limit. Its bounded suffix is historical evidence, not a complete journal. A single-origin profile rejects alternate aliases unless separately configured; the native positive control deliberately selects 28 matching records from a previously exposed 50-artifact fixture, and the foreign-origin negative control refuses.

The dashboard labels receipts and refusal artifacts separately: one denied request can produce both. Current authority remains **UNKNOWN**, and runtime-call linkage remains **not established**. A valid signature establishes who signed a historical claim and its integrity; it does not independently prove the truth of every resource claim or the business outcome.

The installation experiment found that the existing package exported `.ts` files from `node_modules`, which Node refuses to strip. The build now supplies JavaScript exports for the root SDK, edge entry and optional adapter. Existing TypeScript sources remain available for type information. The local tarball loads on tested macOS Node 26.12 and Linux Node 24.22. This does not establish every supported Node/platform combination or a clean-machine Actenon installation.

## Actual end-to-end evidence

The persistent session uses the existing network-isolated, non-root container and ordinary HTTP/MCP handler. The trusted supervisor performs native verification outside that container and relays only the projected evidence. Verification configuration and the operator's authority channel are not runtime tools. The resource still owns the sole protected fixture execution boundary; the evidence endpoint cannot authorize it.

The session discovers and executes the real RCSB → Crossref citation workflow, then learns the newly advertised local compression contract through the existing catalog path. Discovery observes an empty grant store. The issuer refuses execution without a grant and with a changed body. A separately labelled, trusted-controller direct request also receives a signed resource refusal. It is not misrepresented as the agent's broker refusal.

After exact authorization, one POST creates one gzip artifact. Two monitor reads and one terminal read complete the result, each with its own native exact-action proof. The separately implemented checker decompresses the actual artifact, verifies its digest, reconciles the request/proof multiset and checks all signatures. It retains the original four-read continuation budget and rejects write replay or unaccounted requests.

The controller then revokes the grant. Invoking the identical saved capability sends the identical intended POST to the issuer and is refused before forwarding. Effects remain unchanged. Six historical signed artifacts remain visible: four executed receipts, one refused receipt and one refusal artifact. A separate public readback confirms the primary DOI, publication title and publisher for `1CRN`.

The browser capture shows the corrected [historical authority view](evidence/authority-feed/attempt2/authority-final.png). The temporary presentation and disposable resource were closed cleanly. Prior fresh-process and actual-model reuse evidence remains at its original freezes; this increment does not claim a new model trial.

## Measurements and tests

| Check | Observed result | Boundary |
|---|---:|---|
| Complete native regressions | 452/452 | Zero failures, cancellations or skips in final authorized run |
| Focused Linux regressions | 63/63 | 56 authority/recovery checks plus 7 persistence checks; zero skips |
| Existing proof / protected-workflow controls | 28/28 / 30/30 | Acceptance criteria unchanged |
| Native adapter controls | 12/12 | Valid and empty accepted; 10 malformed/untrusted cases rejected |
| Native upstream attestation unit tests | 5/5 | Source-pinned upstream development fixtures |
| Session artifact / unexpected effects | 1 / 0 observed | Disposable resource journal and actual decompressed bytes |
| Session exact successful proofs / signed artifacts | 4 / 6 | Three continuation reads; refused attempt has two artifacts |
| Issuer refusals / direct resource refusals | 3 / 1 | No grant, changed body, revoked identical action; direct native control separate |
| Corrupted session / workflow copies rejected | 9 / 5 | Same-author separate native checkers |
| Session requests / tool calls | 16 / 8 | Six public requests; excludes verifier subprocesses and separate oracle requests |
| Graph operations / retained goals | 20 → 75 / 2 | Counts are not executable-coverage or business-success counts |
| Initial / final runtime RSS | 63,799,296 / 179,646,464 bytes | Samples, not peak or memory containment |
| Serialized state after revocation | 2,188,873 bytes | Compact JSON, with no retained grant or proof |
| Installed native-feed reads | 212.84–265.31 ms; median 220.78 ms | Five sequential local observations, six records, 3,564-byte responses |
| Installed exports | 3/3 load on Linux Node 24 | Root, edge and optional adapter; deterministic hash result correct |

Typecheck, strict harness/adapter typecheck and all four builds pass. The separate protected-workflow checker verifies fourteen successful exact proofs and fifty signed artifacts. The actual installed optional adapter verifies the saved native session artifacts on macOS, retains HTTP authentication and cannot override an execution-denying runtime policy.

These measurements establish neither a strong-agent economic advantage nor independent authorship. Public providers and controlled fixtures were already exposed to the programme. The five feed reads measure verification overhead; they are not a comparative benchmark. Prior adverse saved-script/model results remain binding.

The [manifest](evidence/authority-feed/manifest.json) binds source, tests, harnesses and preserved artifacts to the engineering freeze. [Offline reconciliation](evidence/authority-feed/verification.json) reruns native session/workflow checking without network or model calls. The [metadata](evidence/authority-feed/metadata.json), [public check](evidence/authority-feed/public-check/result.json), [installed-package result](evidence/authority-feed/installed-fixed-check.json) and [failure ledger](evidence/authority-feed/failures.json) retain the underlying evidence.

## Failures retained and corrected

- A native refused **receipt** was initially displayed as unresolved; a refusal artifact was correctly refused. A new semantic assertion reproduced the defect before the mapping was corrected. Both artifact kinds are now explicit.
- The older session checker assumed one fewer pending read and unique wire values. The real provider legitimately returned an extra 202. The corrected checker permits only the existing bounded sequence, requires distinct proofs, accounts for every protected request and still permits exactly one submitted write. Read-budget, replay and unaccounted-request corruptions now have explicit controls.
- Installed Node imports failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The failed installation/log and passing compiled package are both preserved.
- Upstream HMAC development fixtures initially hit their production safety guard. Only the upstream test invocation received `ACTENON_ENV=test`; the product adapter and protected resource use Ed25519 and no such override.
- A restricted full-suite run recorded 376 passes, 3 failures and 71 skips because loopback setup was unavailable. The authorized rerun records all 452 passes with no skips. A missing-output-directory typecheck attempt is documented separately; no result is invented for the command that never ran.

## Requirement coverage and remaining blockers

| Original outcome | Contribution in this increment | Remaining gap |
|---|---|---|
| 1 Generic discovery | Existing real/public and catalog/local path rerun in one session | No new protocol family or independently unseen environment coverage |
| 2 Established meaning and outcomes | Refusal semantics corrected; native artifact and fresh public checks agree | General business meaning and independent-author evaluation |
| 3 Consequential restrictions | Revoked identical action refused; historical feed cannot grant permission | Whole-agent route coverage, production custody and native hard-memory containment |
| 4 Reusable capabilities | Two retained goals still exist; revoked saved goal obeys current authority | New fresh-model/cross-vendor trial in this combined session |
| 5 Safe adaptation | No historical authority survives as a grant | Complete same-session compatible/incompatible provider-change challenge |
| 6 Superior economics | No qualifying advantage claimed | Matched strong-agent acquisition, reuse and maintenance comparison |
| 7 Rigorous evaluation | Full regressions, native negative controls, corruptions and preserved failures | Independent review/holdout; historical native memory escape remains FAIL |
| 8 Simple installation/DX | Actual Node package-import defect corrected; optional adapter packaged | Clean-machine native dependency provisioning and unfamiliar-developer trials |

The initial Actenon feasibility recommendation remains conditional prototype GO / production NO-GO. This minimal optional integration improves inspectability and removes a concrete SDK adoption defect. It does not yet demonstrate commercial superiority. Direct APIs, shell access, credentials, generated endpoints, alternative tools and federated runtimes need covered enforcement boundaries of their own. The fixture's successful controls do not prove universal containment or visibility.

The next three engineering priorities are:

1. Finish compatible-change, incompatible-refusal and actual fresh-model acts in the same session; preserve the distinction between signed artifact identity and trustworthy runtime-call correlation.
2. Freeze the implementation for independently selected unfamiliar software and independent review; remediate the native memory failure or provide an honestly bounded supported containment profile.
3. Compare complete acquisition/reuse/maintenance costs against strong coding-agent and saved-script baselines, then test installation with unfamiliar developers. Existing commercial thresholds are unchanged.

## Reproduce

Use the final engineering freeze with the separately provisioned, source-pinned Actenon environment listed in the metadata. The offline checks use only saved artifacts. The live trial needs the two configured public metadata services, Docker and the existing cached image; it creates disposable local effects only.

```sh
cd /Users/ross/src/rightclick-x-adaptive
npm run typecheck
npm test
npm run build
npm run proof
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/verify-authority.py docs/adaptive/evidence/authority-feed/manifest.json
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/test-authority-adapter.py

node experiments/living/living-session.ts \
  experiments/living/public-citation.json /private/tmp/rcx-authority-new \
  sha256:5e95a1b7bdb5ddd279c4c18760a007a98f94c6fb24236433c19b61831bc4e4f5 \
  /Users/ross/src/actenon-audit/.venv/bin/python
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/check-session.py /private/tmp/rcx-authority-new
/Users/ross/src/actenon-audit/.venv/bin/python -B \
  experiments/living/check-public-citation.py /private/tmp/rcx-authority-new /private/tmp/rcx-authority-oracle-new
```

Output directories must be new. Append `hold` from an interactive terminal for the five-minute bounded dashboard session. The [optional integration README](../../integrations/actenon/README.md) describes host configuration and trust boundaries.

For a local installation check, build, run `npm pack --ignore-scripts --offline --pack-destination /your/new/output`, then install that tarball into a new directory with `npm install /absolute/tarball.tgz --offline --ignore-scripts --omit=dev --no-audit --no-fund`. Run `node experiments/living/check-installed-authority.mjs /absolute/install-directory /absolute/actenon-python /absolute/session-evidence-directory`. It imports only the installed package. The preserved trial demonstrates these steps using the existing local npm cache; it is not a claim that native Actenon dependencies are installed automatically.
