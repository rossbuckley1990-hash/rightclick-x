import { readFile } from "node:fs/promises";
import { VerifiedReconciliation } from "../../src/reconciliation.ts";
import { FileStore } from "../../src/entry/node-host.ts";
import { fixtureAuth } from "./setup.ts";
const [config, state, account, mode = "deterministic"] = process.argv.slice(2);
const contract = JSON.parse(await readFile(config, "utf8"));
let requests = 0, requestBytes = 0, responseBytes = 0, discoveryResponseBytes = 0, fallbackCalls = 0;
const start = performance.now();
const app = await VerifiedReconciliation.create(contract, { store: new FileStore(state),
  auth: fixtureAuth(contract.secondarySource, new URL(contract.checker.source).origin),
  fetch: async (input, init, context) => {
    requests++; requestBytes += typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
    const response = await fetch(input, init);
    const size = (await response.clone().arrayBuffer()).byteLength;
    responseBytes += size; if (!context) discoveryResponseBytes += size;
    return response;
  },
  // An unavailable real-model gate, never a scripted repair. A call fails closed.
  fallback: mode === "fallback-gate" ? { propose: async () => { fallbackCalls++; throw new Error("Responses API unavailable"); } } : undefined,
});
const result = await app.reconcile({ account, period: "2026-10" });
console.log(JSON.stringify({ pid: process.pid, mode, result, measurements: { elapsedMs: performance.now() - start,
  requests, requestBytes, responseBytes, discoveryResponseBytes, fallbackCalls,
  modelTurns: 0, modelInputTokens: 0, modelOutputTokens: 0, inferenceCostUsd: 0,
  mcpBytes: 0, scope: "direct SDK worker; no MCP transport or model invoked", totalDeliveryCostUsd: null } }));
