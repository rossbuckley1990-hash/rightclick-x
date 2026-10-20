// Versioned persistence, not authorization. The envelope deliberately makes
// audited legacy readers stop at graph restoration instead of interpreting an
// unknown version as empty state and overwriting it on their next flush.
import type { PersistedState } from "../runtime.ts";

export const STATE_FORMAT = "rightclick-x/runtime-state@2";
export const STATE_REQUIREMENTS = [
  "scoped-composites@1",
  "http-workflow-continuations@1",
  "composition-goal-obligations@1",
  "declared-continuation-contracts@1",
] as const;
const supported = new Set<string>(STATE_REQUIREMENTS);
const invocations = new Set(["http", "graphql", "mcp", "peer", "builtin", "platform", "cli", "goal", "composite"]);
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Decode an existing value. Only the storage adapter can identify absence. */
export function decodeState(value: unknown): PersistedState {
  if (!object(value)) throw new Error("invalid runtime state: expected an object; existing data was not discarded");
  if ("format" in value) {
    if (value.format !== STATE_FORMAT) throw new Error(`unsupported runtime state format: ${String(value.format)}`);
    if (value.version !== 1 || !object(value.reflections) || value.reflections.requires !== STATE_FORMAT ||
        !object(value.state) || value.state.version !== 2 || "format" in value.state) {
      throw new Error("invalid runtime state envelope");
    }
    value = value.state;
  }
  const state = value as Record<string, any>;
  if (state.version !== 1 && state.version !== 2) throw new Error(`unsupported runtime state version: ${String(state.version)}`);
  if (state.version === 2 && !Array.isArray(state.requirements)) throw new Error("runtime state requirements are missing");
  if (state.requirements !== undefined && (!Array.isArray(state.requirements) ||
      state.requirements.some((r: unknown) => typeof r !== "string" || !supported.has(r)))) {
    throw new Error("unsupported runtime state requirement; use a compatible reader");
  }
  if (!Array.isArray(state.reflections) || !Array.isArray(state.receipts) || !object(state.ledger) ||
      (state.published !== undefined && !Array.isArray(state.published))) {
    throw new Error("invalid runtime state structure");
  }
  for (const reflection of state.reflections) {
    if (!object(reflection) || !object(reflection.provider) || !Array.isArray(reflection.capabilities)) {
      throw new Error("invalid runtime state reflection");
    }
    for (const cap of reflection.capabilities) {
      if (!object(cap) || !object(cap.invoke) || !invocations.has(cap.invoke.kind) ||
          !Array.isArray(cap.inputs) || !Array.isArray(cap.outputs)) {
        throw new Error("unsupported runtime state capability");
      }
    }
  }
  return state as PersistedState;
}

/** Built-in adapters use this on disk/KV; custom adapters should do likewise. */
export function encodeState(state: PersistedState): string {
  decodeState(state);
  if (state.version !== 2) throw new Error("legacy runtime state is read-only; upgrade through the runtime before saving");
  return JSON.stringify({
    format: STATE_FORMAT,
    // This is a version-2 envelope, not a valid version-1 snapshot. Known old
    // readers enter their version-1 branch and refuse this non-array before any
    // restored operation or flush. A bare version:2 would silently reset them.
    version: 1,
    reflections: { requires: STATE_FORMAT },
    state,
  });
}
