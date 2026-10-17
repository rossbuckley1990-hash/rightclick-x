// Cloudflare deployment with real regional placement.
//
// The Worker forwards every request to one Durable Object, created with a
// location hint (weur, enam, apac, …), so an instance lives in the region you
// pick rather than wherever the caller happens to be. The object holds the
// live graph in memory and persists it in its own storage. On boot it asks
// Cloudflare's trace endpoint which datacenter it is actually running in, and
// reports that as its region: placement is observed, not assumed.
//
// wrangler config needs:  [[durable_objects.bindings]] name = "RCX", class_name = "RightClickInstance"
//                          [[migrations]] tag = "v1", new_sqlite_classes = ["RightClickInstance"]
// vars:     RCX_NAME, RCX_LOCATION (location hint)
// secrets:  RCX_TOKEN (required), RCX_AUTH (origin-pinned credentials for peers/APIs)

import { authorityFromEnv } from "../core/authority.ts";
import { createHandler } from "../interface/http.ts";
import { Authority } from "../reflectors/net.ts";
import { RightClick, type PersistedState, type Store } from "../runtime.ts";

type Env = Record<string, any>;

const CHUNK = 100_000;

/** Durable Object storage values are size-limited; store state as numbered chunks. */
class DurableStore implements Store {
  private storage: any;
  constructor(storage: any) {
    this.storage = storage;
  }
  async load(): Promise<PersistedState | null> {
    const meta = (await this.storage.get("state:meta")) as { chunks: number } | undefined;
    if (!meta) return null;
    let text = "";
    for (let i = 0; i < meta.chunks; i += 100) {
      const keys = Array.from({ length: Math.min(100, meta.chunks - i) }, (_, k) => `state:${i + k}`);
      const got: Map<string, string> = await this.storage.get(keys);
      for (const k of keys) text += got.get(k) ?? "";
    }
    return JSON.parse(text);
  }
  async save(state: PersistedState): Promise<void> {
    const text = JSON.stringify(state);
    const chunks = Math.ceil(text.length / CHUNK);
    const entries: Record<string, string> = {};
    for (let i = 0; i < chunks; i++) entries[`state:${i}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += 100) await this.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, entries[k]])));
    await this.storage.put("state:meta", { chunks });
  }
}

export class RightClickInstance {
  private state: any;
  private env: Env;
  private ready: Promise<(req: Request) => Promise<Response>> | null = null;

  constructor(state: any, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async boot() {
    const auth = new Authority();
    auth.loadEnv(this.env.RCX_AUTH);
    const rc = await RightClick.create({
      name: this.env.RCX_NAME ?? "rightclick-x",
      auth,
      store: new DurableStore(this.state.storage),
      // Public deployment: never let "learn any URL" reach private or metadata addresses.
      network: { blockPrivate: true },
      timeoutMs: 25_000,
      authority: authorityFromEnv(this.env as Record<string, unknown>),
    });
    try {
      const trace = await (await fetch("https://cloudflare.com/cdn-cgi/trace")).text();
      const field = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(trace)?.[1];
      rc.observeLocation(`${field("colo")} (${this.env.RCX_LOCATION ?? "auto"})`, field("loc"));
    } catch {
      rc.observeLocation(this.env.RCX_LOCATION);
    }
    return createHandler(rc, { token: this.env.RCX_TOKEN });
  }

  async fetch(req: Request): Promise<Response> {
    this.ready ??= this.boot().catch((e) => {
      this.ready = null;
      throw e;
    });
    return (await this.ready)(req);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const id = env.RCX.idFromName("main");
    const stub = env.RCX.get(id, env.RCX_LOCATION ? { locationHint: env.RCX_LOCATION } : undefined);
    return stub.fetch(req);
  },
};
