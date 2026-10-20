# Fresh-model public capability reuse: development evaluation

Starting checkpoint `b46abeb713190c5231a5e90817f1fa87cf71434c`; product implementation is unchanged from `9fb6b24c`. Freeze this plan, transport, runner, task configuration and checks before model execution.

The missing evidence is an actual fresh model invoking the retained public multi-provider capability on a new input. Earlier fresh-process reuse did not call a model. This evaluation uses the already exposed RCSB/Crossref capability; it is not an independently selected unfamiliar-software holdout, new acquisition result, cross-vendor comparison or economic benchmark.

Each session receives its own untouched copy of the original successful acquisition state (`living-public/attempt3/state.json`, SHA-256 `30b02ea92b6bced59981750525e48bcb48ed4b59e19b268092cb2a0b96562ea3`). No conversation, earlier new-input answer or oracle result is supplied. The prompt names the desired business result and input, not operation IDs, field mappings, DOI values or the saved goal ID. It asks the agent to reuse the inherited capability. The thirteen tools remain available.

Run the four tasks in `experiments/living/fresh-public-reuse.json` once in order: two positive new-input sessions with `gpt-6.1-sol` and `gpt-6-sol`, then a missing-identifier and a withdrawn-local-permission control. Both models are from one vendor, at low effort. The two positive inputs differ from acquisition input `1CRN` and earlier process input `4HHB`; they are not claimed unseen elsewhere in the programme. A separate public REST readback selects the expected primary DOI from the requested structure, then obtains the publication using that DOI. The candidate's answer never chooses the oracle URL.

Positive acceptance requires a completed valid fresh model session, the correct exact DOI/title/publisher, a call to the inherited saved goal, zero contract discovery requests and zero `context_learn` or `context_compose` calls. The missing identifier must produce an explicit inability to answer without a false successful result. The withdrawn permission case must likewise refuse, with zero provider requests. This is local policy evidence, not independent Actenon enforcement or whole-host containment.

Retain raw model and MCP records, every attempted public request/response, the initial-state hash, source hashes, current subscription preflight and final usage. Record all failures without altering the tasks or retrying by answer quality. Stop on transport/trace failure, timeout, quota or unavailable no-spend proof. A changed CLI may require a new separately recorded transport revision; it does not justify concealing the failed attempt.

Use only ChatGPT subscription authentication, ordinary usage allowed, a supported personal plan, primary usage below 90%, zero credits and no unlimited-credit entitlement. Exclude API/provider credentials and disable unrelated agent tools. No Claude retry, billing change, reset or API fallback. The preliminary read-only check observed CLI 0.163.0, included usage available, 34% used and zero credits. The first sandboxed metadata attempt failed before initialization because it could not access the local SQLite runtime; its evidence remains.

The generic host permits configured HTTPS public reads only, with manual redirects, no authorization/cookie headers, 24-request and streaming byte budgets, a thirty-second request timeout and request spacing. Runtime origin/private-network and execution policy checks remain in place. The host is evaluation instrumentation; it is not added to the product as a special integration.

After the frozen sessions, run a separate result checker and corrupt its copied inputs to ensure altered output, hidden discovery and concealed requests fail. Run typecheck and native regressions before committing the freeze. Keep the original broad acceptance thresholds and adverse economics unchanged.

## Preserved runner configuration failure

Freeze `5177cb2` completed the first model turn, then stopped on three trace-audit violations. Inspection of the raw trace establishes a runner error: it supplied `rightclick-x` as the audit prefix, whereas the existing `codexSession` contract and earlier runner require `mcp__rightclick-x`. The observed tool names were the configured MCP server's three `context_*` calls. This was not a CLI naming change. The original invalid result, answer, 115,910 reported tokens and 23.1 seconds remain in `attempt1`; they are not silently converted into a valid trial.

Correct only the caller's prefix, keep the auditor, prompts, tasks, retained state and acceptance rules unchanged, commit the correction, then run a new four-session trial. This is a transport-validity retry, not selection by answer quality. Report the additional first-attempt resources alongside the final trial. Rechecking the original trace under the correct unchanged auditor is diagnostic evidence, not a replacement for the recorded failure.
