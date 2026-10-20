// One actual runtime for public composition and a separately enforced local
// effect. This development assembly is not the completed seven-act challenge.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { RpcPeer, startContainedSession, presentSession, holdPresentation, type Wire } from "./challenge-session.ts";
import { publicReadTransport, type PublicSource } from "./public-read-transport.ts";
import { TransportRefused } from "../../src/reflectors/net.ts";
import { actenonAuthorityEvidence } from "../../integrations/actenon/authority-evidence.ts";

const [configFile, directory, image, python, hold] = process.argv.slice(2);
if (!configFile || !directory || !image?.startsWith("sha256:") || !python)
  throw new Error("usage: living-session.ts CONFIG NEW_OUTPUT IMAGE_ID AUDITED_PYTHON [hold]");
const root = fileURLToPath(new URL("../../", import.meta.url)), output = resolve(directory);
mkdirSync(output, { recursive: false });
const save = (name: string, value: unknown) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n");
const config = JSON.parse(readFileSync(configFile, "utf8")), sources: PublicSource[] = config.sources;
const publicOrigins = [...new Set(sources.map(s => new URL(s.url).origin))];
const operatorCatalog = "https://environment.invalid/catalog";
const network: any[] = [], toolCalls: any[] = [];
const publicFetch = publicReadTransport(sources, (row, body) => {
  network.push(row);
  if (body) writeFileSync(join(output, `public-response-${row.id}.bin`), body);
  save("public-network", network);
});
save("provenance", { revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workingChanges: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }), config,
  node: process.version, image, scope: "same-author integrated development session; not final holdout, fresh model or complete challenge" });
const child = spawn(python, ["-B", join(root, "experiments/actenon/challenge-boundary.py"), join(output, "boundary")],
  { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", data => appendFileSync(join(output, "boundary.stderr.log"), data));
const boundary = new RpcPeer(child, join(output, "operator-session.jsonl"));
let session: Awaited<ReturnType<typeof startContainedSession>> | undefined;
let view: Awaited<ReturnType<typeof presentSession>> | undefined;
let exposeProtected = false, totalRequests = 0;
try {
  const ready = await boundary.ready;
  const protectedOrigin = ready.origin as string;
  save("boundary-ready", ready);
  const authorityEvidence = actenonAuthorityEvidence({ python, attestations: join(output, "boundary/attestations.jsonl"),
    publicKey: join(output, "boundary/public.json"), origin: protectedOrigin,
    issuer: "resource-edge", boundary: "Disposable compression resource" });
  session = await startContainedSession({ output, image,
    authorityEvidence,
    config: { origins: [...publicOrigins, protectedOrigin, new URL(operatorCatalog).origin],
      environment: { catalogs: [operatorCatalog], origins: [...publicOrigins, protectedOrigin] } },
    onTool: row => { toolCalls.push(row); save("tool-calls", toolCalls); },
    fetch: async (wire: Wire) => {
      if (++totalRequests > 64) return { refused: true, reason: "session request budget exhausted" };
      const origin = new URL(wire.url).origin;
      if (wire.url === operatorCatalog && wire.method === "GET" && wire.body === "") {
        const links = sources.filter(s => s.kind === "openapi").map(s => ({ href: s.url, type: "application/vnd.oai.openapi+json" }));
        if (exposeProtected) links.push({ href: protectedOrigin + "/openapi.json", type: "application/vnd.oai.openapi+json" });
        return { response: { status: 200, headers: { "content-type": "application/linkset+json" },
          body: Buffer.from(JSON.stringify({ linkset: [{ "service-desc": links }] })).toString("base64") } };
      }
      if (origin === protectedOrigin) return boundary.call("fetch", { request: wire });
      if (!publicOrigins.includes(origin)) return { refused: true, reason: "origin outside operator-selected sources" };
      try {
        const response = await publicFetch(wire.url, { method: wire.method, headers: wire.headers,
          ...(!["GET", "HEAD"].includes(wire.method) ? { body: Buffer.from(wire.body, "base64") } : {}) });
        return { response: { status: response.status, headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()).toString("base64") } };
      } catch (error) {
        return error instanceof TransportRefused ? { refused: true, reason: error.message } : { reason: "public read outcome unresolved" };
      }
    } });
  view = await presentSession(session.peer);
  save("presentation", { url: view.url, scope: "loopback only; ordinary runtime dashboard and thirteen-tool MCP handler; no issuer controls" });
  process.stdout.write(JSON.stringify({ op: "presentation", url: view.url, output }) + "\n");
  const tool = async (name: string, args: object = {}) => {
    const reply: any = await (await session!.peer.http("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
    if (reply.error) throw new Error(JSON.stringify(reply.error));
    return JSON.parse(reply.result.content[0].text);
  };
  save("baseline", await session.peer.call("snapshot"));
  // OpenAPI sources arrive through the existing environment catalog. GraphQL
  // still requires an explicit source declaration; do not call this universal discovery.
  save("environment-public", await tool("context_research"));
  const explicit = sources.filter(s => s.kind !== "openapi");
  if (explicit.length) save("explicit-sources", await tool("context_learn", { sources: explicit.map(s => s.url),
    kinds: Object.fromEntries(explicit.map(s => [s.url, s.kind])) }));
  save("public-learned", await session.peer.call("snapshot"));
  const result = await tool("context_compose", { ...config.goals[0], risks: ["read"] });
  save("goal-0", result);
  if (result.executed?.status !== "completed") throw new Error("public outcome did not complete");
  exposeProtected = true;
  save("environment-protected", await tool("context_research"));
  const acquired = await session.peer.call("snapshot");
  save("protected-learned", acquired);
  const submit = acquired.graph.capabilities.find((c: any) => c.invoke.kind === "http" &&
    c.invoke.method === "POST" && c.invoke.url.startsWith(protectedOrigin + "/") && c.inputs.some((p: any) => p.name === "document"));
  if (!submit) throw new Error("protected operation was not discovered");
  const args = { label: "first", document: "A document written only by the explicitly authorized living session." };
  save("protected-task", args);
  const before = await boundary.call("snapshot");
  const denied = await tool("context_run", { id: submit.id, args });
  save("unauthorized", denied);
  // An operator-owned direct negative control obtains a signed refusal from the
  // resource itself. It is not mislabelled as the agent's broker refusal.
  save("direct-refusal", await boundary.call("probe"));
  const afterDenied = await boundary.call("snapshot");
  if (denied.status !== "failed" || !denied.refusal || JSON.stringify(before.effects) !== JSON.stringify(afterDenied.effects))
    throw new Error("unauthorized effect was not refused without a side effect");
  const exact: Wire = { method: "POST", url: protectedOrigin + "/jobs", headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(args)).toString("base64") };
  save("authorization", await boundary.call("authorize", { requests: [exact] }));
  const changed = await tool("context_run", { id: submit.id, args: { ...args, document: args.document + " Changed." } });
  save("changed-parameters", changed);
  if (changed.status !== "failed" || !changed.refusal) throw new Error("changed parameters did not require fresh authority");
  const effect = await tool("context_compose", { have: { label: { type: "text", value: args.label },
    document: { type: "text", value: args.document } }, want: "hash", through: [submit.id],
    run: true, publish: "Compressed document digest", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] });
  save("protected-composition", effect);
  if (effect.executed?.status !== "completed") throw new Error("authorized protected outcome did not complete");
  const final = await session.peer.call("snapshot");
  save("final", final);
  save("effects", await boundary.call("snapshot"));
  save("authority-evidence", await (await session.peer.http("/api/authority-evidence")).json());
  save("revocation", await boundary.call("revoke"));
  const revoked = await tool("context_run", { id: effect.published.id, args });
  save("revoked-run", revoked);
  if (revoked.status !== "failed" || !revoked.refusal) throw new Error("historical evidence appeared to authorize a revoked action");
  save("effects-after-revoke", await boundary.call("snapshot"));
  save("revoked-evidence", await (await session.peer.http("/api/authority-evidence")).json());
  save("after-revocation", await session.peer.call("snapshot"));
  save("summary", { status: "PARTIAL", publicOutcome: "completed", protectedOutcome: "completed",
    publicGoal: result.published, protectedGoal: effect.published, totalRequests, toolCalls: toolCalls.length,
    protectedOutput: effect.executed.output, stateSha256: createHash("sha256").update(JSON.stringify(final.state)).digest("hex"),
    remaining: ["separate outcome checking", "fresh-model inheritance", "compatible/incompatible change", "authority-to-runtime call linkage", "independent-author holdout", "matched economics"] });
  if (hold === "hold") {
    process.stdout.write(JSON.stringify({ op: "holding", url: view.url,
      instruction: "Closes on stdin line, EOF, signal or after five minutes. Use a terminal for live inspection." }) + "\n");
    await holdPresentation();
  }
} catch (error) {
  save("failure", { error: String(error), totalRequests, toolCalls: toolCalls.length });
  if (session) {
    try { save("failure-snapshot", await session.peer.call("snapshot")); }
    catch (snapshotError) { save("failure-snapshot-error", { error: String(snapshotError) }); }
  }
  try { save("failure-effects", await boundary.call("snapshot")); }
  catch (snapshotError) { save("failure-effects-error", { error: String(snapshotError) }); }
  throw error;
} finally {
  try { await view?.close(); }
  finally {
    try { await session?.close(); }
    finally {
      try { await boundary.call("close"); child.stdin.end(); await boundary.exited; }
      finally { child.kill("SIGTERM"); }
    }
  }
}
