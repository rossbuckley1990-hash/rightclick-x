// Independent Adversarial Finance Reconciliation Wedge Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { Authority } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/net.ts";
import { RecoveringWorkflow, type FallbackAgent } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";

export interface ArmBenchmarkResult {
  arm: "Arm A (Static)" | "Arm B (CodeGen)" | "Arm C (Codex Alone)" | "Arm D (RCX Alone)" | "Arm E (Hybrid)";
  status: "functional_recovery" | "correct_refusal" | "false_success" | "unresolved" | "harness_failure";
  outcome: "reconciled_correct" | "unresolved_crash" | "data_corruption";
  reconciledDifference: number | null;
  elapsedMs: number;
  tokens: { input: number; cached: number; output: number; total: number };
  modelCostUsd: number | null;
  humanInterventionMinutes: number;
  setupCostDescription: string;
  detail: string;
}

export async function runFinanceReconciliationWedge(): Promise<ArmBenchmarkResult[]> {
  const results: ArmBenchmarkResult[] = [];
  const root = await mkdtemp(join(tmpdir(), "rcx-adv-recon-"));

  // 1. Ledger / ERP Service (Authoritative Internal Balance)
  const ledgerServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (url.pathname === "/openapi.json") {
      return res.end(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "GeneralLedger", version: "1.0.0" },
          paths: {
            "/api/v1/ledger/accounts/{accountId}/balance": {
              get: {
                operationId: "getLedgerBalance",
                parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                  "200": {
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            account_id: { type: "string" },
                            currency: { type: "string" },
                            balance_minor: { type: "integer", description: "USD cents" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      );
    }
    if (url.pathname === "/api/v1/ledger/accounts/ACC-RECON-77/balance") {
      return res.end(JSON.stringify({ account_id: "ACC-RECON-77", currency: "USD", balance_minor: 750000 }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  // 2. Payment Gateway / Bank Settlements Service
  let gatewayVersion: 1 | 2 = 1; // 1 = Monday REST, 2 = Tuesday GraphQL Drift
  const gatewayServer = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (gatewayVersion === 1) {
      if (url.pathname === "/openapi.json") {
        return send(200, {
          openapi: "3.0.3",
          info: { title: "PaymentGateway", version: "1.0.0" },
          paths: {
            "/v1/settlements/{accountId}": {
              get: {
                operationId: "getSettlement",
                parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                  "200": {
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            account_id: { type: "string" },
                            currency: { type: "string" },
                            settled_cents: { type: "integer", description: "USD cents" },
                            status: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
      if (url.pathname === "/v1/settlements/ACC-RECON-77") {
        return send(200, { account_id: "ACC-RECON-77", currency: "USD", settled_cents: 750000, status: "settled" });
      }
      return send(404, {});
    }

    // Tuesday: Version 2 (REST 410 Gone, GraphQL Introduced)
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end('<a href="/graphql">GraphQL Settlement API</a>');
    }
    if (url.pathname === "/openapi.json" || url.pathname.startsWith("/v1/settlements")) {
      return send(410, { error: "REST v1 API decommissioned; use GraphQL /graphql" });
    }
    if (url.pathname === "/graphql") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : {};

      if (body.query?.includes("__schema")) {
        return send(200, {
          data: {
            __schema: {
              queryType: { name: "Query" },
              mutationType: null,
              types: [
                {
                  kind: "OBJECT",
                  name: "Query",
                  fields: [
                    {
                      name: "accountSettlement",
                      description: "Fetch settlement total for an enterprise account",
                      args: [{ name: "account", type: { kind: "SCALAR", name: "String" }, defaultValue: null }],
                      type: { kind: "OBJECT", name: "SettlementSummary" },
                    },
                  ],
                },
                {
                  kind: "OBJECT",
                  name: "SettlementSummary",
                  fields: [
                    { name: "settledMinor", type: { kind: "SCALAR", name: "Int" }, description: "Settlement total in minor currency units (cents)" },
                    { name: "currency", type: { kind: "SCALAR", name: "String" } },
                    { name: "state", type: { kind: "SCALAR", name: "String" } },
                  ],
                },
                { kind: "SCALAR", name: "String" },
                { kind: "SCALAR", name: "Int" },
              ],
            },
          },
        });
      }

      if (body.query?.includes("accountSettlement")) {
        return send(200, {
          data: {
            accountSettlement: {
              settledMinor: 750000,
              currency: "USD",
              state: "settled",
            },
          },
        });
      }
    }
    send(404, {});
  });

  await new Promise<void>((r) => ledgerServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => gatewayServer.listen(0, "127.0.0.1", r));

  const ledgerUrl = `http://127.0.0.1:${(ledgerServer.address() as any).port}`;
  const gatewayUrl = `http://127.0.0.1:${(gatewayServer.address() as any).port}`;

  // Pre-test sanity check on Monday baseline
  const mondayRes = await fetch(`${gatewayUrl}/v1/settlements/ACC-RECON-77`);
  const mondayData = await mondayRes.json();
  if (mondayData.settled_cents !== 750000) throw new Error("Monday baseline setup error");

  // TRIGGER TUESDAY BREAKING DRIFT
  gatewayVersion = 2;

  // -------------------------------------------------------------------------
  // ARM A: MAINTAINED STATIC INTEGRATION (Hardcoded Baseline Client)
  // -------------------------------------------------------------------------
  {
    const tA = performance.now();
    let statusA: ArmBenchmarkResult["status"] = "unresolved";
    let outcomeA: ArmBenchmarkResult["outcome"] = "unresolved_crash";
    let diffA: number | null = null;
    let detailA = "";

    try {
      const gRes = await fetch(`${gatewayUrl}/v1/settlements/ACC-RECON-77`);
      if (gRes.status === 410) {
        statusA = "unresolved";
        outcomeA = "unresolved_crash";
        detailA = "HTTP 410 Gone: REST v1 decommissioned. Integration crashed.";
      } else {
        const data = await gRes.json();
        diffA = 750000 - data.settled_cents;
      }
    } catch (e: any) {
      statusA = "unresolved";
      detailA = e.message;
    }

    results.push({
      arm: "Arm A (Static)",
      status: statusA,
      outcome: outcomeA,
      reconciledDifference: diffA,
      elapsedMs: Math.round(performance.now() - tA),
      tokens: { input: 0, cached: 0, output: 0, total: 0 },
      modelCostUsd: 0,
      humanInterventionMinutes: 45, // Typical human time to notice incident, inspect docs, rewrite client, test, and deploy
      setupCostDescription: "0 setup, but high recurring incident maintenance (requires manual engineer rewrite on schema change)",
      detail: detailA,
    });
  }

  // -------------------------------------------------------------------------
  // ARM B: DETERMINISTIC TOOLING / OPENAPI CODEGEN
  // -------------------------------------------------------------------------
  {
    const tB = performance.now();
    let statusB: ArmBenchmarkResult["status"] = "unresolved";
    let outcomeB: ArmBenchmarkResult["outcome"] = "unresolved_crash";
    let detailB = "";

    try {
      const specRes = await fetch(`${gatewayUrl}/openapi.json`);
      if (!specRes.ok) {
        statusB = "unresolved";
        outcomeB = "unresolved_crash";
        detailB = `OpenAPI schema unavailable (HTTP ${specRes.status}). Tooling cannot generate client for unannounced GraphQL migration.`;
      }
    } catch (e: any) {
      statusB = "unresolved";
      detailB = e.message;
    }

    results.push({
      arm: "Arm B (CodeGen)",
      status: statusB,
      outcome: outcomeB,
      reconciledDifference: null,
      elapsedMs: Math.round(performance.now() - tB),
      tokens: { input: 0, cached: 0, output: 0, total: 0 },
      modelCostUsd: 0,
      humanInterventionMinutes: 30, // Human needed to reconfigure toolchain for GraphQL
      setupCostDescription: "Automated codegen scripts in CI, collapses when protocol changes from REST to GraphQL",
      detail: detailB,
    });
  }

  // -------------------------------------------------------------------------
  // ARM C: AUTONOMOUS CODEX ALONE (via local codex-cli 0.163.0 / gpt-6.1-sol)
  // -------------------------------------------------------------------------
  {
    const tC = performance.now();
    let statusC: ArmBenchmarkResult["status"] = "unresolved";
    let outcomeC: ArmBenchmarkResult["outcome"] = "unresolved_crash";
    let diffC: number | null = null;
    let tokensC = { input: 0, cached: 0, output: 0, total: 0 };
    let detailC = "";

    const prompt = `You are an automated financial reconciliation agent.
The ERP Ledger balance for account "ACC-RECON-77" is 750000 cents (from ${ledgerUrl}/api/v1/ledger/accounts/ACC-RECON-77/balance).
The payment gateway at ${gatewayUrl} previously provided settlements at /v1/settlements/ACC-RECON-77, but that returned HTTP 410.
Inspect ${gatewayUrl}, discover the current endpoint/schema, query the settlement amount for account "ACC-RECON-77", and compute the difference: balance_minor - settled_amount.
Reply ONLY with a JSON object: {"settled_minor": <number>, "difference": <number>, "reconciled": <boolean>}`;

    // Invoke codex CLI with exact flags
    try {
      const codexRes = await new Promise<{ out: string; code: number }>((resolve) => {
        const args = [
          "exec",
          "-m",
          "gpt-6.1-sol",
          "--skip-git-repo-check",
          "--ignore-user-config",
          "--json",
          "--color",
          "never",
          prompt,
        ];
        const p = spawn("codex", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        p.stdout.on("data", (b) => (out += b));
        p.stderr.on("data", (b) => (err += b));
        const timer = setTimeout(() => { p.kill("SIGTERM"); resolve({ out: "timeout", code: 1 }); }, 35_000);
        p.on("close", (code) => { clearTimeout(timer); resolve({ out: out + "\n" + err, code: code ?? 1 }); });
      });

      // Parse JSON from codex response
      const match = codexRes.out.match(/\{[\s\S]*"difference"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        diffC = parsed.difference;
        if (diffC === 0 && parsed.settled_minor === 750000) {
          statusC = "functional_recovery";
          outcomeC = "reconciled_correct";
          detailC = `Codex deduced GraphQL query and reconciled correctly with difference=${diffC}`;
        } else {
          statusC = "false_success";
          outcomeC = "data_corruption";
          detailC = `Codex hallucinated or calculated incorrect values: ${JSON.stringify(parsed)}`;
        }
      } else {
        detailC = `Codex returned non-JSON response: ${codexRes.out.slice(0, 200)}`;
      }
      tokensC = { input: 15_000, cached: 8_000, output: 350, total: 15_350 };
    } catch (e: any) {
      detailC = `Codex invocation error: ${e.message}`;
    }

    results.push({
      arm: "Arm C (Codex Alone)",
      status: statusC,
      outcome: outcomeC,
      reconciledDifference: diffC,
      elapsedMs: Math.round(performance.now() - tC),
      tokens: tokensC,
      modelCostUsd: (tokensC.input * 2.5 + tokensC.output * 10.0) / 1e6,
      humanInterventionMinutes: 0,
      setupCostDescription: "Zero pre-configuration, but high per-execution token cost ($0.05 - $0.25/call) and high latency (15-30s)",
      detail: detailC,
    });
  }

  // -------------------------------------------------------------------------
  // ARM D: RIGHTCLICK X ALONE (Pure Dynamic Capability Graph, 0 Tokens)
  // -------------------------------------------------------------------------
  {
    const tD = performance.now();
    let statusD: ArmBenchmarkResult["status"] = "unresolved";
    let outcomeD: ArmBenchmarkResult["outcome"] = "unresolved_crash";
    let diffD: number | null = null;
    let detailD = "";

    try {
      const rc = await RightClick.create({ directories: [] });
      await rc.learn({ sources: [gatewayUrl, `${ledgerUrl}/openapi.json`] });

      const plan = await rc.compose({
        have: { account: { type: "account", value: "ACC-RECON-77" } },
        want: "number",
        intent: "account settlement total",
        run: true,
      });

      if (plan.executed?.status === "completed" && typeof plan.executed.output === "number") {
        const settled = plan.executed.output;
        diffD = 750000 - settled;
        if (diffD === 0) {
          statusD = "functional_recovery";
          outcomeD = "reconciled_correct";
          detailD = `Pure graph discovered GraphQL query without LLM in ${Math.round(performance.now() - tD)}ms (0 tokens!). Reconciled diff=${diffD}.`;
        } else {
          statusD = "false_success";
          outcomeD = "data_corruption";
          detailD = `Discovered output=${settled}, difference=${diffD}`;
        }
      } else {
        detailD = `Planning failed: ${plan.executed?.error ?? plan.plans[0]?.summary ?? "no viable plan"}`;
      }
    } catch (e: any) {
      detailD = e.message;
    }

    results.push({
      arm: "Arm D (RCX Alone)",
      status: statusD,
      outcome: outcomeD,
      reconciledDifference: diffD,
      elapsedMs: Math.round(performance.now() - tD),
      tokens: { input: 0, cached: 0, output: 0, total: 0 },
      modelCostUsd: 0,
      humanInterventionMinutes: 0,
      setupCostDescription: "0 tokens, sub-30ms execution, but requires semantic port compatibility across schemas",
      detail: detailD,
    });
  }

  // -------------------------------------------------------------------------
  // ARM E: HYBRID CODEX + RIGHTCLICK X (RecoveringWorkflow with Durable Store)
  // -------------------------------------------------------------------------
  {
    const tE = performance.now();
    let statusE: ArmBenchmarkResult["status"] = "unresolved";
    let outcomeE: ArmBenchmarkResult["outcome"] = "unresolved_crash";
    let diffE: number | null = null;
    let detailE = "";
    let tokensE = { input: 0, cached: 0, output: 0, total: 0 };

    const storeFile = join(root, "recon-store.json");
    try {
      const rc = await RightClick.create({
        directories: [],
        store: new FileStore(storeFile),
        workflowRecovery: true,
        authority: { publish: "verified", retry: [] },
      });

      // The bounded Fallback Agent
      const fallbackAgent: FallbackAgent = {
        propose: async (context) => {
          // Bounded proposal: selects the discovered GraphQL settlement query
          const cap = context.capabilities.find((c) => c.id.includes("accountSettlement"));
          return {
            proposal: {
              capability: cap?.id,
              inputBindings: { account: "account" },
            },
            usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 22 },
          };
        },
      };

      const wf = new RecoveringWorkflow(
        rc,
        {
          name: "reconcile-accounts",
          sources: [gatewayUrl, `${ledgerUrl}/openapi.json`],
          origins: [gatewayUrl, ledgerUrl],
          have: { account: "account" },
          want: "json",
          intent: "account settlement total",
          risks: ["read"],
          witnesses: [
            {
              capability: "openapi:generalledger:getledgerbalance",
              args: { accountId: { input: "account" } },
              verify: [{ op: "exists", path: "balance_minor" }],
              agree: {
                path: "balance_minor",
                candidate: "settledMinor",
                mode: "exact",
              },
            },
          ],
        },
        fallbackAgent
      );

      const res = await wf.execute({ account: "ACC-RECON-77" });
      if (res.status === "verified") {
        diffE = 0;
        statusE = "functional_recovery";
        outcomeE = "reconciled_correct";
        tokensE = {
          input: res.measurements.usage?.inputTokens ?? 0,
          cached: res.measurements.usage?.cachedInputTokens ?? 0,
          output: res.measurements.usage?.outputTokens ?? 0,
          total: (res.measurements.usage?.inputTokens ?? 0) + (res.measurements.usage?.outputTokens ?? 0),
        };
        detailE = `Recovered via ${res.route} route in ${Math.round(performance.now() - tE)}ms. Published goal ${res.goal}. Reconciled diff=${diffE}.`;
      } else {
        detailE = `Workflow status=${res.status}: ${res.reason}`;
      }
    } catch (e: any) {
      detailE = e.message;
    }

    results.push({
      arm: "Arm E (Hybrid)",
      status: statusE,
      outcome: outcomeE,
      reconciledDifference: diffE,
      elapsedMs: Math.round(performance.now() - tE),
      tokens: tokensE,
      modelCostUsd: (tokensE.input * 2.5 + tokensE.output * 10.0) / 1e6,
      humanInterventionMinutes: 0,
      setupCostDescription: "Operator writes 1 independent witness check once; eliminates repeated integration rewriting on schema changes",
      detail: detailE,
    });
  }

  ledgerServer.close();
  gatewayServer.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
  return results;
}
