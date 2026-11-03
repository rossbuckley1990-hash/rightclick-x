import { RightClick, type RuntimeOptions } from "../../src/runtime.ts";
import { Authority } from "../../src/reflectors/net.ts";
import { reconciliationWitness, type ReconciliationContract } from "../../src/reconciliation.ts";
import { RULES_DIGEST } from "./service.ts";

export function fixtureAuth(gateway: string, checker: string) {
  const auth = new Authority();
  auth.set(gateway, { Authorization: "Bearer fixture-gateway-read" });
  auth.set(checker, { Authorization: "Bearer fixture-checker-read" });
  return auth;
}
// Explicit operator enrollment for this development fixture, outside any agent.
export async function fixtureContract(gateway: string, checker: string, fetcher?: RuntimeOptions["fetch"]): Promise<ReconciliationContract> {
  const contract: ReconciliationContract = { name: "settlement-reconciliation", secondarySource: gateway,
    approvedOrigins: [gateway, checker], approvedGraphqlEndpoints: [`${gateway}/graphql`], expected: { currency: "USD", unit: "minor", basis: "settled" },
    checker: { source: `${checker}/openapi.json`, capability: "openapi:operator-checker:observe", owner: "operator", contract: "", rulesDigest: RULES_DIGEST } };
  const rc = await RightClick.create({ directories: [], auth: fixtureAuth(gateway, checker), fetch: fetcher,
    authority: { execution: { allowedRisks: ["read"], allowedOrigins: [checker] } } });
  await rc.learn({ source: contract.checker.source });
  contract.checker.contract = (await rc.pinOutcomeWitnesses([reconciliationWitness(contract)]))[0].contract!;
  return contract;
}
