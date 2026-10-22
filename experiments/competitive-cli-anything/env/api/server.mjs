import { createServer } from "node:http";

const VERSION = process.env.API_VERSION === "2" ? 2 : 1;
const PORT = Number(process.env.API_PORT ?? 18081);

const suppliers = new Map([
  ["SUP-NW", { id: "SUP-NW", name: "Northwind Logistics", country: "NL", risk_band: "B" }],
  ["SUP-AC", { id: "SUP-AC", name: "Acme Components", country: "US", risk_band: "A" }],
  ["SUP-KT", { id: "SUP-KT", name: "Kite Systems", country: "GB", risk_band: "C" }],
  ["SUP-HL", { id: "SUP-HL", name: "Helios Energy", country: "DE", risk_band: "B" }],
]);

const rates = {
  "2026-07-02": { USD: 0.92, GBP: 1.17, EUR: 1.0 },
  "2026-07-03": { USD: 0.91, GBP: 1.16, EUR: 1.0 },
  "2026-07-06": { USD: 0.93, GBP: 1.18, EUR: 1.0 },
  "2026-07-07": { USD: 0.9, GBP: 1.15, EUR: 1.0 },
  "2026-07-08": { USD: 0.94, GBP: 1.19, EUR: 1.0 },
  "2026-08-03": { USD: 0.95, GBP: 1.2, EUR: 1.0 },
  "2026-08-04": { USD: 0.94, GBP: 1.21, EUR: 1.0 },
  "2026-08-05": { USD: 0.96, GBP: 1.22, EUR: 1.0 },
  "2026-08-06": { USD: 0.93, GBP: 1.19, EUR: 1.0 },
  "2026-08-07": { USD: 0.97, GBP: 1.23, EUR: 1.0 },
  "2026-08-10": { USD: 0.95, GBP: 1.2, EUR: 1.0 },
};

const invoices = new Map([
  ["INV-1001", { invoice_id: "INV-1001", supplier_id: "SUP-NW", region: "EMEA", currency: "EUR", amount: 1250.0, issued_on: "2026-07-02", deleted: false }],
  ["INV-1003", { invoice_id: "INV-1003", supplier_id: "SUP-KT", region: "EMEA", currency: "GBP", amount: 780.0, issued_on: "2026-07-03", deleted: false }],
  ["INV-1008", { invoice_id: "INV-1008", supplier_id: "SUP-AC", region: "EMEA", currency: "USD", amount: 510.0, issued_on: "2026-07-02", deleted: false }],
  ["INV-1012", { invoice_id: "INV-1012", supplier_id: "SUP-AC", region: "EMEA", currency: "USD", amount: 750.0, issued_on: "2026-07-07", deleted: false }],
]);

const pair = (supplier) => VERSION === 2
  ? { id: supplier.id, name: supplier.name, country: supplier.country, risk: supplier.risk_band }
  : supplier;

function rateFor(date, base) {
  const day = rates[date];
  if (!day) return { status: 404, body: { error: "no_rate_for_date", date } };
  const rate = day[base];
  if (rate === undefined) return { status: 404, body: { error: "unsupported_currency", base } };
  return { status: 200, body: VERSION === 2 ? { date, base, quote: "EUR", conversion_rate: rate } : { date, base, quote: "EUR", rate } };
}

const spec = (port) => ({
  openapi: "3.0.3",
  info: { title: "Ledger Exposure API", version: VERSION === 2 ? "2.0.0" : "1.0.0" },
  servers: [{ url: `http://127.0.0.1:${port}` }],
  paths: {
    "/v1/suppliers/{id}": {
      get: {
        operationId: "getSupplier",
        summary: "Read a supplier and its risk band",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "supplier", content: { "application/json": { schema: { $ref: "#/components/schemas/Supplier" } } } },
          "404": { description: "not found" },
        },
      },
    },
    "/v1/fx/{date}/{base}": {
      get: {
        operationId: "getFxRate",
        summary: "EUR per one unit of base currency on a date",
        parameters: [
          { name: "date", in: "path", required: true, schema: { type: "string", format: "date" } },
          { name: "base", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "rate", content: { "application/json": { schema: { $ref: "#/components/schemas/FxRate" } } } },
          "404": { description: "no rate" },
        },
      },
    },
    "/v1/convert": {
      get: {
        operationId: "convertToEur",
        summary: "Convert an amount in a currency to EUR on a date",
        parameters: [
          { name: "amount", in: "query", required: true, schema: { type: "number" } },
          { name: "from", in: "query", required: true, schema: { type: "string" } },
          { name: "date", in: "query", required: true, schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": { description: "converted amount", content: { "application/json": { schema: { $ref: "#/components/schemas/Conversion" } } } },
          "404": { description: "no rate" },
        },
      },
    },
    "/v1/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List invoices",
        responses: { "200": { description: "invoices", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Invoice" } } } } } },
      },
    },
    "/v1/invoices/{id}": {
      get: {
        operationId: "getInvoice",
        summary: "Read one invoice",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "invoice", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } }, "404": { description: "not found" } },
      },
      delete: {
        operationId: "deleteInvoice",
        summary: "Delete an invoice",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "deleted" }, "404": { description: "not found" } },
      },
    },
  },
  components: {
    schemas: {
      Supplier: {
        type: "object",
        required: ["id", "name", "country", VERSION === 2 ? "risk" : "risk_band"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          country: { type: "string" },
          ...(VERSION === 2 ? { risk: { type: "string" } } : { risk_band: { type: "string" } }),
        },
      },
      FxRate: {
        type: "object",
        required: VERSION === 2 ? ["date", "base", "quote", "conversion_rate"] : ["date", "base", "quote", "rate"],
        properties: {
          date: { type: "string", format: "date" },
          base: { type: "string" },
          quote: { type: "string" },
          ...(VERSION === 2 ? { conversion_rate: { type: "number" } } : { rate: { type: "number" } }),
        },
      },
      Conversion: {
        type: "object",
        required: VERSION === 2 ? ["amount", "from", "date", "eur_amount"] : ["amount", "from", "date", "eur"],
        properties: {
          amount: { type: "number" },
          from: { type: "string" },
          date: { type: "string", format: "date" },
          ...(VERSION === 2 ? { eur_amount: { type: "number" } } : { eur: { type: "number" } }),
        },
      },
      Invoice: {
        type: "object",
        properties: {
          invoice_id: { type: "string" },
          supplier_id: { type: "string" },
          region: { type: "string" },
          currency: { type: "string" },
          amount: { type: "number" },
          issued_on: { type: "string", format: "date" },
        },
      },
    },
  },
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  if (p === "/" ) return json(res, 200, { name: "Ledger Exposure API", version: VERSION, openapi: "/openapi.json", docs: "Use GET /openapi.json for the contract." });
  if (p === "/openapi.json") return json(res, 200, spec(PORT));
  if (p === "/health") return json(res, 200, { ok: true, version: VERSION });

  let m = p.match(/^\/v1\/suppliers\/([^/]+)$/);
  if (m && req.method === "GET") {
    const supplier = suppliers.get(decodeURIComponent(m[1]));
    return supplier ? json(res, 200, pair(supplier)) : json(res, 404, { error: "supplier_not_found", id: m[1] });
  }
  m = p.match(/^\/v1\/fx\/([^/]+)\/([^/]+)$/);
  if (m && req.method === "GET") {
    const r = rateFor(decodeURIComponent(m[1]), decodeURIComponent(m[2]).toUpperCase());
    return json(res, r.status, r.body);
  }
  if (p === "/v1/convert" && req.method === "GET") {
    const amount = Number(url.searchParams.get("amount"));
    const from = (url.searchParams.get("from") ?? "").toUpperCase();
    const date = url.searchParams.get("date") ?? "";
    if (!Number.isFinite(amount)) return json(res, 400, { error: "invalid_amount" });
    const r = rateFor(date, from);
    if (r.status !== 200) return json(res, r.status, r.body);
    const rate = VERSION === 2 ? r.body.conversion_rate : r.body.rate;
    const eur = Math.round(amount * rate * 100) / 100;
    return json(res, 200, VERSION === 2 ? { amount, from, date, eur_amount: eur } : { amount, from, date, eur });
  }
  if (p === "/v1/invoices" && req.method === "GET") return json(res, 200, [...invoices.values()]);
  m = p.match(/^\/v1\/invoices\/([^/]+)$/);
  if (m) {
    const invoice = invoices.get(decodeURIComponent(m[1]));
    if (!invoice) return json(res, 404, { error: "invoice_not_found", id: m[1] });
    if (req.method === "GET") return json(res, 200, invoice);
    if (req.method === "DELETE") {
      invoice.deleted = true;
      return json(res, 200, { deleted: true, invoice_id: invoice.invoice_id });
    }
  }
  return json(res, 404, { error: "not_found", path: p });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${PORT}`, version: VERSION }));
});
