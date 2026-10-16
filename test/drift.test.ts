import { test } from "node:test";
import assert from "node:assert/strict";
import { evolvingPolyglot, handWrittenClient } from "../demo/evolving.ts";
import { routerFetch } from "../demo/services.ts";
import { RightClick } from "../src/runtime.ts";

const ORIGIN = "https://polyglot.test";
const GOAL = {
  have: { text: "Hello world. The weather is sunny today.", language: "es" },
  want: "text",
  intent: "summary translated",
  verify: [{ op: "contains" as const, value: "Hola mundo" }],
};

test("self-maintaining integration survives four breaking API releases, including two protocol migrations", async () => {
  const svc = evolvingPolyglot();
  const f = routerFetch({ [ORIGIN]: svc.handler });
  const rc = await RightClick.create({ fetch: f, directories: [] });
  await rc.learn({ source: `${ORIGIN}/` });

  const first = await rc.compose({ ...GOAL, run: true });
  assert.equal(first.executed?.status, "completed");
  assert.equal(first.executed?.verification.status, "verified");
  assert.ok(first.crystallized, "the v1 pipeline is crystallized");
  const v1Pipeline = first.crystallized!.id;

  const sources: string[] = [];
  for (const v of [2, 3, 4] as const) {
    svc.setVersion(v);
    await assert.rejects(handWrittenClient(ORIGIN, "Hello world", "es", f), "the hand-written v1 client breaks");
    const r = await rc.compose({ ...GOAL, run: true });
    assert.equal(r.executed?.status, "completed", `v${v}: ${JSON.stringify(r.executed?.attempts)}`);
    assert.equal(r.executed?.verification.status, "verified");
    assert.match(String(r.executed?.output), /Hola mundo/);
    assert.ok(r.executed!.attempts.some((a) => /API drift/.test(a.healing ?? "")), `v${v} detected drift`);
    const translator = r.executed!.runs.map((id) => rc.runs.get(id)!).find((x) => !x.provider.startsWith("builtin") && !x.provider.startsWith("composite"));
    sources.push(rc.graph.providers.get(translator!.provider)?.source ?? "?");
  }
  assert.deepEqual(sources, ["openapi", "graphql", "mcp"]);
  assert.equal(rc.graph.get(v1Pipeline), undefined, "the stale v1 pipeline was retired");
  assert.equal([...rc.graph.providers.values()].filter((p) => p.meta?.source === `${ORIGIN}/`).length, 1, "old protocol providers were replaced, not left behind");
  assert.equal((await rc.verifyReceipts()).intact, true);
});

test("a contract change under the same operation id still retires the crystallized pipeline", async () => {
  const svc = evolvingPolyglot();
  const rc = await RightClick.create({ fetch: routerFetch({ [ORIGIN]: svc.handler }), directories: [] });
  await rc.learn({ source: `${ORIGIN}/` });
  const r = await rc.compose({ ...GOAL, run: true });
  const id = r.crystallized!.id;
  const translate = rc.graph.list().find((c) => c.source === "openapi")!;
  // Same id, different ports: the proof no longer holds.
  rc.graph.add({
    provider: { ...rc.graph.providers.get(translate.provider)!, capabilityIds: [] },
    capabilities: [{ ...translate, inputs: [...translate.inputs, { name: "formality", type: "text", required: true }] }],
  });
  assert.equal(rc.graph.get(id), undefined);
});

test("a provider that disappears is withdrawn: capabilities removed, pipelines retired, alternative used", async () => {
  const { SERVICES } = await import("../demo/services.ts");
  let primaryUp = true;
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    "https://primary.test": (req) => (primaryUp ? SERVICES.polyglot(req) : Promise.resolve(new Response("gone", { status: 404 }))),
    "https://backup.test": SERVICES.polyglot,
  };
  const rc = await RightClick.create({ fetch: routerFetch(routes), directories: [] });
  await rc.learn({ source: "https://primary.test/openapi.json" });
  const goal = { have: { text: "Hello world. The weather is sunny today.", language: "es" }, want: "text", intent: "summary translated", verify: [{ op: "contains" as const, value: "Hola mundo" }] };
  const first = await rc.compose({ ...goal, run: true });
  const pipeline = first.crystallized!.id;
  await rc.learn({ source: "https://backup.test/openapi.json" });

  primaryUp = false;
  const r = await rc.compose({ ...goal, run: true });
  assert.equal(r.executed?.status, "completed");
  assert.ok(r.executed!.attempts.some((a) => /provider gone/.test(a.healing ?? "")), JSON.stringify(r.executed!.attempts));
  assert.equal(rc.graph.providers.has("openapi:polyglot"), false, "the vanished provider is withdrawn");
  assert.equal(rc.graph.list().some((c) => c.id.startsWith("openapi:polyglot:")), false);
  assert.equal(rc.graph.get(pipeline), undefined, "the pipeline built on it is retired");
  const via = r.executed!.runs.map((id) => rc.runs.get(id)!.provider);
  assert.ok(via.includes("openapi:polyglot@backup-test"), via.join(","));

  // With no alternative left, the honest answer is "cannot", not a stale success.
  await rc.learn({ source: "https://backup.test/openapi.json" });
  routes["https://backup.test"] = async () => new Response("gone", { status: 404 });
  const none = await rc.compose({ ...goal, run: true });
  assert.notEqual(none.executed?.status, "completed");
});
