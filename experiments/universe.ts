// A synthetic API universe for stress tests: thousands of independent
// providers whose operations use a realistic, Zipf-skewed vocabulary of field
// names. Every operation actually executes: its response is built from its
// declared output schema with deterministic values, so pipelines run for real.

const FIELDS: Array<[string, string, string?]> = [
  ["text", "string"], ["title", "string"], ["summary", "string"], ["description", "string"], ["body", "string"],
  ["url", "string", "uri"], ["homepage", "string", "uri"], ["email", "string", "email"], ["city", "string"], ["country", "string"],
  ["language", "string"], ["currency", "string"], ["latitude", "number"], ["longitude", "number"], ["temperature", "number"],
  ["price", "number"], ["amount", "number"], ["score", "number"], ["count", "integer"], ["created_at", "string", "date-time"],
  ["domain", "string"], ["ip", "string", "ipv4"], ["username", "string"], ["repo", "string"], ["color", "string"],
  ["sha256", "string"], ["path", "string"], ["image_url", "string", "uri"], ["timezone", "string"], ["postal_code", "string"],
];
const ENTITIES = ["user", "order", "invoice", "ticket", "device", "shipment", "product", "account", "project", "issue", "release", "build", "song", "album", "artist", "flight", "booking", "patient", "lab", "sensor"];

/** Deterministic PRNG so every run builds the same universe. */
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

function zipf(r: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(Math.pow(r(), 2.2) * n));
}

function field(r: () => number): [string, any] {
  if (r() < 0.25) {
    const e = ENTITIES[zipf(r, ENTITIES.length)];
    return [`${e}_id`, { type: "string" }];
  }
  const [name, type, format] = FIELDS[zipf(r, FIELDS.length)];
  return [name, { type, ...(format ? { format } : {}) }];
}

export function makeSpec(i: number, opsPerProvider = 10): any {
  const r = rng(i * 7919 + 13);
  const paths: Record<string, any> = {};
  for (let o = 0; o < opsPerProvider; o++) {
    const inputs = new Map<string, any>();
    const nIn = 1 + Math.floor(r() * 2);
    while (inputs.size < nIn) inputs.set(...field(r));
    const outputs = new Map<string, any>();
    const nOut = 1 + Math.floor(r() * 4);
    while (outputs.size < nOut) outputs.set(...field(r));
    const verb = ["get", "lookup", "convert", "enrich", "resolve", "score", "classify", "translate", "summarize", "locate"][o % 10];
    paths[`/op${o}`] = {
      get: {
        operationId: `${verb}${o}`,
        summary: `${verb} ${[...inputs.keys()].join(" and ")} into ${[...outputs.keys()].join(", ")}`,
        parameters: [...inputs].map(([name, schema]) => ({ name, in: "query", required: true, schema })),
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(outputs) } } } } },
      },
    };
  }
  return { openapi: "3.0.3", info: { title: `Provider ${i}`, version: "1" }, servers: [{ url: `/p/${i}` }], paths };
}

function valueFor(name: string, schema: any, seed: string): unknown {
  if (schema.type === "number") return name === "latitude" ? 38.7 : name === "longitude" ? -9.1 : (seed.length % 97) + 0.5;
  if (schema.type === "integer") return seed.length % 50;
  if (schema.format === "uri") return `https://example.com/${name}/${encodeURIComponent(seed.slice(0, 12))}`;
  if (schema.format === "email") return "someone@example.com";
  if (schema.format === "date-time") return "2026-10-16T12:00:00Z";
  if (schema.format === "ipv4") return "93.184.216.34";
  return `${name}:${seed.slice(0, 40)}`;
}

export interface UniverseOptions {
  /** Probability that a call fails (per provider, may be a function). */
  failure?: (provider: number) => number;
  /** Added latency in ms (per provider). */
  latency?: (provider: number) => number;
}

/** One fetch handler serving every provider at /p/<i>/openapi.json and /p/<i>/op<k>. */
export function universeHandler(opts: UniverseOptions = {}) {
  const specs = new Map<number, any>();
  const spec = (i: number) => {
    let s = specs.get(i);
    if (!s) specs.set(i, (s = makeSpec(i)));
    return s;
  };
  const chaos = rng(42);
  return async (req: Request): Promise<Response> => {
    const m = /^\/p\/(\d+)\/(openapi\.json|op\d+)$/.exec(new URL(req.url).pathname);
    if (!m) return new Response("not found", { status: 404 });
    const i = Number(m[1]);
    if (m[2] === "openapi.json") return Response.json(spec(i));
    const ms = opts.latency?.(i) ?? 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    if (chaos() < (opts.failure?.(i) ?? 0)) return new Response(JSON.stringify({ error: "chaos" }), { status: 503 });
    const op = spec(i).paths[`/${m[2]}`].get;
    const q = new URL(req.url).searchParams.toString();
    const props = op.responses["200"].content["application/json"].schema.properties;
    return Response.json(Object.fromEntries(Object.entries(props).map(([k, s]) => [k, valueFor(k, s, q || k)])));
  };
}
