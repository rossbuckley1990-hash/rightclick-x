// A Durable Object that drives DurableStore against workerd's own storage, for
// test/durable-workerd.test.ts. Local only: started with wrangler's unstable_dev, never deployed.
import { DurableStore } from "../../../src/entry/durable.ts";

/** The object's storage, failing every put that touches `at`: "state:meta", or "batch2" for any
 *  chunk index of 100 or more. The fault sits at the API boundary; the storage underneath is real. */
function faulty(storage: any, at: string | null): any {
  if (!at) return storage;
  return new Proxy(storage, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      if (prop !== "put") return value.bind(target);
      return async (key: string | Record<string, unknown>, v?: unknown) => {
        const keys = typeof key === "string" ? [key] : Object.keys(key);
        if (keys.some((k) => k === at || (at === "batch2" && /:\d+$/.test(k) && Number(k.split(":").pop()) >= 100))) throw new Error(`injected storage failure at ${at}`);
        return value.call(target, key, v);
      };
    },
  });
}

export class Harness {
  private state: any;
  private store?: DurableStore;
  constructor(state: any) {
    this.state = state;
  }
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const fail = u.searchParams.get("fail");
    // One store per object, as the deployed entry has, unless the test asks for a fresh reader.
    const store = fail || u.searchParams.has("fresh") ? new DurableStore(faulty(this.state.storage, fail)) : (this.store ??= new DurableStore(this.state.storage));
    try {
      switch (u.pathname) {
        case "/save": await store.save(await req.json()); return Response.json({ ok: true });
        case "/load": return Response.json({ ok: true, state: await store.load() });
        case "/keys": return Response.json({ ok: true, keys: [...(await this.state.storage.list({ prefix: "state:" })).keys()].sort() });
        case "/meta": return Response.json({ ok: true, meta: (await this.state.storage.get("state:meta")) ?? null });
        case "/legacy": {
          // The layout the previous DurableStore wrote: state:<i> chunks behind { chunks }.
          const text = await req.text();
          const parts = Math.ceil(text.length / 100_000);
          for (let i = 0; i < parts; i++) await this.state.storage.put(`state:${i}`, text.slice(i * 100_000, (i + 1) * 100_000));
          await this.state.storage.put("state:meta", { chunks: parts });
          return Response.json({ ok: true });
        }
        case "/read": {
          const generation = u.searchParams.get("generation");
          const chunks = Number(u.searchParams.get("chunks"));
          const keys = Array.from({ length: chunks }, (_, i) => generation ? `state:${generation}:${i}` : `state:${i}`);
          const got: Map<string, string> = await this.state.storage.get(keys);
          return Response.json({ ok: true, text: keys.map((k) => got.get(k) ?? "").join("") });
        }
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      return Response.json({ ok: false, error: String((e as Error)?.message ?? e) });
    }
  }
}

export default {
  fetch(req: Request, env: any) {
    const name = new URL(req.url).searchParams.get("object") ?? "one";
    return env.HARNESS.get(env.HARNESS.idFromName(name)).fetch(req);
  },
};
