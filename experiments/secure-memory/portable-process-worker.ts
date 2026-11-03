// Synthetic separate-process actor for the production portable-goal APIs.
// No external service or model is called; the host supplies the mock fetcher.
import { readFile, writeFile } from "node:fs/promises";
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";

const [mode, statePath, artifactPath] = process.argv.slice(2);
if (!mode || !statePath || !artifactPath) throw new Error("usage: portable-process-worker MODE STATE ARTIFACT");
const notes = "https://notes.test", checker = "https://checker.test";
const metadataCanary = "synthetic-metadata-canary-4927";
const values: Record<string, string> = { a: "alpha note", b: "beta note" };
const observed: string[] = [];
const spec = (origin: string, witness: boolean) => ({ openapi: "3.0.0", info: { title: witness ? "Fixture Checker" : "Fixture Notes", version: "1", description: metadataCanary }, servers: [{ url: origin }],
  paths: witness ? { "/check": { get: { operationId: "checkNote", summary: "Check note", parameters: ["id", "text"].map(name => ({ name, in: "query", required: true, schema: { type: "string" } })),
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } } } } }
    : { "/notes/{id}": { get: { operationId: "getNote", summary: "Get note", description: metadataCanary, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } } } } } } });
const fetcher: typeof fetch = async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  observed.push(`${url.origin}${url.pathname}`);
  if (url.pathname === "/openapi.json") return Response.json(spec(url.origin, url.origin === checker));
  if (url.origin === notes && url.pathname.startsWith("/notes/")) return Response.json({ text: values[url.pathname.split("/").pop()!] ?? "" });
  if (url.origin === checker && url.pathname === "/check") return Response.json({ valid: values[url.searchParams.get("id") ?? ""] === url.searchParams.get("text") });
  throw new Error("unexpected synthetic fixture request");
};
const denied = mode === "denied";
const rc = await RightClick.create({ store: new FileStore(statePath), directories: [], fetch: fetcher,
  network: { origins: [notes, checker] }, authority: { publish: "any", shareEvidence: true,
    ...(denied ? { execution: { deniedCapabilities: ["openapi:fixture-notes:getnote"] } } : {}) } });
await rc.learn({ sources: [`${notes}/openapi.json`, `${checker}/openapi.json`] });
await rc.flush();
const operation = rc.graph.list().find(c => c.title === "Get note")?.id;
const witness = rc.graph.list().find(c => c.title === "Check note")?.id;
if (!operation || !witness) throw new Error("fixture operations were not learned");
if (mode === "create") {
  const created = await rc.compose({ have: { id: { type: "text", value: "a" } }, want: "json", through: [operation], run: true,
    publish: "Portable note lookup", origins: [notes, checker], witnesses: [{ capability: witness, args: { id: { input: "id" }, text: { output: "text" } },
      verify: [{ op: "equals", path: "valid", value: true }] }] });
  if (!created.published) throw new Error(`fixture publication refused: ${created.publishRefused ?? "unknown"}`);
  await rc.flush();
  const artifact = (rc as any).exportPortableGoal("portable-note-lookup", {}, { approveDefinition: true, portableFixedInputs: [] });
  const serialized = JSON.stringify(artifact);
  await writeFile(artifactPath, serialized, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ pid: process.pid, status: created.executed?.status, verification: created.executed?.verification.status,
    durable: created.published.durable, graphHasMetadataCanary: JSON.stringify(rc.graph.list()).includes(metadataCanary),
    artifactHasMetadataCanary: serialized.includes(metadataCanary), observed }));
} else {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const imported = await (rc as any).importPortableGoal(artifact, { approveDefinition: true });
  const trust = rc.published.get("portable-note-lookup")?.trust;
  observed.length = 0;
  const result = await rc.run(imported.id, { id: "b" });
  await rc.flush();
  process.stdout.write(JSON.stringify({ pid: process.pid, discovered: !!rc.graph.get(imported.id), status: result.status,
    output: result.output, verification: result.verification?.status, trust, observed, error: result.error }));
}
