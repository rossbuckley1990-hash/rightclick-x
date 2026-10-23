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
import { backupSuffix, decodeState, encodeState, migrationReplaces } from "../core/state-format.ts";
import { createHandler } from "../interface/http.ts";
import { Authority } from "../reflectors/net.ts";
import { environmentOptions } from "../reflectors/environment.ts";
import { RightClick, type PersistedState, type Store } from "../runtime.ts";

type Env = Record<string, any>;

let instance: Promise<{ rc: RightClick; handler: (r: Request) => Promise<Response> }> | null = null;

/** How long a state replaced by another isolate's save is kept (Workers KV expirationTtl). */
const SUPERSEDED_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Workers KV is eventually consistent and last-writer-wins, and one state is shared by every
 * isolate. A save that would replace a state this isolate neither loaded nor wrote keeps that state
 * first under `rcx-state.superseded-<generation>-<time>`, expiring after a bounded time, and
 * reports it, so a concurrent writer's work is not destroyed silently. A concurrent write not yet
 * visible here cannot be detected; use DurableStore where writers must not race.
 */
export class KvStore implements Store {
  private kv: any;
  /** The value as loaded, kept under its own key before a save that changes its format or
   *  inference version replaces it. */
  private loaded?: { value: unknown; text: string };
  /** What this isolate last saw in KV: whether a state existed, and its generation. */
  private known?: { found: boolean; generation: string | null };
  private onSuperseded?: (key: string) => void;
  constructor(kv: any, opts: { onSuperseded?: (key: string) => void } = {}) {
    this.kv = kv;
    this.onSuperseded = opts.onSuperseded;
  }
  private async read(): Promise<{ text: string | null; generation: string | null }> {
    if (typeof this.kv.getWithMetadata !== "function") return { text: await this.kv.get("rcx-state", "text"), generation: null };
    const r = await this.kv.getWithMetadata("rcx-state", "text");
    const generation = (r?.metadata as { generation?: unknown } | null)?.generation;
    return { text: r?.value ?? null, generation: typeof generation === "string" ? generation : null };
  }
  async load(): Promise<PersistedState | null> {
    const { text, generation } = await this.read();
    this.known = { found: text != null, generation };
    if (text == null) return null;
    const value = JSON.parse(text);
    const state = decodeState(value);
    this.loaded = { value, text };
    return state;
  }
  async save(state: PersistedState): Promise<void> {
    const content = encodeState(state);
    const replaced = this.loaded && migrationReplaces(this.loaded.value, state);
    if (replaced) await this.kv.put(`rcx-state${backupSuffix(replaced)}`, this.loaded!.text);
    // Without metadata reads, generations cannot be compared, so nothing can be detected.
    const current = typeof this.kv.getWithMetadata === "function" ? await this.read() : { text: null, generation: null };
    if (current.text != null && (!this.known?.found || current.generation !== this.known.generation)) {
      const key = `rcx-state.superseded-${current.generation ?? "unversioned"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await this.kv.put(key, current.text, { expirationTtl: SUPERSEDED_TTL_SECONDS });
      this.onSuperseded?.(key);
    }
    const generation = crypto.randomUUID();
    await this.kv.put("rcx-state", content, { metadata: { generation } });
    this.known = { found: true, generation };
    this.loaded = undefined;
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
    store: env.RCX_STATE ? new KvStore(env.RCX_STATE, { onSuperseded: (key) => console.warn(`RightClick X: another isolate's state was replaced by this save; it is kept for 7 days at KV key ${key}`) }) : undefined,
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
