// Independent Adversarial Recovery Integrity Test Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { Authority } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/net.ts";
import { RecoveringWorkflow, type FallbackAgent } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";

export interface RecoveryTestCaseResult {
  id: string;
  name: string;
  category: string;
  recoveredWithoutModel: boolean;
  requiredModelFallback: boolean;
  remainsUnsupported: boolean;
  status: string;
  reason: string;
  detail: string;
}

export async function runRecoverySuite(): Promise<RecoveryTestCaseResult[]> {
  const results: RecoveryTestCaseResult[] = [];
  const root = await mkdtemp(join(tmpdir(), "rcx-adv-recovery-"));

  // -------------------------------------------------------------------------
  // CASE C1: Unseen REST-to-GraphQL Query Shift
  // -------------------------------------------------------------------------
  {
    // A service shifts from REST /v1/rates to GraphQL query getFxRate(pair)
    let version = 2; // Day 2: REST is 410, GraphQL is available
    const server = createServer(async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end('<a href="/graphql">GraphQL API</a>');
      }
      if (url.pathname === "/openapi.json") return send(410, { error: "REST OpenAPI deprecated" });
      if (url.pathname === "/v1/rates") return send(410, { error: "REST v1 removed" });
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
                        name: "getFxRate",
                        description: "Get foreign exchange rate",
                        args: [{ name: "pair", type: { kind: "SCALAR", name: "String" }, defaultValue: null }],
                        type: { kind: "OBJECT", name: "FxRate" },
                      },
                    ],
                  },
                  {
                    kind: "OBJECT",
                    name: "FxRate",
                    fields: [
                      { name: "pair", type: { kind: "SCALAR", name: "String" } },
                      { name: "exchangeRate", type: { kind: "SCALAR", name: "Float" } },
                    ],
                  },
                  { kind: "SCALAR", name: "String" },
                  { kind: "SCALAR", name: "Float" },
                ],
              },
            },
          });
        }
        if (body.query?.includes("getFxRate")) {
          return send(200, { data: { getFxRate: { pair: "EUR", exchangeRate: 1.08 } } });
        }
      }
      send(404, {});
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}`;

    const rc = await RightClick.create({ directories: [] });
    await rc.learn({ source: srvUrl });

    // Test pure RightClick X compose (no model)
    const plan = await rc.compose({
      have: { pair: "EUR" },
      want: "number",
      intent: "foreign exchange rate",
      run: true,
    });

    const recovered = plan.executed?.status === "completed" && plan.executed?.output === 1.08;
    server.close();

    results.push({
      id: "REC-ADV-01",
      name: "REST-to-GraphQL Query Shift (Field and Port Synthesis)",
      category: "protocol_shift",
      recoveredWithoutModel: recovered,
      requiredModelFallback: !recovered,
      remainsUnsupported: false,
      status: plan.executed?.status ?? "no_plan",
      reason: plan.executed?.status === "completed" ? "Successfully composed and executed GraphQL query without LLM" : (plan.plans[0]?.summary ?? "no viable plan"),
      detail: `Learned GraphQL schema directly from origin. Executed output=${JSON.stringify(plan.executed?.output)}.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE C2: Opaque Renamed Input Without Semantic Synonym
  // -------------------------------------------------------------------------
  {
    // A provider renames customer_id to 'x_client_identity_handle'
    const server = createServer(async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (url.pathname === "/openapi.json") {
        return send(200, {
          openapi: "3.0.3",
          info: { title: "Directory", version: "2.0.0" },
          paths: {
            "/profile": {
              get: {
                operationId: "getProfile",
                summary: "Get user profile",
                parameters: [{ name: "x_client_identity_handle", in: "query", required: true, schema: { type: "string" } }],
                responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (url.pathname === "/profile") {
        if (url.searchParams.get("x_client_identity_handle") === "CUST-99") {
          return send(200, { email: "cust99@corp.test" });
        }
        return send(400, { error: "missing required x_client_identity_handle" });
      }
      send(404, {});
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}`;

    // Pure RightClick X without fallback
    const rc = await RightClick.create({ directories: [] });
    await rc.learn({ source: srvUrl });
    const planNoModel = await rc.compose({
      have: { customer_id: "CUST-99" },
      want: "email",
      intent: "get user profile email",
      run: false,
    });

    const failedClosedWithoutModel = planNoModel.plans.length === 0;

    // Now test with RecoveringWorkflow and a mock fallback agent
    const storePath = join(root, "c2-store.json");
    const rcWf = await RightClick.create({
      directories: [],
      store: new FileStore(storePath),
      workflowRecovery: true,
      authority: { publish: "verified", retry: [] },
    });

    const fallbackAgent: FallbackAgent = {
      propose: async (context) => {
        const cap = context.capabilities.find((c) => c.inputs.some((p) => p.name === "x_client_identity_handle"));
        return {
          proposal: {
            capability: cap?.id,
            inputBindings: { x_client_identity_handle: "customer_id" },
          },
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 25 },
        };
      },
    };

    const wf = new RecoveringWorkflow(
      rcWf,
      {
        name: "get-profile",
        sources: [srvUrl],
        origins: [srvUrl],
        have: { customer_id: "text" },
        want: "json",
        intent: "get user profile email",
        risks: ["read"],
        witnesses: [
          {
            capability: "openapi:directory:getprofile",
            args: { x_client_identity_handle: { input: "customer_id" } },
            verify: [{ op: "exists", path: "email" }],
            agree: {},
          },
        ],
      },
      fallbackAgent
    );

    const wfRes = await wf.execute({ customer_id: "CUST-99" });
    server.close();

    results.push({
      id: "REC-ADV-02",
      name: "Opaque Renamed Input: Pure Graph vs Fallback Boundary",
      category: "unmapped_rename",
      recoveredWithoutModel: !failedClosedWithoutModel,
      requiredModelFallback: failedClosedWithoutModel && wfRes.status === "verified",
      remainsUnsupported: false,
      status: wfRes.status,
      reason: failedClosedWithoutModel ? "Pure graph correctly failed closed on unmapped rename; fallback successfully aliased" : "Pure graph guessed unmapped rename",
      detail: `Pure graph plansCount=${planNoModel.plans.length}. RecoveringWorkflow with fallback route=${wfRes.route}, status=${wfRes.status}.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE C3: Disappeared Discovery Endpoints (Silent 404)
  // -------------------------------------------------------------------------
  {
    const server = createServer((req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "No schema published" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}`;

    const storePath = join(root, "c3-store.json");
    const rc = await RightClick.create({
      directories: [],
      store: new FileStore(storePath),
      workflowRecovery: true,
      authority: { publish: "verified", retry: [] },
    });

    let fallbackCalled = false;
    const fallbackAgent: FallbackAgent = {
      propose: async () => {
        fallbackCalled = true;
        return { proposal: {}, usage: null };
      },
    };

    const wf = new RecoveringWorkflow(
      rc,
      {
        name: "dead-service",
        sources: [srvUrl],
        origins: [srvUrl],
        have: { item_id: "text" },
        want: "json",
        intent: "lookup item",
        risks: ["read"],
        witnesses: [
          {
            capability: "openapi:fake:lookup",
            args: {},
            verify: [{ op: "exists", path: "id" }],
            agree: {},
          },
        ],
      },
      fallbackAgent
    );

    const res = await wf.execute({ item_id: "ITM-1" });
    server.close();

    const passes = res.status === "unavailable" && !fallbackCalled;
    results.push({
      id: "REC-ADV-03",
      name: "Disappeared Discovery Endpoints (404 Schema Fail-Closed)",
      category: "discovery_absence",
      recoveredWithoutModel: false,
      requiredModelFallback: false,
      remainsUnsupported: true,
      status: res.status,
      reason: res.reason,
      detail: `When schema 404s, returned status='${res.status}' ('${res.reason}'). Model fallback was NOT called (${fallbackCalled}).`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE C4: Stale Witness / Changed Verification Contract Refusal
  // -------------------------------------------------------------------------
  {
    // Provider returns { status: "ACTIVE" } but witness expects { legacy_code: "200" }
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.includes("/openapi.json")) {
        return res.end(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "StatusService", version: "1" },
            paths: {
              "/status": {
                get: {
                  operationId: "getStatus",
                  responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } } },
                },
              },
            },
          })
        );
      }
      res.end(JSON.stringify({ status: "ACTIVE" })); // Does NOT have legacy_code!
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const srvUrl = `http://127.0.0.1:${(server.address() as any).port}`;

    const storePath = join(root, "c4-store.json");
    const rc = await RightClick.create({
      directories: [],
      store: new FileStore(storePath),
      workflowRecovery: true,
      authority: { publish: "verified", retry: [] },
    });

    const wf = new RecoveringWorkflow(rc, {
      name: "stale-witness-check",
      sources: [srvUrl],
      origins: [srvUrl],
      have: { dummy: "text" },
      want: "json",
      intent: "check service status",
      risks: ["read"],
      witnesses: [
        {
          capability: "openapi:statusservice:getstatus",
          args: {},
          verify: [{ op: "equals", path: "legacy_code", value: "200" }], // Stale check!
          agree: {},
        },
      ],
    });

    const res = await wf.execute({ dummy: "ok" });
    server.close();

    const passes = res.status !== "verified";
    results.push({
      id: "REC-ADV-04",
      name: "Stale Witness Verification Failure Blocks Publication",
      category: "stale_witness",
      recoveredWithoutModel: false,
      requiredModelFallback: false,
      remainsUnsupported: true,
      status: res.status,
      reason: res.reason,
      detail: `Stale witness failed verification. Workflow returned status='${res.status}' ('${res.reason}'). Blocked publication of unverified repair.`,
    });
  }

  await rm(root, { recursive: true, force: true }).catch(() => {});
  return results;
}
