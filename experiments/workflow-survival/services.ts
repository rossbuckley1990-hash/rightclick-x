// Multi-Service Polyglot Environment for the Independent Workflow Survival Challenge
// Clean disposable service handlers for Billing, Freight, Directory, and FX.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------
// 1. BILLING SERVICE
// ---------------------------------------------------------------------------
export function createBillingService() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (v === 5) return json({ error: "Billing service retired" }, 410);

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
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { result: { type: "object", properties: { finalAmountCents: { type: "integer" } } } } } } } } },
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
                summary: "Calculate invoice total in dollars",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["invoice_id", "items"],
                        properties: { invoice_id: { type: "string" }, items: { type: "array" } },
                      },
                    },
                  },
                },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { total_dollars: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (v === 1 && u.pathname === "/v1/invoices/total") {
      const sum = (body.items ?? []).reduce((acc: number, item: any) => acc + (item.price_cents * item.quantity), 0);
      return json({ total_cents: sum });
    }

    if (v === 2 && u.pathname === "/v2/compute") {
      const sum = (body.lineItems ?? []).reduce((acc: number, item: any) => acc + (item.unitPriceCents * item.count), 0);
      return json({ result: { finalAmountCents: sum } });
    }

    if (v === 3 && u.pathname === "/graphql") {
      if (String(body.query).includes("__schema")) {
        return json({
          data: {
            __schema: {
              queryType: { name: "Query" },
              types: [
                {
                  kind: "OBJECT",
                  name: "Query",
                  fields: [
                    {
                      name: "computeInvoice",
                      description: "Compute invoice total amount",
                      args: [
                        { name: "invoiceId", type: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "String" } } },
                        { name: "subtotal", type: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "Int" } } },
                      ],
                      type: { kind: "OBJECT", name: "InvoiceSummary" },
                    },
                  ],
                },
                {
                  kind: "OBJECT",
                  name: "InvoiceSummary",
                  fields: [{ name: "totalCents", args: [], type: { kind: "SCALAR", name: "Int" } }],
                },
                { kind: "SCALAR", name: "String", fields: null },
                { kind: "SCALAR", name: "Int", fields: null },
              ],
            },
          },
        });
      }
      const { subtotal } = body.variables ?? {};
      return json({ data: { computeInvoice: { totalCents: subtotal ?? 7800 } } });
    }

    if (v === 4 && u.pathname === "/v1/invoices/total") {
      const sumCents = (body.items ?? []).reduce((acc: number, item: any) => acc + (item.price_cents * item.quantity), 0);
      return json({ total_dollars: sumCents / 100 });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 2. FREIGHT SERVICE
// ---------------------------------------------------------------------------
export function createFreightService() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (v === 5) return json({ error: "Freight Service Unavailable" }, 503);

    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight Quote", version: "1.0.0" },
          paths: {
            "/v1/quote": {
              get: {
                operationId: "getFreightQuote",
                summary: "Calculate freight quote in USD",
                parameters: [
                  { name: "origin_zip", in: "query", required: true, schema: { type: "string" } },
                  { name: "dest_zip", in: "query", required: true, schema: { type: "string" } },
                  { name: "weight_kg", in: "query", required: true, schema: { type: "number" } },
                ],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { quote_usd: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight Quote", version: "2.0.0" },
          paths: {
            "/v2/rates": {
              post: {
                operationId: "calculateShippingRate",
                summary: "Calculate shipping rate in USD",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["fromZip", "toZip", "massKg"],
                        properties: { fromZip: { type: "string" }, toZip: { type: "string" }, massKg: { type: "number" } },
                      },
                    },
                  },
                },
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { rateUSD: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 4) {
        return json({
          openapi: "3.0.3",
          info: { title: "Freight Quote", version: "4.0.0" },
          paths: {
            "/v1/quote": {
              get: {
                operationId: "getFreightQuoteLbs",
                summary: "Calculate freight quote in pounds",
                parameters: [{ name: "weight_kg", in: "query", required: true, schema: { type: "number" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { quote_usd: { type: "number" } } } } } } },
              },
            },
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (v === 1 && u.pathname === "/v1/quote") {
      const kg = Number(u.searchParams.get("weight_kg") ?? 1);
      return json({ quote_usd: Math.round(kg * 5.5 * 100) / 100 });
    }

    if (v === 2 && u.pathname === "/v2/rates") {
      const kg = Number(body.massKg ?? 1);
      return json({ rateUSD: Math.round(kg * 5.5 * 100) / 100 });
    }

    if (v === 3 && u.pathname === "/mcp") {
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "FreightMCP", version: "3.0" } } });
      if (body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "quote_freight_shipping",
                title: "Freight Shipping Calculator",
                description: "Computes freight cost from weight",
                inputSchema: { type: "object", properties: { weight_kg: { type: "number" } }, required: ["weight_kg"] },
                outputSchema: { type: "object", properties: { cost_usd: { type: "number" } } },
                annotations: { readOnlyHint: true },
              },
            ],
          },
        });
      }
      if (body.method === "tools/call" && body.params?.name === "quote_freight_shipping") {
        const kg = Number(body.params.arguments?.weight_kg ?? 1);
        const cost = Math.round(kg * 5.5 * 100) / 100;
        return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { cost_usd: cost } } });
      }
    }

    if (v === 4 && u.pathname === "/v1/quote") {
      const lbs = Number(u.searchParams.get("weight_kg") ?? 1);
      return json({ quote_usd: Math.round(lbs * 2.5 * 100) / 100, unit: "lbs" });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 3. DIRECTORY SERVICE
// ---------------------------------------------------------------------------
export function createDirectoryService() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);

    if (u.pathname === "/openapi.json") {
      if (v === 1) {
        return json({
          openapi: "3.0.3",
          info: { title: "User Directory", version: "1.0.0" },
          paths: {
            "/v1/users/{userId}": {
              get: {
                operationId: "getUserProfile",
                summary: "Get user profile",
                parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, email: { type: "string" } } } } } } },
              },
            },
          },
        });
      }
      if (v === 2) {
        return json({
          openapi: "3.0.3",
          info: { title: "User Directory", version: "2.0.0" },
          paths: {
            "/v2/accounts/{userId}": {
              get: {
                operationId: "fetchAccount",
                summary: "Fetch account details email",
                parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { account: { type: "object", properties: { userEmail: { type: "string" } } } } } } } } },
              },
            },
          },
        });
      }
    }

    if (v === 1) {
      const m = u.pathname.match(/^\/v1\/users\/([^/]+)$/);
      if (m) return json({ id: m[1], email: `${m[1]}@enterprise.test` });
    }
    if (v === 2) {
      const m = u.pathname.match(/^\/v2\/accounts\/([^/]+)$/);
      if (m) return json({ account: { userEmail: `${m[1]}@enterprise.test` } });
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}

// ---------------------------------------------------------------------------
// 4. CURRENCY FX SERVICE
// ---------------------------------------------------------------------------
export function createFxService() {
  let v = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

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
      const rates: Record<string, number> = { EUR: 1.08, GBP: 1.29, JPY: 0.0065 };
      return json({ base, usd_rate: rates[base] ?? 1.0 });
    }

    if (v === 2 && u.pathname === "/mcp") {
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
        const rates: Record<string, number> = { EUR: 1.08, GBP: 1.29, JPY: 0.0065 };
        return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { rate: rates[curr] ?? 1.0 } } });
      }
    }

    return json({ error: "not found" }, 404);
  };
  return { handler, setVersion: (n: number) => { v = n; }, version: () => v };
}
