// Evaluation transport, not a claim of whole-host containment.
import { TransportRefused } from "../../src/reflectors/net.ts";

export interface PublicSource { url: string; kind: "graphql" | "openapi" }
export interface Observation {
  id: number; url: string; method: string; body?: string;
  status?: number; bytes?: number; error?: string; discovery: boolean;
}

export function publicReadTransport(sources: PublicSource[], record: (row: Observation, body?: Uint8Array) => void,
  options: { fetch?: typeof fetch; spacingMs?: number; requestLimit?: number; bodyLimit?: number; totalLimit?: number } = {}) {
  const origins = new Set(sources.map(s => new URL(s.url).origin));
  const transport = options.fetch ?? fetch;
  const maximum = options.requestLimit ?? 24, bodyLimit = options.bodyLimit ?? 8 * 1024 * 1024;
  const totalLimit = options.totalLimit ?? 32 * 1024 * 1024;
  let requests = 0, total = 0, tail = Promise.resolve(), next = 0;
  const measured: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" || url.username || url.password || !origins.has(url.origin))
      throw new TransportRefused("evaluation permits configured public HTTPS origins only");
    const req = new Request(input, init);
    if (req.headers.has("authorization") || req.headers.has("cookie"))
      throw new TransportRefused("evaluation does not accept credentials");
    let body: string | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.method !== "POST" || !sources.some(s => s.kind === "graphql" && s.url === req.url))
        throw new TransportRefused("evaluation permits public reads only");
      body = await req.clone().text();
      if (body.length > 64 * 1024) throw new TransportRefused("evaluation query too large");
      let query: unknown;
      try { query = JSON.parse(body).query; } catch { /* refused below */ }
      // Conservative: refusing mutation text even inside a literal can reject a
      // valid query; it cannot permit a second mutation operation in this profile.
      if (typeof query !== "string" || !/^\s*(query\b|\{)/.test(query) || /\b(mutation|subscription)\b/.test(query))
        throw new TransportRefused("evaluation permits explicit GraphQL queries only");
    }
    if (++requests > maximum) throw new TransportRefused("evaluation request budget exhausted");
    const row: Observation = { id: requests, url: req.url, method: req.method, body,
      discovery: sources.some(s => s.kind === "openapi" && s.url === req.url) || /\b__(schema|type)\b/.test(body ?? "") };
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (total >= totalLimit) throw new TransportRefused("evaluation response budget exhausted");
      await new Promise(resolve => setTimeout(resolve, Math.max(0, next - Date.now())));
      next = Date.now() + (options.spacingMs ?? 1100);
      const headers = new Headers(req.headers);
      headers.set("user-agent", "RightClick-X-fresh-reuse-readonly/0.1");
      const response = await transport(new Request(req, { headers, credentials: "omit", redirect: "manual",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]) }));
      row.status = response.status;
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength; total += chunk.value.byteLength;
        if (bytes > bodyLimit || total > totalLimit) throw new TransportRefused("evaluation response byte budget exhausted");
        chunks.push(chunk.value);
      }
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      row.bytes = bytes; record(row, data);
      return new Response(response.body === null ? null : data, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      row.error = String(error); record(row); throw error;
    } finally {
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      release();
    }
  };
  return measured;
}
