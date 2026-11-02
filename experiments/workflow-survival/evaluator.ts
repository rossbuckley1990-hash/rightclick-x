// Independent Evaluator for the Workflow Survival Challenge
// Evaluates outcomes outside of RightClick X's internal reporting against external ground truth.

import type { ScenarioDefinition } from "./services.ts";

export interface ArmResult {
  scenarioId: string;
  arm: "Baseline A (Static)" | "Baseline B (Codex)" | "Treatment (RightClick X)";
  status: "success" | "failed" | "refused" | "false_success";
  output: unknown;
  expected: unknown;
  turns: number;
  timeMs: number;
  reason?: string;
}

export function evaluateOutcome(scenario: ScenarioDefinition, arm: "Baseline A (Static)" | "Baseline B (Codex)" | "Treatment (RightClick X)", rawOutput: unknown, turns: number, timeMs: number, error?: Error): ArmResult {
  // If an error was thrown
  if (error) {
    if (scenario.expectRefusal) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "refused",
        output: null,
        expected: null,
        turns,
        timeMs,
        reason: `Explicitly refused/failed closed on outage/deprecation: ${error.message}`,
      };
    }
    return {
      scenarioId: scenario.id,
      arm,
      status: "failed",
      output: null,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
      reason: error.message,
    };
  }

  // If the scenario expected an explicit refusal (e.g. outage or deprecation)
  if (scenario.expectRefusal) {
    if (rawOutput === null || rawOutput === undefined || String(rawOutput).toLowerCase().includes("unavailable") || String(rawOutput).toLowerCase().includes("refused")) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "refused",
        output: rawOutput,
        expected: null,
        turns,
        timeMs,
        reason: "Clean fail-closed refusal as required",
      };
    }
    // If it produced a hallucinated answer for an offline service
    return {
      scenarioId: scenario.id,
      arm,
      status: "false_success",
      output: rawOutput,
      expected: null,
      turns,
      timeMs,
      reason: "Hallucinated an answer for a deprecated/offline service instead of refusing",
    };
  }

  // Adversarial Semantic Drift check (e.g. cents vs dollars)
  if (scenario.incompatibleUnit) {
    const num = Number(rawOutput);
    // If output matches the naive unadjusted calculation (e.g. 12.50 instead of 1250 cents)
    if (!Number.isNaN(num) && num !== scenario.expectedOutput) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "false_success",
        output: rawOutput,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
        reason: `Silent corruption: accepted incompatible unit without adjustment (got ${rawOutput}, expected ${scenario.expectedOutput})`,
      };
    }
  }

  // Exact or close match for numeric values
  if (typeof scenario.expectedOutput === "number") {
    const num = Number(rawOutput);
    if (!Number.isNaN(num) && Math.abs(num - scenario.expectedOutput) < 0.01) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "success",
        output: num,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
      };
    }
  }

  // String / Object match
  if (JSON.stringify(rawOutput) === JSON.stringify(scenario.expectedOutput) || String(rawOutput) === String(scenario.expectedOutput)) {
    return {
      scenarioId: scenario.id,
      arm,
      status: "success",
      output: rawOutput,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
    };
  }

  return {
    scenarioId: scenario.id,
    arm,
    status: "failed",
    output: rawOutput,
    expected: scenario.expectedOutput,
    turns,
    timeMs,
    reason: `Output mismatch: got ${JSON.stringify(rawOutput)}, expected ${JSON.stringify(scenario.expectedOutput)}`,
  };
}
