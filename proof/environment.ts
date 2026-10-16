// Controlled, synthetic test infrastructure. This file is not product code.
// Three separate HTTP servers hold separately cloned records. Nothing about
// these providers is registered with RightClick X; only their gateway is given.
import { createServer, type Server } from "node:http";

export type TaxVersion = 1 | 2 | 3;
export interface OrderRecord { order_id: string; amount_cents: number }
export interface ServiceEvent {
  sequence: number;
  service: "orders" | "tax" | "auditor" | "gateway" | "operator";
  action: string;
  detail: Record<string, unknown>;
}

type Running = { url: string; port: number; close(): Promise<void> };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const round = (value: number) => Math.round(value * 100) / 100;

async function listen(handler: (request: Request) => Promise<Response>, port = 0): Promise<Running> {
  const server: Server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const req = new Request(`http://${request.headers.host}${request.url}`, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === "string")) as Record<string, string>,
        ...(body.length && request.method !== "GET" && request.method !== "HEAD" ? { body } : {}),
      });
      const result = await handler(req);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const actual = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }),
  };
}

function records(seed: number): OrderRecord[] {
  let state = seed >>> 0;
  return Array.from({ length: 16 }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // Multiples of five cents make a 20% quote exact to a cent.
    return { order_id: `ORD-${index + 1001}`, amount_cents: 500 + (state % 30000) * 5 };
  });
}

const orderInput = { type: "string", description: "Order identifier" };
const moneyMajor = { type: "number", description: "Tax amount in USD dollars" };

export async function startEnvironment(seed = 472901) {
  const truth = records(seed);
  const orderRows = structuredClone(truth);
  const auditRows = structuredClone(truth);
  const events: ServiceEvent[] = [];
  const event = (service: ServiceEvent["service"], action: string, detail: Record<string, unknown> = {}) => events.push({ sequence: events.length + 1, service, action, detail });
  let version: TaxVersion = 1;
  let badArithmetic = false;
  let tax: Running | undefined;
  let taxPort = 0;
  let closed = false;

  const orders = await listen(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/openapi.json") return json({
      openapi: "3.0.3", info: { title: "Proof Orders", version: "1" },
      paths: { "/order": { get: {
        operationId: "retrieveOrderSubtotal", summary: "Retrieve order subtotal",
        parameters: [{ name: "order_id", in: "query", required: true, schema: orderInput }],
        responses: { "200": { description: "Order subtotal", content: { "application/json": { schema: { type: "object", properties: {
          amount_cents: { type: "integer", description: "Order subtotal in USD cents" },
        } } } } } },
      } } },
    });
    if (req.method === "GET" && url.pathname === "/order") {
      const row = orderRows.find((order) => order.order_id === url.searchParams.get("order_id"));
      event("orders", "read", { order_id: url.searchParams.get("order_id"), amount_cents: row?.amount_cents });
      return row ? json({ amount_cents: row.amount_cents }) : json({ error: "unknown order" }, 404);
    }
    return json({ error: "not found" }, 404);
  });

  const taxRequest = (input: unknown) => {
    if (typeof input !== "number" || !Number.isFinite(input) || input < 0) return undefined;
    const quoted = round(input * (badArithmetic ? 0.23 : 0.2));
    event("tax", "quote", { version, amount_dollars: input, tax_amount: quoted, badArithmetic });
    return quoted;
  };
  const taxHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const input = version === 1 ? "amount_dollars" : "subtotal_usd";
    const output = version === 1 ? "tax_amount" : "levy_usd";
    const path = version === 1 ? "/quote" : "/v2/assessment";
    const amountSchema = { type: "number", description: "Order subtotal in USD dollars" };
    const outputSchema = version === 1
      ? { type: "object", properties: { [output]: moneyMajor } }
      : { type: "object", properties: { result: { type: "object", properties: { [output]: moneyMajor } } } };
    if (version !== 3 && url.pathname === "/openapi.json") return json({
      openapi: "3.0.3", info: { title: "Proof Tax", version: String(version) },
      paths: { [path]: { get: {
        operationId: version === 1 ? "calculateOrderTax" : "assessOrderTax", summary: "Calculate order tax",
        parameters: [{ name: input, in: "query", required: true, schema: amountSchema }],
        responses: { "200": { description: "Order tax quote", content: { "application/json": { schema: outputSchema } } } },
      } } },
    });
    if (version !== 3 && req.method === "GET" && url.pathname === path) {
      const quoted = url.searchParams.has(input) ? taxRequest(Number(url.searchParams.get(input))) : undefined;
      if (quoted === undefined) return json({ error: "subtotal required" }, 400);
      return json(version === 1 ? { tax_amount: quoted } : { result: { levy_usd: quoted } });
    }
    if (version === 3 && req.method === "POST" && url.pathname === "/mcp") {
      if (body.id === undefined) return new Response(null, { status: 202 });
      const ok = (result: unknown) => json({ jsonrpc: "2.0", id: body.id, result });
      if (body.method === "initialize") return ok({ protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Proof Tax MCP", version: "3" } });
      if (body.method === "tools/list") return ok({ tools: [{
        name: "calculate_order_tax", title: "Calculate order tax", description: "Calculate order tax from an order subtotal in USD dollars.",
        inputSchema: { type: "object", properties: { subtotal_usd: amountSchema }, required: ["subtotal_usd"] },
        outputSchema: { type: "object", properties: { tax_amount: moneyMajor } }, annotations: { readOnlyHint: true },
      }] });
      if (body.method === "tools/call" && body.params?.name === "calculate_order_tax") {
        const quoted = taxRequest(body.params?.arguments?.subtotal_usd);
        if (quoted === undefined) return ok({ content: [{ type: "text", text: "subtotal required" }], isError: true });
        return ok({ content: [{ type: "text", text: JSON.stringify({ tax_amount: quoted }) }], structuredContent: { tax_amount: quoted } });
      }
      return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    }
    return json({ error: "not found" }, 404);
  };
  tax = await listen(taxHandler);
  taxPort = tax.port;
  const taxUrl = tax.url;

  const auditor = await listen(async (req) => {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/mcp") return json({ error: "not found" }, 404);
    const body: any = await req.json();
    if (body.id === undefined) return new Response(null, { status: 202 });
    const ok = (result: unknown) => json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return ok({ protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Proof Independent Auditor", version: "1" } });
    if (body.method === "tools/list") return ok({ tools: [{
      name: "audit_order_tax", title: "Audit order tax independently", description: "Validate the proposed tax amount against separately held order records and a fixed synthetic 20 percent rule. Returns a boolean, never an expected monetary answer.",
      inputSchema: { type: "object", properties: { order_id: orderInput, tax_amount: moneyMajor }, required: ["order_id", "tax_amount"] },
      outputSchema: { type: "object", properties: { valid: { type: "boolean", description: "Whether the proposed quote matches independent records" } } }, annotations: { readOnlyHint: true },
    }] });
    if (body.method === "tools/call" && body.params?.name === "audit_order_tax") {
      const args = body.params.arguments ?? {};
      const row = auditRows.find((order) => order.order_id === args.order_id);
      // This implementation deliberately computes from integer cents rather
      // than reusing the tax provider's calculation function.
      const expected = row ? Math.round(row.amount_cents / 5) / 100 : undefined;
      const valid = typeof args.tax_amount === "number" && expected !== undefined && Math.abs(args.tax_amount - expected) < 0.000001;
      event("auditor", "check", { order_id: args.order_id, proposed: args.tax_amount, expected, valid });
      return ok({ content: [{ type: "text", text: JSON.stringify({ valid }) }], structuredContent: { valid } });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
  });
  const gateway = await listen(async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/.well-known/api-catalog") return json({ error: "not found" }, 404);
    const listed = [orders.url, ...(tax ? [tax.url] : []), auditor.url];
    event("gateway", "catalog", { listed });
    return new Response(JSON.stringify({ linkset: [{ anchor: `${url.origin}/.well-known/api-catalog`, item: listed.map((href) => ({ href })) }] }), { headers: { "content-type": "application/linkset+json" } });
  });

  return {
    seed,
    gateway: gateway.url,
    ordersUrl: orders.url,
    taxUrl,
    auditorUrl: auditor.url,
    orderIds: truth.map((row) => row.order_id),
    truth: structuredClone(truth),
    events,
    expected(orderId: string) {
      const row = truth.find((record) => record.order_id === orderId);
      if (!row) throw new Error(`unknown test order: ${orderId}`);
      return Math.round(row.amount_cents / 5) / 100;
    },
    setTaxVersion(next: TaxVersion) { version = next; event("operator", "tax-contract", { version }); },
    setBadArithmetic(bad: boolean) { badArithmetic = bad; event("operator", "tax-arithmetic", { badArithmetic }); },
    async removeTax() { if (tax) { await tax.close(); tax = undefined; event("operator", "tax-removed"); } },
    async restoreTax(next: TaxVersion = version) { version = next; if (!tax) tax = await listen(taxHandler, taxPort); event("operator", "tax-restored", { version }); },
    async stop() {
      if (closed) return;
      closed = true;
      await Promise.all([orders.close(), auditor.close(), gateway.close(), ...(tax ? [tax.close()] : [])]);
    },
  };
}

export type ProofEnvironment = Awaited<ReturnType<typeof startEnvironment>>;
