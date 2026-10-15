// "Polyglot" across four breaking releases, served from one origin.
// This is the shape API drift takes in the wild:
//
//   v1  REST    POST /translate         {text, target}              -> {translatedText}
//   v2  REST    POST /v2/translations   {input, targetLanguage}     -> {result: {translation}}
//               (renamed path, renamed fields, nested response, new operationId)
//   v3  GraphQL query translate(input: String!, to: String!) { translation }
//               (moved to a different protocol entirely)
//   v4  MCP     tool translate_text {text, language} -> {translation}
//               (moved again)
//
// Each version answers only its own contract; everything else is 404.

import { translate } from "./services.ts";

export type Version = 1 | 2 | 3 | 4;
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const notFound = () => json({ error: "not found" }, 404);

const V1_SPEC = {
  openapi: "3.0.3",
  info: { title: "Polyglot", version: "1.0.0" },
  paths: {
    "/translate": {
      post: {
        operationId: "translateText",
        summary: "Translate text",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text", "target"], properties: { text: { type: "string" }, target: { type: "string", description: "ISO 639-1 language code" } } } } } },
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { translatedText: { type: "string" } } } } } } },
      },
    },
  },
};

const V2_SPEC = {
  openapi: "3.1.0",
  info: { title: "Polyglot", version: "2.0.0" },
  paths: {
    "/v2/translations": {
      post: {
        operationId: "createTranslation",
        summary: "Create a translation",
        description: "Translate input text into the target language.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TranslationRequest" } } },
        },
        responses: { "201": { description: "created", content: { "application/json": { schema: { $ref: "#/components/schemas/TranslationResponse" } } } } },
      },
    },
  },
  components: {
    schemas: {
      TranslationRequest: { type: "object", required: ["input", "targetLanguage"], properties: { input: { type: "string" }, targetLanguage: { type: "string" } } },
      TranslationResponse: { type: "object", properties: { result: { type: "object", properties: { translation: { type: "string" }, detectedLanguage: { type: "string" } } } } },
    },
  },
};

const T = (kind: string, name: string | null, ofType: any = null) => ({ kind, name, ofType });
const V3_INTROSPECTION = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      mutationType: null,
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "translate",
              description: "Translate input text.",
              args: [
                { name: "input", type: T("NON_NULL", null, T("SCALAR", "String")), defaultValue: null },
                { name: "to", type: T("NON_NULL", null, T("SCALAR", "String")), defaultValue: null },
              ],
              type: T("OBJECT", "Translation"),
            },
          ],
        },
        { kind: "OBJECT", name: "Translation", fields: [{ name: "translation", args: [], type: T("SCALAR", "String") }] },
        { kind: "SCALAR", name: "String", fields: null },
      ],
    },
  },
};

const V4_TOOLS = [
  {
    name: "translate_text",
    title: "Translate text",
    description: "Translate text into a language.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, language: { type: "string" } }, required: ["text", "language"] },
    outputSchema: { type: "object", properties: { translation: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
];

export function evolvingPolyglot(): { handler: (req: Request) => Promise<Response>; setVersion(v: Version): void; version(): Version } {
  let v: Version = 1;
  const handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (v === 1) {
      if (u.pathname === "/openapi.json" && req.method === "GET") return json(V1_SPEC);
      if (u.pathname === "/translate" && req.method === "POST") return json({ translatedText: translate(body.text, body.target) });
      return notFound();
    }
    if (v === 2) {
      if (u.pathname === "/openapi.json" && req.method === "GET") return json(V2_SPEC);
      if (u.pathname === "/v2/translations" && req.method === "POST") {
        if (!body.input || !body.targetLanguage) return json({ error: "input and targetLanguage are required" }, 422);
        return json({ result: { translation: translate(body.input, body.targetLanguage), detectedLanguage: "en" } }, 201);
      }
      return notFound();
    }
    if (v === 3) {
      if (u.pathname !== "/graphql" || req.method !== "POST") return notFound();
      if (String(body.query).includes("__schema")) return json(V3_INTROSPECTION);
      const { input, to } = body.variables ?? {};
      return json({ data: { translate: { translation: translate(input, to) } } });
    }
    // v4: MCP
    if (u.pathname !== "/mcp" || req.method !== "POST") return notFound();
    if (body.id === undefined) return new Response(null, { status: 202 });
    const ok = (result: unknown) => json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Polyglot", version: "4.0.0" } } }, 200, { "mcp-session-id": "pg-" + Date.now() });
    if (body.method === "tools/list") return ok({ tools: V4_TOOLS });
    if (body.method === "tools/call" && body.params?.name === "translate_text") {
      const translation = translate(body.params.arguments.text, body.params.arguments.language);
      return ok({ content: [{ type: "text", text: translation }], structuredContent: { translation } });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
  };
  return { handler, setVersion: (n) => (v = n), version: () => v };
}

/** What every team writes today: a hand-written client for v1. */
export async function handWrittenClient(base: string, text: string, target: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${base}/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, target }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { translatedText?: string };
  if (typeof j.translatedText !== "string") throw new Error("response has no translatedText");
  return j.translatedText;
}
