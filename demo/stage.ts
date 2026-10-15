// Stand up the demo services as real localhost HTTP servers.

import { serve, type Served } from "../src/entry/node-host.ts";
import { SERVICES } from "./services.ts";

export interface Stage {
  polyglot: string;
  atlas: string;
  skycast: string;
  skycastMirror: string;
  newsroom: string;
  servers: Record<string, Served>;
  stop(name?: string): Promise<void>;
}

export async function startStage(): Promise<Stage> {
  const servers: Record<string, Served> = {
    polyglot: await serve(SERVICES.polyglot, 0),
    atlas: await serve(SERVICES.atlas, 0),
    skycast: await serve(SERVICES.skycast, 0),
    skycastMirror: await serve(SERVICES.skycast, 0),
    newsroom: await serve(SERVICES.newsroom, 0),
  };
  return {
    polyglot: `${servers.polyglot.url}/openapi.json`,
    atlas: `${servers.atlas.url}/graphql`,
    skycast: `${servers.skycast.url}/mcp`,
    skycastMirror: `${servers.skycastMirror.url}/mcp`,
    newsroom: `${servers.newsroom.url}/`,
    servers,
    async stop(name?: string) {
      const names = name ? [name] : Object.keys(servers);
      for (const n of names) {
        await servers[n]?.close();
        delete servers[n];
      }
    },
  };
}
