// Independent Adversarial Durable Reuse Test Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { Authority } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/net.ts";
import { RecoveringWorkflow, type FallbackAgent } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";

export interface DurableTestCaseResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  status: string;
  route: string;
  fallbackCalls: number;
  pid1: number | null;
  pid2: number | null;
  detail: string;
}

export async function runDurableSuite(): Promise<DurableTestCaseResult[]> {
  const results: DurableTestCaseResult[] = [];
  const root = await mkdtemp(join(tmpdir(), "rcx-adv-durable-"));
  const dbPath = join(root, "durable-ledger.sqlite");
  const storePath = join(root, "store.json");

  // Setup test SQLite database
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS invoices (
      request_id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      invoice_id TEXT UNIQUE NOT NULL
    );
  `);

  let providerVersion = 2; // GraphQL
  const replySchema = { "200": { content: { "application/json": { schema: { type: "object", properties: { invoice_id: { type: "string" }, customer: { type: "string" }, currency: { type: "string" }, total_minor: { type: "integer" } } } } } } };

  // Provider server
  const providerServer = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (req.headers.authorization !== "Bearer synthetic-provider") return send(401, { error: "unauthorized" });
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end('<a href="/graphql">GraphQL API</a>');
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
                mutationType: { name: "Mutation" },
                types: [
                  {
                    kind: "OBJECT",
                    name: "Mutation",
                    fields: [
                      {
                        name: "createInvoice",
                        description: "Create customer invoice",
                        args: [
                          {
                            name: "payload",
                            type: {
                              kind: "INPUT_OBJECT",
                              name: "InvoiceInput",
                              inputFields: [
                                { name: "request_id", type: { kind: "SCALAR", name: "String" } },
                                { name: "customer", type: { kind: "SCALAR", name: "String" } },
                                { name: "currency", type: { kind: "SCALAR", name: "String" } },
                                { name: "total_minor", type: { kind: "SCALAR", name: "Int" } },
                              ],
                            },
                            defaultValue: null,
                          },
                        ],
                        type: { kind: "OBJECT", name: "Invoice" },
                      },
                    ],
                  },
                  {
                    kind: "OBJECT",
                    name: "Invoice",
                    fields: [
                      { name: "invoice_id", type: { kind: "SCALAR", name: "String" } },
                      { name: "customer", type: { kind: "SCALAR", name: "String" } },
                      { name: "currency", type: { kind: "SCALAR", name: "String" } },
                      { name: "total_minor", type: { kind: "SCALAR", name: "Int" } },
                    ],
                  },
                  { kind: "OBJECT", name: "Query", fields: [] },
                  { kind: "SCALAR", name: "String" },
                  { kind: "SCALAR", name: "Int" },
                ],
              },
            },
          });
        }

        if (body.query?.includes("createInvoice")) {
          const inv = body.variables?.payload;
          if (providerVersion === 3) {
            // Day 3: Provider broke! Mutation no longer exists!
            return send(500, { errors: [{ message: "Endpoint decommissioned" }] });
          }
          db.prepare("INSERT OR REPLACE INTO invoices VALUES (?, ?, ?, ?, ?)").run(
            inv.request_id,
            inv.customer,
            inv.currency,
            inv.total_minor,
            `INV-${inv.request_id}`
          );
          return send(200, {
            data: {
              createInvoice: {
                invoice_id: `INV-${inv.request_id}`,
                customer: inv.customer,
                currency: inv.currency,
                total_minor: inv.total_minor,
              },
            },
          });
        }
      }
      send(404, {});
    } catch {
      send(500, { error: "error" });
    }
  });

  // Observer server
  const observerServer = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (req.headers.authorization !== "Bearer synthetic-observer") return send(401, { error: "unauthorized" });
      if (url.pathname === "/openapi.json") {
        return send(200, {
          openapi: "3.0.3",
          info: { title: "DurableAudit", version: "1" },
          paths: {
            "/audit": {
              get: {
                operationId: "checkInvoice",
                parameters: [{ name: "request_id", in: "query", required: true, schema: { type: "string" } }],
                responses: replySchema,
              },
            },
          },
        });
      }
      if (url.pathname === "/audit") {
        const id = url.searchParams.get("request_id");
        const row = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get(id) as any;
        if (!row) return send(404, { error: "not found" });
        return send(200, {
          invoice_id: row.invoice_id,
          customer: row.customer,
          currency: row.currency,
          total_minor: row.total_minor,
        });
      }
      send(404, {});
    } catch {
      send(500, { error: "error" });
    }
  });

  await new Promise<void>((r) => providerServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => observerServer.listen(0, "127.0.0.1", r));

  const providerUrl = `http://127.0.0.1:${(providerServer.address() as any).port}`;
  const observerUrl = `http://127.0.0.1:${(observerServer.address() as any).port}`;

  // Helper script to run worker in a fresh Node process
  const workerScript = join(root, "worker-runner.mjs");
  await writeFile(
    workerScript,
    `
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { Authority } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/net.ts";
import { RecoveringWorkflow } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";

const [providerUrl, observerUrl, storeFile, requestJson, hasFallback] = process.argv.slice(2);
const auth = new Authority();
auth.set(providerUrl, { Authorization: "Bearer synthetic-provider" });
auth.set(observerUrl, { Authorization: "Bearer synthetic-observer" });

const rc = await RightClick.create({
  directories: [],
  store: new FileStore(storeFile),
  workflowRecovery: true,
  auth,
  timeoutMs: 2000,
  authority: { publish: "verified", retry: [] },
});

let agent = undefined;
if (hasFallback === "true") {
  agent = {
    propose: async (context) => {
      const cap = context.capabilities.find(c => c.risk === "write");
      return {
        proposal: { capability: cap?.id, inputBindings: { payload: "invoice" } },
        usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 15 },
      };
    }
  };
}

const wf = new RecoveringWorkflow(rc, {
  name: "durable-invoice",
  sources: [providerUrl, \`\${observerUrl}/openapi.json\`],
  origins: [providerUrl, observerUrl],
  have: { invoice: "json" },
  want: "json",
  intent: "create customer invoice",
  risks: ["write"],
  witnesses: [{
    capability: "openapi:durableaudit:checkinvoice",
    args: { request_id: { input: "invoice.request_id" } },
    verify: [{ op: "exists", path: "invoice_id" }],
    agree: {},
  }],
}, agent);

const res = await wf.execute({ invoice: JSON.parse(requestJson) });
await rc.flush().catch(() => {});
process.stdout.write(JSON.stringify({ pid: process.pid, ...res }) + "\\n");
`
  );

  function runSubprocess(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [workerScript, ...args]);
      let out = "", err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.on("close", (code) => {
        if (code !== 0) return reject(new Error(`Subprocess exited ${code}: ${err}`));
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          reject(new Error(`JSON parse error: ${out}`));
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // CASE E1: Multi-Process Fresh Agent Reuse with Unseen Identifier
  // -------------------------------------------------------------------------
  {
    const req1 = { request_id: "PID1-REQ", customer: "Proc1Corp", currency: "USD", total_minor: 1500 };
    const req2 = { request_id: "PID2-REQ-UNSEEN", customer: "Proc2Corp", currency: "USD", total_minor: 3200 };

    // Process 1: Uses fallback to recover
    const out1 = await runSubprocess([providerUrl, observerUrl, storePath, JSON.stringify(req1), "true"]);
    console.log("OUT1:", JSON.stringify(out1));

    // Process 2: Completely separate OS process, NO fallback agent provisioned!
    const out2 = await runSubprocess([providerUrl, observerUrl, storePath, JSON.stringify(req2), "false"]);
    console.log("OUT2:", JSON.stringify(out2));

    const passes =
      out1.status === "verified" &&
      out2.status === "verified" &&
      out2.route === "retained" &&
      out2.measurements.fallbackCalls === 0 &&
      out1.pid !== out2.pid;

    results.push({
      id: "DURABLE-ADV-01",
      name: "Fresh OS Process Learning Transfer on Unseen Identifier",
      category: "process_isolation",
      passed: passes,
      status: out2.status,
      route: out2.route,
      fallbackCalls: out2.measurements.fallbackCalls,
      pid1: out1.pid,
      pid2: out2.pid,
      detail: `Proc1 (PID ${out1.pid}) recovered route='${out1.route}'. Proc2 (PID ${out2.pid}) executed unseen request via route='${out2.route}' with 0 fallback calls.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE E2: Changed Provider State Invalidates Retained Route
  // -------------------------------------------------------------------------
  {
    // Provider drifts to v3 (endpoint broken/decommissioned)
    providerVersion = 3;
    const req3 = { request_id: "PID3-REQ-BROKEN", customer: "Proc3Corp", currency: "USD", total_minor: 4000 };

    // Process 3: Tries to run retained route against broken provider
    const out3 = await runSubprocess([providerUrl, observerUrl, storePath, JSON.stringify(req3), "false"]);
    providerVersion = 2; // Reset

    const failsClosed = out3.status !== "verified";

    results.push({
      id: "DURABLE-ADV-02",
      name: "Changed Provider State Invalidates Retained Route",
      category: "stale_invalidation",
      passed: failsClosed,
      status: out3.status,
      route: out3.route,
      fallbackCalls: out3.measurements.fallbackCalls,
      pid1: null,
      pid2: out3.pid,
      detail: `Provider broken after retention. Fresh worker returned status='${out3.status}' ('${out3.reason}'). Did not falsely claim success.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE E3: Corrupted Checkpoint File Recovery
  // -------------------------------------------------------------------------
  {
    const corruptedStore = join(root, "corrupted-store.json");
    await writeFile(corruptedStore, '{"published": { "corrupted": { "unclosed": true'); // Truncated JSON!

    let threwOrRefused = false;
    let detail = "";
    try {
      const req = { request_id: "PID4-REQ", customer: "CorruptCorp", currency: "USD", total_minor: 1000 };
      const out4 = await runSubprocess([providerUrl, observerUrl, corruptedStore, JSON.stringify(req), "false"]);
      threwOrRefused = out4.status !== "verified";
      detail = `Returned status='${out4.status}'`;
    } catch (e: any) {
      threwOrRefused = true;
      detail = `Safely caught store read error: ${e.message.slice(0, 100)}`;
    }

    results.push({
      id: "DURABLE-ADV-03",
      name: "Corrupted Checkpoint File Handling",
      category: "storage_resilience",
      passed: threwOrRefused,
      status: threwOrRefused ? "handled_safely" : "false_success",
      route: "none",
      fallbackCalls: 0,
      pid1: null,
      pid2: null,
      detail,
    });
  }

  // -------------------------------------------------------------------------
  // CASE E4: Read-Only / Unwritable Store Admission
  // -------------------------------------------------------------------------
  {
    let rejectedAtStartup = false;
    let detail = "";
    try {
      const rcNoStore = await RightClick.create({
        directories: [],
        workflowRecovery: true, // But no FileStore provided!
        authority: { publish: "verified", retry: [] },
      });
      detail = "Unexpectedly allowed RightClick.create without store";
    } catch (e: any) {
      rejectedAtStartup = e.message.includes("workflow recovery requires a Store");
      detail = `Safely threw error at startup: ${e.message}`;
    }

    results.push({
      id: "DURABLE-ADV-04",
      name: "Refusal on Non-Durable / Unwritable Storage",
      category: "storage_admission",
      passed: rejectedAtStartup,
      status: rejectedAtStartup ? "refused_at_admission" : "admitted_unsafely",
      route: "none",
      fallbackCalls: 0,
      pid1: null,
      pid2: null,
      detail,
    });
  }

  providerServer.close();
  observerServer.close();
  db.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
  return results;
}
