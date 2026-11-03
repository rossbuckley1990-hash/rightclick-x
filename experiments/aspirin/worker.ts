import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { Authority } from "../../src/reflectors/net.ts";
import { RecoveringWorkflow, type FallbackAgent } from "../../src/recovery.ts";
const [provider, observer, state, request, fallbackMode, permission] = process.argv.slice(2);
const auth = new Authority();
auth.set(provider, { Authorization: `Bearer synthetic-${permission === "denied" ? "unauthorised" : "provider"}` });
auth.set(observer, { Authorization: "Bearer synthetic-observer" });
const rc = await RightClick.create({ directories: [], store: new FileStore(state), workflowRecovery: true, auth, timeoutMs: 1500, authority: { publish: "verified", retry: [] } });
// Deliberately scripted proposal adapter: proves validation/publication mechanics,
// not Codex reasoning. It gets no input values, oracle, database or conversation.
let disclosed: unknown;
const agent: FallbackAgent | undefined = fallbackMode === "fixture" ? { propose: async context => {
  disclosed = context;
  const candidate = context.capabilities.find(c => c.risk === "write" && c.inputs.some(p => p.name === "payload" && p.type === "json"));
  return { proposal: { capability: candidate?.id, inputBindings: { payload: "invoice" } }, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } };
} } : undefined;
const workflow = new RecoveringWorkflow(rc, { name: "issue-invoice", sources: [provider, `${observer}/openapi.json`], origins: [provider, observer],
  have: { invoice: "json" }, want: "json", intent: "create customer invoice", risks: ["write"],
  witnesses: [{ capability: "openapi:independent-audit:observeinvoice", args: { invoice: { input: "invoice" } }, verify: [{ op: "exists", path: "invoice_id" }], agree: {} }],
}, agent);
const result = await workflow.execute({ invoice: JSON.parse(request) });
await rc.flush().catch(() => {});
process.stdout.write(JSON.stringify({ ...result, evidence: result.evidence, disclosed, adapter: agent ? "scripted-development-proposal-no-model" : "none" }) + "\n");
