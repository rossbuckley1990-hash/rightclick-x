// Disposable proof infrastructure. This renderer has no country records or
// Wikipedia text: it formats arbitrary strings supplied by its caller.
type Env = { PROOF: any; ADMIN_TOKEN: string; AUDITOR_URL: string };
type Version = 1 | 2 | 3;
const TITLE = "Render sourced destination brief";
const COUNTRIES = "https://countries.trevorblades.com/";
const WIKI_SPEC = "https://en.wikipedia.org/api/rest_v1/?spec";
const json = (value: unknown, status = 200) => Response.json(value, { status });
const placeSchema = { type: "string", description: "Capital city or place name" };
const textSchema = { type: "string", description: "Complete plain text Wikipedia summary for this place" };
const markdownSchema = { type: "string", description: "Sourced destination brief in Markdown" };

function render(place: unknown, text: unknown): string {
  if (typeof place !== "string" || typeof text !== "string" || !place.trim() || !text.trim()) throw new Error("A nonempty place and complete summary text are required");
  if (place.length > 200 || text.length > 24000 || /[\r\n\[\]<>]/.test(place)) throw new Error("Invalid place or oversized summary");
  const location = place.normalize("NFC").trim();
  const extract = text.normalize("NFC").replace(/\r\n/g, "\n").trim();
  const source = `https://en.wikipedia.org/wiki/${encodeURIComponent(location.replaceAll(" ", "_"))}`;
  return `# Destination brief: ${location}\n\n${extract}\n\nSource: [Wikipedia — ${location}](${source})\n`;
}

export function formatterContract(origin: string, version: Version) {
  const path = version === 1 ? "/v1/brief" : "/v2/destination-document";
  const place = version === 1 ? "place" : "location";
  const text = version === 1 ? "text" : "content";
  return {
    openapi: "3.0.3", info: { title: "Live Destination Formatter", version: String(version) }, servers: [{ url: origin }],
    paths: { [path]: { get: {
      operationId: version === 1 ? "renderDestinationBrief" : "produceDestinationDocument", summary: TITLE,
      description: "Render a sourced Markdown destination brief from a place and its complete Wikipedia summary. This operation does not fetch or invent facts.",
      parameters: [
        { name: place, in: "query", required: true, schema: placeSchema },
        { name: text, in: "query", required: true, schema: textSchema },
      ],
      responses: { "200": { description: "Sourced destination brief", content: { "application/json": { schema: {
        type: "object", properties: version === 1 ? { markdown: markdownSchema } : { document: { type: "object", properties: { markdown: markdownSchema } } },
      } } } } },
    } } },
  };
}

export function formatterTools() {
  return [{
    name: "render_destination_document", title: TITLE,
    description: "Render a sourced Markdown destination brief from a place and its complete Wikipedia summary. This operation does not fetch or invent facts.",
    inputSchema: { type: "object", properties: { city: placeSchema, content: textSchema }, required: ["city", "content"] },
    outputSchema: { type: "object", properties: { artifact: { type: "object", properties: { markdown: markdownSchema } } } },
    annotations: { readOnlyHint: true },
  }];
}

export class FormatterState {
  private storage: any;
  private env: Env;
  constructor(state: any, env: Env) { this.storage = state.storage; this.env = env; }
  private async event(action: string, detail: Record<string, unknown>) {
    await this.storage.transaction(async (tx: any) => {
      const sequence = ((await tx.get("sequence")) ?? 0) + 1;
      await tx.put("sequence", sequence);
      await tx.put(`event:${String(sequence).padStart(8, "0")}`, { sequence, at: new Date().toISOString(), service: "formatter", action, detail });
      if (sequence > 1000) await tx.delete(`event:${String(sequence - 1000).padStart(8, "0")}`);
    });
  }
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const version: Version = (await this.storage.get("version")) ?? 1;
    if (u.pathname === "/__admin/events") {
      const since = Number(u.searchParams.get("since") ?? 0);
      const events = [...(await this.storage.list({ prefix: "event:" })).values()].filter((e: any) => e.sequence > since);
      return json({ events });
    }
    if (u.pathname === "/__admin/version") {
      if (req.method === "POST") {
        const body: any = await req.json();
        if (![1, 2, 3].includes(body.version)) return json({ error: "version must be 1, 2 or 3" }, 400);
        await this.storage.put("version", body.version);
        await this.event("version", { previous: version, version: body.version });
        return json({ version: body.version });
      }
      return json({ version });
    }
    if (u.pathname === "/.well-known/api-catalog") {
      const listed = [COUNTRIES, WIKI_SPEC, `${u.origin}/formatter`, this.env.AUDITOR_URL];
      await this.event("catalog", { listed, version });
      return json({ linkset: [{ anchor: u.href, item: listed.map((href) => ({ href })) }] });
    }
    if (u.pathname === "/health") return json({ service: "formatter", version });
    if (u.pathname === "/") return new Response("<!doctype html><html><head><title>Destination brief service directory</title></head><body><h1>Destination brief services</h1><p>This disposable proof directory lists a public countries GraphQL API, Wikipedia's public REST contract, an owned document formatter, and a separately deployed auditor.</p></body></html>", { headers: { "content-type": "text/html" } });
    if (u.pathname === "/formatter" && req.method === "GET" && version !== 3) return json(formatterContract(u.origin, version));
    if (version !== 3 && req.method === "GET" && u.pathname === (version === 1 ? "/v1/brief" : "/v2/destination-document")) {
      const place = u.searchParams.get(version === 1 ? "place" : "location");
      const text = u.searchParams.get(version === 1 ? "text" : "content");
      try {
        const markdown = render(place, text);
        await this.event("render", { version, place, text, markdown, protocol: "openapi" });
        return json(version === 1 ? { markdown } : { document: { markdown } });
      } catch (e) { return json({ error: String(e) }, 400); }
    }
    if (version === 3 && u.pathname === "/formatter" && req.method === "POST") {
      const body: any = await req.json();
      if (body.id === undefined && body.method?.startsWith("notifications/")) return new Response(null, { status: 202 });
      const ok = (result: unknown) => json({ jsonrpc: "2.0", id: body.id ?? null, result });
      if (body.method === "initialize") return ok({ protocolVersion: body.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Live Destination Formatter MCP", version: "3" } });
      if (body.method === "tools/list") return ok({ tools: formatterTools() });
      if (body.method === "tools/call" && body.params?.name === "render_destination_document") {
        const args = body.params.arguments ?? {};
        try {
          const markdown = render(args.city, args.content);
          await this.event("render", { version, place: args.city, text: args.content, markdown, protocol: "mcp" });
          const structuredContent = { artifact: { markdown } };
          return ok({ content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent });
        } catch (e) { return ok({ content: [{ type: "text", text: String(e) }], isError: true }); }
      }
      return json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "method not found" } });
    }
    if (/^\/v[12]\//.test(u.pathname) || u.pathname === "/formatter") await this.event("retired-request", { version, path: u.pathname, method: req.method, status: 404 });
    return json({ error: "not found" }, 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/__admin") && (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: "forbidden" }, 403);
    if (Number(req.headers.get("content-length") ?? 0) > 64000) return json({ error: "request too large" }, 413);
    return env.PROOF.get(env.PROOF.idFromName("main")).fetch(req);
  },
};
