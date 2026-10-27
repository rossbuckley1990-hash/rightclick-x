// Deterministic synthetic actor, invoked in a distinct OS process by acceptance.test.ts.
// The HTTP fetch function below is a test double; no agent or real service runs here.
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { dispatch } from "../../src/interface/tools.ts";

const [mode, statePath] = process.argv.slice(2);
const notes = "http://127.0.0.1:39001", witness = "http://127.0.0.1:39002";
const observed: string[] = [];
const truth: Record<string, string> = { a: "alpha note", b: "beta note" };
const schema = (origin: string, kind: "notes" | "witness") => ({
  openapi: "3.0.0", info: { title: kind, version: ["compatible", "incompatible", "removed"].includes(mode) ? "2" : "1" }, servers: [{ url: origin }],
  paths: mode === "removed" && kind === "witness" ? {} : kind === "notes" ? { "/notes/{id}": { get: { operationId: "getNote", summary: "Get a note",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } } } } } }
    : { "/check": { get: { operationId: "checkNote", summary: "Check note independently",
    parameters: ["id", "text"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } } },
});
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input)); observed.push(`${url.origin}${url.pathname}`);
  if (url.pathname === "/openapi.json") return Response.json(schema(url.origin, url.origin === notes ? "notes" : "witness"));
  if (url.origin === notes && url.pathname.startsWith("/notes/")) return Response.json({ text: truth[url.pathname.split("/").pop()!] ?? "" });
  if (url.origin === witness && url.pathname === "/check") return Response.json({ valid: mode !== "incompatible" && truth[url.searchParams.get("id") ?? ""] === url.searchParams.get("text") });
  throw new Error("unexpected fixture request");
};
const allowed = mode === "denied" ? [notes] : [notes, witness];
const rc = await RightClick.create({ directories: [], store: new FileStore(statePath),
  network: { blockPrivate: false, origins: allowed }, fetch: fetcher });
if (mode === "create") {
  await dispatch(rc, "context_learn", { sources: [`${notes}/openapi.json`, `${witness}/openapi.json`] });
  const operation = rc.graph.list().find(c => c.title === "Get a note")!.id;
  const checker = rc.graph.list().find(c => c.title === "Check note independently")!.id;
  const result = await rc.compose({ have: { id: { type: "text", value: "a" } }, want: "json", through: [operation], run: true,
    publish: "Note lookup", origins: [notes, witness],
    witnesses: [{ capability: checker, args: { id: { input: "id" }, text: { output: "text" } },
      verify: [{ op: "equals", path: "valid", value: true }] }] });
  await rc.flush();
  process.stdout.write(JSON.stringify({ mode, pid: process.pid, status: result.executed?.status, verification: result.executed?.verification.status,
    durable: result.published?.durable, observed }));
} else {
  if (["compatible", "incompatible", "removed"].includes(mode)) {
    // Refresh a changed fixture contract, with no handwritten changes to the saved goal.
    await rc.learn({ source: `${notes}/openapi.json` });
    await rc.learn({ source: `${witness}/openapi.json` });
  }
  const discovered = !!rc.graph.get("goal:note-lookup");
  const result: any = await dispatch(rc, "context_run", { id: "goal:note-lookup", args: { id: "b" }, view: { full: true } });
  await rc.flush();
  process.stdout.write(JSON.stringify({ mode, pid: process.pid, discovered, status: result.status, output: result.output,
    verification: result.verification?.status, error: result.error, observed, runId: result.runId }));
}
