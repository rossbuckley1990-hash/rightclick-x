// Source discovery: hand RightClick X any URL and it works out what is there.
//
// Probes run in parallel: the URL itself (OpenAPI? GraphQL? MCP? a RightClick
// peer? a web page with forms?), plus well-known locations at the origin.
// Everything found is reflected; page hints are followed one level deep.

import type { Capability, Reflection } from "../core/types.ts";
import { INTROSPECTION_QUERY, isIntrospection, reflectGraphQL } from "./graphql.ts";
import { McpClient, reflectMcpTools } from "./mcp.ts";
import { readBody, request, slug, type Net } from "./net.ts";
import { isOpenAPI, reflectOpenAPI } from "./openapi.ts";
import { reflectWeb } from "./web.ts";

export interface Discovery {
  reflections: Reflection[];
  probes: Array<{ url: string; kind: string; ok: boolean; detail?: string }>;
}

const WELL_KNOWN = [
  "/.well-known/rightclick.json",
  "/openapi.json",
  "/.well-known/openapi.json",
  "/swagger.json",
  "/api/openapi.json",
  "/graphql",
  "/mcp",
];

export async function discover(net: Net, source: string, opts: { deep?: boolean; mcp?: (url: string) => McpClient } = {}): Promise<Discovery> {
  const url = new URL(source);
  const probes: Discovery["probes"] = [];
  const found = new Map<string, Reflection>();
  const keep = (r: Reflection | null) => {
    if (r && (r.capabilities.length || r.provider.source !== "web")) found.set(r.provider.id, r);
  };

  const direct = await probeUrl(net, url.toString(), probes, opts);
  for (const r of direct.reflections) keep(r);

  const isRoot = url.pathname === "/" || url.pathname === "";
  if ((isRoot || opts.deep) && !direct.definitive) {
    const extra = await Promise.all(
      WELL_KNOWN.map((p) => probeUrl(net, new URL(p, url.origin).toString(), probes, { ...opts, quiet: true })),
    );
    const all = extra.flatMap((e) => e.reflections);
    // Another RightClick X instance: federate its graph, not its own context_* tools.
    const peer = all.find((r) => r.provider.source === "peer");
    for (const r of peer ? [peer] : all) keep(r);
  }
  for (const hint of direct.hints.slice(0, 5)) {
    const e = await probeUrl(net, hint, probes, opts);
    for (const r of e.reflections) keep(r);
  }
  return { reflections: [...found.values()], probes };
}

async function probeUrl(
  net: Net,
  url: string,
  probes: Discovery["probes"],
  opts: { mcp?: (url: string) => McpClient; quiet?: boolean },
): Promise<{ reflections: Reflection[]; hints: string[]; definitive: boolean }> {
  const reflections: Reflection[] = [];
  let hints: string[] = [];
  // 1. GET: specs, peers and pages.
  try {
    const res = await request(net, url, { headers: { accept: "application/json, text/html;q=0.9, */*;q=0.5" } });
    if (res.ok) {
      const body = await readBody(res);
      if (isOpenAPI(body)) {
        const r = reflectOpenAPI(body as any, url);
        probes.push({ url, kind: "openapi", ok: true, detail: `${r.capabilities.length} operations` });
        return { reflections: [r], hints: [], definitive: true };
      }
      if (body && typeof body === "object" && (body as any).rightclick) {
        const r = await reflectPeer(net, new URL(url).origin);
        probes.push({ url, kind: "peer", ok: true, detail: `${r.capabilities.length} federated capabilities` });
        return { reflections: [r], hints: [], definitive: true };
      }
      if (typeof body === "string" && /<html|<form|<!doctype/i.test(body)) {
        // A page answering a well-known probe is a catch-all route (or a GraphQL
        // playground): don't reflect it as a page, but keep probing the URL.
        if (!opts.quiet) {
          const r = reflectWeb(body, url);
          hints = (r.provider.meta?.hints as string[]) ?? [];
          probes.push({ url, kind: "web", ok: r.capabilities.length > 0, detail: `${r.capabilities.length} forms, ${hints.length} hints` });
          reflections.push(r);
        }
      }
    } else {
      await res.body?.cancel();
    }
  } catch (e) {
    if (!opts.quiet) probes.push({ url, kind: "get", ok: false, detail: String((e as Error).message ?? e) });
  }
  // 2. POST GraphQL introspection.
  try {
    const res = await request(net, url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    });
    if (res.ok) {
      const body = await readBody(res);
      if (isIntrospection(body)) {
        const r = reflectGraphQL(body, url);
        probes.push({ url, kind: "graphql", ok: true, detail: `${r.capabilities.length} fields` });
        return { reflections: [r], hints, definitive: true };
      }
    } else await res.body?.cancel();
  } catch {
    /* not graphql */
  }
  // 3. MCP initialize + tools/list.
  try {
    const client = opts.mcp?.(url) ?? new McpClient(url, net);
    const tools = await client.listTools();
    const r = reflectMcpTools(tools, url, client.serverInfo.name);
    probes.push({ url, kind: "mcp", ok: true, detail: `${tools.length} tools` });
    return { reflections: [r], hints, definitive: true };
  } catch {
    /* not mcp */
  }
  if (!reflections.length && !opts.quiet) probes.push({ url, kind: "unknown", ok: false, detail: "no supported contract found" });
  return { reflections, hints, definitive: false };
}

export async function reflectPeer(net: Net, origin: string): Promise<Reflection> {
  const res = await request(net, `${origin}/api/graph`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`peer ${origin} -> HTTP ${res.status}`);
  const g = (await res.json()) as { name?: string; region?: string; capabilities: Capability[] };
  const host = new URL(origin).host;
  const providerId = `peer:${slug(host)}`;
  const capabilities: Capability[] = g.capabilities
    // Builtins exist everywhere; federate what is unique to the peer.
    .filter((c) => c.source !== "peer" && c.source !== "builtin")
    .map((c) => ({
      ...c,
      id: `${providerId}:${c.id}`,
      provider: providerId,
      source: "peer",
      tags: [...c.tags, "federated", host, ...(g.region ? [g.region] : [])],
      invoke: { kind: "peer", endpoint: origin, id: c.id },
    }));
  return {
    provider: {
      id: providerId,
      title: `Peer ${g.name ?? host}${g.region ? ` (${g.region})` : ""}`,
      source: "peer",
      origin,
      learnedAt: new Date().toISOString(),
      capabilityIds: capabilities.map((c) => c.id),
      meta: { region: g.region },
    },
    capabilities,
  };
}
