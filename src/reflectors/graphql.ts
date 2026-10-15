// GraphQL introspection -> typed capabilities. Every Query and Mutation field
// becomes a capability; the reflector builds the selection set itself.

import { graphqlScalar, inferType } from "../core/semantics.ts";
import type { Capability, Port, Reflection, SemType } from "../core/types.ts";
import { slug } from "./net.ts";

export const INTROSPECTION_QUERY = `query RightClickIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind name description
      fields(includeDeprecated: false) {
        name description
        args { name description defaultValue type { ...T } }
        type { ...T }
      }
    }
  }
}
fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;

interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}
interface Field {
  name: string;
  description?: string | null;
  args: Array<{ name: string; description?: string | null; defaultValue?: string | null; type: TypeRef }>;
  type: TypeRef;
}
interface FullType {
  kind: string;
  name: string;
  description?: string | null;
  fields?: Field[] | null;
}

export function isIntrospection(doc: unknown): boolean {
  return !!(doc as any)?.data?.__schema?.types;
}

function printType(t: TypeRef): string {
  if (t.kind === "NON_NULL") return `${printType(t.ofType!)}!`;
  if (t.kind === "LIST") return `[${printType(t.ofType!)}]`;
  return t.name ?? "String";
}

function named(t: TypeRef): { name: string; kind: string; list: boolean } {
  let list = false;
  let cur: TypeRef = t;
  while (cur.ofType) {
    if (cur.kind === "LIST") list = true;
    cur = cur.ofType;
  }
  return { name: cur.name ?? "String", kind: cur.kind, list };
}

function semantic(name: string, t: TypeRef, description = ""): SemType {
  const n = named(t);
  const base = n.kind === "SCALAR" || n.kind === "ENUM" ? inferType(name, graphqlScalar(n.name), description) : "json";
  return n.list ? `list:${base}` : base;
}

export function reflectGraphQL(introspection: any, endpoint: string, title?: string): Reflection {
  const schema = introspection.data.__schema;
  const types = new Map<string, FullType>(schema.types.map((t: FullType) => [t.name, t]));
  const host = new URL(endpoint).host;
  const providerTitle = title ?? `GraphQL ${host}`;
  const providerId = `graphql:${slug(host + new URL(endpoint).pathname)}`;
  const capabilities: Capability[] = [];

  const roots: Array<["query" | "mutation", string | undefined]> = [
    ["query", schema.queryType?.name],
    ["mutation", schema.mutationType?.name],
  ];
  for (const [operation, rootName] of roots) {
    const root = rootName ? types.get(rootName) : undefined;
    for (const field of root?.fields ?? []) {
      if (field.name.startsWith("__")) continue;
      const inputs: Port[] = field.args.map((a) => ({
        name: a.name,
        type: semantic(a.name, a.type, a.description ?? ""),
        required: a.type.kind === "NON_NULL" && a.defaultValue == null,
        description: a.description ?? undefined,
        wire: printType(a.type),
      }));
      const { selection, ports } = buildSelection(field, types);
      capabilities.push({
        id: `${providerId}:${operation}:${field.name}`,
        title: humanize(field.name) + (operation === "mutation" ? " (mutation)" : ""),
        description: (field.description ?? `${operation} ${field.name} on ${host}`).slice(0, 400),
        provider: providerId,
        source: "graphql",
        inputs,
        outputs: ports,
        risk: operation === "query" ? "read" : "write",
        tags: [operation, "graphql", host, named(field.type).name],
        invoke: {
          kind: "graphql",
          endpoint,
          operation,
          field: field.name,
          args: Object.fromEntries(field.args.map((a) => [a.name, printType(a.type)])),
          selection,
        },
      });
    }
  }

  return {
    provider: {
      id: providerId,
      title: providerTitle,
      source: "graphql",
      origin: endpoint,
      learnedAt: new Date().toISOString(),
      capabilityIds: capabilities.map((c) => c.id),
    },
    capabilities,
  };
}

function buildSelection(field: Field, types: Map<string, FullType>): { selection: string; ports: Port[] } {
  const ret = named(field.type);
  const wrap = (t: SemType) => (ret.list ? `list:${t}` : t);
  const target = types.get(ret.name);
  if (!target || target.kind === "SCALAR" || target.kind === "ENUM") {
    return { selection: "", ports: [{ name: "", type: semantic(field.name, field.type), required: true }] };
  }
  const ports: Port[] = [{ name: "", type: ret.list ? "list:json" : "json", required: true }];
  const parts: string[] = [];
  for (const f of (target.fields ?? []).filter((f) => !f.args.some((a) => a.type.kind === "NON_NULL")).slice(0, 25)) {
    const n = named(f.type);
    const ft = types.get(n.name);
    if (!ft || ft.kind === "SCALAR" || ft.kind === "ENUM") {
      parts.push(f.name);
      ports.push({ name: f.name, type: wrap(semantic(f.name, f.type, f.description ?? "")), required: true });
    } else if (ft.kind === "OBJECT") {
      const subs = (ft.fields ?? [])
        .filter((s) => !s.args.length && ["SCALAR", "ENUM"].includes(types.get(named(s.type).name)?.kind ?? "SCALAR"))
        .slice(0, 8);
      if (!subs.length) continue;
      parts.push(`${f.name} { ${subs.map((s) => s.name).join(" ")} }`);
      for (const s of subs) {
        const st = semantic(s.name, s.type, s.description ?? "");
        const listy = ret.list || n.list;
        ports.push({ name: `${f.name}.${s.name}`, type: listy && !st.startsWith("list:") ? `list:${st}` : st, required: true });
      }
    }
  }
  return { selection: parts.length ? `{ ${parts.join(" ")} }` : "{ __typename }", ports };
}

function humanize(s: string): string {
  const t = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function buildDocument(inv: { operation: string; field: string; args: Record<string, string>; selection: string }, provided: string[]): string {
  const used = Object.entries(inv.args).filter(([n, t]) => provided.includes(n) || t.endsWith("!"));
  const vars = used.map(([n, t]) => `$${n}: ${t}`).join(", ");
  const call = used.map(([n]) => `${n}: $${n}`).join(", ");
  return `${inv.operation} RightClick${vars ? `(${vars})` : ""} { ${inv.field}${call ? `(${call})` : ""} ${inv.selection} }`;
}
