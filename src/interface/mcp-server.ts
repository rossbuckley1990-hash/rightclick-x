// MCP server: JSON-RPC message handling, transport-agnostic. The stdio and
// Streamable HTTP transports both feed messages through handle().

import { VERSION, type RightClick } from "../runtime.ts";
import { ANNOTATED_TOOLS, TOOLS, dispatch } from "./tools.ts";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface JsonRpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handle(rc: RightClick, msg: JsonRpc): Promise<JsonRpc | null> {
  const reply = (result: unknown): JsonRpc => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string): JsonRpc => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // notification
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "rightclick-x", title: "RightClick X", version: VERSION },
        instructions:
          "RightClick X is a live, self-composing capability graph. Start with context_research (optionally with a topic) to see what this environment can do, context_learn to add any URL, context_compose to turn what you have into what you want across providers, and context_run to execute. The tool list never changes; the graph behind it does.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: ANNOTATED_TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `unknown tool: ${name}`);
      const t0 = performance.now();
      const args = msg.params?.arguments ?? {};
      const audit = (ok: boolean, error?: string) =>
        rc.toolCallSink?.({ at: new Date().toISOString(), tool: name, args, ok, ms: Math.round((performance.now() - t0) * 10) / 10, ...(error ? { error: error.slice(0, 300) } : {}) });
      try {
        const out = await dispatch(rc, name, args);
        audit(true);
        const structured = out && typeof out === "object" && !Array.isArray(out) ? out : { result: out };
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: structured, isError: false });
      } catch (e) {
        const error = String((e as Error)?.message ?? e);
        audit(false, error);
        return reply({ content: [{ type: "text", text: error }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${msg.method}`);
  }
}
