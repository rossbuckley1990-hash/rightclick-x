// Pure decisions shared by the fixture host and its model-free negative controls.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { stableStringify, type Receipt } from "../../src/core/ledger.ts";

export const phaseTools = (phase: "creator" | "reuser") => new Set([
  "context_runtime", "context_inspect", "context_actions", "context_explain", "context_run", "context_run_status", "context_graph", "context_providers",
  ...(phase === "creator" ? ["context_learn", "context_compose"] : []),
]);

export function refusalForTool(phase: "creator" | "reuser", name: string, args: any, programs: string[]): string {
  if (!phaseTools(phase).has(name)) return "tool unavailable in this phase";
  if (name === "context_learn") {
    if (args.sources !== undefined && !Array.isArray(args.sources)) return "only the four operator-authorised local CLI paths may be learned";
    const sources = [...(args.source === undefined ? [] : [args.source]), ...(args.sources ?? [])];
    if (!sources.length || sources.some((s: unknown) => typeof s !== "string" || !programs.some(p => s === `cli:${p}`)))
      return "only the four operator-authorised local CLI paths may be learned";
  }
  if (name === "context_compose" && args.acquire) return "network acquisition is disabled";
  return "";
}

export function sameGoalDefinition(before: any, after: any) {
  const definition = (g: any) => { if (!g) return g; const { calls, lastPipeline, providers, lastResult, ...fixed } = g; return fixed; };
  return !!before && !!after && isDeepStrictEqual(definition(before), definition(after));
}

export function receiptBindsRun(receipt: Receipt | undefined, goalId: string, args: unknown, run: any): boolean {
  const hash = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex");
  return !!receipt && receipt.runId === run?.runId && receipt.capability === goalId && receipt.status === "completed" &&
    receipt.verification === "verified" && receipt.inputDigest === hash(args) && receipt.outputDigest === hash(run.output);
}
