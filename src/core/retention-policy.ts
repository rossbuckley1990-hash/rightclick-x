// Raw execution values can be credentials even under an innocuous name. There
// is deliberately no content or name heuristic in this policy. Until the host
// supplies an external value/credential reference mechanism, durable goals
// may retain only data-free Boolean/null literals. Invokers supply all other
// values afresh under their own authority.
import type { OutcomeWitness, Predicate } from "./verify.ts";

function safeLiteral(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function safePredicate(p: Predicate): boolean {
  switch (p.op) {
    case "exists": case "type": return true;
    case "equals": return safeLiteral(p.value);
    // Patterns, text and numeric constants can themselves contain secrets.
    case "contains": case "matches": case "gt": case "lt": case "length_gt": return false;
  }
}

/** Returns an error without echoing the rejected value. */
export function definitionRetentionError(fixed: Record<string, unknown>, verify: Predicate[] = [], witnesses: OutcomeWitness[] = []): string | undefined {
  if (Object.values(fixed).some(value => !safeLiteral(value))) return "inline fixed execution values cannot be persisted; supply them at invocation";
  if (!verify.every(safePredicate)) return "verification literals cannot be persisted; use a value-free or Boolean check";
  for (const witness of witnesses) {
    if (!witness.verify.every(safePredicate)) return "witness literals cannot be persisted; use a value-free or Boolean check";
    if (Object.values(witness.args).some(binding => "value" in binding && !safeLiteral(binding.value))) return "inline witness values cannot be persisted; bind invocation input or output";
  }
}
