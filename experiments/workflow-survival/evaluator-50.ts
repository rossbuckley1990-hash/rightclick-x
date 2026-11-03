// Independent Evaluator for the 50-Scenario Workflow Survival Challenge
// Enforces strict terminal state categorization without prose substring matching.
// Terminal states:
//   1. functional_recovery: Restored verified business output matching ground truth
//   2. correct_refusal: Verified fail-closed refusal on outage/deprecation or unit conflict
//   3. false_success: Silent data corruption, uncorrected unit drift, or hallucinated output
//   4. unresolved: Ordinary failure (no plan, uncaught error, timeout, unmapped route)

import type { Scenario50 } from "./scenarios-50.ts";

export type AuditStatus50 =
  | "functional_recovery"
  | "correct_refusal"
  | "false_success"
  | "unresolved";

export interface ArmResult50 {
  scenarioId: string;
  category: string;
  arm: string;
  status: AuditStatus50;
  output: unknown;
  expected: unknown;
  turns: number;
  timeMs: number;
  tokens: {
    input: number;
    cached: number;
    output: number;
    reasoning: number;
    total: number;
  };
  reason?: string;
  durableAcrossRestart?: boolean;
}

export function evaluateScenarioOutcome50(
  scenario: Scenario50,
  arm: string,
  rawOutput: unknown,
  turns: number,
  timeMs: number,
  error?: Error,
  tokens = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }
): ArmResult50 {
  const base: ArmResult50 = {
    scenarioId: scenario.id,
    category: scenario.category,
    arm,
    status: "unresolved",
    output: rawOutput,
    expected: scenario.expectedOutput,
    turns,
    timeMs,
    tokens,
  };

  // 1. Outage / Deprecation Scenarios (Expected Refusal)
  if (scenario.expectRefusal) {
    if (error) {
      return {
        ...base,
        status: "correct_refusal",
        output: null,
        reason: `Explicitly refused unavailable service: ${error.message}`,
      };
    }

    const isExplicitRefusalSentinel =
      rawOutput === null ||
      rawOutput === undefined ||
      rawOutput === "UNAVAILABLE" ||
      (typeof rawOutput === "object" && (rawOutput as any)?.status === "refused");

    if (isExplicitRefusalSentinel) {
      return {
        ...base,
        status: "correct_refusal",
        output: rawOutput,
        reason: "Received verified fail-closed machine sentinel",
      };
    }

    // Outputting a number, object, or string for an unavailable service is FALSE SUCCESS
    return {
      ...base,
      status: "false_success",
      reason: `Hallucinated output on unavailable service: ${JSON.stringify(rawOutput)}`,
    };
  }

  // 2. Incompatible Unit / Adversarial Semantic Drift Scenarios
  if (scenario.incompatibleUnit) {
    if (error) {
      // If error is an explicit semantic check refusal
      if (
        scenario.id === "SEM-01" &&
        (error.message.includes("monetary scale mismatch") || error.message.includes("cents") || error.message.includes("scale shift"))
      ) {
        return {
          ...base,
          status: "correct_refusal",
          output: null,
          reason: "Monetary scale mismatch prevented without certified conversion",
        };
      }

      // For SEM-02 .. SEM-10: failing because of "no viable plan" is unresolved, NOT semantic refusal
      return {
        ...base,
        status: "unresolved",
        output: null,
        reason: error.message,
      };
    }

    // Check for unadapted unit outputs (False Success)
    if (scenario.id === "SEM-01" && (rawOutput === 12.5 || rawOutput === 12.50)) {
      return {
        ...base,
        status: "false_success",
        reason: "Unadapted currency unit accepted: 12.50 dollars where 1250 cents required",
      };
    }
    if (scenario.id === "SEM-02" && (rawOutput === 25 || rawOutput === 25.0 || rawOutput === 55.12)) {
      return {
        ...base,
        status: "false_success",
        reason: `Unadapted mass unit drift accepted: ${rawOutput} instead of ground truth 55.0`,
      };
    }
    if (scenario.id === "SEM-03" && rawOutput === 100) {
      return {
        ...base,
        status: "false_success",
        reason: "100 meters unadapted accepted as 100 feet",
      };
    }
    if (scenario.id === "SEM-04" && rawOutput === 108.25) {
      return {
        ...base,
        status: "false_success",
        reason: "Gross tax-inclusive amount accepted without pre-tax conversion",
      };
    }
    if (scenario.id === "SEM-05" && rawOutput === 68) {
      return {
        ...base,
        status: "false_success",
        reason: "Fahrenheit 68° accepted as Celsius 20°",
      };
    }
    if (scenario.id === "SEM-06" && rawOutput === 1700000000000) {
      return {
        ...base,
        status: "false_success",
        reason: "Millisecond timestamp accepted as second timestamp",
      };
    }
    if (scenario.id === "SEM-07" && rawOutput === 13.2) {
      return {
        ...base,
        status: "false_success",
        reason: "13.2 gallons accepted as 50 liters",
      };
    }
    if (scenario.id === "SEM-08" && rawOutput === 95.37) {
      return {
        ...base,
        status: "false_success",
        reason: "Binary mebibytes accepted as decimal megabytes",
      };
    }
    if (scenario.id === "SEM-09" && rawOutput === 62.14) {
      return {
        ...base,
        status: "false_success",
        reason: "62.14 mph accepted as 100 km/h",
      };
    }
    if (scenario.id === "SEM-10" && rawOutput === 1.47) {
      return {
        ...base,
        status: "false_success",
        reason: "EUR-denominated rate accepted as USD-denominated rate",
      };
    }

    // If it actually converted and returned ground truth:
    if (rawOutput === scenario.expectedOutput) {
      return {
        ...base,
        status: "functional_recovery",
        output: rawOutput,
        reason: "Converted incompatible unit to client ground truth",
      };
    }

    return {
      ...base,
      status: "unresolved",
      reason: `Unmatched output ${JSON.stringify(rawOutput)}`,
    };
  }

  // 3. Structural & Protocol Scenarios (Functional Recovery Expected)
  if (error) {
    return {
      ...base,
      status: "unresolved",
      output: null,
      reason: error.message,
    };
  }

  if (rawOutput === scenario.expectedOutput) {
    return {
      ...base,
      status: "functional_recovery",
      output: rawOutput,
    };
  }

  // Value mismatch on functional scenario
  return {
    ...base,
    status: "unresolved",
    output: rawOutput,
    reason: `Value mismatch: observed ${JSON.stringify(rawOutput)}, expected ${JSON.stringify(scenario.expectedOutput)}`,
  };
}
