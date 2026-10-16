// CONTROLLED TEST SERVICE (owned, disposable). Deployed to Cloudflare Workers
// for Open-World Experiment 4. It serves one of four breaking contracts of the
// same translation capability (REST v1, renamed REST v2, GraphQL, MCP); the
// test infrastructure switches contracts through an admin route guarded by a
// secret. RightClick X has no knowledge of this code.

import { evolvingPolyglot, type Version } from "../../../demo/evolving.ts";

type Env = { SERVICE: any; ADMIN_TOKEN: string };

export class ContractHolder {
  private storage: any;
  private svc = evolvingPolyglot();
  private loaded = false;
  constructor(state: any) {
    this.storage = state.storage;
  }
  async fetch(req: Request): Promise<Response> {
    if (!this.loaded) {
      this.svc.setVersion(((await this.storage.get("version")) as Version) ?? 1);
      this.loaded = true;
    }
    const u = new URL(req.url);
    if (u.pathname === "/__admin/version" && req.method === "POST") {
      const { version } = (await req.json()) as { version: Version };
      this.svc.setVersion(version);
      await this.storage.put("version", version);
      return Response.json({ version });
    }
    if (u.pathname === "/__admin/version") return Response.json({ version: this.svc.version() });
    return this.svc.handler(req);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/__admin") && req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
    return env.SERVICE.get(env.SERVICE.idFromName("main")).fetch(req);
  },
};
