// The context_* family: a fixed, small interface over an unbounded graph.
// Agents never get a new tool when the graph grows; they research, learn,
// compose and run through these thirteen.

import type { RightClick } from "../runtime.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const predicates = {
  type: "array",
  description: 'Outcome checks on the result, e.g. [{"op":"contains","value":"Lisbon"}, {"op":"gt","path":"temperature","value":-50}]. ops: exists, equals, contains, matches, type, gt, lt, length_gt.',
  items: { type: "object" },
};

export const TOOLS = [
  {
    name: "context_runtime",
    description: "Identify this RightClick X instance: version, runtime (node/bun/deno/workers/browser), region, graph size and powers, receipt-chain head.",
    inputSchema: obj({}),
  },
  {
    name: "context_research",
    description:
      "Research the environment: what runtime and platform bindings exist, which semantic types the graph produces and consumes, which inputs have no producer yet (gaps), and — given a topic — which public sources worldwide (APIs.guru OpenAPI directory, the official MCP Registry) could add powers. Pass learn:N to pull the top N candidates straight into the graph.",
    inputSchema: obj({ topic: str("What to look for, e.g. 'weather', 'translation', 'geocoding'."), limit: num("Candidates per directory (default 5)."), learn: num("Learn the top N candidates immediately.") }),
  },
  {
    name: "context_learn",
    description:
      "Point RightClick X at any URL. It detects what is there (OpenAPI/Swagger spec, GraphQL endpoint, MCP server, another RightClick X peer, or a web page whose forms become capabilities), reflects it into typed capabilities, and reports how many new capabilities and composite powers the graph gained.",
    inputSchema: obj({ source: str("URL of a spec, endpoint, server, peer or page."), sources: { type: "array", items: { type: "string" } }, deep: bool("Also probe well-known locations at the origin.") }),
  },
  {
    name: "context_forget",
    description: "Remove a provider and its capabilities from the live graph.",
    inputSchema: obj({ provider: str("Provider id from context_providers.") }, ["provider"]),
  },
  {
    name: "context_inspect",
    description: "Classify any value into the semantic type lattice (url, email, language, place, geo.lat, html, markdown, json, ...).",
    inputSchema: obj({ value: { description: "Any value." } }, ["value"]),
  },
  {
    name: "context_actions",
    description: "What can be done with this value right now: capabilities that accept it directly, plus every semantic type it can be turned into through multi-step pipelines.",
    inputSchema: obj({ value: { description: "A value to act on." }, type: str("Or a semantic type instead of a value."), limit: num("Max direct actions (default 25).") }),
  },
  {
    name: "context_explain",
    description: "Everything about one capability: typed ports, provider, risk label, how it is invoked, its neighbours in the graph, observed reliability and latency, and example arguments.",
    inputSchema: obj({ id: str("Capability id (or a search phrase).") }, ["id"]),
  },
  {
    name: "context_run",
    description: "Run one capability now. Returns the output, timing, a hash-chained receipt, and verification status (verified/refuted/unverified) against optional predicates.",
    inputSchema: obj({ id: str("Capability id."), args: { type: "object", description: "Input arguments by port name." }, verify: predicates, confirm: bool("Required for capabilities labelled destructive.") }, ["id"]),
  },
  {
    name: "context_run_status",
    description: "Read a previous run by runId, or list recent runs. Also reports whether the receipt chain is intact.",
    inputSchema: obj({ runId: str("Run id."), limit: num("Recent runs to list.") }),
  },
  {
    name: "context_compose",
    description:
      "Give what you have and the type you want; RightClick X searches the live graph for pipelines across any providers and protocols, ranks them by intent and learned reliability, and (with run:true) executes the best one, falling back to the next if a step fails. A successful multi-step pipeline is crystallized into a new first-class capability.",
    inputSchema: obj(
      {
        have: { type: "object", description: 'Named inputs, e.g. {"place":"Lisbon","language":"es"} or {"x":{"type":"url","value":"https://..."}}.' },
        want: str("Desired semantic type, e.g. text, language, geo.lat, html, hash."),
        intent: str("Words describing the goal, e.g. 'weather forecast translated'."),
        run: bool("Execute the best plan."),
        verify: predicates,
        maxSteps: num("Max pipeline length (default 4)."),
        confirm: bool("Required to run plans containing destructive capabilities."),
        publish: str("After a verified run, publish this goal as a stable API endpoint under this name (served at /x/<name>, described in /openapi.json)."),
        acquire: bool("If nothing in the graph can do it: research public directories (APIs.guru, MCP Registry), learn the best candidates and re-plan."),
        through: { type: "array", items: { type: "string" }, description: "Anchors: capability ids or search phrases the pipeline must pass through; the planner wires the types between them." },
        risks: { type: "array", items: { type: "string", enum: ["read", "write", "external", "destructive"] }, description: 'Optional constraint: plan only with these risk labels, e.g. ["read"].' },
      },
      ["have", "want"],
    ),
  },
  {
    name: "context_graph",
    description: "Query the live graph. op: stats | types | search (query) | neighbors (id) | paths (from, to) | edges | export.",
    inputSchema: obj({ op: str("Operation."), id: str("Capability id."), query: str("Search text."), from: str("From semantic type."), to: str("To semantic type."), limit: num("Max results.") }, ["op"]),
  },
  {
    name: "context_providers",
    description: "Providers currently contributing capabilities: builtins, platform, OpenAPI, GraphQL, MCP, web, peers, crystallized pipelines.",
    inputSchema: obj({}),
  },
  {
    name: "context_watch",
    description: "Follow the graph as it changes: providers learned/forgotten, runs, crystallizations, research. Pass the returned cursor back as since; waitMs long-polls.",
    inputSchema: obj({ since: num("Cursor from a previous call."), waitMs: num("Wait up to this long for new events.") }),
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export async function dispatch(rc: RightClick, name: string, a: Record<string, any> = {}): Promise<unknown> {
  switch (name) {
    case "context_runtime":
      return rc.runtime();
    case "context_research":
      return rc.research({ topic: a.topic, limit: a.limit, learn: a.learn });
    case "context_learn":
      return rc.learn({ source: a.source, sources: a.sources, deep: a.deep });
    case "context_forget":
      return rc.forget(a.provider);
    case "context_inspect":
      return rc.inspect(a.value);
    case "context_actions":
      return rc.actions({ value: a.value, type: a.type, limit: a.limit });
    case "context_explain":
      return rc.explain(a.id);
    case "context_run":
      return rc.run(a.id, a.args ?? {}, { verify: a.verify, confirm: a.confirm });
    case "context_run_status":
      return a.runId ? rc.runStatus({ runId: a.runId }) : { ...(rc.runStatus({ limit: a.limit }) as object), chain: await rc.verifyReceipts() };
    case "context_compose":
      return rc.compose({ have: a.have ?? {}, want: a.want, intent: a.intent, run: a.run, verify: a.verify, maxSteps: a.maxSteps, risks: a.risks, through: a.through, acquire: a.acquire, publish: a.publish, confirm: a.confirm });
    case "context_graph":
      return rc.graphQuery(a as any);
    case "context_providers":
      return rc.providers();
    case "context_watch":
      return rc.watch({ since: a.since, waitMs: a.waitMs });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
