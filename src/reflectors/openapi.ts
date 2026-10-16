// OpenAPI 3.x and Swagger 2.0 -> typed capabilities.

import { inferInContext, inferType, type SchemaLike } from "../core/semantics.ts";
import type { Capability, Port, Reflection, Risk } from "../core/types.ts";
import { readBody, request, slug, type Net } from "./net.ts";

type Obj = Record<string, any>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function isOpenAPI(doc: unknown): doc is Obj {
  return !!doc && typeof doc === "object" && ("openapi" in (doc as Obj) || "swagger" in (doc as Obj)) && "paths" in (doc as Obj);
}

export function reflectOpenAPI(spec: Obj, specUrl: string): Reflection {
  const resolve = makeResolver(spec);
  const title: string = spec.info?.title ?? new URL(specUrl).host;
  const providerId = `openapi:${slug(title)}`;
  const base = serverBase(spec, specUrl);
  const capabilities: Capability[] = [];

  for (const [path, rawItem] of Object.entries<Obj>(spec.paths ?? {})) {
    const item = resolve(rawItem);
    for (const method of METHODS) {
      const op = item?.[method] ? resolve(item[method]) : null;
      if (!op) continue;
      const params: Obj[] = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(resolve);
      const inputs: Port[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      const headerParams: string[] = [];
      const bodyParams: string[] = [];
      const multiSegment: string[] = [];
      let body: "json" | "form" | "raw" | null = null;
      const seen = new Set<string>();
      const addInput = (name: string, schema: SchemaLike, required: boolean, description = "") => {
        if (seen.has(name)) return false;
        seen.add(name);
        const t = schema?.type;
        const values = Array.isArray(schema?.enum) ? schema.enum.map(String) : undefined;
        inputs.push({
          ...(values ? { enum: values } : {}),
          name,
          // Another RightClick X tells us the exact semantic type; trust it over inference.
          type: (schema as any)?.["x-rightclick-type"] ?? inferType(name, schema, description),
          required,
          description: description || undefined,
          wire: Array.isArray(t) ? t.join("|") : t,
        });
        return true;
      };

      for (const p of params) {
        if (!p?.name) continue;
        const resolved = resolve(p.schema ?? p) as SchemaLike;
        // Examples may sit on the parameter rather than its schema; both describe the value.
        const schema: SchemaLike = p.example !== undefined || p.examples !== undefined ? { ...resolved, example: resolved?.example ?? p.example, examples: resolved?.examples ?? p.examples } : resolved;
        if (p.in === "path") {
          if (addInput(p.name, schema, true, p.description)) pathParams.push(p.name);
          if (p["x-multi-segment"]) multiSegment.push(p.name);
        } else if (p.in === "query") {
          if (addInput(p.name, schema, !!p.required, p.description)) queryParams.push(p.name);
        } else if (p.in === "header") {
          if (/^(authorization|accept|content-type)$/i.test(p.name)) continue;
          if (addInput(p.name, schema, !!p.required, p.description)) headerParams.push(p.name);
        } else if (p.in === "body") {
          body = "json";
          collectBody(resolve(p.schema ?? {}), resolve, !!p.required, addInput, bodyParams, () => (body = "raw"));
        } else if (p.in === "formData") {
          body = "form";
          if (addInput(p.name, schema, !!p.required, p.description)) bodyParams.push(p.name);
        }
      }

      const rb = op.requestBody ? resolve(op.requestBody) : null;
      if (rb?.content) {
        const json = rb.content["application/json"] ?? Object.entries<Obj>(rb.content).find(([k]) => k.includes("json"))?.[1];
        const form = rb.content["application/x-www-form-urlencoded"];
        if (json) {
          body = "json";
          collectBody(resolve(json.schema ?? {}), resolve, !!rb.required, addInput, bodyParams, () => (body = "raw"));
        } else if (form) {
          body = "form";
          collectBody(resolve(form.schema ?? {}), resolve, !!rb.required, addInput, bodyParams, () => (body = "raw"));
        }
      }

      const outputs = responsePorts(op, resolve);
      const opName: string = op.operationId ?? `${method}-${path}`;
      const risk: Risk = method === "get" ? "read" : method === "delete" ? "destructive" : "write";
      capabilities.push({
        id: `${providerId}:${slug(opName)}`,
        title: op.summary ?? humanize(op.operationId) ?? `${method.toUpperCase()} ${path}`,
        description: String(op.description ?? op.summary ?? "").slice(0, 400),
        provider: providerId,
        source: "openapi",
        inputs,
        outputs,
        risk,
        tags: [...(op.tags ?? []), title, method, ...path.split("/").filter((seg) => seg && !seg.startsWith("{"))],
        invoke: {
          kind: "http",
          method: method.toUpperCase(),
          url: joinUrl(base, path),
          pathParams,
          queryParams,
          headerParams,
          body,
          bodyParams,
          ...(multiSegment.length ? { multiSegment } : {}),
        },
      });
    }
  }

  return {
    provider: {
      id: providerId,
      title,
      source: "openapi",
      origin: specUrl,
      learnedAt: new Date().toISOString(),
      capabilityIds: capabilities.map((c) => c.id),
      meta: { base, version: spec.info?.version, security: Object.keys(spec.components?.securitySchemes ?? spec.securityDefinitions ?? {}) },
    },
    capabilities,
  };
}

/**
 * OpenAPI 3 without `servers` means "/" relative to the document, i.e. the
 * origin. Contracts served below a path prefix (…/api/openapi.json) often mean
 * their own directory instead. When the contract leaves the base unstated and
 * those two differ, try one or two parameterless JSON GET operations against
 * each (origin first, as the standard says) and keep the base that answers with
 * JSON. The outcome is recorded on the provider either way.
 */
export async function settleUnstatedBase(net: Net, spec: Obj, specUrl: string, r: Reflection): Promise<Reflection> {
  if (!spec.openapi || spec.servers?.length) return r;
  const origin = new URL(specUrl).origin;
  const dir = new URL(".", specUrl).toString().replace(/\/$/, "");
  if (dir === origin) return r;
  const resolve = makeResolver(spec);
  const probes: string[] = [];
  for (const [path, rawItem] of Object.entries<Obj>(spec.paths ?? {})) {
    const op = resolve(resolve(rawItem)?.get);
    if (!op || path.includes("{")) continue;
    const params = [...(resolve(rawItem).parameters ?? []), ...(op.parameters ?? [])].map(resolve);
    if (params.some((p: Obj) => p?.required)) continue;
    const ok = resolve(op.responses?.["200"] ?? op.responses?.default);
    if (!Object.keys(ok?.content ?? {}).some((k) => k.includes("json"))) continue;
    probes.push(path);
    if (probes.length === 2) break;
  }
  const tried: string[] = [];
  for (const base of [origin, dir]) {
    for (const path of probes) {
      try {
        const res = await request(net, joinUrl(base, path), { headers: { accept: "application/json" } });
        const body = res.ok ? await readBody(res) : (await res.body?.cancel(), null);
        tried.push(`GET ${joinUrl(base, path)} → ${res.status}${res.ok ? (body && typeof body === "object" ? " json" : " not json") : ""}`);
        if (!res.ok || !body || typeof body !== "object") continue;
      } catch (e) {
        tried.push(`GET ${joinUrl(base, path)} → ${String((e as Error)?.message ?? e).slice(0, 80)}`);
        continue;
      }
      if (base !== origin) {
        for (const c of r.capabilities) if (c.invoke.kind === "http" && c.invoke.url.startsWith(origin + "/")) c.invoke.url = base + c.invoke.url.slice(origin.length);
      }
      r.provider.meta = { ...r.provider.meta, base, baseResolution: { stated: false, chosen: base, tried } };
      return r;
    }
  }
  r.provider.meta = { ...r.provider.meta, baseResolution: { stated: false, chosen: origin, unverified: true, tried } };
  return r;
}

function collectBody(
  schema: Obj,
  resolve: (o: any) => any,
  required: boolean,
  addInput: (name: string, s: SchemaLike, req: boolean, d?: string) => boolean,
  bodyParams: string[],
  markRaw: () => void,
): void {
  const merged = mergeAllOf(schema, resolve);
  if (merged.type === "object" || merged.properties) {
    const req = new Set<string>(merged.required ?? []);
    for (const [name, prop] of Object.entries<Obj>(merged.properties ?? {})) {
      const p = resolve(prop);
      if (p.readOnly) continue;
      if (addInput(name, p, req.has(name), p.description)) bodyParams.push(name);
    }
  } else {
    markRaw();
    if (addInput("body", merged, required)) bodyParams.push("body");
  }
}

function responsePorts(op: Obj, resolve: (o: any) => any): Port[] {
  const responses: Obj = op.responses ?? {};
  const key = ["200", "201", "202", "2XX", "default"].find((k) => responses[k]);
  const r = key ? resolve(responses[key]) : null;
  let schema: Obj | undefined;
  let textual = false;
  if (r?.content) {
    const json = r.content["application/json"] ?? Object.entries<Obj>(r.content).find(([k]) => k.includes("json"))?.[1];
    if (json) schema = resolve(json.schema ?? {});
    else if (Object.keys(r.content).some((k) => k.startsWith("text/"))) textual = true;
  } else if (r?.schema) {
    schema = resolve(r.schema);
  }
  if (textual) return [{ name: "", type: Object.keys(r.content).includes("text/html") ? "html" : "text", required: true }];
  if (!schema) return [{ name: "", type: "json", required: true }];
  // The schema's own name is context: `id` on a "release" is an id.release.
  const context = refName(rawRef(r, resolve)) ?? "";
  const merged = mergeAllOf(schema, resolve);
  const ports: Port[] = [{ name: "", type: merged.type === "array" ? inferType("items", merged) : inferType("", merged), required: true }];
  if (merged.properties) {
    for (const [name, prop] of Object.entries<Obj>(merged.properties)) {
      const p = mergeAllOf(resolve(prop), resolve);
      ports.push({ name, type: p["x-rightclick-type"] ?? inferInContext(name, p, p.description ?? "", context), required: true, wire: p.type });
      if (p.properties) {
        for (const [sub, sp] of Object.entries<Obj>(p.properties).slice(0, 12)) {
          const s = resolve(sp);
          ports.push({ name: `${name}.${sub}`, type: inferInContext(sub, s, s.description ?? "", name), required: true, wire: s.type });
        }
      }
    }
  }
  return ports;
}

function rawRef(r: Obj | null, resolve: (o: any) => any): string | undefined {
  if (!r) return undefined;
  if (r.content) {
    const json = r.content["application/json"] ?? Object.entries<Obj>(r.content).find(([k]) => k.includes("json"))?.[1];
    return json?.schema?.$ref;
  }
  return r.schema?.$ref ?? resolve(r)?.schema?.$ref;
}

function refName(ref?: string): string | undefined {
  return ref?.split("/").pop()?.replace(/[-_](simple|full|minimal|private|public)$/i, "");
}

function mergeAllOf(schema: Obj, resolve: (o: any) => any): Obj {
  // oneOf/anyOf (e.g. GitHub's private-user | public-user): union of the variants' properties.
  const variants = schema?.oneOf ?? schema?.anyOf;
  if (variants && !schema.properties) {
    const out: Obj = { type: "object", properties: {}, required: [] };
    for (const v of variants.map(resolve)) {
      const m = mergeAllOf(v, resolve);
      if (m.type && m.type !== "object" && !m.properties) return m;
      for (const [k, p] of Object.entries<Obj>(m.properties ?? {})) out.properties[k] ??= p;
    }
    return out;
  }
  if (!schema?.allOf) return schema ?? {};
  const out: Obj = { type: "object", properties: {}, required: [] };
  for (const part of schema.allOf.map(resolve)) {
    const m = mergeAllOf(part, resolve);
    Object.assign(out.properties, m.properties ?? {});
    out.required.push(...(m.required ?? []));
  }
  return out;
}

function makeResolver(spec: Obj): (o: any) => any {
  return function resolve(o: any, depth = 0): any {
    if (!o || typeof o !== "object" || typeof o.$ref !== "string" || depth > 20) return o;
    if (!o.$ref.startsWith("#/")) return {};
    let cur: any = spec;
    for (const seg of o.$ref.slice(2).split("/")) cur = cur?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    return resolve(cur, depth + 1) ?? {};
  };
}

function serverBase(spec: Obj, specUrl: string): string {
  if (spec.openapi) {
    const s = spec.servers?.[0];
    if (!s?.url) return new URL(specUrl).origin;
    let u: string = s.url;
    for (const [k, v] of Object.entries<Obj>(s.variables ?? {})) u = u.replace(`{${k}}`, v.default ?? "");
    return new URL(u, specUrl).toString().replace(/\/$/, "");
  }
  const scheme = spec.schemes?.includes("https") ? "https" : (spec.schemes?.[0] ?? new URL(specUrl).protocol.replace(":", ""));
  const host = spec.host ?? new URL(specUrl).host;
  return `${scheme}://${host}${spec.basePath ?? ""}`.replace(/\/$/, "");
}

function joinUrl(base: string, path: string): string {
  return base + (path.startsWith("/") ? path : `/${path}`);
}

function humanize(id?: string): string | undefined {
  if (!id) return undefined;
  const s = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
