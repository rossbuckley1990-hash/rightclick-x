// Four independent demo services, each speaking a different protocol, none of
// which knows RightClick X exists:
//
//   Polyglot  — OpenAPI 3 REST API: translation + sentiment
//   Atlas     — GraphQL API: geocoding + country facts
//   Skycast   — MCP server (Streamable HTTP): weather forecast + air quality
//   Newsroom  — plain HTML site with a search form
//
// They are fetch handlers, so they can run behind real localhost servers (the
// demo) or an in-memory router (the tests).

type Handler = (req: Request) => Promise<Response>;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

// ------------------------------------------------------------------ Polyglot

const DICT: Record<string, Record<string, string>> = {
  es: { sunny: "soleado", cloudy: "nublado", rain: "lluvia", light: "ligera", clear: "despejado", skies: "cielos", expect: "se esperan", with: "con", a: "una", high: "máxima", of: "de", in: "en", today: "hoy", and: "y", wind: "viento", breeze: "brisa", gentle: "suave", hello: "hola", world: "mundo", weather: "tiempo" },
  fr: { sunny: "ensoleillé", cloudy: "nuageux", rain: "pluie", light: "légère", clear: "dégagé", skies: "ciel", expect: "attendez-vous à", with: "avec", a: "une", high: "maximale", of: "de", in: "à", today: "aujourd'hui", and: "et", wind: "vent", breeze: "brise", gentle: "douce", hello: "bonjour", world: "monde", weather: "météo" },
};

export function translate(text: string, target: string): string {
  const d = DICT[target];
  if (!d) return `[${target}] ${text}`;
  return text.replace(/[A-Za-z]+/g, (w) => {
    const t = d[w.toLowerCase()];
    if (!t) return w;
    return w[0] === w[0].toUpperCase() ? t[0].toUpperCase() + t.slice(1) : t;
  });
}

const POLYGLOT_SPEC = {
  openapi: "3.0.3",
  info: { title: "Polyglot", version: "1.0.0", description: "Translation and sentiment analysis." },
  servers: [{ url: "/" }],
  paths: {
    "/translate": {
      post: {
        operationId: "translateText",
        summary: "Translate text",
        description: "Translate text into a target language.",
        tags: ["translation", "language"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text", "target"],
                properties: {
                  text: { type: "string", description: "Text to translate" },
                  target: { type: "string", description: "Target ISO 639-1 language code" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Translated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Translation" },
              },
            },
          },
        },
      },
    },
    "/sentiment": {
      get: {
        operationId: "analyzeSentiment",
        summary: "Analyze sentiment",
        tags: ["sentiment", "nlp"],
        parameters: [{ name: "text", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Sentiment",
            content: { "application/json": { schema: { type: "object", properties: { score: { type: "number" }, label: { type: "string" } } } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Translation: {
        type: "object",
        properties: { translatedText: { type: "string" }, detectedLanguage: { type: "string" } },
      },
    },
  },
};

export const polyglot: Handler = async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/openapi.json") return json(POLYGLOT_SPEC);
  if (u.pathname === "/translate" && req.method === "POST") {
    const b = (await req.json()) as { text?: string; target?: string };
    if (!b.text || !b.target) return json({ error: "text and target required" }, 400);
    return json({ translatedText: translate(b.text, b.target), detectedLanguage: "en" });
  }
  if (u.pathname === "/sentiment") {
    const t = (u.searchParams.get("text") ?? "").toLowerCase();
    const score = (t.match(/sunny|clear|good|great|gentle/g)?.length ?? 0) - (t.match(/rain|storm|bad|smog/g)?.length ?? 0);
    return json({ score, label: score > 0 ? "positive" : score < 0 ? "negative" : "neutral" });
  }
  return json({ error: "not found" }, 404);
};

// ------------------------------------------------------------------ Atlas

const PLACES: Record<string, { name: string; latitude: number; longitude: number; countryCode: string }> = {
  lisbon: { name: "Lisbon", latitude: 38.7223, longitude: -9.1393, countryCode: "PT" },
  tokyo: { name: "Tokyo", latitude: 35.6762, longitude: 139.6503, countryCode: "JP" },
  nairobi: { name: "Nairobi", latitude: -1.2921, longitude: 36.8219, countryCode: "KE" },
  lima: { name: "Lima", latitude: -12.0464, longitude: -77.0428, countryCode: "PE" },
};
const COUNTRIES: Record<string, { name: string; capital: string; currency: string }> = {
  PT: { name: "Portugal", capital: "Lisbon", currency: "EUR" },
  JP: { name: "Japan", capital: "Tokyo", currency: "JPY" },
  KE: { name: "Kenya", capital: "Nairobi", currency: "KES" },
  PE: { name: "Peru", capital: "Lima", currency: "PEN" },
};

const T = (kind: string, name: string | null, ofType: any = null) => ({ kind, name, ofType });
const NN = (t: any) => T("NON_NULL", null, t);
const S = (n: string) => T("SCALAR", n);
const field = (name: string, type: any, args: any[] = [], description: string | null = null) => ({ name, description, args, type });
const arg = (name: string, type: any, description: string | null = null) => ({ name, description, type, defaultValue: null });

const ATLAS_INTROSPECTION = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      mutationType: null,
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          description: null,
          fields: [
            field("geocode", T("OBJECT", "Location"), [arg("place", NN(S("String")))], "Find coordinates for a place name."),
            field("country", T("OBJECT", "Country"), [arg("code", NN(S("String")), "ISO 3166 country code")], "Facts about a country."),
          ],
        },
        {
          kind: "OBJECT",
          name: "Location",
          description: null,
          fields: [field("name", NN(S("String"))), field("latitude", NN(S("Float"))), field("longitude", NN(S("Float"))), field("countryCode", NN(S("String")))],
        },
        {
          kind: "OBJECT",
          name: "Country",
          description: null,
          fields: [field("name", NN(S("String"))), field("capital", S("String")), field("currency", S("String"))],
        },
        { kind: "SCALAR", name: "String", description: null, fields: null },
        { kind: "SCALAR", name: "Float", description: null, fields: null },
      ],
    },
  },
};

export const atlas: Handler = async (req) => {
  if (req.method !== "POST") return json({ error: "POST GraphQL queries to /graphql" }, 405);
  const { query, variables = {} } = (await req.json()) as { query: string; variables?: Record<string, any> };
  if (query.includes("__schema")) return json(ATLAS_INTROSPECTION);
  if (/\bgeocode\s*\(/.test(query)) {
    const p = PLACES[String(variables.place ?? "").toLowerCase()];
    return json({ data: { geocode: p ?? null }, ...(p ? {} : { errors: [{ message: `unknown place ${variables.place}` }] }) });
  }
  if (/\bcountry\s*\(/.test(query)) return json({ data: { country: COUNTRIES[String(variables.code).toUpperCase()] ?? null } });
  return json({ errors: [{ message: "unsupported query" }] });
};

// ------------------------------------------------------------------ Skycast (MCP)

function forecastFor(lat: number, lon: number, days = 1) {
  // Deterministic toy weather so tests are stable.
  const t = Math.round(28 - Math.abs(lat) * 0.35 + ((lon * 7) % 5));
  const conditions = t > 22 ? "sunny" : t > 15 ? "cloudy" : "light rain";
  return {
    summary: `Expect ${conditions} skies with a high of ${t}°C and a gentle breeze today.`,
    temperatureC: t,
    conditions,
    days,
  };
}

const SKYCAST_TOOLS = [
  {
    name: "forecast",
    title: "Weather forecast",
    description: "Weather forecast for coordinates.",
    inputSchema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" }, days: { type: "number" } }, required: ["latitude", "longitude"] },
    outputSchema: { type: "object", properties: { summary: { type: "string" }, temperatureC: { type: "number" }, conditions: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "air_quality",
    title: "Air quality",
    description: "Air quality index for coordinates.",
    inputSchema: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] },
    outputSchema: { type: "object", properties: { aqi: { type: "number" }, category: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
];

export const skycast: Handler = async (req) => {
  if (req.method !== "POST") return new Response("MCP: POST only", { status: 405 });
  const msg = (await req.json()) as any;
  if (msg.id === undefined) return new Response(null, { status: 202 });
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Skycast", version: "1.0.0" } } }), {
        headers: { "content-type": "application/json", "mcp-session-id": "sky-" + Math.random().toString(36).slice(2) },
      });
    case "tools/list":
      return ok({ tools: SKYCAST_TOOLS });
    case "tools/call": {
      const a = msg.params.arguments ?? {};
      if (msg.params.name === "forecast") {
        const f = forecastFor(Number(a.latitude), Number(a.longitude), a.days);
        return ok({ content: [{ type: "text", text: f.summary }], structuredContent: f });
      }
      if (msg.params.name === "air_quality") {
        const aqi = Math.round(20 + Math.abs(Number(a.lat) * 1.3));
        const r = { aqi, category: aqi < 50 ? "good" : "moderate" };
        return ok({ content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r });
      }
      return ok({ content: [{ type: "text", text: "unknown tool" }], isError: true });
    }
    default:
      return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
};

// ------------------------------------------------------------------ Newsroom (plain web)

const ARTICLE = `RightClick X turns every reachable service into a typed capability. Engineers in Lisbon used it to connect a geocoder, a weather server and a translation API without writing integration code. The runtime discovered each service, inferred the meaning of its inputs and outputs, and linked them into a graph. When a pipeline succeeded, the runtime saved it as a new capability that other agents could reuse. Critics asked whether automatic composition can be trusted. The answer, the team said, is receipts: every run is hashed into a verifiable chain, and every result can be checked against explicit predicates.`;

export const newsroom: Handler = async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/search") {
    const q = u.searchParams.get("q") ?? "";
    return new Response(`<!doctype html><html><head><title>Search: ${q}</title></head><body><h1>Results for ${q}</h1><p>1 article mentions ${q}.</p><a href="/article">Capability graphs arrive</a></body></html>`, {
      headers: { "content-type": "text/html" },
    });
  }
  if (u.pathname === "/article") {
    return new Response(`<!doctype html><html><head><title>Capability graphs arrive</title></head><body><nav>Home · World · Tech</nav><article><h1>Capability graphs arrive</h1><p>${ARTICLE}</p></article></body></html>`, {
      headers: { "content-type": "text/html" },
    });
  }
  return new Response(
    `<!doctype html><html><head><title>Newsroom</title></head><body><h1>Newsroom</h1>
<form action="/search" method="get" aria-label="Search articles"><input type="search" name="q" placeholder="Search articles" required><input type="hidden" name="src" value="home"><button>Go</button></form>
<a href="/article">Capability graphs arrive</a></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
};

export const SERVICES = { polyglot, atlas, skycast, newsroom } as const;

/** In-memory fetch that routes by origin, falling back to `fallback`. */
export function routerFetch(routes: Record<string, Handler>, fallback?: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const h = routes[new URL(req.url).origin];
    if (h) return h(req);
    if (fallback) return fallback(req);
    return new Response("no route", { status: 502 });
  }) as typeof fetch;
}
