// Services for the tool-loading experiment, run as a separate process.
//   node experiments/tool-loading/services.mjs <request-log.jsonl> <overrides.json>
// The fulfilment, levy and inspection services of experiments/agent-baseline/services.mjs, plus a
// shipping service with two side effects: creating a label and voiding one. Every request is
// logged, and every effect with what it changed, so effects are observed, not reported. The
// overrides file is read on every request, so the harness can change the world between the
// operator's setup and an agent's session:
//   {"levy":{"FR":25}}             the levy provider answers wrongly for a country; inspection keeps the truth
//   {"levy":{"release":"2.0"}}     an incompatible levy release: its rate operation moves to
//                                  GET /v2/rates and takes "region" instead of "country"
//   {"session":"<id>"}             a new session starts: labels voided in an earlier session are restored
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [log, overridesFile] = process.argv.slice(2);
const countries = { "O-1001": "DE", "O-1002": "FR", "O-1003": "IT", "O-1004": "ES", "O-1005": "NL", "O-1006": "DE" };
const rates = { DE: 19, FR: 20, IT: 22, ES: 21, NL: 21 };
const overrides = () => { try { return JSON.parse(readFileSync(overridesFile, "utf8")); } catch { return {}; } };
const v2 = () => overrides().levy?.release === "2.0";
const parameter = (name, type = "string", description) => ({ name, in: "query", required: true, description, schema: { type } });
const operation = (id, summary, inputs, properties) => ({ operationId: id, summary, parameters: inputs,
  responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties } } } } } });
const contract = (title, origin, paths, version = "1.4.2") => ({ openapi: "3.1.0", info: { title, version }, servers: [{ url: origin }], paths });
const services = {
  fulfilment: (o) => contract("Fulfilment", o, { "/run": { get: operation("lookup", "Look up where an order ships", [parameter("order_id", "string", "Order identifier such as O-1001")], { country: { type: "string", description: "ISO country code" } }) } }),
  levy: (o) => v2()
    ? contract("Levy", o, { "/v2/rates": { get: operation("calculate", "Sales tax rate for a tax region", [parameter("region", "string", "Tax region code, e.g. EU-DE")], { tax_rate: { type: "number", description: "Percent" } }) } }, "2.0.0")
    : contract("Levy", o, { "/run": { get: operation("calculate", "Sales tax rate for a country", [parameter("country", "string", "ISO country code")], { tax_rate: { type: "number", description: "Percent" } }) } }),
  inspection: (o) => contract("Inspection", o, { "/run": { get: operation("validate", "Independently validate a tax rate for an order", [parameter("order_id"), parameter("candidate", "number", "Proposed tax rate in percent")], { valid: { type: "boolean" } }) } }),
  shipping: (o) => contract("Shipping", o, {
    "/labels": {
      post: operation("createLabel", "Create and pay for a shipping label for an order", [parameter("order_id", "string", "Order identifier such as O-1001")],
        { label_id: { type: "string" }, order_id: { type: "string" }, tracking_code: { type: "string", description: "Carrier tracking code" }, carrier: { type: "string" }, charged: { type: "number", description: "Amount charged, EUR" } }),
      delete: operation("voidLabel", "Void a shipping label and refund it. Cannot be undone.", [parameter("label_id", "string", "Label identifier such as L-1")], { voided: { type: "boolean" }, refunded: { type: "number", description: "Amount refunded, EUR" } }),
    },
  }),
};
let labels = 0, session;
const voided = new Set();
const answer = {
  fulfilment: (q, path) => path === "/run" ? { country: countries[q.get("order_id")] ?? null } : null,
  levy: (q, path) => {
    if (v2()) return path === "/v2/rates" ? { tax_rate: rates[String(q.get("region")).replace(/^EU-/, "")] ?? null } : null;
    return path === "/run" ? { tax_rate: overrides().levy?.[q.get("country")] ?? rates[q.get("country")] ?? null } : null;
  },
  inspection: (q, path) => path === "/run" ? { valid: Number(q.get("candidate")) === rates[countries[q.get("order_id")]] } : null,
};
const urls = {};
for (const name of Object.keys(services)) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (overrides().session !== session) { session = overrides().session; voided.clear(); }
    let body = null, effect;
    if (req.method === "GET" && url.pathname === "/contract") body = services[name](urls[name]);
    else if (name === "shipping" && url.pathname === "/labels" && req.method === "POST" && countries[url.searchParams.get("order_id")]) {
      body = { label_id: `L-${++labels}`, order_id: url.searchParams.get("order_id"), tracking_code: `TRK-${randomBytes(4).toString("hex").toUpperCase()}`, carrier: "Northwind Parcel", charged: 7.5 };
      effect = { effect: "label-created", label: body.label_id, tracking: body.tracking_code };
    } else if (name === "shipping" && url.pathname === "/labels" && req.method === "DELETE") {
      const id = url.searchParams.get("label_id");
      const known = /^L-\d+$/.test(id ?? "") && Number(id.slice(2)) <= labels;
      body = { voided: known && !voided.has(id), refunded: known && !voided.has(id) ? 7.5 : 0 };
      effect = { effect: "label-void", label: id, voided: body.voided };
      if (body.voided) voided.add(id);
    } else if (req.method === "GET" && name !== "shipping") body = answer[name](url.searchParams, url.pathname);
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), service: name, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ...effect }) + "\n");
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(body ? JSON.stringify(body) : "{}");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  urls[name] = `http://127.0.0.1:${server.address().port}`;
}
console.log(JSON.stringify(urls));
