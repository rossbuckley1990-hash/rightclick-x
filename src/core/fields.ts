// Contract-declared result fields: every path a JSON schema declares, through objects and
// arrays, bounded. A plan is judged by what its result carries (core/satisfaction.ts), and
// that is often deeper than the ports used for binding.
import type { DeclaredField } from "./types.ts";

type Obj = Record<string, any>;

export function schemaFields(schema: Obj | undefined, resolve: (o: any) => any = (o) => o, maxDepth = 5, limit = 400): DeclaredField[] {
  const out: DeclaredField[] = [];
  const seen = new Set<any>();
  const walk = (s: Obj | undefined, prefix: string, depth: number) => {
    if (!s || out.length >= limit || depth > maxDepth) return;
    s = resolve(s);
    if (!s || typeof s !== "object" || seen.has(s)) return;
    seen.add(s);
    for (const part of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) walk(part, prefix, depth);
    if (s.items) walk(s.items, prefix ? `${prefix}[]` : "[]", depth);
    for (const [name, prop] of Object.entries<Obj>(s.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (out.length >= limit) break;
      out.push({ path });
      walk(prop, path, depth + 1);
    }
    seen.delete(s);
  };
  walk(schema, "", 0);
  return out;
}
