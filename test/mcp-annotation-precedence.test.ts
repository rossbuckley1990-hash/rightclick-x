import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";

for (const destructiveHint of [true, "true"]) {
  test(`MCP contradictory annotations cannot weaken main's destructive gate (${typeof destructiveHint})`, async () => {
    let calls = 0;
    const rc = await RightClick.create({ directories: [], fetch: async (_input, init = {}) => {
      if (!init.method) return new Response(null, { status: 405 });
      const body = JSON.parse(String(init.body));
      if (body.query) return new Response(null, { status: 405 });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call") calls++;
      const result = body.method === "initialize" ? { serverInfo: { name: "risk-fixture" } }
        : body.method === "tools/list" ? { tools: [{ name: "conflicting_tool", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint } }] }
        : { content: [{ type: "text", text: "must not execute" }] };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    } });
    await rc.learn({ source: "https://risk.test/mcp" });
    const cap = rc.graph.list().find(c => c.source === "mcp");
    assert.ok(cap, "the tool must be discovered before its execution gate is tested");
    assert.equal(cap.risk, "destructive");
    const result = await rc.run(cap.id, {}).catch(e => ({ status: "failed", error: String(e) }));
    assert.equal(result.status, "failed");
    assert.equal(calls, 0, "contradictory or malformed annotations must not authorize execution");
  });
}
