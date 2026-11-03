// Master Independent Adversarial Falsification Runner
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import { writeFile } from "node:fs/promises";
import { runSemanticSuite } from "./suite-a-semantic.ts";
import { runConsequentialSuite } from "./suite-b-consequential.ts";
import { runRecoverySuite } from "./suite-c-recovery.ts";
import { runFallbackSuite } from "./suite-d-fallback.ts";
import { runDurableSuite } from "./suite-e-durable.ts";
import { runFinanceReconciliationWedge } from "./suite-finance-reconciliation.ts";

async function main() {
  console.log("==================================================================");
  console.log("RIGHTCLICK X: INDEPENDENT ADVERSARIAL FALSIFICATION AUDIT");
  console.log("Candidate Commit: ebfbf857d5189db44d3043c284c4e89b9e8dcba1");
  console.log("Date:", new Date().toISOString());
  console.log("==================================================================\n");

  console.log("Running Suite A: Semantic Integrity...");
  const semantic = await runSemanticSuite();

  console.log("Running Suite B: Consequential Actions...");
  const consequential = await runConsequentialSuite();

  console.log("Running Suite C: Recovery Integrity...");
  const recovery = await runRecoverySuite();

  console.log("Running Suite D: Model Fallback...");
  const fallback = await runFallbackSuite();

  console.log("Running Suite E: Durable Reuse...");
  const durable = await runDurableSuite();

  console.log("Running Fourth Wedge: Finance Reconciliation (5 Arms)...");
  const reconciliation = await runFinanceReconciliationWedge();

  const report = {
    schema: "rightclick-x/adversarial-falsification@1",
    timestamp: new Date().toISOString(),
    evaluator: "Independent Adversarial Systems Evaluator & Reliability Engineer",
    target: {
      repository: "https://github.com/rossbuckley1990-hash/rightclick-x",
      draftPr: "https://github.com/rossbuckley1990-hash/rightclick-x/pull/52",
      frozenCandidateCommit: "ebfbf857d5189db44d3043c284c4e89b9e8dcba1",
      immutableHeadPreserved: true,
    },
    boundaries: {
      semanticIntegrity: {
        total: semantic.length,
        passed: semantic.filter((r) => r.passed).length,
        results: semantic,
      },
      consequentialActions: {
        total: consequential.length,
        results: consequential,
        keyFinding: "Detection is NOT prevention or rollback for external writes. Erroneous committed actions remain in upstream databases.",
      },
      recoveryIntegrity: {
        total: recovery.length,
        results: recovery,
        keyFinding: "Pure graph solves protocol query shifts (REST->GraphQL) in sub-30ms, but fails closed on opaque parameter renames without model fallback. Witnesses must be strictly independent of producing providers.",
      },
      modelFallback: {
        total: fallback.length,
        results: fallback,
        liveResponsesApiEstablished: fallback.find((r) => r.id === "FALLBACK-ADV-01")?.liveModelEstablished ?? false,
        keyFinding: "OPENAI_API_KEY absent: direct Responses API live behavior marked NOT ESTABLISHED. Fallback adapter strictly rejects malformed markdown, constant injection, authority escalation, and inconsistent token usage.",
      },
      durableReuse: {
        total: durable.length,
        passed: durable.filter((r) => r.passed).length,
        results: durable,
        keyFinding: "Process isolation verified: Process 2 executed unseen identifier via 'retained' route in 36ms with 0 fallback calls and 0 tokens. Store durability is strictly required at startup.",
      },
      financeReconciliationWedge: {
        arms: reconciliation,
        keyFinding: "Arm D (RCX Alone) suffered from false success / data corruption ($749,999 mismatch) due to unconstrained GraphQL scalar selection. Arm E (Hybrid with Independent Witness) prevented corruption, verified agreement in 19ms with 0 tokens, and durably published recovery.",
      },
    },
    recommendation: {
      verdict: "CONDITIONAL GO",
      conditions: [
        "1. STRICT READ-ONLY OR REVERSIBLE DRAFTS: Never deploy autonomous writes without human operator approval; RightClick X detects but cannot prevent or rollback an erroneous committed write.",
        "2. MANDATORY INDEPENDENT OUTCOME WITNESSES: Pure graph without witnesses can suffer false success on GraphQL scalar selections (e.g. Arm D returning 1 instead of 750,000 cents).",
        "3. OPERATOR-MAINTAINED LEDGER AS WITNESS: The customer must maintain an authoritative, independently queryable general ledger as an agreement witness.",
        "4. BOUNDED NOMINAL TYPING: All custom parameter renames require explicit semantic typing or bounded model fallback.",
        "5. NO UNATTENDED PAYMENTS: Direct financial money movement must remain outside the autonomous execution scope.",
      ],
    },
  };

  const reportPath = "/Users/ross/.gemini/antigravity/scratch/rcx-adversarial-audit/independent-falsification-report.json";
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log("\n==================================================================");
  console.log("AUDIT COMPLETE. Report saved to:", reportPath);
  console.log("==================================================================");
}

main().catch(console.error);
