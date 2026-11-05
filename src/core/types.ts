// The RightClick X data model.
//
// A Capability is a typed node: it consumes semantic values on its input
// ports and produces semantic values on its output ports. Because every
// reflector (OpenAPI, GraphQL, MCP, web, platform, peer) lands capabilities in
// this one shape, capabilities from unrelated providers and protocols can be
// chained by the planner without anyone writing glue code.

/** A semantic type such as "url", "text", "language", "geo.lat", "list:url". */
export type SemType = string;

import type { OutcomeWitness, Predicate } from "./verify.ts";

export interface Port {
  /** Input: argument name. Output: dotted path into the result ("" = whole result). */
  name: string;
  type: SemType;
  required: boolean;
  description?: string;
  /** Raw source schema type, when the source declares one (e.g. "String!", "integer"). */
  wire?: string;
  /** Allowed values, when the source declares an enum. Only the caller can choose one. */
  enum?: string[];
  /**
   * Identifier schemes this port was observed to carry (see core/identities.ts): an input
   * accepts a value from any output that feeds one of its schemes. Learned, never declared.
   */
  schemes?: string[];
  /** An output path the contract does not declare, observed in real results; not part of the contract signature. */
  observed?: boolean;
  /** Input established (by experiment) to accept any kind of text, markup included. */
  anyText?: boolean;
}

export type SourceKind =
  | "builtin"
  | "openapi"
  | "graphql"
  | "mcp"
  | "web"
  | "platform"
  | "composite"
  | "peer"
  | "cli";

/** Destructive operations require confirmation; callers can constrain allowed risks. */
export type Risk = "read" | "write" | "external" | "destructive";

/** A required operation's role, retained across protocol/port-name changes.
 * Matching is deliberately exact and source-bound, never a fuzzy replacement.
 */
export interface CapabilityAnchor {
  id: string;
  source?: string;
  title: string;
  risk: Risk;
  inputTypes: SemType[];
  outputTypes: SemType[];
  /** What the id invoked when pinned (method and path below the base, GraphQL field or MCP tool). Absent on older pins. */
  operation?: string;
}

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
  /** Path params whose "/" must stay literal (OpenAPI x-multi-segment, e.g. git refs "heads/main"). */
  multiSegment?: string[];
  /** Keyed-map projection: the result is response[map][args[keyInput]]; keyInput is never sent. */
  entry?: { map: string; keyInput: string };
}

/** Local protocol evidence, not an authority grant or proof of absent effects. */
export interface GraphQLFailureEvidence {
  kind: "invalid-document" | "execution-errors" | "invalid-response";
  reason: string;
  capability?: string;
  runs: string[];
}

export interface GraphQLInvoke {
  kind: "graphql";
  endpoint: string;
  operation: "query" | "mutation";
  field: string;
  /** Argument name -> GraphQL type literal, e.g. { code: "ID!" }. */
  args: Record<string, string>;
  selection: string;
  /** Optional input port through which a caller replaces the default selection set. */
  selectPort?: string;
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
  /** A constant chosen by the planner (e.g. a GraphQL selection for required fields); `from` is "$const". */
  value?: unknown;
  /** Either a goal input ("$in.<name>") or "<stepIndex>.<outputPath>". */
  from: string;
  /** Exact declared relationship, checked against the producing HTTP response before extraction. */
  link?: { name: string; status: number; pointer: string; wire: "string" | "number" | "integer" | "boolean"; format?: "uuid" | "uri" };
  /**
   * Fan-out: `from` is a list and this single-value port takes one item at a time. The step
   * runs once per item, in order, and each of its outputs becomes the list of per-item outputs.
   * More than `max` items refuses the step. With `shapes`, only items of those identifier shapes
   * (see core/identities.ts) are used, because the list was linked by a learned scheme.
   */
  each?: { max: number; shapes?: string[] };
}

/** Directed contract evidence; never an identifier equivalence or execution grant. */
export interface ContractLink {
  name: string;
  target: string;
  status: number;
  parameters: Array<{ port: string; pointer: string; wire: "string" | "number" | "integer" | "boolean"; format?: "uuid" | "uri" }>;
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
  /** Contract signature of each step when the pipeline was proven; a mismatch retires it. */
  signatures?: string[];
  /** Checks travel with a saved capability and run on every new invocation. */
  verify?: Predicate[];
  require?: string[];
  witnesses?: OutcomeWitness[];
  /** Caller restrictions and observed preservation obligations survive reuse. */
  origins?: string[];
  preserveInputs?: string[];
}

export interface GoalInvoke {
  kind: "goal";
  slug: string;
}

/** A local command-line program, run only inside the host sandbox. */
/** One sandboxed acquisition trial, kept as evidence by digest. */
export interface BinaryTrial {
  purpose: string;
  argv: string[];
  input: { sha256: string; bytes: number; mediaType: string; valid: boolean; source: string };
  exit: number | null;
  process: "completed" | "timed-out" | "limit" | "truncated";
  output?: { sha256: string; bytes: number; type: string };
  stderrPreview: string;
  ms: number;
}

/** See `CliInvoke.binary`. */
export interface BinaryContract {
  v: 1;
  /**
   * `signature`: for a format known only by experiment (a provisional `x-ext/<ext>` type with no
   * validator), the leading bytes every witnessed sample shared, as hex. Such a format is
   * recognised by that signature only, and only because experiments witnessed it.
   */
  input: { mediaType: string; via: "file" | "stdin"; name?: string; signature?: string };
  output: { mediaType: string; via: "file" | "stdout"; name?: string; signature?: string };
  /** A documented flag this transformation is established with (a format or fidelity variant). */
  flag?: string;
  /**
   * Facts in `preserves` that could not be read from the output's own format and were instead
   * witnessed through another capability: the output decoded by `capability` (a decoder), or the
   * input reconstructed from it (a round trip). Rechecked at run time when that capability can run.
   */
  witnessed?: Array<{ facts: string[]; capability: string; how: "decoded" | "round-trip" }>;
  /** The argument vector observed to work, with the staged input and output names in place. */
  argv: string[];
  /** Facts the output kept from the input in every confirming trial (width, height, pages, ...). */
  preserves: string[];
  /** "bytes": the same input gave identical output; "structure": identical facts, different bytes. */
  deterministic: "bytes" | "structure";
  /** How the program treated invalid input during acquisition. */
  rejectsInvalid: "yes" | "no" | "not-tested";
  /** Where the valid inputs came from: generated fixtures, or outputs of another acquired capability. */
  fixtures: string;
  trials: BinaryTrial[];
}

export interface CliInvoke {
  kind: "cli";
  bin: string;
  /**
   * argv after the program: literal flags; {input} placeholders materialised as files; and
   * {input, literal} placeholders passed as argument text (patterns, sets, numbers).
   */
  args: Array<string | { input: string; literal?: boolean }>;
  /**
   * The documented-options interface: the caller may pass options from this declared list (and
   * their arguments) in the input named `port`; anything else is refused before running.
   * These are placed before `args`: group-level options, or a program's only options.
   */
  options?: { port: string; allowed: Array<{ flags: string[]; arg: boolean; arity?: number; optionalArg?: boolean; file?: "read" | "write" }>; excluded?: string[] };
  /**
   * Documented options placed after `args`. A subcommand's own options belong after the verb
   * when a program requires `prog [global options] verb [verb options] [files]`.
   */
  optionsAfterArgs?: { port: string; allowed: Array<{ flags: string[]; arg: boolean; arity?: number; optionalArg?: boolean; file?: "read" | "write" }>; excluded?: string[] };
  /** Input holding named files ({name: content}) written exactly into the sandbox. */
  filesPort?: string;
  /** Optional list of named files to append as operands, in order. Omitted means all files; [] means none. */
  operandsPort?: string;
  /** Input naming files the program creates (flat names); their exact bytes are returned as artefacts. */
  outputsPort?: string;
  /** Input choosing how stdout is returned: "text" (default, UTF-8 required) or "artefact" (exact bytes). */
  stdoutAsPort?: string;
  /** Input whose value is written to stdin. */
  stdin?: string;
  /**
   * Exit codes after which this operation's result may be established. Exit 0 is success by
   * convention. A nonzero code here is a success only with an entry in `exitSemantics`: see there.
   */
  okExit: number[];
  /**
   * The demonstrated basis for each nonzero code in `okExit`, keyed by the code. A nonzero exit is
   * a valid outcome of this operation (a comparison that found differences) only when the
   * investigation observed it with output derived from the input, nothing on standard error, and
   * the same operation exiting 0 on other input. Every run re-checks the observable part: a run
   * that exits with this code but writes to standard error or produces nothing is a failure.
   * A nonzero code without an entry is never a success, whatever `okExit` lists (a declared
   * interface whose behaviour was never observed, or state learned before this was recorded).
   */
  exitSemantics?: Record<string, { meaning: string; evidence: string }>;
  /**
   * A binary transformation RightClick established by its own experiments (see
   * reflectors/binary-acquisition.ts): one typed input artefact in, one typed output artefact
   * out, with the exact argument vector that was observed to work. Every run re-establishes the
   * contract: the input must validate as `input.mediaType` before anything runs, the output must
   * validate as `output.mediaType`, and every fact in `preserves` must be equal in both, or no
   * result is established.
   */
  binary?: BinaryContract;
  output: "text" | "json" | "html" | "xml";
  /** SHA-256 of the program when it was investigated; a different program is not run as this. */
  sha256: string;
  /** Local environment pin, never proof of complete execution dependency coverage. */
  environment?: { version: 1; coverage: "partial"; digest: string };
  /**
   * Behaviour fingerprint: a digest of the outputs this mode produced for the investigator's fixed
   * synthetic inputs. Two investigations with the same fingerprint observed the same behaviour, so
   * a new file (another version, a wrapper) that keeps it is the same capability, and one that
   * changes it is not.
   */
  behaviour?: string;
  /**
   * Conformance examples: synthetic inputs from the investigation and the digest of the output
   * they produced. Re-running them (in the sandbox) revalidates the capability somewhere else or
   * after a change, without repeating the whole investigation.
   */
  examples?: Array<{ stdin?: string; files?: Record<string, string>; literals?: string[]; outputSha256: string; outputPreview: string }>;
  /** Local operation identities retained across inference upgrades by matching old examples
   * against fresh evidence for the same binary and invocation contract. Not portable authority
   * or universal semantic equivalence; export/import removes this local lineage. */
  continuity?: Array<{ behaviour: string; examples: NonNullable<CliInvoke["examples"]> }>;
  /** Output values that vary between identical runs (file timestamps) and are normalised in fingerprints. */
  volatile?: "timestamps";
  /**
   * The element type of a line-oriented result, established during investigation by validating
   * every line of every working trial (see `lineListType`). When present the result is returned as
   * a list of that type and every line is re-validated on each run: a line that does not validate
   * is a refusal, never a coerced element. Absent means the output stays opaque text, which is the
   * honest state when the evidence does not cover every line the program printed.
   */
  lineType?: SemType;
  /**
   * Empty standard output was observed as a legitimate result of this invocation, alongside real
   * output for a different input. Recorded as evidence for the caller; the run-time permission to
   * return an empty result rests on the exit code, not on this field.
   */
  emptyResult?: "observed";
  /**
   * Verified execution locale profile under which this capability's behaviour and conformance
   * examples were established. Execution under a different locale profile requires revalidation.
   */
  localeProfile?: { profile: "c" | "utf8"; locale: string; env: Record<string, string> };
}

export type Invoke =
  | CliInvoke
  | HttpInvoke
  | GraphQLInvoke
  | McpInvoke
  | BuiltinInvoke
  | PlatformInvoke
  | PeerInvoke
  | GoalInvoke
  | CompositeInvoke;

/** A field the provider's contract declares in this capability's result (paths may cross arrays). */
export interface DeclaredField {
  path: string;
  /** Semantic type when the contract describes a selectable scalar leaf. */
  type?: SemType;
  /** For providers that choose what to return (GraphQL): whether the default request selects it. */
  selected?: boolean;
}

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
  /** Result fields the contract declares (deeper than the output ports); used to judge goal satisfaction. */
  fields?: DeclaredField[];
  links?: ContractLink[];
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

/** Local transport observation, never a credential or proof of authority.
 * capabilityId identifies the owning run, including its monitor/redirect requests,
 * not necessarily the operation performed by each HTTP request. Not persisted. */
export interface TransportContext {
  readonly runtimeId: string;
  readonly runId: string;
  readonly capabilityId: string;
  readonly requestId: string;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit, context?: TransportContext) => Promise<Response>;

/** A host transport reports refusal, not a provider failure or an authority grant. */
export interface TransportRefusal {
  reason: string;
  capability?: string;
  runs: string[];
}
