// Three unfamiliar internal HTTP services with OpenAPI contracts, run as a separate process.
//   node experiments/agent-baseline/services.mjs <request-log.jsonl>
// Prints {"fulfilment": url, "levy": url, "inspection": url} once listening. Every request is
// appended to the log: the harness's independent observation of what an agent actually called.
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const log = process.argv[2];
// Ground truth lives here and in the harness, never in a contract.
const countries = { "O-1001": "DE", "O-1002": "FR", "O-1003": "IT", "O-1004": "ES", "O-1005": "NL", "O-1006": "DE" };
const rates = { DE: 19, FR: 20, IT: 22, ES: 21, NL: 21 };
const parameter = (name, type = "string", description) => ({ name, in: "query", required: true, description, schema: { type } });
const contract = (title, origin, id, summary, inputs, properties) => ({
  openapi: "3.1.0", info: { title, version: "1.4.2" }, servers: [{ url: origin }],
  paths: { "/run": { get: { operationId: id, summary, parameters: inputs,
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties } } } } } } } },
});
const services = {
  fulfilment: (origin) => contract("Fulfilment", origin, "lookup", "Look up where an order ships", [parameter("order_id", "string", "Order identifier such as O-1001")], { country: { type: "string", description: "ISO country code" } }),
  levy: (origin) => contract("Levy", origin, "calculate", "Sales tax rate for a country", [parameter("country", "string", "ISO country code")], { tax_rate: { type: "number", description: "Percent" } }),
  inspection: (origin) => contract("Inspection", origin, "validate", "Independently validate a tax rate for an order", [parameter("order_id"), parameter("candidate", "number", "Proposed tax rate in percent")], { valid: { type: "boolean" } }),
};
const answer = {
  fulfilment: (q) => ({ country: countries[q.get("order_id")] ?? null }),
  levy: (q) => ({ tax_rate: rates[q.get("country")] ?? null }),
  inspection: (q) => ({ valid: Number(q.get("candidate")) === rates[countries[q.get("order_id")]] }),
};
const urls = {};
for (const name of Object.keys(services)) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), service: name, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) }) + "\n");
    const origin = urls[name];
    const body = req.method !== "GET" ? null : url.pathname === "/contract" ? services[name](origin) : url.pathname === "/run" ? answer[name](url.searchParams) : null;
    res.writeHead(body ? 200 : req.method !== "GET" ? 405 : 404, { "content-type": "application/json" });
    res.end(body ? JSON.stringify(body) : "{}");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  urls[name] = `http://127.0.0.1:${server.address().port}`;
}
console.log(JSON.stringify(urls));
