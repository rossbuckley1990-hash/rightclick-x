// Edge entry: `export default { fetch }`. Deploys as-is to Cloudflare Workers
// (wrangler.toml), and the same module works for Deno Deploy, Bun, and any
// platform that accepts a module exporting a fetch handler.
//
// Environment (Workers vars/secrets, or process env elsewhere):
//   RCX_TOKEN    bearer token; without it the API stays locked on public hosts
//   RCX_SOURCES  comma-separated URLs to learn at cold start
//   RCX_AUTH     JSON {origin: "Bearer ..."} credentials, origin-pinned
//   RCX_NAME     instance name shown to peers
//   RCX_STATE    (binding) KV namespace to persist the graph across isolates
//   any other KV / AI bindings become platform capabilities automatically

import { authorityFromEnv } from "../core/authority.ts";
import { createHandler } from "../interface/http.ts";
import { Authority } from "../reflectors/net.ts";
import { environmentOptions } from "../reflectors/environment.ts";
import { RightClick, type PersistedState, type Store } from "../runtime.ts";

type Env = Record<string, any>;

let instance: Promise<{ rc: RightClick; handler: (r: Request) => Promise<Response> }> | null = null;

class KvStore implements Store {
  private kv: any;
  constructor(kv: any) {
    this.kv = kv;
  }
  async load(): Promise<PersistedState | null> {
    return (await this.kv.get("rcx-state", "json")) ?? null;
  }
  async save(state: PersistedState): Promise<void> {
    await this.kv.put("rcx-state", JSON.stringify(state));
  }
}

async function boot(env: Env) {
  const auth = new Authority();
  auth.loadEnv(env.RCX_AUTH);
  const bindings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) if (v && typeof v === "object" && k !== "RCX_STATE") bindings[k] = v;
  const rc = await RightClick.create({
    name: env.RCX_NAME ?? "rightclick-x-edge",
    auth,
    bindings,
    store: env.RCX_STATE ? new KvStore(env.RCX_STATE) : undefined,
    authority: authorityFromEnv(env as Record<string, unknown>),
    environment: environmentOptions(env.RCX_ENVIRONMENT),
  });
  const sources = String(env.RCX_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => ![...rc.graph.providers.values()].some((p) => p.origin === s));
  if (sources.length) await rc.learn({ sources });
  return { rc, handler: createHandler(rc, { token: env.RCX_TOKEN }) };
}

export default {
  async fetch(req: Request, env: Env = {}, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    instance ??= boot(env).catch((e) => {
      instance = null;
      throw e;
    });
    const { rc, handler } = await instance;
    const cf = (req as any).cf;
    if (cf) rc.observeLocation(cf.colo, cf.country);
    const res = await handler(req);
    ctx?.waitUntil(rc.flush());
    return res;
  },
};
