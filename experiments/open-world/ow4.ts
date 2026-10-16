// OPEN-WORLD EXPERIMENT 4: adaptation across a real network boundary.
// RightClick X (frozen build, local) ↔ a CONTROLLED, owned, disposable service
// deployed to Cloudflare Workers (free tier). The task never changes; the test
// infrastructure changes the service's contract four times (incl. two protocol
// changes and a rollback), then deletes the deployed service, then restores it.
// The task-performing client speaks only MCP (stdio) to RightClick X.
//   node experiments/open-world/ow4.ts

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { translate } from "../../demo/services.ts";

const CFG = "experiments/open-world/service/wrangler.toml";
const log = (...a: unknown[]) => console.log(...a);
const ms = (t: number) => Math.round(performance.now() - t);
const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const wrangler = (args: string[], input?: string) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", input, stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "pipe"] });
const adminToken = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
const ev: Record<string, any> = {
  experiment: "OW4",
  hypothesis: "RightClick X keeps an unchanged task working across breaking contract changes of a real network service, withdraws it when it disappears, and rediscovers it when restored, without integration-code changes.",
  build,
  service: "CONTROLLED TEST SERVICE (owned, disposable): rcx-ow-service on Cloudflare Workers",
  rounds: [],
};

// ---------------------------------------------------------------- deploy (test infrastructure)
async function deploy(): Promise<string> {
  const out = wrangler(["deploy", "-c", CFG]);
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(out)![0];
  wrangler(["secret", "put", "ADMIN_TOKEN", "-c", CFG], adminToken);
  await stable(url, true);
  return url;
}
/**
 * A new or deleted workers.dev route propagates across Cloudflare's edge for a
 * while (error 1042 flaps). Wait for N consecutive consistent answers before
 * involving RightClick X, so the experiment measures RightClick X, not propagation.
 */
async function stable(url: string, up: boolean, n = 5) {
  let streak = 0;
  for (let i = 0; i < 150 && streak < n; i++) {
    const r = await fetch(`${url}/__admin/version`, { headers: { authorization: `Bearer ${adminToken}` } }).catch(() => null);
    streak = !!r?.ok === up ? streak + 1 : 0;
    await new Promise((res) => setTimeout(res, 2000));
  }
  if (streak < n) throw new Error(`service did not become stably ${up ? "available" : "unavailable"}`);
}
const setVersion = (url: string, version: number) => fetch(`${url}/__admin/version`, { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ version }) });
/** Harness-side snapshot of the contract the service currently advertises. */
async function contract(url: string) {
  const o = await fetch(`${url}/openapi.json`);
  if (o.ok) return { protocol: "openapi", paths: Object.keys(((await o.json()) as any).paths) };
  const g = await fetch(`${url}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ __schema { queryType { name } types { name fields { name args { name } } } } }" }) });
  if (g.ok) return { protocol: "graphql", query: ((await g.json()) as any).data.__schema.types.find((t: any) => t.name === "Query")?.fields };
  const m = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  if (m.ok) return { protocol: "mcp", tools: (((await m.json()) as any).result?.tools ?? []).map((t: any) => ({ name: t.name, inputs: Object.keys(t.inputSchema.properties) })) };
  return { protocol: "none", status: [o.status, g.status, m.status] };
}

// ---------------------------------------------------------------- MCP client (stdio)
const dir = mkdtempSync(`${tmpdir()}/rcx-ow4-`);
const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], { env: { ...process.env, RCX_STATE_FILE: `${dir}/state.json`, RCX_MCP_LOG: `${dir}/mcp-calls.jsonl` }, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map<number, (v: any) => void>();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
let id = 0;
const rpc = (method: string, params?: unknown): Promise<any> => new Promise((res) => (pending.set(++id, res), child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")));
const call = async (name: string, a: Record<string, unknown> = {}) => {
  const r = await rpc("tools/call", { name, arguments: a });
  if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content?.[0]?.text}`);
  return r.result.structuredContent;
};
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ow4-harness", version: "1" } });

const TEXT = "Hello world. The weather is sunny today.";
const LANG = "es";
const expected = translate(TEXT, LANG); // documented behaviour of the controlled service
const goal = { have: { text: TEXT, language: LANG }, want: "text", intent: "summary translated", verify: [{ op: "contains", value: "Hola mundo" }], run: true };
const providers = async () => {
  const p = await call("context_providers");
  return ((p.result ?? p) as any[]).map((x) => x.id);
};
async function round(label: string, url: string) {
  const snapshot = await contract(url);
  const t = performance.now();
  const r = await call("context_compose", goal);
  const took = ms(t);
  const verified = r.executed?.status === "completed" && r.executed.output === expected;
  const row = {
    label,
    contract: snapshot,
    status: r.executed?.status ?? "no plan",
    output: r.executed?.output,
    expected,
    verified,
    pipeline: r.executed?.titles,
    healing: r.executed?.attempts?.map((a: any) => a.healing).filter(Boolean),
    crystallized: r.crystallized?.id,
    ms: took,
    providers: await providers(),
  };
  ev.rounds.push(row);
  log(`${verified ? "✓" : row.status === "completed" ? "✗" : "·"} ${label.padEnd(34)} ${snapshot.protocol.padEnd(8)} ${String(took).padStart(5)}ms  ${row.status}${row.healing?.length ? `  ↻ ${row.healing.join(" | ").slice(0, 120)}` : ""}`);
  return row;
}

// ---------------------------------------------------------------- run
log(`build ${build.slice(0, 10)} · deploying the controlled service…`);
const url = await deploy();
await setVersion(url, 1);
ev.endpoint = url;
log(`service: ${url}\n`);
const t0 = performance.now();
const learned = await call("context_learn", { source: `${url}/` });
ev.discovery = { ms: ms(t0), probes: learned.results[0]?.probes };
await round("v1 REST (initial)", url);
for (const [v, label] of [[2, "v2 REST: renamed path/fields, nested"], [3, "v3 moved to GraphQL"], [4, "v4 moved to MCP"], [1, "rollback to v1 REST"]] as const) {
  await setVersion(url, v);
  await round(label, url);
}

log("\ndeleting the deployed service (wrangler delete)…");
wrangler(["delete", "-c", CFG, "--force"], "y\n");
await stable(url, false);
const gone = await round("service deleted", url);
ev.withdrawal = { status: gone.status, honest: gone.status !== "completed", providerStillListed: gone.providers.some((p: string) => p.includes("polyglot")) };

log("\nrestoring the service (redeploy)…");
await deploy();
await setVersion(url, 1);
const tr = performance.now();
await call("context_learn", { source: `${url}/` });
const back = await round("restored + rediscovered", url);
ev.rediscovery = { ms: ms(tr), verified: back.verified };

child.stdin.end();
const changes = ev.rounds.slice(1, 5);
ev.verdict = ev.rounds[0].verified && changes.every((r: any) => r.verified) && ev.withdrawal.honest && !ev.withdrawal.providerStillListed && back.verified ? "PASS" : "FAIL";
ev.finishedAt = new Date().toISOString();
log(`\nVERDICT: ${ev.verdict}`);
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/ow4-network-adaptation.json", JSON.stringify(ev, null, 2));
