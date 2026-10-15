// E9: the chameleon in Kubernetes.
//
// Kubernetes is the classic place where agents need hand-written MCP tools:
// a huge API, and custom resources (CRDs) that no pre-built server knows.
// RightClick X gets none. It reflects the live cluster's own OpenAPI, extends
// the cluster with a brand-new CRD through a capability it just reflected,
// re-reflects and finds the new resource's operations in its graph, then
// pipes live internet knowledge into instances of that resource. kubectl is
// used only at the end, as an independent witness.
//
//   kubectl proxy --port 8001 &   (any cluster; we use a throwaway kind cluster)
//   node experiments/kubernetes.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { RightClick } from "../src/runtime.ts";

const K8S = process.env.K8S_PROXY ?? "http://127.0.0.1:8001";
const CONTEXT = process.env.K8S_CONTEXT ?? "kind-rcx";
const NS = "rightclick-x";
const log = (...a: unknown[]) => console.log(...a);
const ms = (t: number) => Math.round(performance.now() - t);
const out: Record<string, unknown> = { at: new Date().toISOString() };

const rc = await RightClick.create({ name: "rcx-k8s", region: "kind", timeoutMs: 60_000 });

async function run(id: string, args: Record<string, unknown>, verify?: any[]) {
  const r = await rc.run(id, args, { verify });
  if (r.status !== "completed") throw new Error(`${id}: ${r.error}`);
  if (r.verification.status === "refuted") throw new Error(`${id} refuted: ${JSON.stringify(r.verification.results)}`);
  return r.output as any;
}
function find(phrase: string, expect: RegExp): string {
  const hit = rc.graph.search(phrase, 10).find((h) => expect.test(h.capability.id)) ?? { capability: rc.graph.list().find((c) => expect.test(c.id)) };
  if (!hit.capability) throw new Error(`no capability for ${phrase}`);
  return hit.capability.id;
}
const k8sIds = () => new Set(rc.graph.list().filter((c) => c.provider === "openapi:kubernetes").map((c) => c.id));

// ---------------------------------------------------------------- 1. become the cluster
let t = performance.now();
const learned = await rc.learn({ source: `${K8S}/openapi/v2` });
const before = k8sIds();
const caps = rc.graph.list().filter((c) => c.provider === "openapi:kubernetes");
const byRisk = caps.reduce((m: Record<string, number>, c) => ((m[c.risk] = (m[c.risk] ?? 0) + 1), m), {});
const p1 = rc.graph.powers();
log(`1. reflected the live cluster's API: ${before.size} operations in ${ms(t)}ms ${JSON.stringify(byRisk)}`);
log(`   graph: ${p1.capabilities} capabilities · ${p1.edges.toLocaleString()} typed links · ${p1.total.toLocaleString()} powers · 0 Kubernetes-specific lines of code`);
if (learned.results[0]?.error) throw new Error(learned.results[0].error);

const version = await run(find("get the code version", /getcodeversion$/), {});
const nsList = await run(find("list namespace", /listcorev1namespace$/), {});
log(`   cluster ${version.gitVersion} (${version.platform}); namespaces: ${nsList.items.map((n: any) => n.metadata.name).join(", ")}`);
out.reflect = { operations: before.size, byRisk, powers: p1, ms: ms(t), version: version.gitVersion };

// ---------------------------------------------------------------- 2. extend the environment, take its new shape
t = performance.now();
const CREATE_CRD = find("create a CustomResourceDefinition", /createapiextensionsv1customresourcedefinition$/);
await run(CREATE_CRD, {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "insights.rightclick.dev" },
  spec: {
    group: "rightclick.dev",
    scope: "Namespaced",
    names: { plural: "insights", singular: "insight", kind: "Insight", shortNames: ["ins"] },
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            description: "A piece of world knowledge stored in the cluster by an agent.",
            properties: {
              spec: {
                type: "object",
                properties: {
                  topic: { type: "string", description: "What the insight is about" },
                  summary: { type: "string", description: "Summary text" },
                  source: { type: "string", description: "Where it came from" },
                },
                required: ["topic", "summary"],
              },
            },
          },
        },
      },
    ],
  },
});
log(`2. created CustomResourceDefinition insights.rightclick.dev through reflected capability ${CREATE_CRD}`);
let added: string[] = [];
for (let i = 0; i < 30 && !added.length; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  await rc.learn({ source: `${K8S}/openapi/v2` });
  added = [...k8sIds()].filter((id) => !before.has(id));
}
const p2 = rc.graph.powers();
log(`   re-reflected after ${ms(t)}ms: +${added.length} capabilities nobody wrote → ${added.map((a) => a.split(":").pop()).join(", ")}`);
log(`   graph now ${p2.capabilities} capabilities · ${p2.total.toLocaleString()} powers (+${(p2.total - p1.total).toLocaleString()})`);
out.shapeShift = { crd: "insights.rightclick.dev", newCapabilities: added, ms: ms(t), powersGained: p2.total - p1.total };

// ---------------------------------------------------------------- 3. internet → cluster
t = performance.now();
await rc.learn({ sources: ["https://countries.trevorblades.com/", "https://en.wikipedia.org/api/rest_v1/?spec"] });
await run(find("create a Namespace", /createcorev1namespace$/), { apiVersion: "v1", kind: "Namespace", metadata: { name: NS, labels: { "created-by": "rightclick-x" } } });
const CREATE_INSIGHT = added.find((id) => /createrightclickdevv1namespacedinsight$/.test(id));
const LIST_INSIGHTS = added.find((id) => /listrightclickdevv1namespacedinsight$/.test(id));
if (!CREATE_INSIGHT || !LIST_INSIGHTS) throw new Error(`CRD operations not reflected: ${added.join(", ")}`);
const stored: Array<{ code: string; via: string[]; preview: string }> = [];
for (const code of ["PT", "JP", "KE", "BR"]) {
  const c = await rc.compose({ have: { country: code }, want: "text", intent: "country capital summary", run: true, risks: ["read", "external"], verify: [{ op: "length_gt", value: 40 }] });
  if (c.executed?.status !== "completed") throw new Error(`compose failed for ${code}: ${JSON.stringify(c.executed?.attempts)}`);
  const summary = String(c.executed.output);
  await run(
    CREATE_INSIGHT,
    { namespace: NS, apiVersion: "rightclick.dev/v1", kind: "Insight", metadata: { name: `capital-of-${code.toLowerCase()}` }, spec: { topic: `capital of ${code}`, summary, source: c.executed.titles.join(" → ") } },
    [{ op: "equals", path: "spec.summary", value: summary }],
  );
  stored.push({ code, via: c.executed.titles, preview: summary.slice(0, 90) });
  log(`3. ${code}: ${c.executed.titles.join(" → ")} → Insight capital-of-${code.toLowerCase()}  "${summary.slice(0, 70)}…"`);
}
const listed = await run(LIST_INSIGHTS, { namespace: NS }, [{ op: "length_gt", path: "items", value: 3 }]);
log(`   read back through ${LIST_INSIGHTS.split(":").pop()}: ${listed.items.length} Insights (${ms(t)}ms)`);
out.internetToCluster = { stored, readBack: listed.items.length, ms: ms(t) };

// ---------------------------------------------------------------- 4. independent witness
const witness = JSON.parse(execFileSync("kubectl", ["--context", CONTEXT, "get", "insights.rightclick.dev", "-n", NS, "-o", "json"], { encoding: "utf8" }));
const agree = witness.items.length === listed.items.length && witness.items.every((i: any) => listed.items.some((l: any) => l.metadata.uid === i.metadata.uid && l.spec.summary === i.spec.summary));
log(`4. kubectl (independent): ${witness.items.length} Insights, uids and summaries ${agree ? "✓ identical" : "✗ differ"}`);
out.witness = { kubectlCount: witness.items.length, identical: agree };

// ---------------------------------------------------------------- 5. destructive, no gate
t = performance.now();
const DELETE_NS = find("delete a Namespace", /deletecorev1namespace$/);
const del = await run(DELETE_NS, { name: NS });
log(`5. ${DELETE_NS.split(":").pop()} [${rc.graph.get(DELETE_NS)!.risk}] ran directly, no approval gate: status ${del.status?.phase ?? del.status ?? "accepted"} (${ms(t)}ms)`);
await run(find("delete a CustomResourceDefinition", /deleteapiextensionsv1customresourcedefinition$/), { name: "insights.rightclick.dev" });
const chain = await rc.verifyReceipts();
log(`   receipts: ${chain.count}, chain intact: ${chain.intact}`);
out.cleanup = { namespace: del.status?.phase ?? "deleted", crdDeleted: true };
out.receipts = chain;

mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/E9-kubernetes.json", JSON.stringify(out, null, 2));
log("results → experiments/results/E9-kubernetes.json");
