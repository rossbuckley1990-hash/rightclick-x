import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { decodeState } from "../src/core/state-format.ts";

for (const mode of ["leaf", "workflow", "composition"]) test(`a killed runtime recovers a real HTTP ${mode} from FileStore without discovery or a repeated effect`, { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcx-http-resume-"));
  const stateFile = join(directory, "state.json");
  const calls: string[] = [];
  const publications: string[] = [];
  let origin = "", document = "", artifact = Buffer.alloc(0), complete = false, waiting: ServerResponse | undefined;
  let observed!: () => void;
  const polled = new Promise<void>(resolve => { observed = resolve; });
  const responseSchema = { "200": { content: { "application/json": { schema: {
    type: "object", properties: { sha256: { type: "string" } },
  } } } } };
  const server = createServer(async (request, response) => {
    const path = request.url!; calls.push(`${request.method} ${path}`);
    let value: unknown;
    if (path === "/catalog") value = { linkset: [{ anchor: origin, "service-desc": [{ href: origin + "/spec", type: "application/vnd.oai.openapi+json" }] }] };
    else if (path === "/spec") value = { openapi: "3.1.0", info: { title: "Queued compression" },
      servers: [{ url: origin }], paths: {
        "/enqueue": { post: { operationId: "enqueue", requestBody: { content: { "application/json": { schema: {
          type: "object", properties: { document: { type: "string" } }, required: ["document"],
        } } } }, responses: { ...responseSchema, "202": { description: "Pending" } } } },
        "/publish": { post: { operationId: "publish", requestBody: { content: { "application/json": { schema: {
          type: "object", properties: { sha256: { type: "string" } }, required: ["sha256"],
        } } } }, responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { confirmed: { type: "string" } } } } } } } } },
        "/queue/{ticket}": { get: { operationId: "queue", parameters: [{ name: "ticket", in: "path", required: true, schema: { type: "string" } }], responses: { "303": { description: "Complete" } } } },
        "/files/{ticket}": { get: { operationId: "file", parameters: [{ name: "ticket", in: "path", required: true, schema: { type: "string" } }], responses: responseSchema } },
      } };
    else if (path === "/enqueue" && request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk;
      document = JSON.parse(body).document;
      artifact = gzipSync(document);
      response.writeHead(202, { location: "/queue/q1", "retry-after": "0" }); response.end(); return;
    } else if (path === "/publish" && request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk;
      const sha256 = JSON.parse(body).sha256; publications.push(sha256); value = { confirmed: sha256 };
    } else if (path === "/queue/q1") {
      if (!complete) { waiting = response; observed(); return; }
      response.writeHead(303, { location: "/files/q1", "retry-after": "0" }); response.end(); return;
    } else if (path === "/files/q1") value = { sha256: createHash("sha256").update(artifact).digest("hex") };
    else { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": path === "/catalog" ? "application/linkset+json" : "application/json" });
    response.end(JSON.stringify(value));
  });
  const children: ReturnType<typeof spawn>[] = [];
  const child = (phase: string) => {
    const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL("./fixtures/http-resume-client.ts", import.meta.url)), origin, stateFile, phase, mode],
      { env: { PATH: globalThis.process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(process);
    let stdout = "", stderr = "";
    process.stdout!.on("data", chunk => { stdout += chunk; });
    process.stderr!.on("data", chunk => { stderr += chunk; });
    const done = new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>(resolve =>
      process.on("close", (code, signal) => resolve({ code, signal, stdout, stderr })));
    return { process, done };
  };
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const first = child("start");
    await Promise.race([polled, first.done.then(result => { throw new Error("client exited before polling: " + result.stderr); })]);
    const stored = decodeState(JSON.parse(await readFile(stateFile, "utf8")));
    const checkpoint = stored.httpContinuations![0];
    const parent = mode !== "leaf" ? stored.workflowContinuations![0] : undefined;
    if (parent) {
      assert.equal(parent.phase, "waiting");
      assert.equal(parent.next, 0);
      assert.equal(parent.childRunId, checkpoint.runId);
    }
    assert.equal(checkpoint.cursor.used, 1);
    assert.equal(checkpoint.cursor.url, origin + "/queue/q1");
    assert.equal(JSON.stringify(checkpoint).includes(document), false);
    first.process.kill("SIGKILL");
    assert.equal((await first.done).signal, "SIGKILL");
    waiting?.destroy();
    complete = true;
    const before = calls.length;
    const fresh = child("resume");
    const result = await fresh.done;
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.notEqual(report.pid, first.process.pid);
    assert.equal(report.before.status, "pending");
    assert.equal(report.run.status, "completed");
    assert.equal(report.run.verification.status, "checked");
    assert.equal(report.run.resumes, parent?.runId ?? checkpoint.runId);
    assert.equal(mode !== "leaf" ? report.run.output : report.run.output.sha256, createHash("sha256").update(artifact).digest("hex"));
    assert.equal(gunzipSync(artifact).toString(), document);
    assert.equal(report.receipts.intact, true);
    assert.deepEqual(calls.slice(before), ["GET /queue/q1", "GET /files/q1", ...(mode !== "leaf" ? ["POST /publish"] : [])]);
    assert.deepEqual(publications, mode !== "leaf" ? [createHash("sha256").update(artifact).digest("hex")] : []);
    if (mode === "composition") {
      assert.ok(parent!.composition);
      assert.equal(report.run.composition?.published?.slug, "compressed-document");
    }
    assert.equal(calls.filter(c => c === "POST /enqueue").length, 1);
    const final = decodeState(JSON.parse(await readFile(stateFile, "utf8")));
    assert.deepEqual(final.httpContinuations, []);
    assert.deepEqual(final.workflowContinuations, []);
  } finally {
    for (const p of children) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    waiting?.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
