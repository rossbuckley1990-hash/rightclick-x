// Chameleon Lab environment, generated from lab/fixtures.json with a seed.
// A domain is pure data: an objective and a chain of services. Services are
// served by generic OpenAPI, GraphQL and MCP servers. Nothing here is known to
// RightClick X.

import { readFileSync } from "node:fs";
import { serve, type Served } from "../src/entry/node-host.ts";

export type Protocol = "openapi" | "graphql" | "mcp";

export interface Field {
  role: string;
  name: string;
  kind: "string" | "number";
  /** Published in the contract when the domain provides one. */
  description?: string;
}

export interface ServiceSpec {
  service: string;
  link: number;
  label: string;
  brand: string;
  protocol: Protocol;
  operation: string;
  slug: string;
  input: Field;
  outputs: Field[];
  /** When set, outputs are nested under this key (a typical breaking change). */
  nest?: string;
}

export interface Dataset {
  /** One table per chain link, rows keyed by role. */
  tables: Array<Array<Record<string, string | number>>>;
}

export interface Domain {
  objective: string;
  have: string;
  want: string;
  intent: string;
  chain: Array<{ service: string; key: string; next?: string; answer?: string; operation: string[]; fields: Record<string, string[]> }>;
  values: Record<string, string | string[]>;
  numbers: Record<string, [number, number]>;
  descriptions?: Record<string, string>;
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
export const DOMAINS = Object.keys(fixtures.domains);

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function generate(seed: number, domainName = "invoicing") {
  const domain: Domain = fixtures.domains[domainName];
  if (!domain) throw new Error(`unknown domain ${domainName}; known: ${DOMAINS.join(", ")}`);
  const r = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const brands: string[] = [...fixtures.brands].sort(() => r() - 0.5);

  const makeService = (link: number, label: string, protocol?: Protocol, avoid?: ServiceSpec): ServiceSpec => {
    const def = domain.chain[link];
    const taken = avoid ? new Set([avoid.input.name, ...avoid.outputs.map((f) => f.name)]) : new Set<string>();
    const choose = (options: string[]) => pick(options.filter((o) => !taken.has(o)).length ? options.filter((o) => !taken.has(o)) : options);
    const names: Record<string, string> = {};
    for (const [role, options] of Object.entries(def.fields)) names[role] = choose(options);
    const kind = (role: string): Field["kind"] => (role in domain.numbers ? "number" : "string");
    const operation = avoid ? pick(def.operation.filter((o) => o !== avoid.operation)) : pick(def.operation);
    return {
      service: def.service,
      link,
      label,
      brand: avoid?.brand ?? brands.pop()!,
      protocol: protocol ?? pick(fixtures.protocols as Protocol[]),
      operation,
      slug: slugify(operation),
      input: { role: def.key, name: names[def.key], kind: kind(def.key), description: domain.descriptions?.[def.key] },
      outputs: Object.keys(def.fields).map((role) => ({ role, name: names[role], kind: kind(role), description: domain.descriptions?.[role] })),
    };
  };

  const last = domain.chain.length - 1;
  const services = domain.chain.map((d, i) => makeService(i, d.service));
  const backup = makeService(last, `${domain.chain[last].service} (newcomer)`, pick((fixtures.protocols as Protocol[]).filter((p) => p !== services[last].protocol)));

  // Synthetic data, built from the end of the chain backwards so every link resolves.
  const value = (role: string, i: number): string | number => {
    const v = domain.values[role];
    if (role in domain.numbers) {
      const [lo, hi] = domain.numbers[role];
      return Math.round((lo + r() * (hi - lo)) * 10) / 10;
    }
    if (Array.isArray(v)) return pick(v);
    if (typeof v === "string") return `${v}${1000 + i}`;
    return `${role}-${i}`;
  };
  const tables: Dataset["tables"] = [];
  for (let link = last; link >= 0; link--) {
    const def = domain.chain[link];
    const keyPool = domain.values[def.key];
    const keys = Array.isArray(keyPool) ? [...keyPool] : Array.from({ length: link === 0 ? 12 : 8 }, (_, i) => `${keyPool}${1000 + i * 7 + Math.floor(r() * 7)}`);
    tables[link] = keys.map((k, i) => {
      const row: Record<string, string | number> = {};
      for (const role of Object.keys(def.fields)) row[role] = value(role, i);
      row[def.key] = k;
      if (def.next) row[def.next] = pick(tables[link + 1])[domain.chain[link + 1].key] as string;
      return row;
    });
  }
  const data: Dataset = { tables };

  /** Ground truth: walk the chain through the harness's own tables. */
  const expected = (start: string, truth: Dataset = data): string | number | undefined => {
    let v: string | number | undefined = start;
    for (const [i, def] of domain.chain.entries()) {
      const row = truth.tables[i].find((x) => x[def.key] === v);
      if (!row) return undefined;
      v = def.next ? row[def.next] : row[def.answer!];
    }
    return v;
  };
  const starts = tables[0].map((row) => String(row[domain.chain[0].key]));
  return { seed, domainName, domain, services, backup, data, expected, starts, makeService };
}

/** A breaking release: new operation title, new field spellings, nested output, a different protocol. */
export function breakingRelease(env: ReturnType<typeof generate>, old: ServiceSpec, seed: number): ServiceSpec {
  const protocols = (["openapi", "graphql", "mcp"] as Protocol[]).filter((p) => p !== old.protocol);
  return { ...env.makeService(old.link, old.label, protocols[seed % 2], old), nest: "result" };
}

// ------------------------------------------------------------------ servers

function lookup(spec: ServiceSpec, data: Dataset, value: unknown): Record<string, unknown> | undefined {
  const row = data.tables[spec.link].find((x) => String(x[spec.input.role]) === String(value ?? ""));
  if (!row) return undefined;
  const flat = Object.fromEntries(spec.outputs.map((f) => [f.name, row[f.role]]));
  return spec.nest ? { [spec.nest]: flat } : flat;
}

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (s: string) => camel(s).charAt(0).toUpperCase() + camel(s).slice(1);
const jsonType = (f: Field) => (f.kind === "number" ? "number" : "string");

const desc = (f: Field) => (f.description ? { description: f.description } : {});

function openapi(spec: ServiceSpec) {
  const props = Object.fromEntries(spec.outputs.map((f) => [f.name, { type: jsonType(f), ...desc(f) }]));
  const schema = spec.nest ? { type: "object", properties: { [spec.nest]: { type: "object", properties: props } } } : { type: "object", properties: props };
  return {
    openapi: "3.0.3",
    info: { title: spec.brand, version: spec.nest ? "2.0.0" : "1.0.0" },
    paths: {
      [`/api/${spec.slug}`]: {
        get: {
          operationId: camel(spec.slug),
          summary: spec.operation,
          parameters: [{ name: spec.input.name, in: "query", required: true, schema: { type: "string" }, ...desc(spec.input) }],
          responses: { "200": { description: "ok", content: { "application/json": { schema } } } },
        },
      },
    },
  };
}

function graphqlSchema(spec: ServiceSpec) {
  const T = (kind: string, name: string | null, ofType: any = null) => ({ kind, name, ofType });
  const scalar = (f: Field) => T("SCALAR", f.kind === "number" ? "Float" : "String");
  const typeName = pascal(spec.slug);
  const fields = spec.outputs.map((f) => ({ name: f.name, description: f.description ?? null, args: [], type: scalar(f) }));
  const types: any[] = [
    {
      kind: "OBJECT",
      name: "Query",
      description: null,
      fields: [{ name: camel(spec.slug), description: spec.operation, args: [{ name: spec.input.name, description: spec.input.description ?? null, type: T("NON_NULL", null, T("SCALAR", "String")), defaultValue: null }], type: T("OBJECT", spec.nest ? `${typeName}Envelope` : typeName) }],
    },
    { kind: "OBJECT", name: typeName, description: null, fields },
    { kind: "SCALAR", name: "String", description: null, fields: null },
    { kind: "SCALAR", name: "Float", description: null, fields: null },
  ];
  if (spec.nest) types.push({ kind: "OBJECT", name: `${typeName}Envelope`, description: null, fields: [{ name: spec.nest, description: null, args: [], type: T("OBJECT", typeName) }] });
  return { data: { __schema: { queryType: { name: "Query" }, mutationType: null, types } } };
}

function mcpTool(spec: ServiceSpec) {
  const props = Object.fromEntries(spec.outputs.map((f) => [f.name, { type: jsonType(f), ...desc(f) }]));
  return {
    name: spec.slug.replace(/-/g, "_"),
    title: spec.operation,
    description: `${spec.operation} (${spec.brand})`,
    inputSchema: { type: "object", properties: { [spec.input.name]: { type: "string", ...desc(spec.input) } }, required: [spec.input.name] },
    outputSchema: spec.nest ? { type: "object", properties: { [spec.nest]: { type: "object", properties: props } } } : { type: "object", properties: props },
    annotations: { readOnlyHint: true },
  };
}

/** One disposable service: its spec can be swapped (a release) and it can be shut down (removal). */
export class LabService {
  spec: ServiceSpec;
  private data: Dataset;
  private server?: Served;
  constructor(spec: ServiceSpec, data: Dataset) {
    this.spec = spec;
    this.data = structuredClone(data);
  }
  get url(): string {
    return `${this.server!.url}/`;
  }
  async start(): Promise<void> {
    this.server = await serve((req) => this.handle(req), 0);
  }
  async stop(): Promise<void> {
    await this.server?.close();
  }
  private async handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const s = this.spec;
    const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (s.protocol === "openapi") {
      if (req.method === "GET" && u.pathname === "/openapi.json") return json(openapi(s));
      if (req.method === "GET" && u.pathname === `/api/${s.slug}`) {
        const row = lookup(s, this.data, u.searchParams.get(s.input.name));
        return row ? json(row) : json({ error: "not found" }, 404);
      }
      return json({ error: "not found" }, 404);
    }
    if (s.protocol === "graphql") {
      if (req.method !== "POST" || u.pathname !== "/graphql") return json({ error: "not found" }, 404);
      if (String(body.query).includes("__schema")) return json(graphqlSchema(s));
      const value = body.variables?.[s.input.name] ?? new RegExp(`${s.input.name}\\s*:\\s*"([^"]*)"`).exec(String(body.query))?.[1];
      return json({ data: { [camel(s.slug)]: lookup(s, this.data, value) ?? null } });
    }
    if (req.method !== "POST" || u.pathname !== "/mcp") return json({ error: "not found" }, 404);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const ok = (result: unknown) => json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: s.brand, version: s.nest ? "2" : "1" } } }, 200, { "mcp-session-id": `lab-${Date.now()}` });
    if (body.method === "tools/list") return ok({ tools: [mcpTool(s)] });
    if (body.method === "tools/call") {
      const row = lookup(s, this.data, body.params?.arguments?.[s.input.name]);
      if (!row) return ok({ content: [{ type: "text", text: "not found" }], isError: true });
      return ok({ content: [{ type: "text", text: JSON.stringify(row) }], structuredContent: row });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
  }
}
