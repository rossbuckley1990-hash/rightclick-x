import test from "node:test";
import assert from "node:assert/strict";
const source = process.env.RCX_TARGET ? new URL(`file://${process.env.RCX_TARGET}/src/`) : new URL("../src/", import.meta.url);
const { RightClick } = await import(new URL("runtime.ts", source).href);
const { reflectOpenAPI } = await import(new URL("reflectors/openapi.ts", source).href);

// The external audit's frozen GraphQL trace selects status -> text.stats.words,
// not __typename. Exercise the same mechanism across fields and descriptions.
for (const field of ["state", "description", "note"]) {
  test(`a ${field} statistic cannot substitute for a settlement amount`, async () => {
    let calls = 0;
    const rc = await RightClick.create({ directories: [], fetch: async () => {
      calls++; return Response.json({ settledMinor: 750000, [field]: "settled" });
    } });
    const schema = { type: "object", properties: {
      settledMinor: { type: "integer", description: "Amount in USD cents" }, [field]: { type: "string" },
    } };
    rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: "Gateway" }, paths: {
      "/balance": { get: { operationId: "accountSettlement", summary: "Account settlement total",
        parameters: [{ name: "account", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { content: { "application/json": { schema } } } } } },
    } }, "https://gateway.test/openapi.json"));
    const r = await rc.compose({ have: { account: { type: "account", value: "ACC-77" } },
      want: "number", intent: "account settlement total", run: true });
    assert.equal(r.executed, undefined, JSON.stringify(r));
    assert.equal(calls, 0, "unjustified measurement must be refused before dispatch");
  });
}

test("an explicitly requested word count remains executable and unverified", async () => {
  const rc = await RightClick.create({ directories: [] });
  const r = await rc.compose({ have: { text: "two words" }, want: "number", intent: "count words", run: true });
  assert.equal(r.executed?.output, 2);
  assert.equal(r.executed?.verification.status, "unverified");
});

// Independently exercise the contract boundary, including retained composites.
test("unused typed outputs cannot justify an unrequested count or decision", async () => {
  const { assessPlan } = await import(new URL("core/contract.ts", source).href);
  const rc = await RightClick.create({ directories: [] });
  const stats = rc.graph.get("builtin:text.stats")!;
  assert.ok(stats);
  stats.outputs.push({ name: "unused", type: "account.balance", required: false });
  for (const type of ["number", "boolean"]) {
    stats.outputs.find((p: { name: string }) => p.name === "words")!.type = type;
    const steps = [{ capability: stats.id, bindings: [{ port: "text", from: "$in.status" }] }];
    const ctx = { have: { status: "text" }, want: type, intent: new Set(["settlement"]), require: [], anchors: new Set<string>() };
    assert.equal(assessPlan(rc.graph, steps, "0.words", ctx).status, "violated");
    const composite = { ...stats, id: "composite:old-count", source: "composite" as const,
      invoke: { kind: "composite" as const, steps, result: "0.words" } };
    rc.graph.addCapability(composite, rc.graph.providers.get(stats.provider)!);
    assert.equal(assessPlan(rc.graph, [{ capability: composite.id, bindings: [{ port: "text", from: "$in.status" }] }], "0.words", ctx).status, "violated");
  }
});
