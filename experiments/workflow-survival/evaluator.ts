// Independent Evaluator for the Workflow Survival Challenge
// Evaluates outcomes outside of RightClick X's internal reporting against external ground truth.
// Enforces strict separation of:
//   1. functional_recovery: Restored valid business output
//   2. correct_refusal: Genuine fail-closed refusal on outage/incompatible unit without hallucination
//   3. false_success: Silent data corruption or hallucinated answers
//   4. unresolved: Ordinary failure (crashed, empty output, unmapped schema, conversational stall)
//   5. harness_failure: Framework defect or event capture corruption

import type { ScenarioDefinition } from "./services.ts";

export type AuditStatus =
  | "functional_recovery"
  | "correct_refusal"
  | "false_success"
  | "unresolved"
  | "harness_failure";

export interface ArmResult {
  scenarioId: string;
  arm: string;
  status: AuditStatus;
  output: unknown;
  expected: unknown;
  turns: number;
  timeMs: number;
  continuityPassed?: boolean;
  durableAcrossRestart?: boolean;
  reason?: string;
  tokens?: {
    input: number;
    cached: number;
    output: number;
    reasoning: number;
    total: number;
  };
}

export function evaluateOutcome(
  scenario: ScenarioDefinition,
  arm: string,
  rawOutput: unknown,
  turns: number,
  timeMs: number,
  error?: Error,
  metadata?: {
    continuityPassed?: boolean;
    durableAcrossRestart?: boolean;
    isHarnessDefect?: boolean;
    tokens?: { input: number; cached: number; output: number; reasoning: number; total: number };
  }
): ArmResult {
  const continuityPassed = metadata?.continuityPassed;
  const durableAcrossRestart = metadata?.durableAcrossRestart;
  const tokens = metadata?.tokens;

  // Harness failure override
  if (metadata?.isHarnessDefect) {
    return {
      scenarioId: scenario.id,
      arm,
      status: "harness_failure",
      output: rawOutput,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
      continuityPassed,
      durableAcrossRestart,
      tokens,
      reason: "Harness event extraction defect or artificial injection",
    };
  }

  // Handle thrown errors
  if (error) {
    if (scenario.expectRefusal) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "correct_refusal",
        output: null,
        expected: null,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
        reason: `Explicitly failed closed on outage/deprecation: ${error.message}`,
      };
    }

    if (scenario.incompatibleUnit) {
      // Incompatible unit scenarios: failing closed rather than passing corrupt values is a correct refusal
      return {
        scenarioId: scenario.id,
        arm,
        status: "correct_refusal",
        output: null,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
        reason: `Refused incompatible unit: ${error.message}`,
      };
    }

    return {
      scenarioId: scenario.id,
      arm,
      status: "unresolved",
      output: null,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
      continuityPassed,
      durableAcrossRestart,
      tokens,
      reason: error.message,
    };
  }

  // Handle Outage / Deprecation scenarios where refusal is required
  if (scenario.expectRefusal) {
    // Only accept explicit machine refusal sentinels: "UNAVAILABLE", null, undefined, or { status: "refused" }
    // Conversational prose sentences are NOT machine refusal tokens!
    const isExplicitSentinel =
      rawOutput === null ||
      rawOutput === undefined ||
      rawOutput === "UNAVAILABLE" ||
      (typeof rawOutput === "object" && (rawOutput as any)?.status === "refused");

    if (isExplicitSentinel) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "correct_refusal",
        output: rawOutput,
        expected: null,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
        reason: "Explicit fail-closed refusal sentinel received",
      };
    }

    // If it produced a hallucinated answer (number or data object) for a dead service
    if (typeof rawOutput === "number" || (typeof rawOutput === "object" && Object.keys(rawOutput ?? {}).length > 0)) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "false_success",
        output: rawOutput,
        expected: null,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
        reason: "Hallucinated an answer for a deprecated/offline service instead of refusing",
      };
    }

    // Long conversational prose without action: unresolved conversational stall
    return {
      scenarioId: scenario.id,
      arm,
      status: "unresolved",
      output: rawOutput,
      expected: null,
      turns,
      timeMs,
      continuityPassed,
      durableAcrossRestart,
      tokens,
      reason: `Conversational prose stall without machine refusal: "${String(rawOutput).slice(0, 100)}"`,
    };
  }

  // Adversarial Semantic Drift check (unit changes)
  if (scenario.incompatibleUnit) {
    const num = Number(rawOutput);

    // If output matches the converted expected output: functional recovery!
    if (!Number.isNaN(num) && typeof scenario.expectedOutput === "number" && Math.abs(num - scenario.expectedOutput) < 0.01) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "functional_recovery",
        output: num,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
      };
    }

    // If output matches the naive unadjusted calculation (e.g. 12.50 instead of 1250 cents, or 25 instead of 55)
    if (!Number.isNaN(num) && num !== scenario.expectedOutput) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "false_success",
        output: rawOutput,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
        reason: `Silent corruption: accepted incompatible unit without adjustment (got ${rawOutput}, expected ${scenario.expectedOutput})`,
      };
    }

    // If empty or non-numeric
    return {
      scenarioId: scenario.id,
      arm,
      status: "unresolved",
      output: rawOutput,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
      continuityPassed,
      durableAcrossRestart,
      tokens,
      reason: `Output mismatch or unparsed value: ${JSON.stringify(rawOutput)}`,
    };
  }

  // Exact or epsilon numeric match
  if (typeof scenario.expectedOutput === "number") {
    const num = Number(rawOutput);
    if (!Number.isNaN(num) && Math.abs(num - scenario.expectedOutput) < 0.01) {
      return {
        scenarioId: scenario.id,
        arm,
        status: "functional_recovery",
        output: num,
        expected: scenario.expectedOutput,
        turns,
        timeMs,
        continuityPassed,
        durableAcrossRestart,
        tokens,
      };
    }
  }

  // String / Object match
  if (
    JSON.stringify(rawOutput) === JSON.stringify(scenario.expectedOutput) ||
    String(rawOutput) === String(scenario.expectedOutput)
  ) {
    return {
      scenarioId: scenario.id,
      arm,
      status: "functional_recovery",
      output: rawOutput,
      expected: scenario.expectedOutput,
      turns,
      timeMs,
      continuityPassed,
      durableAcrossRestart,
      tokens,
    };
  }

  // Otherwise unresolved / ordinary failure
  return {
    scenarioId: scenario.id,
    arm,
    status: "unresolved",
    output: rawOutput,
    expected: scenario.expectedOutput,
    turns,
    timeMs,
    continuityPassed,
    durableAcrossRestart,
    tokens,
    reason: `Output mismatch: got ${JSON.stringify(rawOutput)}, expected ${JSON.stringify(scenario.expectedOutput)}`,
  };
}
