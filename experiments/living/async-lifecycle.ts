// Local HTTP integration experiment. Both service families are development
// fixtures. Worker processes use only the target runtime's public API.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [mode, rootArg, outArg, originArg, textArg] = process.argv.slice(2);
const root = resolve(rootArg ?? "."), out = resolve(outArg ?? ".");
const repository = fileURLToPath(new URL("../../", import.meta.url));
const save = (name: string, value: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
if (mode === "worker") {
  const { RightClick } = await import(pathToFileURL(join(root, "src/runtime.ts")).href);
  const { FileStore } = await import(pathToFileURL(join(root, "src/entry/node-host.ts")).href);
  const reuse = textArg === "second";
  const rc = await RightClick.create({ directories: [], sandbox: null,
    store: new FileStore(join(out, "state.json")),
    network: { blockPrivate: true, allow: [originArg], origins: [originArg] },
    authority: { investigate: [], execute: [], execution: { allowedOrigins: [originArg], allowedRisks: ["read", "write"] }, publish: "checked" },
    // The second process intentionally has no discovery configuration.
    ...(!reuse ? { environment: { catalogs: [`${originArg}/catalog`] } } : {}),
  });
  const start = performance.now();
  let outcome: any;
  if (reuse) outcome = await rc.run("goal:rendered-character-count", { text: "a different input" });
  else {
    const research = await rc.research({});
    save("research", research);
    // Task anchors select operations. No reflection objects, output bindings,
    // intermediate identifiers, generated programs or polling logic are supplied.
    const anchors = rc.graph.list().filter((c: any) => ["Render text", "Count characters"].includes(c.title)).map((c: any) => c.id);
    if (anchors.length !== 2) throw new Error(`expected two task operations, found ${anchors.length}`);
    outcome = await rc.compose({ have: { text: "first input" }, want: "number", through: anchors,
      run: true, publish: "Rendered character count", verify: [{ op: "type", value: "number" }, { op: "gt", value: 0 }] });
  }
  await rc.flush();
  save(reuse ? "reuse" : "cold", { pid: process.pid, durationMs: performance.now() - start,
    rss: process.memoryUsage().rss, graphSize: rc.graph.list().length, outcome, receipts: rc.chain.receipts,
    chain: await rc.verifyReceipts() });
  if ((reuse ? outcome.status : outcome.executed?.status) !== "completed") process.exitCode = 1;
} else if (mode === "run") {
  mkdirSync(out, { recursive: false });
  // Optional fourth argument pins an older source export for the matched baseline.
  const revision = originArg ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "src"], { cwd: repository, encoding: "utf8" }).trim().split("\n");
  const sourceHashes = Object.fromEntries(paths.map(path => {
    const content = readFileSync(join(root, path));
    const committed = execFileSync("git", ["show", `${revision}:${path}`], { cwd: repository });
    if (!content.equals(committed)) throw new Error(`unfrozen source: ${path}`);
    return [path, createHash("sha256").update(content).digest("hex")];
  }));
  const events: any[] = [], jobs = new Map<string, { text: string; polls: number }>();
  let origin = "";
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, origin).pathname;
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString(), body = raw ? JSON.parse(raw) : undefined;
    events.push({ method: req.method, path, ...(body ? { body } : {}) });
    const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    const stringBody = { content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } } } };
    const parameter = [{ in: "path", name: "ticket", required: true, schema: { type: "string" } }];
    if (path === "/catalog") return json({ linkset: [{ anchor: origin, "service-desc": [
      { href: `${origin}/render.json`, type: "application/vnd.oai.openapi+json" },
      { href: `${origin}/count.json`, type: "application/vnd.oai.openapi+json" },
    ] }] });
    if (path === "/render.json") return json({ openapi: "3.1.0", info: { title: "Renderer" }, servers: [{ url: origin }], paths: {
      "/render": { post: { operationId: "render", summary: "Render text", requestBody: stringBody,
        responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } }, "202": { description: "Accepted" } } } },
      "/jobs/{ticket}": { get: { operationId: "monitor", parameters: parameter, responses: { "202": { description: "Pending" }, "303": { description: "See result" } } } },
      "/artifacts/{ticket}": { get: { operationId: "result", parameters: parameter, responses: { "200": { content: { "text/plain": { schema: { type: "string" } } } } } } },
    } });
    if (path === "/count.json") return json({ openapi: "3.1.0", info: { title: "Counter" }, servers: [{ url: origin }], paths: {
      "/count": { post: { operationId: "count", summary: "Count characters", requestBody: stringBody,
        responses: { "200": { content: { "application/json": { schema: { type: "number" } } } } } } },
    } });
    if (path === "/render" && req.method === "POST") {
      const id = String(jobs.size + 1); jobs.set(id, { text: `RENDERED: ${body.text.toUpperCase()}`, polls: 0 });
      res.writeHead(202, { location: `/jobs/${id}`, "retry-after": "0" }); return res.end();
    }
    const id = path.split("/").at(-1)!; const job = jobs.get(id);
    if (path.startsWith("/jobs/") && job) {
      job.polls++; res.writeHead(job.polls === 1 ? 202 : 303, { ...(job.polls === 1 ? {} : { location: `/artifacts/${id}` }), "retry-after": "0" }); return res.end();
    }
    if (path.startsWith("/artifacts/") && job) { res.setHeader("content-type", "text/plain"); return res.end(job.text); }
    if (path === "/count" && req.method === "POST") return json(body.text.length);
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  save("provenance", { revision, node: process.version, sourceHashes, origin,
    scope: "controlled development HTTP services; separate process, not fresh model or independent author holdout" });
  try {
    for (const stage of ["first", "second"]) {
      const start = events.length;
      const code = await new Promise<number | null>((r, reject) => {
        const p = spawn(process.execPath, [fileURLToPath(import.meta.url), "worker", root, out, origin, stage], { stdio: ["ignore", "pipe", "pipe"] });
        const deadline = setTimeout(() => p.kill("SIGTERM"), 30_000);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        p.stdout.on("data", d => stdout.push(d)); p.stderr.on("data", d => stderr.push(d));
        p.on("error", reject);
        p.on("exit", code => {
          clearTimeout(deadline);
          writeFileSync(join(out, `${stage}.stdout.log`), Buffer.concat(stdout));
          writeFileSync(join(out, `${stage}.stderr.log`), Buffer.concat(stderr));
          save(`${stage}-transport`, { code, events: events.slice(start) }); r(code);
        });
      });
      if (code !== 0) { process.exitCode = 1; break; }
    }
    save("resource-state", { jobs: [...jobs.entries()], events });
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
} else throw new Error("usage: async-lifecycle.ts run FROZEN_SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY [REVISION]");
