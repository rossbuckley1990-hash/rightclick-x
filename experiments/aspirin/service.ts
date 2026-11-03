// Development service and independent read-only observer. No real money or credentials.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [role, database, modeFile] = process.argv.slice(2);
const db = new DatabaseSync(database, { readOnly: role === "observer" });
if (role === "provider") db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS invoices (request_id TEXT PRIMARY KEY, customer TEXT NOT NULL, currency TEXT NOT NULL, total_minor INTEGER NOT NULL, invoice_id TEXT UNIQUE NOT NULL, request_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calls (request_id TEXT, outcome TEXT);`);
const output = { type: "object", properties: { invoice_id: { type: "string" }, customer: { type: "string" }, currency: { type: "string" }, total_minor: { type: "integer", description: "USD cents" } } };
const replySchema = { "200": { content: { "application/json": { schema: output } } } };
const rowResult = (row: any) => ({ invoice_id: row.invoice_id, customer: row.customer, currency: row.currency, total_minor: row.total_minor });
const scalar = (name: string) => ({ kind: "SCALAR", name });
function introspection() {
  return { data: { __schema: { queryType: { name: "Query" }, mutationType: { name: "Mutation" }, types: [
    { kind: "INPUT_OBJECT", name: "InvoiceInput", inputFields: [{ name: "request_id", type: scalar("String") }, { name: "customer", type: scalar("String") }, { name: "currency", type: scalar("String") }, { name: "lines", type: { kind: "LIST", name: null, ofType: { kind: "INPUT_OBJECT", name: "LineInput" } } }] }, { kind: "INPUT_OBJECT", name: "LineInput", inputFields: [{ name: "unit_minor", type: scalar("Int") }, { name: "quantity", type: scalar("Int") }] }, { kind: "SCALAR", name: "String" }, { kind: "SCALAR", name: "Int" },
    { kind: "OBJECT", name: "Query", fields: [] },
    { kind: "OBJECT", name: "Mutation", fields: [{ name: "issueInvoice", description: "Create customer invoice", args: [{ name: "payload", type: { kind: "INPUT_OBJECT", name: "InvoiceInput" }, defaultValue: null }], type: { kind: "OBJECT", name: "Invoice" } }] },
    { kind: "OBJECT", name: "Invoice", fields: Object.entries(output.properties).map(([name, s]) => ({ name, description: "description" in s ? s.description : "", args: [], type: scalar(s.type === "integer" ? "Int" : "String") })) },
  ] } } };
}
const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (req.headers.authorization !== `Bearer synthetic-${role}`) return send(401, { error: "permission required" });
    if (role === "observer") {
      if (url.pathname === "/openapi.json") return send(200, { openapi: "3.0.3", info: { title: "Independent Audit", version: "1" }, paths: {
        "/observe": { get: { operationId: "observeInvoice", summary: "Independently inspect committed invoice", parameters: [{ name: "invoice", in: "query", required: true, schema: { type: "object" } }], responses: replySchema } },
      } });
      if (url.pathname !== "/observe") return send(404, {});
      const expected = JSON.parse(url.searchParams.get("invoice")!);
      const rows = db.prepare("SELECT * FROM invoices WHERE request_id = ?").all(expected.request_id) as any[];
      const total = expected.lines.reduce((s: bigint, line: any) => s + BigInt(line.unit_minor) * BigInt(line.quantity), 0n);
      if (rows.length !== 1 || rows[0].customer !== expected.customer || rows[0].currency !== expected.currency || BigInt(rows[0].total_minor) !== total)
        return send(409, { error: "business effect disagrees with original request" });
      return send(200, rowResult(rows[0]));
    }
    const mode = JSON.parse(readFileSync(modeFile, "utf8"));
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(mode.version === 1 ? '<a href="/openapi.json">API contract</a>' : '<a href="/graphql">GraphQL API</a>');
    }
    if (url.pathname === "/openapi.json") return mode.version !== 1 ? send(410, { error: "old documentation removed" }) : send(200, {
      openapi: "3.0.3", info: { title: "Invoice Provider", version: "1" }, paths: {
        "/v1/invoices": { post: { operationId: "createInvoice", summary: "Create customer invoice", requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["invoice"], properties: { invoice: { type: "object" } },
        } } } }, responses: replySchema } },
      },
    });
    if (url.pathname === "/v1/invoices" && mode.version !== 1) return send(410, { error: "endpoint removed" });
    if (url.pathname !== "/v1/invoices" && url.pathname !== "/graphql") return send(404, {});
    if (req.method !== "POST") return send(405, {});
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 16384) return send(413, {}); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (url.pathname === "/graphql" && String(body.query).includes("__schema")) return send(200, introspection());
    if (url.pathname === "/graphql" && !String(body.query).startsWith("mutation")) return send(400, { errors: [{ message: "write requires mutation" }] });
    const invoice = url.pathname === "/graphql" ? body.variables?.payload : body.invoice;
    if (!invoice || typeof invoice.request_id !== "string" || typeof invoice.customer !== "string" || invoice.currency !== "USD" || !Array.isArray(invoice.lines) || !invoice.lines.length ||
      invoice.lines.some((line: any) => !Number.isSafeInteger(line.unit_minor) || line.unit_minor < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1)) return send(400, { error: "invalid invoice" });
    if (mode.rateLimit) { db.prepare("INSERT INTO calls VALUES (?, ?)").run(invoice.request_id, "rate-limited"); return send(429, { error: "rate limited" }); }
    const total = invoice.lines.reduce((sum: number, line: any) => sum + line.unit_minor * line.quantity, 0) * (mode.lie ? 100 : 1);
    if (!Number.isSafeInteger(total)) return send(400, { error: "unsafe precision" });
    db.prepare("INSERT INTO calls VALUES (?, ?)").run(invoice.request_id, "attempt");
    const prior = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get(invoice.request_id) as any;
    if (prior && prior.request_json !== JSON.stringify(invoice)) return send(409, { error: "idempotency key conflicts with original request" });
    db.prepare("INSERT OR IGNORE INTO invoices VALUES (?, ?, ?, ?, ?, ?)").run(invoice.request_id, invoice.customer, invoice.currency, total, `INV-${invoice.request_id}`, JSON.stringify(invoice));
    const row = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get(invoice.request_id);
    if (mode.loseResponse) { req.socket.destroy(); return; }
    if (mode.slowResponse) await new Promise(resolve => setTimeout(resolve, 2200));
    return send(200, url.pathname === "/graphql" ? { data: { issueInvoice: rowResult(row) } } : rowResult(row));
  } catch { send(500, { error: "service failure" }); }
});
server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${(server.address() as any).port}` }) + "\n"));
