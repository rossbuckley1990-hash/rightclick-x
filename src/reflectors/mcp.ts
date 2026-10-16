// Remote MCP servers (Streamable HTTP) -> typed capabilities.
// RightClick X is itself an MCP server, so absorbing other MCP servers means
// one connection gives an agent every tool behind every server it learned.

import { inferType } from "../core/semantics.ts";
import type { Capability, Port, Reflection, Risk } from "../core/types.ts";
import { request, slug, type Net } from "./net.ts";

const PROTOCOL = "2025-06-18";

export class McpClient {
  private session: string | null = null;
  private ready: Promise<any> | null = null;
  private id = 0;
  serverInfo: { name?: string; version?: string } = {};
  private endpoint: string;
  private net: Net;

  constructor(endpoint: string, net: Net) {
    this.endpoint = endpoint;
    this.net = net;
  }

  private async rpc(method: string, params?: unknown, notify = false): Promise<any> {
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.id, method, params };
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
    };
    if (this.session) headers["mcp-session-id"] = this.session;
    const res = await request(this.net, this.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (notify) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) throw new Error(`MCP ${method} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const msg = await parseRpcResponse(res, (body as { id: number }).id);
    if (msg.error) throw new Error(`MCP ${method} error ${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  }

  async init(): Promise<void> {
    this.ready ??= (async () => {
      const r = await this.rpc("initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "rightclick-x", version: "0.1.0" },
      });
      this.serverInfo = r?.serverInfo ?? {};
      await this.rpc("notifications/initialized", undefined, true);
      return r;
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    await this.ready;
  }

  async listTools(): Promise<any[]> {
    await this.init();
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {});
      tools.push(...(r?.tools ?? []));
      cursor = r?.nextCursor;
    } while (cursor && tools.length < 2000);
    return tools;
  }

  /** Returns structured content when the caller wants it (tool has an output schema), else the text. */
  async call(name: string, args: Record<string, unknown>, structured = true): Promise<unknown> {
    await this.init();
    let r: any;
    try {
      r = await this.rpc("tools/call", { name, arguments: args });
    } catch (e) {
      // Sessions expire; reconnect once.
      if (!/HTTP (400|404)/.test(String(e))) throw e;
      this.session = null;
      this.ready = null;
      await this.init();
      r = await this.rpc("tools/call", { name, arguments: args });
    }
    const text = (r?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    if (r?.isError) throw new Error(text || "MCP tool reported an error");
    return structured && r?.structuredContent !== undefined ? r.structuredContent : text;
  }
}

async function parseRpcResponse(res: Response, id: number): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.includes("event-stream")) return JSON.parse(text);
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const msg = JSON.parse(data);
    if (msg.id === id) return msg;
  }
  throw new Error("MCP stream ended without a response");
}

export function reflectMcpTools(tools: any[], endpoint: string, serverName?: string): Reflection {
  const host = new URL(endpoint).host;
  const title = serverName || `MCP ${host}`;
  const providerId = `mcp:${slug(serverName || host + new URL(endpoint).pathname)}`;
  const capabilities: Capability[] = tools.map((t) => {
    const props: Record<string, any> = t.inputSchema?.properties ?? {};
    const req = new Set<string>(t.inputSchema?.required ?? []);
    const inputs: Port[] = Object.entries(props).map(([name, s]) => ({
      ...(Array.isArray(s?.enum) ? { enum: s.enum.map(String) } : {}),
      name,
      type: inferType(name, s, s?.description ?? ""),
      required: req.has(name),
      description: s?.description,
      wire: s?.type,
    }));
    const outputs: Port[] = [];
    const os = t.outputSchema;
    if (os?.properties) {
      outputs.push({ name: "", type: "json", required: true });
      for (const [name, s] of Object.entries<any>(os.properties)) {
        outputs.push({ name, type: inferType(name, s, s?.description ?? ""), required: true, wire: s?.type });
        // One level of nesting, as the OpenAPI and GraphQL reflectors do ({ result: { rate } }).
        for (const [sub, ss] of Object.entries<any>(s?.properties ?? {}).slice(0, 12)) {
          outputs.push({ name: `${name}.${sub}`, type: inferType(sub, ss, ss?.description ?? ""), required: true, wire: ss?.type });
        }
      }
    } else {
      outputs.push({ name: "", type: "text", required: true });
    }
    const a = t.annotations ?? {};
    const risk: Risk = a.destructiveHint ? "destructive" : a.readOnlyHint ? "read" : a.openWorldHint === false ? "write" : "external";
    return {
      id: `${providerId}:${slug(t.name)}`,
      title: t.title ?? a.title ?? t.name,
      description: String(t.description ?? "").slice(0, 400),
      provider: providerId,
      source: "mcp",
      inputs,
      outputs,
      risk,
      tags: ["mcp", host, t.name],
      invoke: { kind: "mcp", endpoint, tool: t.name },
    };
  });
  return {
    provider: {
      id: providerId,
      title,
      source: "mcp",
      origin: endpoint,
      learnedAt: new Date().toISOString(),
      capabilityIds: capabilities.map((c) => c.id),
    },
    capabilities,
  };
}
