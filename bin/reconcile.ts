#!/usr/bin/env node
// Operator-owned config only. No arbitrary generated code or agent tools.
import { readFile } from "node:fs/promises";
import { VerifiedReconciliation, type ReconciliationContract } from "../src/reconciliation.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { Authority } from "../src/reflectors/net.ts";
const [configFile, stateFile, account, period] = process.argv.slice(2);
if (!configFile || !stateFile || !account || !period) throw new Error("Usage: node bin/reconcile.ts contract.json state.json account closed-period");
try {
  const contract: ReconciliationContract = JSON.parse(await readFile(configFile, "utf8"));
  const auth = new Authority();
  if (process.env.RCX_SECONDARY_TOKEN) auth.set(contract.secondarySource, { Authorization: `Bearer ${process.env.RCX_SECONDARY_TOKEN}` });
  if (process.env.RCX_CHECKER_TOKEN) auth.set(contract.checker.source, { Authorization: `Bearer ${process.env.RCX_CHECKER_TOKEN}` });
  const app = await VerifiedReconciliation.create(contract, { store: new FileStore(stateFile), auth });
  const result = await app.reconcile({ account, period });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.state === "verified" ? 0 : 2;
} catch {
  console.log(JSON.stringify({ outcome: "UNRESOLVED/UNVERIFIED", state: "unsupported", explanation: "Configuration, storage or admission failed. Inspect the operator configuration and local state; no verified result is available.", durable: false }));
  process.exitCode = 2;
}
