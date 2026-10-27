# Inheritance isolation inventory — BLOCKED

This directory **does not launch models or an agent, create infrastructure, run
network probes, certify an environment, or grant approval**. `preflight.py`
is a fail-closed inventory for the future independent isolation assessment.
It always reports `BLOCKED` and exits 1. A supplied manifest is untrusted;
even a fully populated one is reported as unverified, never as a pass. It
prints field names and statuses, not the values supplied by the operator.

Run locally with Python 3:

```sh
python3 experiments/inheritance-isolation/preflight.py
python3 -m unittest discover -s experiments/inheritance-isolation -p 'test_*.py'
```

An optional JSON object may list nonempty text under the field names in
`preflight.FIELDS`. Do not put credentials, personal data or model prompts in
the manifest. This is a local assessment aid, not an executable runner.

## Requirements still to establish

* Separate ephemeral creator and inheritor environments, with only the
  synthetic fixture and their own identities. Transfer only a reviewed,
  versioned capability artifact, never a workspace or conversation.
* Trusted external probes and negative controls must demonstrate denial of a
  harmless existing out-of-bound file and a harmless disallowed destination,
  alongside positive controls to distinguish a genuine denial from a missing
  file or unreachable server. Test IPv4/IPv6, DNS/redirects and direct paths
  where relevant. Preserve independently collected observations.
* Enforced per-attempt process, memory and time limits, and proof that child
  processes terminate, including on supervisor failure.
* Owner-approved, enforceable per-attempt usage or billing boundaries,
  including retries, uncertain in-flight requests and applicable non-model
  charges. A rate allowance, alert, or monthly project budget is not by itself
  a per-attempt boundary.
* Independent assessment of controls and evidence, plus the platform's normal
  model-execution approval. The prior rejected launch must not be retried or
  circumvented.

OpenAI documents a [hosted sandbox](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)
with restricted networking and chosen CPU/memory sizes, and a
[self-hosted executor](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted).
Neither documentation nor this inventory establishes that the current account,
runner, model, process limits, independent tests or approval satisfy this
experiment. Hosted stdio MCP requires enabled networking, which conflicts with
the requested restricted egress; another supported configuration would need to
be evaluated. [API hard spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
can overshoot because enforcement is not instantaneous. The published
[per-run Responses API controller](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api)
excludes server-managed agent runs and several charge types; it is not proof of
a budget limit for the Codex CLI or an Agents API session.

No independent negative test, execution route, per-attempt cost boundary or
permission has been established by the files in this directory.
