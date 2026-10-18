// Read-only dashboard facts. Graph topology, local policy and outcome evidence
// establish different things; none may silently stand in for another.
import type { RightClick } from "../runtime.ts";

export interface DashboardMetric {
  value: number | null;
  status: "measured" | "unknown" | "not-assessed";
  label: string;
  source: string;
  limitation: string;
}

export function dashboardMetrics(rc: RightClick) {
  const powers = rc.graph.powers();
  const retained = [...rc.published.values()].filter((goal) => {
    const cap = rc.graph.get(`goal:${goal.slug}`);
    return cap?.invoke.kind === "goal" && cap.invoke.slug === goal.slug;
  });
  const metric = (label: string, value: number | null, source: string, limitation: string, status: DashboardMetric["status"] = "measured"): DashboardMetric => ({ label, value, status, source, limitation });
  return {
    providers: metric("Providers", rc.graph.providers.size, "graph.providers.size", "Includes local built-ins and retained-capability providers; not a connectivity test."),
    discovered: metric("Discovered operations", rc.graph.capabilities.size, "graph.capabilities.size", "Known operation descriptors, including generated ones. Discovery establishes neither executability nor authority."),
    potentialPaths: metric("Potential typed paths", powers.chains2 + powers.chains3, "graph.powers().chains2 + graph.powers().chains3", "Directed walks through two or three operation nodes. Type compatibility is not semantic validity, a complete plan, authority or a verified workflow."),
    independentlyVerified: metric("Independently verified capabilities", null, "No current capability-wide independent outcome assessment is available", "Stored predicates, publication trust labels and receipt hashes are insufficient. Inspect per-run witness evidence; a separate provider is not an external attestation.", "not-assessed"),
    authorised: metric("Authorised capabilities", null, "No exact action, parameter set, principal and protected-boundary decision is established by this graph view", "Local execution-policy permission is only one prerequisite. Credentials, program authority, destructive approval and the actual execution boundary still apply. Other tools and shells are outside this view.", "unknown"),
    reusable: metric("Retained reusable contracts", retained.length, "published goals with a matching current graph goal descriptor", "Retained callable contracts; not a claim of current validity, independent verification or permission. Each call replans and checks its requirements."),
  };
}
