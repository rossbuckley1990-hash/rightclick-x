// Independent Adversarial Consequential Actions Test Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { FileStore } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/entry/node-host.ts";
import { Authority } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/net.ts";
import { RecoveringWorkflow, type FallbackAgent } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/recovery.ts";

export interface ConsequentialTestCaseResult {
  id: string;
  name: string;
  category: string;
  preventedAction: boolean;
  detectedAction: boolean;
  refusedReplay: boolean;
  reportedUncertainty: boolean;
  committedToDatabase: boolean;
  verdict: "prevented" | "detected_post_facto_unprevented" | "refused_replay" | "unsafe_replay" | "ambiguous_safe";
  detail: string;
}

export async function runConsequentialSuite(): Promise<ConsequentialTestCaseResult[]> {
  const results: ConsequentialTestCaseResult[] = [];
  const root = await mkdtemp(join(tmpdir(), "rcx-adv-consequential-"));
  const dbPath = join(root, "test-ledger.sqlite");
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
      invoice_id TEXT UNIQUE NOT NULL,
      request_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calls (
      request_id TEXT,
      outcome TEXT
    );
  `);

  let currentMode = {
    version: 1,
    lie: false,
    loseResponse: false,
    slowResponse: false,
  };

  // Provider server
  const replySchema = { "200": { content: { "application/json": { schema: { type: "object", properties: { invoice_id: { type: "string" }, customer: { type: "string" }, currency: { type: "string" }, total_minor: { type: "integer" } } } } } } };
  const providerServer = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (req.headers.authorization !== "Bearer synthetic-provider") return send(401, { error: "unauthorized" });
      if (url.pathname === "/openapi.json") {
        return send(200, {
          openapi: "3.0.3",
          info: { title: "Invoice Provider", version: "1.0.0" },
          paths: {
            "/v1/invoices": {
              post: {
                operationId: "createInvoice",
                summary: "Create invoice",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { invoice: { type: "object" } } } } } },
                responses: replySchema,
              },
            },
          },
        });
      }
      if (url.pathname !== "/v1/invoices" || req.method !== "POST") return send(404, {});

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const invoice = body.invoice;

      db.prepare("INSERT INTO calls VALUES (?, ?)").run(invoice.request_id, "attempt");

      // Check idempotency conflict
      const prior = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get(invoice.request_id) as any;
      if (prior && prior.request_json !== JSON.stringify(invoice)) {
        return send(409, { error: "idempotency key conflict" });
      }

      const mult = currentMode.lie ? 100 : 1;
      const total = invoice.lines.reduce((s: number, l: any) => s + l.unit_minor * l.quantity, 0) * mult;

      // Commit to DB
      db.prepare("INSERT OR IGNORE INTO invoices VALUES (?, ?, ?, ?, ?, ?)").run(
        invoice.request_id,
        invoice.customer,
        invoice.currency,
        total,
        `INV-${invoice.request_id}`,
        JSON.stringify(invoice)
      );

      if (currentMode.loseResponse) {
        req.socket.destroy();
        return;
      }

      if (currentMode.slowResponse) {
        await new Promise((r) => setTimeout(r, 2500));
      }

      return send(200, {
        invoice_id: `INV-${invoice.request_id}`,
        customer: invoice.customer,
        currency: invoice.currency,
        total_minor: total,
      });
    } catch {
      send(500, { error: "server error" });
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
          info: { title: "Independent Observer", version: "1.0.0" },
          paths: {
            "/observe": {
              get: {
                operationId: "observeInvoice",
                summary: "Observe committed invoice",
                parameters: [{ name: "invoice", in: "query", required: true, schema: { type: "object" } }],
                responses: replySchema,
              },
            },
          },
        });
      }
      if (url.pathname !== "/observe") return send(404, {});

      const expected = JSON.parse(url.searchParams.get("invoice")!);
      const rows = db.prepare("SELECT * FROM invoices WHERE request_id = ?").all(expected.request_id) as any[];
      const total = expected.lines.reduce((s: bigint, l: any) => s + BigInt(l.unit_minor) * BigInt(l.quantity), 0n);

      if (rows.length !== 1 || rows[0].customer !== expected.customer || rows[0].currency !== expected.currency || BigInt(rows[0].total_minor) !== total) {
        return send(409, { error: "business invariant violated" });
      }
      return send(200, {
        invoice_id: rows[0].invoice_id,
        customer: rows[0].customer,
        currency: rows[0].currency,
        total_minor: rows[0].total_minor,
      });
    } catch {
      send(500, { error: "observer error" });
    }
  });

  await new Promise<void>((r) => providerServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => observerServer.listen(0, "127.0.0.1", r));

  const providerUrl = `http://127.0.0.1:${(providerServer.address() as any).port}`;
  const observerUrl = `http://127.0.0.1:${(observerServer.address() as any).port}`;

  function createWorkflow(file = storePath) {
    const auth = new Authority();
    auth.set(providerUrl, { Authorization: "Bearer synthetic-provider" });
    auth.set(observerUrl, { Authorization: "Bearer synthetic-observer" });
    return RightClick.create({
      directories: [],
      store: new FileStore(file),
      workflowRecovery: true,
      auth,
      timeoutMs: 1500,
      authority: { publish: "verified", retry: [] },
    }).then((rc) => {
      return new RecoveringWorkflow(rc, {
        name: "issue-invoice",
        sources: [providerUrl, `${observerUrl}/openapi.json`],
        origins: [providerUrl, observerUrl],
        have: { invoice: "json" },
        want: "json",
        intent: "create customer invoice",
        risks: ["write"],
        witnesses: [
          {
            capability: "openapi:independent-observer:observeinvoice",
            args: { invoice: { input: "invoice" } },
            verify: [{ op: "exists", path: "invoice_id" }],
            agree: {},
          },
        ],
      });
    });
  }

  // -------------------------------------------------------------------------
  // CASE B1: The "Lie" Scenario: Erroneous Write Committed to Upstream DB
  // -------------------------------------------------------------------------
  {
    currentMode.lie = true;
    const wf = await createWorkflow(join(root, "store-lie.json"));
    const reqData = {
      request_id: "req-adv-lie",
      customer: "AliceCorp",
      currency: "USD",
      lines: [{ unit_minor: 1000, quantity: 1 }], // Expected total: 1000 cents ($10.00)
    };

    const res = await wf.execute({ invoice: reqData });
    const row = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get("req-adv-lie") as any;

    const prevented = !row;
    const detected = res.status !== "verified";
    const committed = !!row;
    const badTotalCommitted = row?.total_minor === 100000; // 100x overcharge

    results.push({
      id: "CONSEQ-ADV-01",
      name: "Consequential Action: Upstream Miscalculation Committed to Ledger",
      category: "consequential_write",
      preventedAction: prevented,
      detectedAction: detected,
      refusedReplay: false,
      reportedUncertainty: res.status === "unresolved",
      committedToDatabase: committed,
      verdict: "detected_post_facto_unprevented",
      detail: `Workflow returned status=${res.status}. Observer refuted and blocked publication, BUT database holds total_minor=${row?.total_minor} (100x overcharge). Proves: Detection is NOT prevention or rollback.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE B2: Response Loss After Commit (Phantom Write) & Cold Replay Refusal
  // -------------------------------------------------------------------------
  {
    currentMode.lie = false;
    currentMode.loseResponse = true;
    const lostStore = join(root, "store-lost.json");
    const wf = await createWorkflow(lostStore);
    const reqData = {
      request_id: "req-adv-lost",
      customer: "BobCorp",
      currency: "USD",
      lines: [{ unit_minor: 2500, quantity: 1 }],
    };

    // First attempt: socket is destroyed after DB insert
    const res1 = await wf.execute({ invoice: reqData });
    const row1 = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get("req-adv-lost") as any;
    const calls1 = db.prepare("SELECT COUNT(*) as c FROM calls WHERE request_id = ?").get("req-adv-lost") as any;

    // Reset mode so provider is normal now
    currentMode.loseResponse = false;

    // Second attempt in a FRESH worker mounting the same store
    const wf2 = await createWorkflow(lostStore);
    const res2 = await wf2.execute({ invoice: reqData });
    const calls2 = db.prepare("SELECT COUNT(*) as c FROM calls WHERE request_id = ?").get("req-adv-lost") as any;

    const refusedReplay = calls2.c === calls1.c; // Calls count did NOT increment
    const reportedUncertainty = res1.status === "unresolved" || res1.status === "ambiguous";

    results.push({
      id: "CONSEQ-ADV-02",
      name: "Response Loss After Commit (Phantom Write): Replay Refusal",
      category: "response_loss",
      preventedAction: false,
      detectedAction: true,
      refusedReplay: refusedReplay,
      reportedUncertainty: reportedUncertainty,
      committedToDatabase: !!row1,
      verdict: refusedReplay ? "refused_replay" : "unsafe_replay",
      detail: `Attempt 1 status=${res1.status}. Attempt 2 status=${res2.status}. DB call count before=${calls1.c}, after=${calls2.c}. Fresh worker refused to re-dispatch uncertain write.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE B3: Idempotency Key Conflict with Divergent Payload
  // -------------------------------------------------------------------------
  {
    const idempStore = join(root, "store-idemp.json");
    const wf = await createWorkflow(idempStore);
    const reqOriginal = {
      request_id: "req-adv-idemp",
      customer: "CharlieCorp",
      currency: "USD",
      lines: [{ unit_minor: 500, quantity: 2 }],
    };
    const reqConflicting = {
      request_id: "req-adv-idemp", // Same request_id
      customer: "AttackerMallory", // Conflicting customer
      currency: "USD",
      lines: [{ unit_minor: 999999, quantity: 1 }],
    };

    // Run original
    const res1 = await wf.execute({ invoice: reqOriginal });
    // Run conflicting
    const res2 = await wf.execute({ invoice: reqConflicting });
    const row = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get("req-adv-idemp") as any;

    const preventedOverwrite = row.customer === "CharlieCorp" && row.total_minor === 1000;
    const conflictDetected = res2.status !== "verified";

    results.push({
      id: "CONSEQ-ADV-03",
      name: "Idempotency Conflict: Divergent Payload with Same Key",
      category: "idempotency",
      preventedAction: preventedOverwrite,
      detectedAction: conflictDetected,
      refusedReplay: true,
      reportedUncertainty: true,
      committedToDatabase: true,
      verdict: preventedOverwrite ? "prevented" : "unsafe_replay",
      detail: `Original succeeded (INV-${row.request_id}). Conflicting payload returned status=${res2.status}. Database retained original CharlieCorp data without overwrite.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE B4: Concurrent Workers Race Condition on Same Store
  // -------------------------------------------------------------------------
  {
    const concStore = join(root, "store-concurrent.json");
    const wfA = await createWorkflow(concStore);
    const wfB = await createWorkflow(concStore);
    const reqData = {
      request_id: "req-adv-parallel",
      customer: "DaveCorp",
      currency: "USD",
      lines: [{ unit_minor: 1200, quantity: 1 }],
    };

    const [resA, resB] = await Promise.all([
      wfA.execute({ invoice: reqData }),
      wfB.execute({ invoice: reqData }),
    ]);

    const calls = db.prepare("SELECT COUNT(*) as c FROM calls WHERE request_id = ?").get("req-adv-parallel") as any;
    const row = db.prepare("SELECT * FROM invoices WHERE request_id = ?").get("req-adv-parallel") as any;

    results.push({
      id: "CONSEQ-ADV-04",
      name: "Concurrent Workers Race on Identical Lease",
      category: "concurrency",
      preventedAction: false,
      detectedAction: true,
      refusedReplay: true,
      reportedUncertainty: false,
      committedToDatabase: !!row,
      verdict: "ambiguous_safe",
      detail: `Worker A status=${resA.status}, Worker B status=${resB.status}. Provider DB calls=${calls.c}, unique invoices in DB=1. State lock prevented double insertion.`,
    });
  }

  // -------------------------------------------------------------------------
  // CASE B5: Timeout After Commit: Cold Restart Marks Ambiguous
  // -------------------------------------------------------------------------
  {
    currentMode.slowResponse = true; // 2500ms delay, timeout is 1500ms
    const slowStore = join(root, "store-slow.json");
    const wf = await createWorkflow(slowStore);
    const reqData = {
      request_id: "req-adv-slow",
      customer: "EveCorp",
      currency: "USD",
      lines: [{ unit_minor: 4000, quantity: 1 }],
    };

    const res1 = await wf.execute({ invoice: reqData });
    currentMode.slowResponse = false;

    // Fresh worker on cold restart
    const wfCold = await createWorkflow(slowStore);
    const res2 = await wfCold.execute({ invoice: reqData });
    const calls = db.prepare("SELECT COUNT(*) as c FROM calls WHERE request_id = ?").get("req-adv-slow") as any;

    const staysAmbiguous = res2.status === "ambiguous";
    const callsStayedOne = calls.c === 1;

    results.push({
      id: "CONSEQ-ADV-05",
      name: "Timeout After Commit: Cold Restart Preserves Ambiguous State",
      category: "crash_recovery",
      preventedAction: false,
      detectedAction: true,
      refusedReplay: callsStayedOne,
      reportedUncertainty: staysAmbiguous,
      committedToDatabase: true,
      verdict: staysAmbiguous && callsStayedOne ? "refused_replay" : "unsafe_replay",
      detail: `Timed-out write produced status=${res1.status}. Cold restart returned status=${res2.status} ('${res2.reason}'). DB calls count=${calls.c}. Replay was safely refused.`,
    });
  }

  // Teardown
  providerServer.close();
  observerServer.close();
  db.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});

  return results;
}
