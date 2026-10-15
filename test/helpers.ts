import { routerFetch, SERVICES } from "../demo/services.ts";
import { createHandler } from "../src/interface/http.ts";
import { RightClick, type PersistedState, type RuntimeOptions, type Store } from "../src/runtime.ts";

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
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(s: PersistedState) {
    this.state = structuredClone(s);
  }
}

export function peerHandler(rc: RightClick) {
  return createHandler(rc, { open: true });
}
