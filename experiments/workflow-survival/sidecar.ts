// SENTINEL Independent Acceptance Sidecar Adaptation
// Executes actual RightClick X scenarios using isolated fresh loopback services
// and returns strictly-typed structured observable outcomes.
//
// Does NOT modify or intercept RightClick X runtime logic.
// Does NOT rely on prose parsing or agent self-reports.

import { serve } from "../../src/entry/node-host.ts";
import { RightClick } from "../../src/runtime.ts";
import {
  createBillingService,
  createFreightService,
  createDirectoryService,
  createFxService,
} from "./services.ts";
import { SCENARIOS } from "./scenarios.ts";

export type WorkflowOutcomeStatus =
  | "workflow_recovered"
  | "workflow_correctly_refused"
  | "workflow_not_established";

export interface SidecarOutcome {
  scenarioId: string;
  status: WorkflowOutcomeStatus;
  output: unknown;
  reason?: string;
}

export async function runScenario(scenarioId: string): Promise<SidecarOutcome> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    return {
      scenarioId,
      status: "workflow_not_established",
      output: null,
      reason: "unknown scenario",
    };
  }

  // 1. Instantiate fresh disposable service for this exact scenario
  let handler: (req: Request) => Promise<Response>;
  let setVersion: (v: number) => void;

  if (scenario.service === "billing") {
    const s = createBillingService();
    handler = s.handler;
    setVersion = s.setVersion;
  } else if (scenario.service === "freight") {
    const s = createFreightService();
    handler = s.handler;
    setVersion = s.setVersion;
  } else if (scenario.service === "directory") {
    const s = createDirectoryService();
    handler = s.handler;
    setVersion = s.setVersion;
  } else if (scenario.service === "fx") {
    const s = createFxService();
    handler = s.handler;
    setVersion = s.setVersion;
  } else {
    return {
      scenarioId,
      status: "workflow_not_established",
      output: null,
      reason: "unsupported service",
    };
  }

  setVersion(scenario.version);

  // 2. Start server on ephemeral port (port 0)
  const server = await serve(handler, 0);

  try {
    const rc = await RightClick.create({
      name: `sentinel-${scenario.id}-${Date.now()}`,
      authority: { retry: ["*"] },
      timeoutMs: 5000,
    });

    // 3. Learn schema directly from live loopback service
    await rc.learn({ source: server.url });

    // 4. Intent and output type mapping
    let wantType = "number";
    let intent = "calculate";
    if (scenario.service === "directory") {
      wantType = "string";
      intent = "account email";
    } else if (scenario.service === "billing") {
      wantType = "number";
      intent = "invoice total";
    } else if (scenario.service === "freight") {
      wantType = "number";
      intent = "shipping rate";
    } else if (scenario.service === "fx") {
      wantType = "number";
      intent = "exchange rate";
    }

    // 5. Compose and execute
    const comp = await rc.compose({
      have: scenario.input,
      want: wantType,
      intent,
      run: true,
    });

    if (comp.executed?.status === "completed") {
      const output = comp.executed.output;

      // Validate against false success conditions
      if (scenario.expectRefusal) {
        // Outputting a result for an unavailable service is false success
        return {
          scenarioId: scenario.id,
          status: "workflow_not_established",
          output,
          reason: "hallucinated output on outage",
        };
      }

      if (scenario.incompatibleUnit) {
        // SEM-01: Returning 12.5 decimal dollars where 1,250 cents is required is unadapted unit drift
        if (scenario.id === "SEM-01" && (output === 12.5 || output === 12.50)) {
          return {
            scenarioId: scenario.id,
            status: "workflow_not_established",
            output,
            reason: "unadapted unit drift: returned 12.5 decimal dollars where 1250 cents required",
          };
        }
        // SEM-02: Returning 25 lbs where 55 kg cost is required
        if (scenario.id === "SEM-02" && output !== scenario.expectedOutput) {
          return {
            scenarioId: scenario.id,
            status: "workflow_not_established",
            output,
            reason: "unadapted mass unit drift",
          };
        }
      }

      // Check if output matches expected value
      if (output === scenario.expectedOutput) {
        return {
          scenarioId: scenario.id,
          status: "workflow_recovered",
          output,
        };
      }

      return {
        scenarioId: scenario.id,
        status: "workflow_not_established",
        output,
        reason: `value mismatch: observed ${output}, expected ${scenario.expectedOutput}`,
      };
    } else {
      const errorMsg = comp.executed?.error ?? comp.plans?.[0]?.summary ?? "no viable plan";
      throw new Error(errorMsg);
    }
  } catch (error: any) {
    const message = error?.message ?? String(error);

    // Outage scenarios: failure is the required, correct refusal
    if (scenario.expectRefusal) {
      return {
        scenarioId: scenario.id,
        status: "workflow_correctly_refused",
        output: null,
        reason: "service unavailable",
      };
    }

    // Incompatible unit scenarios:
    // SEM-01: RightClick X's monetary provenance guard prevented major/minor scale shift
    if (scenario.id === "SEM-01") {
      return {
        scenarioId: scenario.id,
        status: "workflow_not_established",
        output: null,
        reason: "no viable plan",
      };
    }

    // SEM-02: Kilograms/lbs mismatch:
    // CRITICAL AUDIT RULE: Kilograms/lbs mismatch must NOT be mislabelled as semantic detection if the actual reason is no plan!
    if (scenario.id === "SEM-02") {
      return {
        scenarioId: scenario.id,
        status: "workflow_not_established",
        output: null,
        reason: "no viable plan",
      };
    }

    // Ordinary failures (e.g. STRUC-02, STRUC-03)
    return {
      scenarioId: scenario.id,
      status: "workflow_not_established",
      output: null,
      reason: message.includes("no viable plan") ? "no viable plan" : message,
    };
  } finally {
    await server.close().catch(() => {});
  }
}
