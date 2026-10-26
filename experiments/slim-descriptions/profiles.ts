// Experimental MCP tool-description profiles. Production tools are unchanged: the proxy in this
// directory serves one profile's descriptions in place of the originals for one session.
//   original      the exact production descriptions
//   compact-top   only the 13 top-level tool descriptions shortened
//   compact-full  compact-top plus shortened parameter and schema descriptions
// Each override names the exact location it replaces (a JSON pointer inside one tool). Applying a
// profile fails if a location is missing or doesn't hold a description string, so a profile cannot
// drift silently from the tools it was written for. Names, types, required fields, enums and
// annotations are never touched; test/tool-description-profiles.test.ts proves it.
import { OUTPUT_BUDGET } from "../../src/core/view.ts";

export const PROFILE_NAMES = ["original", "compact-top", "compact-full"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];
type Overrides = Record<string, Record<string, string>>;

const TOP: Overrides = {
  context_runtime: { "/description": "Identify this RightClick X instance: version, runtime, region, graph size, receipt-chain head." },
  context_research: { "/description": "Refresh operator-configured environment catalogs within the approved scope, or search public API directories by topic (learn:N learns the top N). Discovery never grants execution authority." },
  context_learn: { "/description": "Learn capabilities from a URL (OpenAPI, GraphQL, MCP, peer, web page) or an operator-authorised program (cli:/absolute/path). Discovery never grants execution authority." },
  context_forget: { "/description": "Remove a provider and its capabilities from the graph." },
  context_inspect: { "/description": "Classify a value into a semantic type (url, email, place, html, json, ...)." },
  context_actions: { "/description": "What can be done with a value now: capabilities that accept it, and types it can become through pipelines." },
  context_explain: { "/description": "A capability's execution contract: inputs, outputs, authority, restrictions, evidence and stored checks. A saved goal's results are history, not a guarantee. detail:full adds more." },
  context_run: { "/description": "Run one capability now. A saved goal:<slug> re-plans against the current environment and repeats its stored checks and independent witnesses; verify adds checks, never removes them. If a learned API moved, its contract is re-read and the same operation retried once; a changed operation stays refused, and caller acknowledgement cannot authorise it. view returns part of a large output." },
  context_run_status: { "/description": "Read a previous run by runId, or list recent runs, with receipt-chain integrity. view counts, projects or slices a run's recorded output without running it again." },
  context_compose: { "/description": "Plan from named inputs (have) to a wanted type; run:true executes, checks and repairs. Unit/currency changes need explicit conversions. witnesses add independent outcome checks; publish saves a reusable goal:<slug> for context_run." },
  context_graph: { "/description": "Query the live graph. op: stats | types | search (query) | neighbors (id) | paths (from, to) | edges | export | authority (audits consequential capabilities; cannot change policy)." },
  context_providers: { "/description": "Providers contributing capabilities, by kind." },
  context_watch: { "/description": "Follow graph changes: learns, forgets, runs, research. Pass the returned cursor as since; waitMs long-polls." },
};

// Shared schema fragments appear in several tools, so their overrides are built per location.
const predicates = (at: string) => ({
  [`${at}/description`]: 'Outcome checks, e.g. [{"op":"gt","path":"n","value":0}]; ops: exists, equals, contains, matches, type, gt, lt, length_gt. Passing makes a result "checked"; only an independent witness makes it "verified".',
});
const witnesses = (at: string) => ({
  [`${at}/description`]: 'Independent checks by a separate read-only checker provider, re-run on every saved invocation; it must pass verify. e.g. [{"capability":"<checker id>","args":{"order_id":{"input":"order_id"},"tax_amount":{"output":""}},"verify":[{"op":"equals","path":"valid","value":true}]}]. Its contract is pinned; a changed checker fails closed.',
  [`${at}/items/properties/args/additionalProperties/oneOf/1/properties/output/description`]: 'Path in the candidate result ("" = all of it).',
  ...predicates(`${at}/items/properties/verify`),
});
const view = (at: string) => ({
  [`${at}/description`]: `Count, projection or slice of the output. Without it, output over ${OUTPUT_BUDGET} JSON characters is summarised, never cut; the run record keeps all of it.`,
  [`${at}/properties/select/description`]: 'Output path, e.g. "items.id".',
  [`${at}/properties/fields/description`]: "Paths to project per element.",
  [`${at}/properties/count/description`]: "Size only.",
  [`${at}/properties/offset/description`]: "Slice start.",
  [`${at}/properties/limit/description`]: "Slice length.",
  [`${at}/properties/full/description`]: "Whole value, even over budget.",
});
const p = (name: string) => `/inputSchema/properties/${name}`;

const SCHEMA: Overrides = {
  context_research: {
    [`${p("topic")}/description`]: "What to look for, e.g. 'weather'.",
    [`${p("learn")}/description`]: "Learn the top N candidates now.",
  },
  context_learn: { [`${p("deep")}/description`]: "Also probe well-known locations." },
  context_actions: { [`${p("type")}/description`]: "Or a semantic type." },
  context_explain: {
    [`${p("id")}/description`]: "Capability id or search phrase.",
    [`${p("detail")}/description`]: "run (default) or full (more detail).",
  },
  context_run: {
    [`${p("id")}/description`]: "Capability id, or resume:<run-id> to recover a run: completed actions are never replayed; stored checks and current authority apply; pass nothing else.",
    [`${p("args")}/description`]: "Inputs by port name.",
    ...predicates(p("verify")),
    ...view(p("view")),
  },
  context_run_status: { ...view(p("view")) },
  context_compose: {
    [`${p("have")}/description`]: 'Named inputs, e.g. {"place":"Lisbon"} or typed {"x":{"type":"url","value":"..."}}; with publish, {"to":{"value":"EUR","fixed":true}} pins one.',
    [`${p("want")}/description`]: "Wanted semantic type, e.g. number.",
    [`${p("intent")}/description`]: "Words describing the goal.",
    ...predicates(p("verify")),
    ...witnesses(p("witnesses")),
    [`${p("publish")}/description`]: 'Save as goal:<slug> after a successful run; its checks and witnesses re-run on every call. Predicates make it "checked"; a witness makes it "verified".',
    [`${p("acquire")}/description`]: "If nothing fits, learn candidates from public directories and re-plan.",
    [`${p("through")}/description`]: "Ids or phrases the plan must pass through.",
    [`${p("risks")}/description`]: 'Allowed risk labels, e.g. ["read"].',
    [`${p("require")}/description`]: 'Information the result must carry, e.g. ["resolution"]; without an established plan for it, nothing runs.',
    [`${p("origins")}/description`]: "Egress allow-list of origins, kept in repairs and saved with publish.",
    ...view(p("view")),
  },
  context_watch: { [`${p("waitMs")}/description`]: "Long-poll for up to this many ms." },
};

const merge = (...all: Overrides[]): Overrides => {
  const out: Overrides = {};
  for (const o of all) for (const [tool, at] of Object.entries(o)) out[tool] = { ...out[tool], ...at };
  return out;
};

export const PROFILES: Record<ProfileName, Overrides> = { original: {}, "compact-top": TOP, "compact-full": merge(TOP, SCHEMA) };

/** The tools with one profile's descriptions. Never mutates its input. */
export function applyProfile<T extends { name: string }>(tools: readonly T[], profile: ProfileName): T[] {
  const overrides = PROFILES[profile];
  if (!overrides) throw new Error(`unknown description profile: ${profile}`);
  const out = structuredClone(tools) as T[];
  for (const [name, at] of Object.entries(overrides)) {
    const tool: any = out.find((t) => t.name === name);
    if (!tool) throw new Error(`profile ${profile}: no tool ${name}`);
    for (const [pointer, text] of Object.entries(at)) {
      const keys = pointer.split("/").slice(1);
      const last = keys.pop()!;
      const parent = keys.reduce((x: any, k) => (x && typeof x === "object" ? x[k] : undefined), tool);
      if (last !== "description" || !parent || typeof parent[last] !== "string") throw new Error(`profile ${profile}: ${name}${pointer} is not a description`);
      parent[last] = text;
    }
  }
  return out;
}

/** A tool contract without its descriptions: every string-valued "description" key removed, at any depth. */
export function withoutDescriptions(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(withoutDescriptions);
  if (!x || typeof x !== "object") return x;
  return Object.fromEntries(Object.entries(x).filter(([k, v]) => !(k === "description" && typeof v === "string")).map(([k, v]) => [k, withoutDescriptions(v)]));
}
