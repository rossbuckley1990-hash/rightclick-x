import { writeFile } from "node:fs/promises";
import type { ReconciliationInput } from "../../src/reconciliation.ts";
const fields = ["account", "period", "currency", "unit", "basis", "amountMinor"];
const identifier = (s: unknown): s is string => typeof s === "string" && /^[_A-Za-z][_0-9A-Za-z]*$/.test(s);
export interface ReadClient { protocol: "rest" | "graphql"; path: string; field?: string; selection?: string[] }
export function clientFromSchema(doc: any): ReadClient {
  if (doc.openapi) {
    const candidates: ReadClient[] = [];
    for (const [path, entry] of Object.entries<any>(doc.paths ?? {})) {
      const get = entry.get, properties = get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties;
      if (properties && fields.every(f => Object.hasOwn(properties, f)) &&
          ["account", "period"].every(n => get.parameters?.some((p: any) => p.name === n && p.in === "query" && p.schema?.type === "string")))
        candidates.push({ protocol: "rest", path });
    }
    if (candidates.length !== 1) throw new Error("unambiguous compatible GET unavailable");
    return candidates[0];
  }
  const schema = doc.data?.__schema;
  const query = schema?.types?.find((t: any) => t.name === schema.queryType?.name);
  const candidates = query?.fields?.filter((f: any) => {
    const result = schema.types.find((t: any) => t.name === f.type.name);
    return identifier(f.name) && fields.every(n => result?.fields?.some((p: any) => p.name === n)) &&
      ["account", "period"].every(n => f.args?.some((p: any) => p.name === n && p.type?.ofType?.name === "String"));
  }) ?? [];
  if (candidates.length !== 1) throw new Error("unambiguous compatible Query unavailable");
  return { protocol: "graphql", path: "/graphql", field: candidates[0].name, selection: [...fields] };
}
export function admitModelSelection(proposal: any, doc: unknown): ReadClient {
  const current = clientFromSchema(doc);
  if (current.protocol !== "graphql" || !proposal || Object.keys(proposal).sort().join() !== "bindings,field,selection" ||
      proposal.field !== current.field || !Array.isArray(proposal.selection) || [...proposal.selection].sort().join() !== [...fields].sort().join() ||
      Object.keys(proposal.bindings ?? {}).sort().join() !== "account,period" || proposal.bindings.account !== "account" || proposal.bindings.period !== "period")
    throw new Error("model proposal incompatible with unchanged business and authority contract");
  return current;
}
export function documentFor(client: ReadClient) {
  if (!identifier(client.field) || !client.selection?.every(identifier)) throw new Error("invalid query names");
  return `query RightClick($account: String!, $period: String!) { ${client.field}(account: $account, period: $period) { ${client.selection.join(" ")} } }`;
}
export async function generateClient(doc: unknown, file: string) {
  const client = clientFromSchema(doc);
  // Generated code contains validated static metadata only, never provider source code.
  await writeFile(file, `// Deterministically generated from current public contract.\nexport default ${JSON.stringify(client)};\n`);
  return (await import(new URL(`file://${file}`).href)).default as ReadClient;
}
export function maintainedClient(): ReadClient {
  return { protocol: "graphql", path: "/graphql", field: "settlementObservation", selection: [...fields] };
}
export async function readWith(client: ReadClient, gateway: string, input: ReconciliationInput, request: typeof fetch) {
  if (client.protocol === "rest") return request(`${gateway}${client.path}?${new URLSearchParams({ ...input })}`).then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const response = await request(`${gateway}${client.path}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: documentFor(client), variables: input }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors || !body.data?.[client.field!]) throw new Error("unconfirmed GraphQL result");
  return body.data[client.field!];
}
