// Chameleon Lab environment: generated from lab/fixtures.json with a seed.
// Services are plain data (name, protocol, operation, field spellings) served
// by generic protocol servers below. Nothing here is known to RightClick X.

import { readFileSync } from "node:fs";
import { serve, type Served } from "../src/entry/node-host.ts";

type Protocol = "openapi" | "graphql" | "mcp";
type Role = string;

export interface Field {
  role: Role;
  name: string;
  kind: "string" | "number";
}

export interface ServiceSpec {
  key: "invoices" | "customers" | "tax";
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
  customers: Array<{ customer: string; name: string; country: string }>;
  invoices: Array<{ invoice: string; customer: string; amount: number; currency: string }>;
  rates: Record<string, number>;
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));

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

const NUMBER_ROLES = new Set(["amount", "rate"]);

export function generate(seed: number) {
  const r = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const brands = [...fixtures.brands].sort(() => r() - 0.5);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const makeService = (key: ServiceSpec["key"], label: string, protocol?: Protocol, avoid?: ServiceSpec): ServiceSpec => {
    const pool = fixtures.services[key];
    const choose = (options: string[]) => {
      const fresh = options.filter((o) => !avoid || ![avoid.input.name, ...avoid.outputs.map((f) => f.name)].includes(o));
      return pick(fresh.length ? fresh : options);
    };
    const [inRole, inNames] = Object.entries(pool.input as Record<string, string[]>)[0];
    const input: Field = { role: inRole, name: choose(inNames), kind: "string" };
    const outputs: Field[] = Object.entries(pool.output as Record<string, string[]>).map(([role, names]) => ({
      role,
      name: role === inRole ? input.name : choose(names),
      kind: NUMBER_ROLES.has(role) ? "number" : "string",
    }));
    const operation = avoid ? pick((pool.operation as string[]).filter((o) => o !== avoid.operation)) : pick(pool.operation);
    return { key, label, brand: brands.pop()!, protocol: protocol ?? pick(fixtures.protocols), operation, slug: slug(operation), input, outputs };
  };

  const invoices = makeService("invoices", "invoices");
  const customers = makeService("customers", "customers");
  const taxPrimary = makeService("tax", "tax (primary)");
  const taxBackup = makeService("tax", "tax (backup)", pick((fixtures.protocols as Protocol[]).filter((p) => p !== taxPrimary.protocol)));

  const countries: string[] = fixtures.countries;
  const rates: Record<string, number> = Object.fromEntries(countries.map((c) => [c, Math.round((5 + r() * 22) * 10) / 10]));
  const customersData = Array.from({ length: 8 }, (_, i) => ({ customer: `C-${1000 + i}`, name: `${pick(fixtures.brands)} Ltd ${i}`, country: pick(countries) }));
  const invoicesData = Array.from({ length: 12 }, (_, i) => ({
    invoice: `INV-${5000 + Math.floor(r() * 4000)}-${i}`,
    customer: pick(customersData).customer,
    amount: Math.round(r() * 100000) / 100,
    currency: pick(["EUR", "USD", "JPY", "BRL"]),
  }));
  const data: Dataset = { customers: customersData, invoices: invoicesData, rates };
  return { seed, services: { invoices, customers, taxPrimary, taxBackup }, data, makeService };
}

/** A breaking release: new operation, new field spellings, nested output, a different protocol. */
export function breakingRelease(old: ServiceSpec, seed: number): ServiceSpec {
  const g = generate(seed);
  const next = g.makeService(old.key, old.label, (["openapi", "graphql", "mcp"] as Protocol[]).filter((p) => p !== old.protocol)[seed % 2], old);
  return { ...next, brand: old.brand, nest: "result" };
}

// ------------------------------------------------------------------ servers

function lookup(spec: ServiceSpec, data: Dataset, value: unknown): Record<string, unknown> | undefined {
  const v = String(value ?? "");
  const row =
    spec.key === "invoices"
      ? data.invoices.find((x) => x.invoice === v)
      : spec.key === "customers"
        ? data.customers.find((x) => x.customer === v)
        : v in data.rates
          ? { country: v, rate: data.rates[v] }
          : undefined;
  if (!row) return undefined;
  const flat = Object.fromEntries(spec.outputs.map((f) => [f.name, (row as any)[f.role]]));
  return spec.nest ? { [spec.nest]: flat } : flat;
}

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (s: string) => camel(s).charAt(0).toUpperCase() + camel(s).slice(1);
const jsonType = (f: Field) => (f.kind === "number" ? "number" : "string");

function openapi(spec: ServiceSpec) {
  const props = Object.fromEntries(spec.outputs.map((f) => [f.name, { type: jsonType(f) }]));
  const schema = spec.nest ? { type: "object", properties: { [spec.nest]: { type: "object", properties: props } } } : { type: "object", properties: props };
  return {
    openapi: "3.0.3",
    info: { title: `${spec.brand}`, version: spec.nest ? "2.0.0" : "1.0.0" },
    paths: {
      [`/api/${spec.slug}`]: {
        get: {
          operationId: camel(spec.slug),
          summary: spec.operation,
          parameters: [{ name: spec.input.name, in: "query", required: true, schema: { type: "string" } }],
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
  const fields = spec.outputs.map((f) => ({ name: f.name, description: null, args: [], type: scalar(f) }));
  const types: any[] = [
    {
      kind: "OBJECT",
      name: "Query",
      description: null,
      fields: [{ name: camel(spec.slug), description: spec.operation, args: [{ name: spec.input.name, description: null, type: T("NON_NULL", null, T("SCALAR", "String")), defaultValue: null }], type: T("OBJECT", spec.nest ? `${typeName}Envelope` : typeName) }],
    },
    { kind: "OBJECT", name: typeName, description: null, fields },
    { kind: "SCALAR", name: "String", description: null, fields: null },
    { kind: "SCALAR", name: "Float", description: null, fields: null },
  ];
  if (spec.nest) types.push({ kind: "OBJECT", name: `${typeName}Envelope`, description: null, fields: [{ name: spec.nest, description: null, args: [], type: T("OBJECT", typeName) }] });
  return { data: { __schema: { queryType: { name: "Query" }, mutationType: null, types } } };
}

function mcpTool(spec: ServiceSpec) {
  const props = Object.fromEntries(spec.outputs.map((f) => [f.name, { type: jsonType(f) }]));
  return {
    name: spec.slug.replace(/-/g, "_"),
    title: spec.operation,
    description: `${spec.operation} (${spec.brand})`,
    inputSchema: { type: "object", properties: { [spec.input.name]: { type: "string" } }, required: [spec.input.name] },
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
