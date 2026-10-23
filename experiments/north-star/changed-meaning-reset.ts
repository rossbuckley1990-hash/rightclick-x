// Diagnostic, not a containment acceptance test. All effects are local in-memory
// fixture writes; no external service is contacted. Run from a frozen source tree.
import { RightClick, type PersistedState } from "../../src/runtime.ts";

let path = "/old";
let state: PersistedState | null = null;
const effects: Array<{ method: string; path: string; body: string }> = [];
const source = "https://unprotected.fixture/openapi.json";
const fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (url.pathname === "/openapi.json") return Response.json({ openapi: "3.0.0", info: { title: "Unprotected diagnostic", version: "1" }, paths: {
    [path]: { post: { operationId: "append", responses: { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } } } },
  } });
  effects.push({ method: request.method, path: url.pathname, body: await request.text() });
  return new Response("written", { headers: { "content-type": "text/plain" } });
};
const store = { load: async () => structuredClone(state), save: async (value: PersistedState) => { state = structuredClone(value); } };
const rc = await RightClick.create({ directories: [], fetch, store });
await rc.learn({ source });
const original = rc.graph.list().find(c => c.invoke.kind === "http")!;
path = "/changed";
await rc.learn({ source });
const retained = await rc.run(original.id, {}, { acknowledgeChange: true });
const effectsAfterRefusal = effects.length;
const current = rc.meaningChanges.get(original.id)?.current;
if (!current) throw new Error("changed operation has no separate discovery identity");
const freshIdentity = await rc.run(current);
await fetch("https://unprotected.fixture/changed", { method: "POST", body: "direct alternative route" });
rc.forget(original.provider);
await rc.flush();
const restarted = await RightClick.create({ directories: [], fetch, store });
await restarted.learn({ source });
const reset = await restarted.run(original.id);
await restarted.flush();
console.log(JSON.stringify({ scope: "unprotected in-memory fixture; local bookkeeping is not an execution boundary",
  retained: { status: retained.status, error: retained.error, effects: effectsAfterRefusal },
  freshIdentity: { id: current, status: freshIdentity.status },
  reset: { status: reset.status, warningPresent: restarted.meaningChanges.has(original.id) },
  effects, independentContainment: false,
}, null, 2));
