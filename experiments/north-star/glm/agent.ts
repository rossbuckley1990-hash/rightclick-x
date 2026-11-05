// The GLM agent session for the development evaluation (North Star, deviation-recorded).
// The preregistered protocol drives Claude Code; Claude is unavailable in this
// environment, so this development harness drives the same task/scoring shape with the
// same model for every arm. All measurements (tokens, turns, tool calls, wall time) and
// the full transcript are preserved per session.
// The SDK is a development-environment dependency (not a product dependency): resolve it
// from the local node_modules when present, else from the global install location.
const { default: ZAI } = await (async () => {
  try { return await import("z-ai-web-dev-sdk"); } catch { /* fall through to the global path */ }
  return await import("/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js");
})();
import { mkdirSync, writeFileSync } from "node:fs";

const zai = await ZAI.create();

/** Chat completion with backoff: the shared development endpoint rate-limits bursts
 *  (429) and has transient failures; a session must not be lost to either. */
async function complete(body: any): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      return await zai.chat.completions.create(body);
    } catch (e) {
      lastError = e;
      const message = String((e as Error)?.message ?? e);
      const retryable = /429|too many requests|rate limit|5\d\d|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
      if (!retryable || attempt === 6) throw e;
      const waitMs = [2000, 4000, 8000, 16000, 32000, 60000][attempt] + Math.floor(Math.random() * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string>;
}

export interface SessionResult {
  answer: string;
  tokens: number;
  turns: number;
  toolCalls: { tool: string; args: Record<string, unknown> }[];
  seconds: number;
  error?: string;
}

export async function runAgent(opts: {
  system: string;
  prompt: string;
  tools: AgentTool[];
  maxTurns?: number;
  evidenceDir: string;
  label: string;
}): Promise<SessionResult> {
  mkdirSync(opts.evidenceDir, { recursive: true });
  const t0 = performance.now();
  const messages: any[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.prompt },
  ];
  const toolCalls: SessionResult["toolCalls"] = [];
  let tokens = 0;
  let turns = 0;
  let answer = "";
  let error: string | undefined;
  const maxTurns = opts.maxTurns ?? 24;
  try {
    for (; turns < maxTurns; turns++) {
      const out: any = await complete({
        messages,
        tools: opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: "auto",
        thinking: { type: "disabled" },
      });
      tokens += Number(out?.usage?.total_tokens ?? 0);
      const msg = out?.choices?.[0]?.message;
      messages.push(msg ?? { role: "assistant", content: "" });
      if (msg?.tool_calls?.length) {
        for (const call of msg.tool_calls) {
          let result: string;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(call.function?.arguments || "{}");
          } catch { /* the model gets the parse error back verbatim */ }
          try {
            toolCalls.push({ tool: call.function?.name, args: parsed });
            result = String(await opts.tools.find((t) => t.name === call.function?.name)?.call(parsed) ?? `no such tool: ${call.function?.name}`);
          } catch (e) {
            result = `TOOL ERROR: ${String((e as Error)?.message ?? e)}`;
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 60_000) });
        }
        continue;
      }
      answer = String(msg?.content ?? "");
      break;
    }
    if (turns >= maxTurns) answer = answer || "UNABLE: turn budget exhausted";
  } catch (e) {
    error = String((e as Error)?.message ?? e);
    answer = `UNABLE: harness error (${error})`;
  }
  const result: SessionResult = { answer, tokens, turns: turns + 1, toolCalls, seconds: Math.round((performance.now() - t0) / 100) / 10, ...(error ? { error } : {}) };
  writeFileSync(`${opts.evidenceDir}/${opts.label}.json`, JSON.stringify({ prompt: opts.prompt, system: opts.system, messages, result }, null, 1));
  return result;
}
