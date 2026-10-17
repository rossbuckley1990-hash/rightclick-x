// Operator authority from the environment: set by whoever runs RightClick X, never by an agent.
//   RCX_DESTRUCTIVE = operator (default) | agent-confirm | allow
//   RCX_APPROVE     = comma-separated capability ids or prefixes ending in "*" (destructive use)
//   RCX_RETRY       = comma-separated capability ids, prefixes or origins declared side-effect-free
//   RCX_INVESTIGATE = comma-separated program paths (or directories ending "/") that may be
//                     investigated, always in the host sandbox
//   RCX_EXECUTE     = the programs whose learned capabilities may run (same form); when unset,
//                     the programs that may be investigated
//   RCX_SHARE_EVIDENCE = "1" lets capability knowledge be exported from this installation
import type { OperatorAuthority } from "../runtime.ts";

const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function authorityFromEnv(env: Record<string, unknown>): OperatorAuthority {
  const d = String(env.RCX_DESTRUCTIVE ?? "operator");
  if (!["operator", "agent-confirm", "allow"].includes(d)) throw new Error(`RCX_DESTRUCTIVE must be operator, agent-confirm or allow (got ${d})`);
  return {
    destructive: d as OperatorAuthority["destructive"],
    approve: list(env.RCX_APPROVE),
    retry: list(env.RCX_RETRY),
    investigate: list(env.RCX_INVESTIGATE),
    ...(env.RCX_EXECUTE !== undefined ? { execute: list(env.RCX_EXECUTE) } : {}),
    shareEvidence: env.RCX_SHARE_EVIDENCE === "1",
  };
}
