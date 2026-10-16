// Independent proof service. It neither calls nor imports the formatter and
// does not hold canned country facts or Wikipedia extracts.
type Env = { PROOF: any; ADMIN_TOKEN: string };
const COUNTRIES = "https://countries.trevorblades.com/";
const USER_AGENT = "RightClickX-LiveProof/0.1 (bounded read-only destination verification)";
const json = (value: unknown, status = 200) => Response.json(value, { status });
const normalize = (value: string) => value.normalize("NFC").replace(/\r\n/g, "\n").trim();

export function auditorContract(origin: string) {
  return {
    openapi: "3.0.3", info: { title: "Independent Live Destination Auditor", version: "1" }, servers: [{ url: origin }],
    paths: { "/audit": { get: {
      operationId: "auditDestinationBrief", summary: "Audit destination brief independently",
      description: "Fetch current country and Wikipedia data directly, then check the complete candidate Markdown brief, heading and Wikipedia source link. Returns validity without returning a proposed answer.",
      parameters: [
        { name: "country", in: "query", required: true, schema: { type: "string", description: "ISO 3166 country code", "x-rightclick-type": "country" } },
        { name: "candidate", in: "query", required: true, schema: { type: "string", description: "Complete Markdown destination brief to verify", "x-rightclick-type": "markdown" } },
      ],
      responses: { "200": { description: "Independent verdict", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } },
    } } },
  };
}

async function directJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status} at ${url}`);
  return await response.json() as any;
}

async function inspectCandidate(country: string, candidate: string) {
  const countries = await directJson(COUNTRIES, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query Destination($code: ID!) { country(code: $code) { code name capital } }", variables: { code: country } }) });
  const record = countries?.data?.country;
  if (!record || record.code !== country || typeof record.capital !== "string" || !record.capital.trim()) throw new Error("Public country source returned no valid capital");
  const capital = normalize(record.capital);
  const wikiRequest = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capital)}`;
  const wiki = await directJson(wikiRequest);
  const canonical = wiki?.content_urls?.desktop?.page;
  if (wiki?.type !== "standard" || typeof wiki.extract !== "string" || !wiki.extract.trim() || typeof wiki.title !== "string" || !Number.isInteger(wiki.pageid) || wiki.namespace?.id !== 0 || typeof canonical !== "string" || new URL(canonical).origin !== "https://en.wikipedia.org") throw new Error("Wikipedia returned no unambiguous canonical article");
  // The public summary endpoint resolves aliases (e.g. Reykjavik→Reykjavík).
  // The source link is the requested capital article, whose canonical identity
  // and page ID are independently recorded above.
  const source = `https://en.wikipedia.org/wiki/${encodeURIComponent(capital.replaceAll(" ", "_"))}`;
  const parts = /^# Destination brief: ([^\n]+)\n\n([\s\S]+)\n\nSource: \[Wikipedia — ([^\]]+)\]\(([^\n]+)\)$/.exec(normalize(candidate));
  const valid = !!parts && parts[1] === capital && parts[2] === normalize(wiki.extract) && parts[3] === capital && parts[4] === source;
  return {
    valid, country, countryName: record.name, capital, wikiTitle: wiki.title, wikiPageId: wiki.pageid,
    extract: wiki.extract, brief: candidate, sourceURLs: { countries: COUNTRIES, wikipediaRequest: wikiRequest, wikipediaCanonical: canonical, briefSource: source },
    fetchedAt: new Date().toISOString(),
  };
}

export class AuditorState {
  private storage: any;
  constructor(state: any) { this.storage = state.storage; }
  private async event(action: string, detail: Record<string, unknown>) {
    await this.storage.transaction(async (tx: any) => {
      const sequence = ((await tx.get("sequence")) ?? 0) + 1;
      await tx.put("sequence", sequence);
      await tx.put(`event:${String(sequence).padStart(8, "0")}`, { sequence, at: new Date().toISOString(), service: "auditor", action, detail });
      if (sequence > 1000) await tx.delete(`event:${String(sequence - 1000).padStart(8, "0")}`);
    });
  }
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === "/__admin/events") {
      const since = Number(u.searchParams.get("since") ?? 0);
      const events = [...(await this.storage.list({ prefix: "event:" })).values()].filter((e: any) => e.sequence > since);
      return json({ events });
    }
    if (u.pathname === "/health") return json({ service: "auditor" });
    if (u.pathname === "/openapi.json") return json(auditorContract(u.origin));
    if (u.pathname === "/audit" && req.method === "GET") {
      const country = u.searchParams.get("country") ?? "";
      const candidate = u.searchParams.get("candidate") ?? "";
      if (!/^[A-Z]{2}$/.test(country) || !candidate || candidate.length > 30000) return json({ error: "country code and bounded candidate Markdown required" }, 400);
      try {
        const detail = await inspectCandidate(country, candidate);
        await this.event("check", detail);
        return json({ valid: detail.valid });
      } catch (error) {
        await this.event("source-error", { country, brief: candidate, error: String(error) });
        return json({ error: String(error) }, 502);
      }
    }
    return json({ error: "not found" }, 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/__admin") && (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: "forbidden" }, 403);
    return env.PROOF.get(env.PROOF.idFromName("main")).fetch(req);
  },
};
