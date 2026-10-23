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
import { decodeState, encodeState, migrationReplaces } from "../core/state-format.ts";
import { createHandler } from "../interface/http.ts";
import { Authority } from "../reflectors/net.ts";
import { RightClick, type PersistedState, type Store } from "../runtime.ts";

type Env = Record<string, any>;

const CHUNK = 100_000;

/** Which chunks hold a state: a generation's `state:<generation>:<i>`, or legacy `state:<i>`. */
interface Manifest {
  chunks: number;
  /** Absent in the legacy layout. */
  generation?: string;
  /** The generation a migrating save replaced, kept until a later migration replaces it. */
  backup?: { chunks: number; generation: string | null; replaced: string; at: string };
}

const chunkKey = (generation: string | null | undefined, i: number) => generation ? `state:${generation}:${i}` : `state:${i}`;

function validManifest(meta: unknown): meta is Manifest {
  const m = meta as Manifest;
  const chunks = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  const generation = (g: unknown) => typeof g === "string" && /^[a-f0-9-]{36}$/.test(g);
  return !!m && typeof m === "object" && chunks(m.chunks) && (m.generation === undefined || generation(m.generation)) &&
    (m.backup === undefined || (chunks(m.backup.chunks) && (m.backup.generation === null || generation(m.backup.generation)) && typeof m.backup.replaced === "string"));
}

/**
 * Durable Object storage values are size-limited, so state is stored in chunks. Each save writes a
 * new generation of chunk keys and only then switches the manifest, one key written last, so a
 * save interrupted at any point leaves the previous state loadable. A save that changes the
 * loaded state's format or inference version keeps the generation it replaced as the backup.
 * Superseded generations, and orphans of an interrupted save, are removed after a switch.
 */
export class DurableStore implements Store {
  private storage: any;
  private tail: Promise<void> = Promise.resolve();
  /** The state as loaded and its manifest, until a save has replaced it. */
  private loaded?: { value: unknown; manifest: Manifest };
  /** The manifest this store last wrote. */
  private current?: Manifest;
  constructor(storage: any) {
    this.storage = storage;
  }
  async load(): Promise<PersistedState | null> {
    const meta = await this.storage.get("state:meta");
    if (!meta) return null;
    if (!validManifest(meta)) throw new Error("invalid runtime state chunk manifest");
    const value = JSON.parse(await this.read(meta.generation, meta.chunks));
    const state = decodeState(value);
    this.loaded = { value, manifest: meta };
    return state;
  }
  private async read(generation: string | null | undefined, chunks: number): Promise<string> {
    let text = "";
    for (let i = 0; i < chunks; i += 100) {
      const keys = Array.from({ length: Math.min(100, chunks - i) }, (_, k) => chunkKey(generation, i + k));
      const got: Map<string, string> = await this.storage.get(keys);
      for (const k of keys) {
        const part = got.get(k);
        if (typeof part !== "string" || !part.length || part.length > CHUNK) throw new Error(`missing or invalid runtime state chunk: ${k}`);
        text += part;
      }
    }
    return text;
  }
  async save(state: PersistedState): Promise<void> {
    const text = encodeState(state);
    const next = this.tail.then(() => this.write(text, state));
    this.tail = next.catch(() => {});
    return next;
  }
  private async write(text: string, state: PersistedState): Promise<void> {
    const generation = crypto.randomUUID();
    const chunks = Math.ceil(text.length / CHUNK);
    const keys = Array.from({ length: chunks }, (_, i) => chunkKey(generation, i));
    for (let i = 0; i < keys.length; i += 100) {
      await this.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k, j) => [k, text.slice((i + j) * CHUNK, (i + j + 1) * CHUNK)])));
    }
    const stored = this.loaded?.manifest ?? this.current ?? await this.storage.get("state:meta");
    const current = validManifest(stored) ? stored : undefined;
    const replaced = this.loaded && migrationReplaces(this.loaded.value, state);
    const backup = replaced && current
      ? { chunks: current.chunks, generation: current.generation ?? null, replaced, at: new Date().toISOString() }
      : current?.backup;
    const manifest: Manifest = { chunks, generation, ...(backup ? { backup } : {}) };
    await this.storage.put("state:meta", manifest);
    this.loaded = undefined;
    this.current = manifest;
    await this.sweep(manifest).catch(() => { /* stale chunks are removed by a later save */ });
  }
  /** Delete chunks no manifest refers to: superseded generations and interrupted saves. */
  private async sweep(manifest: Manifest): Promise<void> {
    const keep = new Set<string>(["state:meta"]);
    for (const [g, n] of [[manifest.generation, manifest.chunks], [manifest.backup?.generation, manifest.backup?.chunks ?? 0]] as const)
      for (let i = 0; i < n; i++) keep.add(chunkKey(g, i));
    const stale = [...(await this.storage.list({ prefix: "state:" })).keys()].filter((k: string) => !keep.has(k));
    for (let i = 0; i < stale.length; i += 128) await this.storage.delete(stale.slice(i, i + 128));
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
