import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { MoneyObservation } from "../../src/reconciliation.ts";
import { INTROSPECTION_QUERIES } from "../../src/reflectors/graphql.ts";

// Development fixture only. The checker reads the persisted records independently
// of the gateway code and is never supplied the gateway's proposed answer.
export const RULES_DIGEST = `sha256:${createHash("sha256").update(await readFile(import.meta.filename)).digest("hex")}`;
export const observationSchema = { type: "object", properties: {
  account: { type: "string" }, period: { type: "string" }, currency: { type: "string" },
  unit: { type: "string" }, basis: { type: "string" }, amountMinor: { type: "integer", description: "Settled amount in currency minor units" },
} };
const parameter = (name: string) => ({ name, in: "query", required: true, schema: { type: "string" } });
export const spec = (title: string, path: string, operationId: string, schema: object) => ({ openapi: "3.0.3", info: { title, version: "1" }, paths: {
  [path]: { get: { operationId, summary: "Account settlement observation", parameters: [parameter("account"), parameter("period")],
    responses: { "200": { content: { "application/json": { schema } } } } } },
} });
const stringType = { kind: "SCALAR", name: "String" };
export const introspection = { data: { __schema: { queryType: { name: "Query" }, mutationType: null, types: [
  { kind: "OBJECT", name: "Query", fields: [{ name: "settlementObservation", description: "Account settlement observation",
    args: ["account", "period"].map(name => ({ name, defaultValue: null, type: { kind: "NON_NULL", ofType: stringType } })),
    type: { kind: "OBJECT", name: "Settlement" } }] },
  { kind: "OBJECT", name: "Settlement", fields: Object.keys(observationSchema.properties).map(name => ({ name,
    type: { kind: "SCALAR", name: name === "amountMinor" ? "Int" : "String" }, args: [] })) },
  stringType, { kind: "SCALAR", name: "Int" },
] } } };

export async function startServices(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE control(version INTEGER, fault TEXT); INSERT INTO control VALUES(1,'none');
    CREATE TABLE authoritative(account TEXT, period TEXT, currency TEXT, unit TEXT, basis TEXT, amountMinor INTEGER, PRIMARY KEY(account,period));
    CREATE TABLE secondary(account TEXT, period TEXT, currency TEXT, unit TEXT, basis TEXT, amountMinor INTEGER, PRIMARY KEY(account,period));
    CREATE TABLE calls(service TEXT, method TEXT, path TEXT, queryOnly INTEGER NOT NULL DEFAULT 0);`);
  for (const [account, amount, delta] of [["ACC-77", 750000, 0], ["ACC-88", 12551, 51], ["ACC-99", -3100, 0]] as const) {
    db.prepare("INSERT INTO authoritative VALUES(?, '2026-10', 'USD', 'minor', 'settled', ?)").run(account, amount);
    db.prepare("INSERT INTO secondary VALUES(?, '2026-10', 'USD', 'minor', 'settled', ?)").run(account, amount - delta);
  }
  const witnessDb = new DatabaseSync(file, { readOnly: true });
  const observer = (table: "authoritative" | "secondary", account: string, period: string) => {
    const row = witnessDb.prepare(`SELECT account,period,currency,unit,basis,amountMinor FROM ${table} WHERE account=? AND period=?`).get(account, period);
    if (!row) throw new Error("account or closed period unavailable");
    return row as unknown as MoneyObservation;
  };
  const servers = ["gateway", "checker"].map(service => createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const call = db.prepare("INSERT INTO calls(service,method,path) VALUES(?,?,?)").run(service, req.method!, url.pathname);
    if (req.headers.authorization !== `Bearer fixture-${service}-read`) return send(401, { error: "read scope required" });
    const { version, fault } = db.prepare("SELECT * FROM control").get() as { version: number; fault: string };
    try {
      if (service === "checker") {
        if (req.method !== "GET") return send(403, { error: "read only" });
        if (url.pathname === "/openapi.json") {
          const doc = spec("Operator Checker", "/check", "observe", { type: "object", properties: {
            authoritative: observationSchema, secondary: observationSchema, rulesDigest: { type: "string" },
          } });
          if (fault === "checker-drift") doc.paths["/check"].get.parameters[0].name = "other_account";
          return send(200, doc);
        }
        if (url.pathname !== "/check") return send(404, {});
        const account = url.searchParams.get("account")!, period = url.searchParams.get("period")!;
        return send(200, { authoritative: observer("authoritative", account, period), secondary: observer("secondary", account, period), rulesDigest: RULES_DIGEST });
      }
      if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<a href="${version === 1 ? "/openapi.json" : "/graphql"}">Service contract</a>`); }
      if (url.pathname === "/openapi.json") return send(version === 1 ? 200 : 410, version === 1 ? spec("Settlement Gateway", "/v1/settlements", "settlementObservation", observationSchema) : { error: "REST documentation removed" });
      if (url.pathname === "/v1/settlements" && version !== 1) return send(410, { error: "REST endpoint removed" });
      let account = url.searchParams.get("account"), period = url.searchParams.get("period");
      if (url.pathname === "/graphql") {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        // An exact finite whitelist for this fixture's observer, not a product parser.
        // A mutation, second operation, alias, arbitrary POST or malformed document
        // stays queryOnly=0 and fails the independent no-write-dispatch assertion.
        const introspects = INTROSPECTION_QUERIES.includes(body.query);
        const reads = body.query === "query RightClick($account: String!, $period: String!) { settlementObservation(account: $account, period: $period) { account period currency unit basis amountMinor } }";
        if (!introspects && !reads) return send(403, { error: "only approved queries" });
        db.prepare("UPDATE calls SET queryOnly=1 WHERE rowid=?").run(call.lastInsertRowid);
        if (version !== 2) return send(410, { error: "GraphQL not available yet" });
        if (introspects) return send(200, introspection);
        account = body.variables?.account; period = body.variables?.period;
      } else if (url.pathname !== "/v1/settlements" || req.method !== "GET") return send(403, { error: "only approved reads" });
      if (fault === "unavailable") return send(503, { error: "unavailable" });
      if (fault === "rate-limit") return send(429, { error: "rate limited" });
      if (fault === "pending") return send(202, { job: "pending" });
      if (fault === "loss") { req.socket.destroy(); return; }
      const row = db.prepare("SELECT account,period,currency,unit,basis,amountMinor FROM secondary WHERE account=? AND period=?").get(account!, period!);
      if (!row) return send(404, {});
      if (fault === "amount") row.amountMinor = Number(row.amountMinor) * 100;
      if (fault === "currency") row.currency = "CAD";
      if (fault === "identity") row.account = "ANOTHER-ACCOUNT";
      if (fault === "period") row.period = "2026-09";
      if (fault === "precision") row.amountMinor = 0.5;
      if (fault === "units") row.unit = "major";
      if (fault === "basis") row.basis = "gross";
      return send(200, url.pathname === "/graphql" ? { data: { settlementObservation: row } } : row);
    } catch { return send(409, { error: "observation unavailable" }); }
  }));
  for (const server of servers) await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const [gateway, checker] = servers.map(s => `http://127.0.0.1:${(s.address() as { port: number }).port}`);
  return { gateway, checker, db, observer, close: async () => {
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    witnessDb.close(); db.close();
  } };
}
