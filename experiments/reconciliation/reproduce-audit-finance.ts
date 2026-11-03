// DERIVED diagnostic: original finance fixture and Arm D only. Original suites are unchanged in docs/reconciliation/external-audit.
// Independent Adversarial Finance Reconciliation Wedge Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { RightClick } = await import(process.env.RCX_TARGET + "/src/runtime.ts");

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

export async function runFinanceReconciliationWedge(): Promise<unknown> {
  const results: ArmBenchmarkResult[] = [];
  let executionTrace: unknown;
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

      executionTrace = plan;
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

  ledgerServer.closeAllConnections(); gatewayServer.closeAllConnections();
  ledgerServer.close(); gatewayServer.close();
  await rm(root, {recursive:true,force:true});
  return {results,executionTrace};
}
console.log(JSON.stringify(await runFinanceReconciliationWedge(),null,2));
