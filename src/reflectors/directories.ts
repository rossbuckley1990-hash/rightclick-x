// Public capability directories: where research finds new powers worldwide.
// Each directory turns a topic into learnable sources; context_learn then
// pulls any of them into the live graph.

import { tokenize } from "../core/graph.ts";
import { request, type Net } from "./net.ts";

export interface Candidate {
  directory: string;
  name: string;
  title: string;
  description: string;
  source: string;
  kind: "openapi" | "mcp" | "graphql";
  score: number;
}

export interface Directory {
  id: string;
  title: string;
  url: string;
  search(net: Net, topic: string, limit: number): Promise<Candidate[]>;
}

function score(topic: string, ...fields: string[]): number {
  const q = tokenize(topic);
  const doc = new Set(tokenize(fields.join(" ")));
  return q.reduce((s, t) => s + (doc.has(t) ? 1 : 0), 0) / (q.length || 1);
}

let apisGuruCache: { at: number; data: Record<string, any> } | null = null;

export const APIS_GURU: Directory = {
  id: "apis.guru",
  title: "APIs.guru OpenAPI directory",
  url: "https://api.apis.guru/v2/list.json",
  async search(net, topic, limit) {
    if (!apisGuruCache || Date.now() - apisGuruCache.at > 6 * 3600_000) {
      const res = await request(net, this.url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`apis.guru -> HTTP ${res.status}`);
      apisGuruCache = { at: Date.now(), data: (await res.json()) as Record<string, any> };
    }
    const out: Candidate[] = [];
    for (const [name, entry] of Object.entries(apisGuruCache.data)) {
      const v = entry.versions?.[entry.preferred];
      if (!v?.swaggerUrl) continue;
      const cats = (v.info?.["x-apisguru-categories"] ?? []).join(" ");
      const s = score(topic, name, v.info?.title ?? "", String(v.info?.description ?? "").slice(0, 500), cats);
      if (s > 0) {
        out.push({
          directory: this.id,
          name,
          title: v.info?.title ?? name,
          description: String(v.info?.description ?? "").replace(/\s+/g, " ").slice(0, 200),
          source: v.swaggerUrl,
          kind: "openapi",
          score: s,
        });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};

export const MCP_REGISTRY: Directory = {
  id: "mcp-registry",
  title: "Official MCP Registry",
  url: "https://registry.modelcontextprotocol.io/v0/servers",
  async search(net, topic, limit) {
    const res = await request(net, `${this.url}?search=${encodeURIComponent(topic)}&limit=${Math.min(100, limit * 4)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`mcp registry -> HTTP ${res.status}`);
    const j: any = await res.json();
    const out: Candidate[] = [];
    for (const item of j.servers ?? []) {
      const s = item.server ?? item;
      const remote = (s.remotes ?? []).find((r: any) => r.type === "streamable-http" || r.transport_type === "streamable-http" || r.type === "http");
      if (!remote?.url || remote.url.includes("{")) continue;
      out.push({
        directory: this.id,
        name: s.name,
        title: s.title ?? s.name,
        description: String(s.description ?? "").slice(0, 200),
        source: remote.url,
        kind: "mcp",
        score: score(topic, s.name, s.description ?? "") || 0.5,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};

export const DEFAULT_DIRECTORIES: Directory[] = [APIS_GURU, MCP_REGISTRY];
