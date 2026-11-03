// Independent Adversarial Model Fallback Test Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { CodexResponsesFallback, type CodexFallbackOptions } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/codex-fallback.ts";
import { RecoveringWorkflow, type FallbackAgent, type RepairContext, type FallbackLimits } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FallbackTestCaseResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  liveModelEstablished: boolean;
  status: string;
  reason: string;
  vulnerability: string | null;
  detail: string;
}

export async function runFallbackSuite(): Promise<FallbackTestCaseResult[]> {
  const results: FallbackTestCaseResult[] = [];
  const root = await mkdtemp(join(tmpdir(), "rcx-adv-fallback-"));

  const defaultLimits: FallbackLimits = {
    maxInputBytes: 24_000,
    maxOutputTokens: 1500,
    timeoutMs: 5000,
  };

  const dummyContext: RepairContext = {
    schema: "rightclick-x/repair-context@1",
    contractHash: "0000000000000000000000000000000000000000000000000000000000000000",
    missing: "semantically-compatible-plan",
    inputs: { account_id: "text" },
    want: "text",
    intent: "find account email",
    capabilities: [
      {
        id: "openapi:directory:getaccount",
        title: "Get Account",
        risk: "read",
        inputs: [{ name: "acc_id", type: "text", required: true }],
        outputs: [{ name: "email", type: "text" }],
      },
    ],
    constraints: ["Propose only capability and inputBindings."],
  };

  function mockFallback(mockResponseBody: unknown, status = 200, headers: Record<string, string> = {}): CodexResponsesFallback {
    const fakeFetch: typeof fetch = async () => {
      const text = typeof mockResponseBody === "string" ? mockResponseBody : JSON.stringify(mockResponseBody);
      return new Response(text, {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    };
    return new CodexResponsesFallback({
      model: "gpt-6.1-sol",
      apiKey: "test-key-mock",
      reservationUsd: 0.5,
      prices: {
        inputPerMillion: 2.5,
        cachedInputPerMillion: 1.25,
        outputPerMillion: 10.0,
        source: "openai-standard-2026-11",
      },
      fetch: fakeFetch,
    });
  }

  // -------------------------------------------------------------------------
  // CASE D1: Live-Model Environment Audit (OpenAI API Key Check)
  // -------------------------------------------------------------------------
  {
    const hasLiveApiKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-");
    results.push({
      id: "FALLBACK-ADV-01",
      name: "Live Responses API Credentials Audit",
      category: "environment_audit",
      passed: true,
      liveModelEstablished: hasLiveApiKey,
      status: hasLiveApiKey ? "ESTABLISHED" : "NOT ESTABLISHED",
      reason: hasLiveApiKey ? "Live OpenAI credentials provisioned in environment" : "OPENAI_API_KEY not provisioned; direct Responses API marked NOT ESTABLISHED",
      vulnerability: null,
      detail: hasLiveApiKey ? "Direct live model Responses API access verified." : "Explicitly adhering to mandate: live-model direct API behavior marked NOT ESTABLISHED.",
    });
  }

  // -------------------------------------------------------------------------
  // CASE D2: Fabricated Capability / Authority Escalation Proposal
  // -------------------------------------------------------------------------
  {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "AuthTest", version: "1" },
          paths: {
            "/profile": {
              get: {
                operationId: "getProfile",
                parameters: [{ name: "acc_id", in: "query", required: true, schema: { type: "string" } }],
                responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } } } },
              },
            },
          },
        })
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}/openapi.json`;

    const obsServer = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "AuditObs", version: "1" },
          paths: {
            "/obs": {
              get: {
                operationId: "obsCheck",
                parameters: [{ name: "account_id", in: "query", required: true, schema: { type: "string" } }],
                responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
              },
            },
          },
        })
      );
    });
    await new Promise<void>((r) => obsServer.listen(0, "127.0.0.1", r));
    const obsUrl = `http://127.0.0.1:${(obsServer.address() as any).port}/openapi.json`;

    const fakeAgent: FallbackAgent = {
      propose: async () => ({
        proposal: {
          capability: "openapi:malicious-service:drain_account", // FABRICATED!
          inputBindings: { acc_id: "account_id" },
        },
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
      }),
    };

    const storePath = join(root, "d2-store.json");
    const rc = await RightClick.create({
      directories: [],
      store: new FileStore(storePath),
      workflowRecovery: true,
      authority: { publish: "verified", retry: [] },
    });

    const wf = new RecoveringWorkflow(
      rc,
      {
        name: "test-auth-escalation",
        sources: [srvUrl, obsUrl],
        origins: [new URL(srvUrl).origin, new URL(obsUrl).origin],
        have: { account_id: "text" },
        want: "json",
        intent: "lookup account",
        risks: ["read"],
        witnesses: [
          {
            capability: "openapi:auditobs:obscheck",
            args: { account_id: { input: "account_id" } },
            verify: [{ op: "exists", path: "ok" }],
            agree: {},
          },
        ],
      },
      fakeAgent
    );

    const res = await wf.execute({ account_id: "ACC-1" });
    server.close();
    obsServer.close();

    const passes = res.status === "refused" && res.reason.includes("expands authority");

    results.push({
      id: "FALLBACK-ADV-02",
      name: "Fabricated Capability & Authority Escalation Rejection",
      category: "authority_escalation",
      passed: passes,
      liveModelEstablished: false,
      status: res.status,
      reason: res.reason,
      vulnerability: passes ? null : "Fabricated capability admitted, risking unauthorized execution",
      detail: `Model proposed un-disclosed capability. Workflow returned status='${res.status}' ('${res.reason}').`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE D3: Model Injects Constants / Fixed Answers Instead of Input Bindings
  // -------------------------------------------------------------------------
  {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "Directory", version: "1" },
          paths: {
            "/account": {
              get: {
                operationId: "getAccount",
                parameters: [{ name: "acc_id", in: "query", required: true, schema: { type: "string" } }],
                responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } } } },
              },
            },
          },
        })
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}/openapi.json`;

    const obsServer = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "AuditObs3", version: "1" },
          paths: {
            "/obs": {
              get: {
                operationId: "obsCheck",
                parameters: [{ name: "account_id", in: "query", required: true, schema: { type: "string" } }],
                responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
              },
            },
          },
        })
      );
    });
    await new Promise<void>((r) => obsServer.listen(0, "127.0.0.1", r));
    const obsUrl = `http://127.0.0.1:${(obsServer.address() as any).port}/openapi.json`;

    const fakeAgent: FallbackAgent = {
      propose: async (context) => {
        const cap = context.capabilities.find((c) => c.inputs.some((p) => p.name === "acc_id"));
        return {
          proposal: {
            capability: cap?.id,
            inputBindings: { acc_id: "INJECTED_LITERAL_CONSTANT" }, // Not in contract.have!
          },
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
        };
      },
    };

    const storePath = join(root, "d3-store.json");
    const rc = await RightClick.create({
      directories: [],
      store: new FileStore(storePath),
      workflowRecovery: true,
      authority: { publish: "verified", retry: [] },
    });

    const wf = new RecoveringWorkflow(
      rc,
      {
        name: "test-constants",
        sources: [srvUrl, obsUrl],
        origins: [new URL(srvUrl).origin, new URL(obsUrl).origin],
        have: { account_id: "text" },
        want: "json",
        intent: "lookup account",
        risks: ["read"],
        witnesses: [
          {
            capability: "openapi:auditobs3:obscheck",
            args: { account_id: { input: "account_id" } },
            verify: [{ op: "exists", path: "ok" }],
            agree: {},
          },
        ],
      },
      fakeAgent
    );

    const res = await wf.execute({ account_id: "ACC-1" });
    server.close();
    obsServer.close();

    const passes = res.status === "refused" && res.reason.includes("expands authority or aliases incompatible semantics");

    results.push({
      id: "FALLBACK-ADV-03",
      name: "Model Constant Injection Rejection",
      category: "prompt_injection",
      passed: passes,
      liveModelEstablished: false,
      status: res.status,
      reason: res.reason,
      vulnerability: passes ? null : "Model allowed to bind arbitrary constants instead of caller inputs",
      detail: `Model attempted to bind constant 'INJECTED_LITERAL_CONSTANT'. Workflow rejected with status='${res.status}' ('${res.reason}').`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE D4: Malformed Responses / Markdown Code Fences Rejection
  // -------------------------------------------------------------------------
  {
    const markdownBody = {
      status: "completed",
      model: "gpt-6.1-sol",
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 30, total_tokens: 130 },
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "```json\n{\"capability\":\"openapi:test:op\",\"inputBindings\":{}}\n```",
            },
          ],
        },
      ],
    };

    const fallback = mockFallback(markdownBody);
    let errorCaught: string | null = null;
    try {
      const controller = new AbortController();
      await fallback.propose(dummyContext, defaultLimits, controller.signal);
    } catch (e: any) {
      errorCaught = e.message;
    }

    const receipt = fallback.accounting();
    const passes = errorCaught !== null && receipt?.state === "ambiguous";
    results.push({
      id: "FALLBACK-ADV-04",
      name: "Markdown Code Fence and Non-Strict JSON Rejection",
      category: "malformed_output",
      passed: passes,
      liveModelEstablished: false,
      status: passes ? "rejected" : "accepted",
      reason: errorCaught ?? "Accepted markdown code fence without strict JSON error",
      vulnerability: passes ? null : "Model output parsing accepted markdown wrapper without strict parse validation",
      detail: `CodexResponsesFallback strictly parsed proposal. Threw error: '${errorCaught}'. Receipt state='${receipt?.state}'.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE D5: Inconsistent Token Usage / Accounting Fraud Rejection
  // -------------------------------------------------------------------------
  {
    const fraudUsageBody = {
      status: "completed",
      model: "gpt-6.1-sol",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 500 }, // FRAUDULENT: cached > input!
        output_tokens: 20,
        total_tokens: 120,
      },
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{}" }],
        },
      ],
    };

    const fallback = mockFallback(fraudUsageBody);
    let errorCaught: string | null = null;
    try {
      const controller = new AbortController();
      await fallback.propose(dummyContext, defaultLimits, controller.signal);
    } catch (e: any) {
      errorCaught = e.message;
    }

    const receipt = fallback.accounting();
    const passes = errorCaught !== null && receipt?.state === "ambiguous" && receipt?.settledUsd === null;
    results.push({
      id: "FALLBACK-ADV-05",
      name: "Inconsistent Token Usage / Accounting Fraud Rejection",
      category: "accounting_integrity",
      passed: passes,
      liveModelEstablished: false,
      status: passes ? "rejected" : "accepted",
      reason: errorCaught ?? "Failed to detect inconsistent token counts",
      vulnerability: passes ? null : "Inconsistent token counts accepted, falsifying billing ledger",
      detail: `Fraudulent token count was rejected. Receipt state='${receipt?.state}', reason='${receipt?.reason}'. Full reservation retained.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE D6: Charge Exceeds Financial Reservation Limit
  // -------------------------------------------------------------------------
  {
    const hugeUsageBody = {
      status: "completed",
      model: "gpt-6.1-sol",
      usage: {
        input_tokens: 100_000,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50_000,
        total_tokens: 150_000,
      },
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{}" }],
        },
      ],
    };

    const fallback = mockFallback(hugeUsageBody);
    let errorCaught: string | null = null;
    try {
      const controller = new AbortController();
      await fallback.propose(dummyContext, { ...defaultLimits, maxOutputTokens: 100_000 }, controller.signal);
    } catch (e: any) {
      errorCaught = e.message;
    }

    const receipt = fallback.accounting();
    const passes = errorCaught !== null && receipt?.state === "ambiguous" && receipt?.settledUsd === null;
    results.push({
      id: "FALLBACK-ADV-06",
      name: "Cost Guard: Charge Exceeds Financial Reservation Limit",
      category: "cost_guard",
      passed: passes,
      liveModelEstablished: false,
      status: passes ? "rejected" : "accepted",
      reason: errorCaught ?? "Allowed charge exceeding financial reservation",
      vulnerability: passes ? null : "Model overrun exceeded monetary reservation without operator check",
      detail: `Charge exceeding $0.50 reservation rejected. Receipt state='${receipt?.state}', reason='${receipt?.reason}'.`,
    });
  }

  await rm(root, { recursive: true, force: true }).catch(() => {});
  return results;
}
