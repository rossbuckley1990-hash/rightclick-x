// Multi-Service Polyglot Environment for the 50-Scenario Workflow Survival Benchmark
// Supports Billing, Freight, Directory, FX, CRM, and Inventory services
// Covering REST (v1, v2, v3), GraphQL, MCP Tools/Resources, SSE, and Fault Injection.

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

// ---------------------------------------------------------------------------
// 1. BILLING SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createBillingService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outages
    if (v === 5) return json({ error: "Billing service retired permanently" }, 410);
    if (v === 51) {
      // Simulate socket stall / hang
      await new Promise((r) => setTimeout(r, 6000));
      return json({ error: "timeout" }, 504);
    }
    if (v === 52) return json({ error: "Database replica offline" }, 500);

    // OpenAPI Spec
    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service", version: "1.0.0" },
          paths: {
            "/v1/invoices/total": {
              post: {
                operationId: "calculateTotal",
                summary: "Calculate invoice total in cents",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["invoice_id", "items"],
                        properties: {
                          invoice_id: { type: "string" },
                          items: {
                            type: "array",
                            items: {
                              type: "object",
                              required: ["price_cents", "quantity"],
                              properties: { price_cents: { type: "integer" }, quantity: { type: "integer" } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { total_cents: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service", version: "2.0.0" },
          paths: {
            "/v2/compute": {
              post: {
                operationId: "computeInvoiceTotal",
                summary: "Compute invoice total amount in cents",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["invoiceId", "lineItems"],
                        properties: {
                          invoiceId: { type: "string" },
                          lineItems: {
                            type: "array",
                            items: {
                              type: "object",
                              required: ["unitPriceCents", "count"],
                              properties: { unitPriceCents: { type: "integer" }, count: { type: "integer" } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            result: {
                              type: "object",
                              properties: { finalAmountCents: { type: "integer" } },
                            },
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
      if (v === 21) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service (API Key Enforced)", version: "2.1.0" },
          paths: {
            "/v2/compute": {
              post: {
                operationId: "computeWithKey",
                summary: "Compute invoice with X-API-Key",
                parameters: [{ name: "X-API-Key", in: "header", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { total: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 22) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service (Polymorphic)", version: "2.2.0" },
          paths: {
            "/v2/pay": {
              post: {
                operationId: "payInvoice",
                summary: "Pay invoice with polymorphic method",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { invoiceId: { type: "string" }, paymentMethod: { type: "object" } } } } } },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { authStatus: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 23) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service (Problem Details)", version: "2.3.0" },
          paths: {
            "/v2/invoices": {
              post: {
                operationId: "createInvoice",
                summary: "Create invoice",
                responses: { "422": { description: "Unprocessable", content: { "application/problem+json": { schema: { type: "object", properties: { title: { type: "string" }, status: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service", version: "4.0.0" },
          paths: {
            "/v1/invoices/total": {
              post: {
                operationId: "calculateTotalDollars",
                summary: "Calculate invoice total in decimal dollars",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { total_dollars: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 41) {
        return json({
          openapi: "3.0.3",
          info: { title: "Billing Service (Gross Tax)", version: "4.1.0" },
          paths: {
            "/v1/invoices/gross": {
              post: {
                operationId: "calculateGross",
                summary: "Calculate gross amount with embedded tax",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { gross_total: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // Endpoints
    if (v === 1 && u.pathname === "/v1/invoices/total") {
      const sum = (body.items ?? []).reduce((acc: number, item: any) => acc + (item.price_cents * item.quantity), 0);
      return json({ total_cents: sum });
    }
    if (v === 2 && u.pathname === "/v2/compute") {
      const sum = (body.lineItems ?? []).reduce((acc: number, item: any) => acc + (item.unitPriceCents * item.count), 0);
      return json({ result: { finalAmountCents: sum } });
    }
    if (v === 21 && u.pathname === "/v2/compute") {
      const sum = (body.lineItems ?? []).reduce((acc: number, item: any) => acc + (item.unitPriceCents * item.count), 0);
      return json({ total: sum || 1000 });
    }
    if (v === 22 && u.pathname === "/v2/pay") {
      return json({ authStatus: `AUTH_SUCCESS_${body.invoiceId || "INV-POLY"}` });
    }
    if (v === 23 && u.pathname === "/v2/invoices") {
      return json({ type: "https://api.test/errors/validation", title: "Validation Error", status: 422, detail: "Missing line items" }, 422, { "content-type": "application/problem+json" });
    }
    if (v === 4 && u.pathname === "/v1/invoices/total") {
      return json({ total_dollars: 12.50 });
    }
    if (v === 41 && u.pathname === "/v1/invoices/gross") {
      return json({ gross_total: 108.25 });
    }

    // GraphQL endpoint (PROTO-01, PROTO-13)
    if ((v === 3 || v === 33) && u.pathname === "/graphql") {
      if (String(body.query).includes("__schema")) {
        return json({
          data: {
            __schema: {
              queryType: { name: "Query" },
              types: [
                {
                  name: "Query",
                  kind: "OBJECT",
                  fields: [
                    {
                      name: "computeInvoice",
                      args: [
                        { name: "invoiceId", type: { kind: "SCALAR", name: "String" } },
                        { name: "subtotal", type: { kind: "SCALAR", name: "Int" } },
                      ],
                      type: { kind: "SCALAR", name: "Int" },
                    },
                    {
                      name: "billingSummary",
                      args: [
                        { name: "invoiceId", type: { kind: "SCALAR", name: "String" } },
                        { name: "amount", type: { kind: "SCALAR", name: "Int" } },
                      ],
                      type: { kind: "OBJECT", name: "SummaryOutput" },
                    },
                  ],
                },
                {
                  name: "SummaryOutput",
                  kind: "OBJECT",
                  fields: [{ name: "calculatedAmount", type: { kind: "SCALAR", name: "Int" } }],
                },
              ],
            },
          },
        });
      }
      if (String(body.query).includes("computeInvoice")) {
        const subtotal = body.variables?.subtotal ?? 7800;
        return json({ data: { computeInvoice: subtotal } });
      }
      if (String(body.query).includes("billingSummary")) {
        const amount = body.variables?.amount ?? 4200;
        return json({ data: { billingSummary: { calculatedAmount: amount } } });
      }
    }

    // Async Job Simulation (PROTO-09)
    if (v === 32) {
      if (u.pathname === "/v1/pdf/generate") {
        return json({ status: "processing", jobId: "JOB-99" }, 202, { Location: "/v1/pdf/jobs/JOB-99" });
      }
      if (u.pathname === "/v1/pdf/jobs/JOB-99") {
        return json({ status: "completed", result: "PDF_RENDERED_INV-ASYNC-PDF" });
      }
    }

    // WebSocket / Realtime simulation (PROTO-06)
    if (v === 31 && u.pathname === "/ws-quote") {
      return json({ bidResult: "BID_ACCEPTED_5000" });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 2. FREIGHT SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createFreightService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outages
    if (v === 5) return json({ error: "Freight backend unavailable" }, 503);
    if (v === 10) return json({ error: "Catalog empty" }, 404);

    // OpenAPI Spec
    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API", version: "1.0.0" },
          paths: {
            "/v1/quote": {
              get: {
                operationId: "getFreightQuote",
                summary: "Calculate shipping rate in USD",
                parameters: [{ name: "weight_kg", in: "query", required: true, schema: { type: "number" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { cost_usd: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API", version: "2.0.0" },
          paths: {
            "/v2/rates": {
              post: {
                operationId: "calculateRates",
                summary: "Compute shipping quote from JSON body",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["massKg"],
                        properties: { fromZip: { type: "string" }, toZip: { type: "string" }, massKg: { type: "number" } },
                      },
                    },
                  },
                },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { quote: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API (lbs)", version: "4.0.0" },
          paths: {
            "/v1/quote": {
              get: {
                operationId: "getQuoteLbs",
                summary: "Calculate shipping rate in USD per pound",
                parameters: [{ name: "weight_lbs", in: "query", required: true, schema: { type: "number" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { cost_usd: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 6) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API (JSON)", version: "6.0.0" },
          paths: {
            "/v6/rates": {
              post: {
                operationId: "getJsonRates",
                summary: "Compute shipping quote",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { totalCost: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 7) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API (Feet)", version: "7.0.0" },
          paths: {
            "/v1/distance": {
              get: {
                operationId: "getDistance",
                summary: "Calculate route distance in feet",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { distance_ft: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 8) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API (Volume)", version: "8.0.0" },
          paths: {
            "/v1/volume": {
              get: {
                operationId: "getVolume",
                summary: "Calculate volume",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { volume_gal: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 9) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight API (Speed)", version: "9.0.0" },
          paths: {
            "/v1/speed": {
              get: {
                operationId: "getSpeed",
                summary: "Calculate speed in mph",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { speed_mph: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // Endpoints
    if (v === 1 && u.pathname === "/v1/quote") {
      const kg = Number(u.searchParams.get("weight_kg") ?? 10);
      return json({ cost_usd: kg * 5.5 });
    }
    if (v === 2 && u.pathname === "/v2/rates") {
      const kg = Number(body.massKg ?? 10);
      return json({ quote: kg * 5.5 });
    }
    if (v === 4 && u.pathname === "/v1/quote") {
      return json({ cost_usd: 25.0 }); // 10 * 2.5 per lb
    }
    if (v === 6 && u.pathname === "/v6/rates") {
      const kg = Number(body.massKg ?? 15);
      return json({ totalCost: kg * 5.5 });
    }
    if (v === 7 && u.pathname === "/v1/distance") {
      return json({ distance_ft: 328.08 });
    }
    if (v === 8 && u.pathname === "/v1/volume") {
      return json({ volume_gal: 13.2 });
    }
    if (v === 9 && u.pathname === "/v1/speed") {
      return json({ speed_mph: 62.14 });
    }

    // MCP protocol (PROTO-02)
    if (v === 3 && u.pathname === "/mcp") {
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "FreightMCP", version: "1.0" } } });
      if (body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{
              name: "quote_freight_shipping",
              title: "Freight Shipping Quote",
              description: "Calculate standard freight shipping cost in USD given weight in kg",
              inputSchema: { type: "object", properties: { weight_kg: { type: "number" } }, required: ["weight_kg"] },
              outputSchema: { type: "object", properties: { shipping_usd: { type: "number" } } },
              annotations: { readOnlyHint: true },
            }],
          },
        });
      }
      if (body.method === "tools/call") {
        const kg = Number(body.params.arguments?.weight_kg ?? 20);
        return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { shipping_usd: kg * 5.5 } } });
      }
    }

    // SSE Event Stream (PROTO-05)
    if (v === 5 && u.pathname.startsWith("/v3/events/")) {
      return new Response("data: {\"status\": \"DELIVERED\"}\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 3. DIRECTORY SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createDirectoryService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outages
    if (v === 7) return json({ error: "Unauthorized" }, 401);

    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "Directory Service", version: "1.0.0" },
          paths: {
            "/v1/users/{id}": {
              get: {
                operationId: "getUserById",
                summary: "Get user email by ID",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, email: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "Directory Service", version: "2.0.0" },
          paths: {
            "/v2/accounts/{id}": {
              get: {
                operationId: "getAccountById",
                summary: "Get account profile with nested email",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: { account: { type: "object", properties: { userEmail: { type: "string" } } } },
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
      if (v === 3) {
        return json({
          openapi: "3.0.3",
          info: { title: "Directory Service (Split IDs)", version: "3.0.0" },
          paths: {
            "/v3/orgs/{orgId}/users/{userId}": {
              get: {
                operationId: "getOrgUser",
                parameters: [
                  { name: "orgId", in: "path", required: true, schema: { type: "string" } },
                  { name: "userId", in: "path", required: true, schema: { type: "string" } },
                ],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { fullEmail: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "Directory Service (Nested Address)", version: "4.0.0" },
          paths: {
            "/v4/validate-address": {
              post: {
                operationId: "validateAddress",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { verificationStatus: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 6) {
        return json({
          openapi: "3.0.3",
          info: { title: "Directory Service (Storage Quota)", version: "6.0.0" },
          paths: {
            "/v6/quota/{accountId}": {
              get: {
                operationId: "getQuota",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { quota_mib: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (v === 1) {
      const m = u.pathname.match(/^\/v1\/users\/([^/]+)$/);
      if (m) return json({ id: m[1], email: `${m[1]}@enterprise.test` });
    }
    if (v === 2) {
      const m = u.pathname.match(/^\/v2\/accounts\/([^/]+)$/);
      if (m) return json({ account: { userEmail: `${m[1]}@enterprise.test` } });
    }
    if (v === 3) {
      const m = u.pathname.match(/^\/v3\/orgs\/([^/]+)\/users\/([^/]+)$/);
      if (m) return json({ fullEmail: `${m[2]}@${m[1]}.enterprise.test` });
    }
    if (v === 4 && u.pathname === "/v4/validate-address") {
      const addr = body.address ?? {};
      return json({ verificationStatus: `VERIFIED_${String(addr.city ?? "").toUpperCase()}_${addr.zip ?? ""}` });
    }
    if (v === 5) {
      // HATEOAS entrypoint
      if (u.pathname === "/v5/entrypoint") {
        return json({ _links: { account: { href: "/v2/accounts/carol" } } });
      }
    }
    if (v === 6 && u.pathname.startsWith("/v6/quota/")) {
      return json({ quota_mib: 95.37 });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 4. CURRENCY FX SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createFxService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outage: Loopback port closed / ECONNREFUSED simulation
    if (v === 99) return json({ error: "Service daemon stopped" }, 503);

    if (u.pathname === "/openapi.json") {
      return json({
        openapi: "3.0.3",
        info: { title: "Currency FX", version: "1.0.0" },
        paths: {
          "/v1/rates": {
            get: {
              operationId: "getFxRates",
              summary: "Get foreign exchange rates",
              parameters: [{ name: "base", in: "query", required: true, schema: { type: "string" } }],
              responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { base: { type: "string" }, usd_rate: { type: "number" } } } } } } },
            },
          },
        },
      });
    }

    if (v === 1 && u.pathname === "/v1/rates") {
      const base = u.searchParams.get("base") ?? "EUR";
      const rates: Record<string, number> = { EUR: 1.08, GBP: 1.29, JPY: 0.0065, CHF: 1.12 };
      return json({ base, usd_rate: rates[base] ?? 1.0 });
    }

    if ((v === 2 || v === 3 || v === 4) && u.pathname === "/mcp") {
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "FxMCP", version: "2.0" } } });
      if (body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{
              name: "lookup_fx_rate",
              title: "FX Rate Lookup",
              description: "Lookup current exchange rate against USD",
              inputSchema: { type: "object", properties: { currency: { type: "string" } }, required: ["currency"] },
              outputSchema: { type: "object", properties: { rate: { type: "number" } } },
              annotations: { readOnlyHint: true },
            }],
          },
        });
      }
      if (body.method === "tools/call") {
        const curr = String(body.params.arguments?.currency ?? "EUR");
        const rates: Record<string, number> = { EUR: 1.08, GBP: 1.29, JPY: 0.0065, CHF: 1.12 };
        return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { rate: rates[curr] ?? 1.0 } } });
      }
    }

    if (v === 5 && u.pathname === "/v1/rates") {
      // Currency denomination drift (EUR base silent shift)
      return json({ base: "EUR", target_rate: 1.47 }); // CAD in EUR rather than USD
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 5. CRM CUSTOMER SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createCrmService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outages
    if (v === 9) return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "3600" });
    if (v === 10) return json({ error: "Bad gateway" }, 502);

    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "CRM Service", version: "1.0.0" },
          paths: {
            "/v1/customers": {
              post: {
                operationId: "createCustomerSnake",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "CRM Service", version: "2.0.0" },
          paths: {
            "/v2/customers": {
              post: {
                operationId: "createCustomerCamel",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { userId: { type: "string" }, firstName: { type: "string" }, orgId: { type: "string" } } } } } },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { result: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 3) {
        return json({
          openapi: "3.0.3",
          info: { title: "CRM Service (ISO Dates)", version: "3.0.0" },
          paths: {
            "/v3/events/{eventId}": {
              get: {
                operationId: "getEvent",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { eventTime: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "CRM Service (Required Header)", version: "4.0.0" },
          paths: {
            "/v4/customers/{customerId}": {
              get: {
                operationId: "getCustomerHeader",
                parameters: [{ name: "X-Client-Version", in: "header", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 5) {
        return json({
          openapi: "3.0.3",
          info: { title: "CRM Service (Enums)", version: "5.0.0" },
          paths: {
            "/v5/records/{recordId}": {
              get: {
                operationId: "getRecord",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 6) {
        return json({
          openapi: "3.1.0",
          info: { title: "CRM Service (3.1)", version: "6.0.0" },
          paths: {
            "/v6/contacts": {
              post: {
                operationId: "updateContact",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { outcome: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (v === 2 && u.pathname === "/v2/customers") {
      return json({ result: `PROCESSED_${body.userId || "CUST-77"}` });
    }
    if (v === 3 && u.pathname.startsWith("/v3/events/")) {
      return json({ eventTime: "2023-11-14T22:13:20Z" });
    }
    if (v === 4 && u.pathname.startsWith("/v4/customers/")) {
      const id = u.pathname.split("/").pop();
      return json({ status: `ACTIVE_${id}` });
    }
    if (v === 5 && u.pathname.startsWith("/v5/records/")) {
      return json({ status: "ACTIVE" });
    }
    if (v === 6 && u.pathname === "/v6/contacts") {
      return json({ outcome: "NOTE_CLEARED" });
    }
    if (v === 7 && u.pathname === "/v7/webhooks/subscribe") {
      return json({ status: "SUB_REGISTERED_ACK" });
    }
    if (v === 8 && u.pathname.startsWith("/v8/timestamp/")) {
      return json({ timestamp_ms: 1700000000000 });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 6. INVENTORY SERVICE (50-case version)
// ---------------------------------------------------------------------------
export function createInventoryService50() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Outage: Corrupted schema endpoint
    if (v === 7 && u.pathname === "/openapi.json") {
      return new Response("{\"openapi\": \"3.0.3\", \"info\": { \"title\": \"Incomplete...", {
        headers: { "content-type": "application/json" },
      });
    }

    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "Inventory Service", version: "1.0.0" },
          paths: {
            "/v1/items/{sku}": {
              get: {
                operationId: "getItem",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { stock: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "Inventory Service (Cursor & Batch)", version: "2.0.0" },
          paths: {
            "/v2/items": {
              get: {
                operationId: "getItemsCursor",
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            pageInfo: { type: "object" },
                            edges: { type: "array", items: { type: "object", properties: { node: { type: "object", properties: { stock: { type: "integer" } } } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "/v2/adjust": {
              post: {
                operationId: "adjustBatch",
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 3) {
        return json({
          openapi: "3.0.3",
          info: { title: "Inventory Service (RSQL)", version: "3.0.0" },
          paths: {
            "/v2/items": {
              get: {
                operationId: "filterItems",
                parameters: [{ name: "filter", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "Inventory Service (REST v3)", version: "4.0.0" },
          paths: {
            "/inventory/v3/stock/{sku}": {
              get: {
                operationId: "getStockV3",
                parameters: [{ name: "sku", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { quantity: { type: "integer" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (v === 2 && u.pathname === "/v2/items") {
      return json({ pageInfo: { hasNextPage: false }, edges: [{ node: { sku: "WIDGET-01", stock: 42 } }] });
    }
    if (v === 2 && u.pathname === "/v2/adjust") {
      return json({ status: "BATCH_UPDATED_1" });
    }
    if (v === 3 && u.pathname === "/v2/items") {
      return json({ count: 18 });
    }
    if (v === 4 && u.pathname.startsWith("/inventory/v3/stock/")) {
      return json({ quantity: 150 });
    }

    // MCP Tools (PROTO-08)
    if (v === 5 && u.pathname === "/mcp") {
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "InventoryMCP", version: "1.0" } } });
      if (body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{
              name: "create_inventory_item",
              description: "Create inventory item with initial stock",
              inputSchema: { type: "object", properties: { sku: { type: "string" }, initialStock: { type: "integer" } }, required: ["sku"] },
              outputSchema: { type: "object", properties: { creationResult: { type: "string" } } },
            }],
          },
        });
      }
      if (body.method === "tools/call") {
        const sku = String(body.params.arguments?.sku ?? "SKU-MCP-NEW");
        return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { creationResult: `CREATED_${sku}` } } });
      }
    }

    if (v === 6 && u.pathname === "/v1/sensor/temperature") {
      return json({ temp_fahrenheit: 68 });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}
