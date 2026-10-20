// GraphQL introspection -> typed capabilities. Every Query and Mutation field
// becomes a capability; the reflector builds the selection set itself.

import { graphqlScalar, inferInContext } from "../core/semantics.ts";
import type { Capability, DeclaredField, Port, Reflection, SemType } from "../core/types.ts";
import { slug } from "./net.ts";

/** Introspection query with a type-reference nesting depth (servers often cap query depth). */
export function introspectionQuery(refDepth = 4): string {
  let ref = "kind name";
  for (let i = 0; i < refDepth; i++) ref = `kind name ofType { ${ref} }`;
  return `query RightClickIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind name description
      fields(includeDeprecated: false) {
        name description
        args { name description defaultValue type { ${ref} } }
        type { ${ref} }
      }
    }
  }
}`;
}

/** Tried in order: full depth first, then shallower for depth-limited servers. */
export const INTROSPECTION_QUERIES = [introspectionQuery(4), introspectionQuery(3), introspectionQuery(2)];
export const INTROSPECTION_QUERY = INTROSPECTION_QUERIES[0];

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

/** Unwrap NON_NULL/LIST. `name` is null when a depth-limited introspection truncated the chain. */
function named(t: TypeRef): { name: string | null; kind: string; list: boolean } {
  let list = false;
  let cur: TypeRef = t;
  while (cur.ofType) {
    if (cur.kind === "LIST") list = true;
    cur = cur.ofType;
  }
  if (cur.kind === "LIST") list = true;
  return { name: cur.name, kind: cur.name ? cur.kind : "UNKNOWN", list };
}

function semantic(name: string, t: TypeRef, description = "", context = ""): SemType {
  const n = named(t);
  // Another RightClick X tells us the exact semantic type.
  const tagged = /\[rightclick:([\w.:-]+)\]/.exec(description)?.[1];
  if (tagged && tagged !== "goal") return n.list && !tagged.startsWith("list:") ? `list:${tagged}` : tagged;
  const base = n.kind === "SCALAR" || n.kind === "ENUM" ? inferInContext(name, graphqlScalar(n.name!), description, context) : "json";
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
        type: semantic(a.name, a.type, a.description ?? "", field.name),
        required: a.type.kind === "NON_NULL" && a.defaultValue == null,
        description: a.description ?? undefined,
        wire: printType(a.type),
      }));
      const { selection, ports, omitted, total } = buildSelection(field, types);
      // The default selection is bounded; say what it leaves out and let the caller choose.
      const selectPort = ports.length > 1 && !field.args.some((a) => a.name === "selection") ? "selection" : undefined;
      if (selectPort) {
        const shown = omitted.length ? ` Default selects ${total - omitted.length} of ${total} fields; also available: ${clip(omitted.join(", "), 3000)}.` : "";
        inputs.push({ name: selectPort, type: "text", required: false, wire: "selection set", description: `Optional GraphQL selection set for the returned ${named(field.type).name}, e.g. "{ id name nested { field } }"; replaces the default selection.${shown}` });
      }
      const declared = declaredFields(field, types, ports);
      // Default selections are response-size bounds, not the extent of a
      // provider's contract. Expose up to 64 additional, specifically typed
      // identifier leaves for joins; execution must explicitly project them.
      const portNames = new Set(ports.map(p => p.name));
      // A long sequence of earlier list relationships must not hide a scalar
      // identifier. This matches the planner's preference for single values over
      // fan-out; it is not proof that similarly typed identifiers mean the same thing.
      const identifiers = declared.filter(f => f.type && /^(list:)?id\./.test(f.type) && !portNames.has(f.path));
      identifiers.sort((a, b) => Number(a.type!.startsWith("list:")) - Number(b.type!.startsWith("list:")));
      for (const f of identifiers.slice(0, 64)) {
        ports.push({ name: f.path, type: f.type!, required: false });
      }
      capabilities.push({
        id: `${providerId}:${operation}:${field.name}`,
        ...(declared.length ? { fields: declared } : {}),
        title: humanize(field.name) + (operation === "mutation" ? " (mutation)" : ""),
        description: (field.description ?? `${operation} ${field.name} on ${host}`).slice(0, 400),
        provider: providerId,
        source: "graphql",
        inputs,
        outputs: ports,
        risk: operation === "query" ? "read" : "write",
        tags: [operation, "graphql", host, named(field.type).name ?? ""],
        invoke: {
          kind: "graphql",
          endpoint,
          operation,
          field: field.name,
          args: Object.fromEntries(field.args.map((a) => [a.name, printType(a.type)])),
          selection,
          ...(selectPort ? { selectPort } : {}),
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

function buildSelection(field: Field, types: Map<string, FullType>): { selection: string; ports: Port[]; omitted: string[]; total: number } {
  const ret = named(field.type);
  const wrap = (t: SemType) => (ret.list ? `list:${t}` : t);
  const target = ret.name ? types.get(ret.name) : undefined;
  if (!target || target.kind === "SCALAR" || target.kind === "ENUM") {
    return { selection: "", ports: [{ name: "", type: semantic(field.name, field.type), required: true }], omitted: [], total: 0 };
  }
  const ports: Port[] = [{ name: "", type: ret.list ? "list:json" : "json", required: true }];
  const parts: string[] = [];
  const selectable = (target.fields ?? []).filter((f) => !f.args.some((a) => a.type.kind === "NON_NULL"));
  // Fields beyond the default selection, with their scalar subfields, so a caller can ask for them.
  const omitted = selectable.slice(25).map((f) => {
    const ft = named(f.type).name ? types.get(named(f.type).name!) : undefined;
    if (!ft || ft.kind !== "OBJECT") return f.name;
    const subs = (ft.fields ?? []).filter((x) => !x.args.length && ["SCALAR", "ENUM"].includes(types.get(named(x.type).name ?? "")?.kind ?? "")).map((x) => x.name);
    return subs.length ? `${f.name} { ${subs.slice(0, 8).join(" ")}${subs.length > 8 ? " …" : ""} }` : `${f.name} { … }`;
  });
  for (const f of selectable.slice(0, 25)) {
    const n = named(f.type);
    if (!n.name) continue; // truncated type: can't build a valid selection
    const ft = types.get(n.name);
    if (!ft || ft.kind === "SCALAR" || ft.kind === "ENUM") {
      parts.push(f.name);
      ports.push({ name: f.name, type: wrap(semantic(f.name, f.type, f.description ?? "", target.name)), required: true });
    } else if (ft.kind === "OBJECT") {
      const subs = (ft.fields ?? [])
        .filter((s) => {
          const sn = named(s.type).name;
          return !s.args.length && !!sn && ["SCALAR", "ENUM"].includes(types.get(sn)?.kind ?? "SCALAR");
        })
        .slice(0, 8);
      if (!subs.length) continue;
      parts.push(`${f.name} { ${subs.map((s) => s.name).join(" ")} }`);
      for (const s of subs) {
        const st = semantic(s.name, s.type, s.description ?? "", ft.name);
        const listy = ret.list || n.list;
        ports.push({ name: `${f.name}.${s.name}`, type: listy && !st.startsWith("list:") ? `list:${st}` : st, required: true });
      }
    }
  }
  return { selection: parts.length ? `{ ${parts.join(" ")} }` : "{ __typename }", ports, omitted, total: selectable.length };
}

/**
 * Every field the return type declares, three levels deep (lists included), each marked with
 * whether the default selection asks for it. Fields that need arguments are not selectable.
 */
function declaredFields(field: Field, types: Map<string, FullType>, ports: Port[]): DeclaredField[] {
  const selected = new Set(ports.map((p) => p.name).filter(Boolean));
  const out: DeclaredField[] = [];
  // Breadth-first: every top-level field before any nested detail, so a bound never hides a
  // shallow summary field behind the depths of earlier fields (rcsb_entry_info.resolution_combined).
  let level: Array<{ typeName: string | null | undefined; prefix: string; seen: Set<string>; lists: number }> = [{ typeName: named(field.type).name, prefix: "", seen: new Set(), lists: named(field.type).list ? 1 : 0 }];
  for (let depth = 1; depth <= 3 && level.length && out.length < 1500; depth++) {
    const next: typeof level = [];
    for (const { typeName, prefix, seen, lists } of level) {
      const t = typeName ? types.get(typeName) : undefined;
      if (!t || t.kind !== "OBJECT" || seen.has(t.name!)) continue;
      for (const f of t.fields ?? []) {
        if (f.args.some((a) => a.type.kind === "NON_NULL")) continue;
        const path = prefix ? `${prefix}.${f.name}` : f.name;
        if (out.length >= 1500) break;
        const n = named(f.type), ft = n.name ? types.get(n.name) : undefined;
        const type = ft && ["SCALAR", "ENUM"].includes(ft.kind) ? "list:".repeat(lists) + semantic(f.name, f.type, f.description ?? "", t.name) : undefined;
        out.push({ path, selected: selected.has(path), ...(type ? { type } : {}) });
        next.push({ typeName: n.name, prefix: path, seen: new Set([...seen, t.name!]), lists: lists + (n.list ? 1 : 0) });
      }
    }
    level = next;
  }
  return out;
}

/** A selection set: the default one plus the given field paths (merged as a tree). */
export function selectionWith(defaultSelection: string, paths: string[]): string {
  type Tree = Map<string, Tree>;
  const root: Tree = new Map();
  const add = (parts: string[]) => {
    let t = root;
    for (const p of parts) {
      if (!t.has(p)) t.set(p, new Map());
      t = t.get(p)!;
    }
  };
  // Parse the default selection into the tree.
  const tokens = defaultSelection.match(/[A-Za-z_][\w]*|[{}]/g) ?? [];
  const stack: string[] = [];
  let last = "";
  for (const tok of tokens) {
    if (tok === "{") {
      if (last) stack.push(last);
      last = "";
    } else if (tok === "}") {
      stack.pop();
      last = "";
    } else {
      add([...stack, tok]);
      last = tok;
    }
  }
  for (const p of paths) add(p.split("."));
  const print = (t: Tree): string => [...t].map(([k, sub]) => (sub.size ? `${k} { ${print(sub)} }` : k)).join(" ");
  return `{ ${print(root)} }`;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, s.lastIndexOf(",", n))}, … (truncated)`;
}

function humanize(s: string): string {
  const t = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Local document mistakes are not evidence of provider drift. */
export class GraphQLDocumentError extends Error {}

/** One bounded selection subtree. Aliases are allowed; arguments, directives,
 * fragments and additional root fields outside this subtree are not. */
export function checkSelection(sel: unknown): string {
  const fail = (): never => { throw new GraphQLDocumentError(`selection must be a GraphQL selection set such as "{ id name nested { field } }" (one nonempty subtree; no arguments, variables, fragments or operations; at most 64 levels, 4096 fields and 65536 characters)`); };
  if (typeof sel !== "string" || sel.length > 65536) return fail();
  const s = sel.trim(), tokens = s.match(/[_A-Za-z][_0-9A-Za-z]*|[{}:]|[^\s,]/g) ?? [];
  const name = /^[_A-Za-z][_0-9A-Za-z]*$/;
  let at = 0, fields = 0;
  const block = (depth: number) => {
    if (depth > 64 || tokens[at++] !== "{") fail();
    let count = 0;
    while (at < tokens.length && tokens[at] !== "}") {
      if (++fields > 4096 || !name.test(tokens[at++] ?? "")) fail();
      if (tokens[at] === ":") { at++; if (!name.test(tokens[at++] ?? "")) fail(); }
      if (tokens[at] === "{") block(depth + 1);
      count++;
    }
    if (!count || tokens[at++] !== "}") fail();
  };
  block(1);
  if (at !== tokens.length) fail();
  return s;
}

export function buildDocument(inv: { operation: string; field: string; args: Record<string, string>; selection: string }, provided: string[]): string {
  const name = /^[_A-Za-z][_0-9A-Za-z]*$/;
  const type = (value: string): boolean => {
    if (typeof value !== "string" || value.length > 256) return false;
    // Printed introspection types have no whitespace and at most one NON_NULL
    // suffix per named/list type. Validate the nesting, not just its alphabet.
    const tokens = value.match(/[_A-Za-z][_0-9A-Za-z]*|./g) ?? [];
    let at = 0;
    const parse = (depth: number): boolean => {
      if (depth > 32) return false;
      if (tokens[at] === "[") { at++; if (!parse(depth + 1) || tokens[at++] !== "]") return false; }
      else if (!name.test(tokens[at++] ?? "")) return false;
      if (tokens[at] === "!") at++;
      return true;
    };
    return parse(0) && at === tokens.length;
  };
  if (!["query", "mutation"].includes(inv.operation) || !name.test(inv.field) ||
      Object.entries(inv.args).some(([n, t]) => !name.test(n) || !type(t)))
    throw new GraphQLDocumentError("invalid GraphQL operation, field, argument name or type");
  const selection = inv.selection ? checkSelection(inv.selection) : "";
  const used = Object.entries(inv.args).filter(([n, t]) => provided.includes(n) || t.endsWith("!"));
  const vars = used.map(([n, t]) => `$${n}: ${t}`).join(", ");
  const call = used.map(([n]) => `${n}: $${n}`).join(", ");
  return `${inv.operation} RightClick${vars ? `(${vars})` : ""} { ${inv.field}${call ? `(${call})` : ""} ${selection} }`;
}
