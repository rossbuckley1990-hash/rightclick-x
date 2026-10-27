import { routerFetch, SERVICES } from "../demo/services.ts";
import { createHandler } from "../src/interface/http.ts";
import { RightClick, type PersistedState, type RuntimeOptions, type Store } from "../src/runtime.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { goalDefinitionDigest } from "../src/core/goal-identity.ts";
import { StateConflictError } from "../src/core/state-conflict.ts";

export const URLS = {
  polyglot: "https://polyglot.test/openapi.json",
  atlas: "https://atlas.test/graphql",
  skycast: "https://skycast.test/mcp",
  newsroom: "https://news.test/",
};

/** A runtime wired to the four demo services through an in-memory router. */
export async function world(extra: Record<string, (r: Request) => Promise<Response>> = {}, opts: RuntimeOptions = {}) {
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    "https://polyglot.test": SERVICES.polyglot,
    "https://atlas.test": SERVICES.atlas,
    "https://skycast.test": SERVICES.skycast,
    "https://news.test": SERVICES.newsroom,
    ...extra,
  };
  const rc = await RightClick.create({ fetch: routerFetch(routes), directories: [], ...opts });
  return { rc, routes };
}

export async function learnAll(rc: RightClick) {
  return rc.learn({ sources: Object.values(URLS) });
}

export class MemoryStore implements Store {
  state: PersistedState | null = null;
  private active = false;
  private lease = new AsyncLocalStorage<{ active: boolean }>();
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(s: PersistedState) {
    if (this.active && !this.lease.getStore()?.active) throw new StateConflictError("memory goal lease is held");
    this.state = structuredClone(s);
  }
  async withGoalLease<T>(pins: Array<{ slug: string; digest: string }>, invoke: () => Promise<T>): Promise<T> {
    const inherited = this.lease.getStore();
    if (this.active && !inherited?.active) throw new StateConflictError("memory goal lease is held");
    const validate = async () => { for (const pin of pins) {
      const matches = (this.state?.published ?? []).filter(g => g.slug === pin.slug);
      if (matches.length !== 1 || !matches[0].revision || await goalDefinitionDigest(matches[0]) !== pin.digest)
        throw new StateConflictError(`saved goal ${pin.slug} is stale, revoked, or inconsistent`);
    } };
    if (inherited?.active) { await validate(); return invoke(); }
    const scope = { active: true };
    this.active = true;
    try { await validate(); return await this.lease.run(scope, invoke); }
    finally { scope.active = false; this.active = false; }
  }
}

export function peerHandler(rc: RightClick) {
  return createHandler(rc, { open: true });
}
