// Operator authority from the environment: set by whoever runs RightClick X, never by an agent.
//   RCX_DESTRUCTIVE = operator (default) | agent-confirm | allow
//   RCX_APPROVE     = comma-separated capability ids or prefixes ending in "*" (destructive use)
//   RCX_RETRY       = comma-separated capability ids, prefixes or origins declared side-effect-free
//   RCX_INVESTIGATE = comma-separated program paths (or directories ending "/") that may be
//                     investigated and run, always in the host sandbox
import type { OperatorAuthority } from "../runtime.ts";

const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function authorityFromEnv(env: Record<string, unknown>): OperatorAuthority {
  const d = String(env.RCX_DESTRUCTIVE ?? "operator");
  if (!["operator", "agent-confirm", "allow"].includes(d)) throw new Error(`RCX_DESTRUCTIVE must be operator, agent-confirm or allow (got ${d})`);
  return { destructive: d as OperatorAuthority["destructive"], approve: list(env.RCX_APPROVE), retry: list(env.RCX_RETRY), investigate: list(env.RCX_INVESTIGATE) };
}
