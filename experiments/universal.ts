// E13: the universal interface. Three real capabilities that each speak exactly
// one protocol (DeepWiki: MCP only · countries: GraphQL only · ExchangeRate-API:
// REST only), each reached from three client ecosystems (a plain REST GET, a
// plain GraphQL query, an MCP tools/call): nine cross-protocol combinations
// with no adapter written. Clients here are bare protocol requests, not a
// RightClick X SDK. Then B (Newark) learns A's GraphQL face by introspection.
//   node experiments/universal.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const instances = JSON.parse(readFileSync(".rcx-deploy/instances.json", "utf8")) as Record<string, { url: string; token: string }>;
const tokenFor = new Map(Object.values(instances).map((i) => [i.url, i.token]));
const [A, B] = [instances.a.url, instances.b.url];
const log = (...a: unknown[]) => console.log(...a);
const show = (s: unknown, n = 90) => (typeof s === "string" ? s : JSON.stringify(s) ?? "").replace(/\s+/g, " ").slice(0, n);
const auth = (server: string) => ({ authorization: `Bearer ${tokenFor.get(server)}` });

async function retry<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const v = await fn();
    if (v !== undefined) return v;
    if (attempt >= 5) throw new Error("edge error");
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
/** MCP client: one JSON-RPC tools/call. */
const mcp = (server: string, tool: string, args: Record<string, unknown> = {}) =>
  retry(async () => {
    const res = await fetch(`${server}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...auth(server) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
    const j: any = await res.json().catch(() => null);
    if (!j?.jsonrpc) return undefined;
    if (j.error || j.result.isError) throw new Error(`${tool}: ${j.error?.message ?? j.result.content?.[0]?.text}`);
    return j.result.structuredContent;
  });
/** REST client: one GET. */
const rest = (server: string, path: string, q: Record<string, string>) =>
  retry(async () => {
    const res = await fetch(`${server}${path}?${new URLSearchParams(q)}`, { headers: auth(server) });
    const j: any = await res.json().catch(() => null);
    return j && "ok" in j ? j : undefined;
  });
/** GraphQL client: one POST with a query and variables. */
const gql = (server: string, query: string, variables: Record<string, unknown>) =>
  retry(async () => {
    const res = await fetch(`${server}/graphql`, { method: "POST", headers: { "content-type": "application/json", ...auth(server) }, body: JSON.stringify({ query, variables }) });
    const j: any = await res.json().catch(() => null);
    return j && ("data" in j || "errors" in j) ? j : undefined;
  });

const where = await Promise.all([A, B].map((s) => mcp(s, "context_runtime")));
log(`A ${A} in ${where[0].runtime.region} · B ${B} in ${where[1].runtime.region}\n`);

// Publish one goal per single-protocol capability (A already knows these providers).
await mcp(A, "context_learn", { sources: ["https://mcp.deepwiki.com/mcp", "https://countries.trevorblades.com/"] });
const ROWS = [
  {
    native: "MCP only (DeepWiki)",
    publish: "Codebase answer",
    goal: { have: { repoName: "nodejs/node", question: "In one sentence, what is libuv used for in Node.js?" }, want: "text", intent: "ask question", through: ["mcp:deepwiki:ask-wiki-question"] },
    args: { repoName: "denoland/deno", question: "In one sentence, what is deno_core?" },
    check: (r: unknown) => typeof r === "string" && r.length > 40,
  },
  {
    native: "GraphQL only (countries)",
    publish: "Country capital",
    goal: { have: { country: "JP" }, want: "place", intent: "country capital", through: ["graphql:countries-trevorblades-com:query:country"] },
    args: { country: "KE" },
    check: (r: unknown) => r === "Nairobi",
  },
  {
    native: "REST only (ExchangeRate-API)",
    publish: "Exchange rates",
    goal: { have: { currency: "EUR" }, want: "json", intent: "latest exchange rates", through: ["openapi:exchangerate-api:get-latest-base-currency"], acquire: true },
    args: { currency: "BRL" },
    check: (r: any) => r?.base === "BRL" && typeof r?.rates?.USD === "number",
  },
];

const matrix: any[] = [];
for (const row of ROWS) {
  // Resolve the through-anchor id loosely for the REST row (its operation id comes from the spec).
  const pub = await mcp(A, "context_compose", { ...row.goal, risks: ["read", "external"], run: true, publish: row.publish });
  if (!pub.published) throw new Error(`could not publish ${row.publish}: ${JSON.stringify(pub.executed?.attempts ?? pub.plans?.length)}`);
  const slug = pub.published.slug as string;
  const field = slug.replace(/-([a-z0-9])/g, (_: string, c: string) => c.toUpperCase());
  const vars = Object.entries(row.args);
  const query = `query Q(${vars.map(([k]) => `$${k}: String!`).join(", ")}) { ${field}(${vars.map(([k]) => `${k}: $${k}`).join(", ")}) { result pipeline } }`;

  const t1 = performance.now();
  const viaRest = await rest(A, `/x/${slug}`, row.args as Record<string, string>);
  const restMs = Math.round(performance.now() - t1);
  const t2 = performance.now();
  const viaGql = await gql(A, query, row.args);
  const gqlMs = Math.round(performance.now() - t2);
  const t3 = performance.now();
  const viaMcp = await mcp(A, "context_compose", { ...row.goal, have: row.args, run: true, risks: ["read", "external"] });
  const mcpMs = Math.round(performance.now() - t3);

  const cells = {
    rest: { ok: row.check(viaRest.result), ms: restMs, value: viaRest.result },
    graphql: { ok: row.check(viaGql.data?.[field]?.result), ms: gqlMs, value: viaGql.data?.[field]?.result, errors: viaGql.errors },
    mcp: { ok: row.check(viaMcp.executed?.output), ms: mcpMs, value: viaMcp.executed?.output },
  };
  matrix.push({ native: row.native, published: slug, pipeline: pub.executed?.titles, cells });
  log(`${row.native}  →  published "${row.publish}" (${pub.executed?.titles?.join(" → ")})`);
  for (const [client, c] of Object.entries(cells)) log(`   ${c.ok ? "✓" : "✗"} ${client.padEnd(7)} client  ${String(c.ms).padStart(6)}ms  ${show(c.value)}`);
}

// RightClick X ↔ RightClick X over GraphQL: B learns A's GraphQL face by introspection.
const lb = await mcp(B, "context_learn", { source: `${A}/graphql` });
const caps = await mcp(B, "context_graph", { op: "search", query: "codebase answer", limit: 1 });
const capId = (caps.result ?? caps)[0].id;
const t4 = performance.now();
const fromB = await mcp(B, "context_run", { id: capId, args: { repoName: "vercel/next.js", question: "In one sentence, what is Turbopack?" }, verify: [{ op: "length_gt", path: "result", value: 40 }] });
log(`\nB (${where[1].runtime.region}) learned A's GraphQL by introspection (+${lb.totalNewCapabilities} capabilities) and ran ${capId}`);
log(`   ${fromB.verification.status === "verified" ? "✓" : "✗"} ${Math.round(performance.now() - t4)}ms  ${show(fromB.output?.result, 160)}`);

const ok = matrix.flatMap((m) => Object.values(m.cells)).filter((c: any) => c.ok).length;
log(`\n${ok}/9 cross-protocol combinations verified; adapters written: 0`);
mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/E13-universal.json", JSON.stringify({ at: new Date().toISOString(), placement: where.map((w) => w.runtime.region), matrix, fromB: { capability: capId, verification: fromB.verification.status, result: show(fromB.output?.result, 600) }, verified: ok }, null, 2));
