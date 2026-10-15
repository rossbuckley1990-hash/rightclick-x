// The RightClick X data model.
//
// A Capability is a typed node: it consumes semantic values on its input
// ports and produces semantic values on its output ports. Because every
// reflector (OpenAPI, GraphQL, MCP, web, platform, peer) lands capabilities in
// this one shape, capabilities from unrelated providers and protocols can be
// chained by the planner without anyone writing glue code.

/** A semantic type such as "url", "text", "language", "geo.lat", "list:url". */
export type SemType = string;

export interface Port {
  /** Input: argument name. Output: dotted path into the result ("" = whole result). */
  name: string;
  type: SemType;
  required: boolean;
  description?: string;
  /** Raw source schema type, when the source declares one (e.g. "String!", "integer"). */
  wire?: string;
}

export type SourceKind =
  | "builtin"
  | "openapi"
  | "graphql"
  | "mcp"
  | "web"
  | "platform"
  | "composite"
  | "peer";

/** Informational only. RightClick X never blocks on risk; it labels it. */
export type Risk = "read" | "write" | "external" | "destructive";

export interface HttpInvoke {
  kind: "http";
  method: string;
  /** Absolute URL template; {name} segments are path parameters. */
  url: string;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  /** "json" sends bodyParams as a JSON object; "raw" sends the single "body" input. */
  body: "json" | "form" | "raw" | null;
  bodyParams: string[];
  /** Fixed values always sent (e.g. hidden form fields). */
  constants?: Record<string, string>;
}

export interface GraphQLInvoke {
  kind: "graphql";
  endpoint: string;
  operation: "query" | "mutation";
  field: string;
  /** Argument name -> GraphQL type literal, e.g. { code: "ID!" }. */
  args: Record<string, string>;
  selection: string;
}

export interface McpInvoke {
  kind: "mcp";
  endpoint: string;
  tool: string;
}

export interface BuiltinInvoke {
  kind: "builtin";
  fn: string;
}

export interface PlatformInvoke {
  kind: "platform";
  fn: string;
}

export interface PeerInvoke {
  kind: "peer";
  endpoint: string;
  id: string;
}

export interface Binding {
  /** Input port of this step. */
  port: string;
  /** Either a goal input ("$in.<name>") or "<stepIndex>.<outputPath>". */
  from: string;
}

export interface PlanStep {
  capability: string;
  bindings: Binding[];
}

export interface CompositeInvoke {
  kind: "composite";
  steps: PlanStep[];
  /** Where the final value is read from: "<stepIndex>.<outputPath>". */
  result: string;
}

export type Invoke =
  | HttpInvoke
  | GraphQLInvoke
  | McpInvoke
  | BuiltinInvoke
  | PlatformInvoke
  | PeerInvoke
  | CompositeInvoke;

export interface Capability {
  id: string;
  title: string;
  description: string;
  provider: string;
  source: SourceKind;
  inputs: Port[];
  outputs: Port[];
  risk: Risk;
  tags: string[];
  invoke: Invoke;
}

export interface Provider {
  id: string;
  title: string;
  source: SourceKind;
  origin: string;
  learnedAt: string;
  capabilityIds: string[];
  meta?: Record<string, unknown>;
}

export interface Reflection {
  provider: Provider;
  capabilities: Capability[];
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
