// Additional acts in the existing persistent session. Only the trusted host
// changes the disposable provider or grants; ordinary tools operate the runtime.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { RpcPeer, Wire } from "./challenge-session.ts";

export async function exerciseAdaptation(options: {
  output: string; origin: string; goal: { id: string; path: string }; submit: { id: string; title: string };
  peer: RpcPeer; boundary: RpcPeer; tool(name: string, args?: object): Promise<any>;
  save(name: string, value: unknown): void; advertise(visible: boolean): void;
  counts(): { totalRequests: number; toolCalls: number };
}) {
  const { output, origin, goal, submit, peer, boundary, tool, save } = options;
  const lines: Record<string, number> = {};
  function count(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) count(path);
      else if (entry.name.endsWith(".jsonl")) lines[relative(output, path)] = readFileSync(path, "utf8").split("\n").filter(Boolean).length;
    }
  }
  count(output);
  save("adaptation-base-cutoff", { lines, ...options.counts() });
  save("adaptation-base-tools", JSON.parse(readFileSync(join(output, "tool-calls.json"), "utf8")));
  save("adaptation-base-public", JSON.parse(readFileSync(join(output, "public-network.json"), "utf8")));
  const phases: any[] = [];
  async function record(name: string, action: () => Promise<any>) {
    const before = options.counts(), started = performance.now();
    const result = await action();
    const after = options.counts();
    save("adaptation-" + name, result);
    phases.push({ name, durationMs: performance.now() - started,
      requests: after.totalRequests - before.totalRequests, tools: after.toolCalls - before.toolCalls });
    save("adaptation-phases", phases);
    return result;
  }
  async function view(name: string) {
    const value: any = {
      goal: await (await peer.http("/api/capability?id=" + encodeURIComponent(goal.id))).json(),
      original: await (await peer.http("/api/capability?id=" + encodeURIComponent(submit.id))).json(),
      activity: await (await peer.http("/api/activity?limit=100")).json(),
    };
    save("adaptation-view-" + name, value);
    const expected = ["compatible-after", "returned-after"].includes(name) ? "descriptor-matches-observation" : "dependencies-changed";
    assert.equal(value.goal.states.validity.state, expected, "failed calls must not erase dependency drift");
    assert.equal(value.goal.states.authority.state, "unknown");
  }
  const run = (args: object) => tool("context_run", { id: goal.id, args });
  const authorize = (args: object) => {
    const request: Wire = { method: "POST", url: origin + "/jobs", headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(args)).toString("base64") };
    return boundary.call("authorize", { requests: [request] });
  };
  const second = { label: "second", document: "A second document after an operation rename and nested result." };
  const returned = { label: "generated", document: "A third document after the compatible provider returns." };
  save("adaptation-tasks", { second, returned });
  await record("compatible-release", () => boundary.call("release", { release: "compatible" }));
  await record("compatible-refresh", () => tool("context_research"));
  await view("compatible-before");
  const denied = await record("compatible-denied", () => run(second));
  assert.equal(denied.status, "failed"); assert.ok(denied.refusal);
  await record("compatible-authorize", () => authorize(second));
  const compatible = await record("compatible-run", () => run(second));
  assert.equal(compatible.status, "completed", compatible.error);
  assert.match(compatible.output, /^[a-f0-9]{64}$/);
  await view("compatible-after");
  await record("compatible-effects", () => boundary.call("snapshot"));

  await record("incompatible-release", () => boundary.call("release", { release: "incompatible" }));
  await record("incompatible-refresh", () => tool("context_research"));
  await view("incompatible-before");
  const bad = await record("incompatible-run", () => run(returned));
  assert.equal(bad.status, "failed"); assert.match(bad.error, /changed meaning/);
  assert.equal(phases.at(-1).requests, 0, "known incompatible saved goal must not dispatch");
  const page: any = await (await peer.http("/api/capabilities?search=" + encodeURIComponent(submit.title))).json();
  const fresh = page.items.filter((c: any) => c.title === submit.title && c.invocation === "http" &&
    c.states.validity.state !== "changed-operation");
  assert.equal(fresh.length, 1, "one separately discovered changed action");
  const direct = await record("incompatible-fresh", () => tool("context_run", { id: fresh[0].id, args: returned }));
  assert.equal(direct.status, "failed"); assert.ok(direct.refusal);
  const generated: any = await record("incompatible-generated", async () => {
    const response = await peer.http(goal.path, returned);
    return { status: response.status, body: await response.json() };
  });
  assert.equal(generated.status, 400);
  assert.match(generated.body.error, /required anchor contract changed meaning/);
  assert.equal(generated.body.result, undefined);
  assert.equal(phases.at(-1).requests, 0);
  await view("incompatible-after");
  await record("incompatible-effects", () => boundary.call("snapshot"));

  options.advertise(false);
  await record("removed-refresh", () => tool("context_research"));
  await view("removed-before");
  const removed = await record("removed-run", () => run(returned));
  assert.equal(removed.status, "failed"); assert.match(removed.error, /unresolved required anchor/);
  assert.equal(phases.at(-1).requests, 0);
  await view("removed-after");
  await record("removed-effects", () => boundary.call("snapshot"));

  await record("returned-release", () => boundary.call("release", { release: "compatible" }));
  options.advertise(true);
  await record("returned-refresh", () => tool("context_research"));
  const noNewGrant = await record("returned-denied", () => run(returned));
  assert.equal(noNewGrant.status, "failed"); assert.ok(noNewGrant.refusal);
  await record("returned-authorize", () => authorize(returned));
  const complete = await record("returned-run", () => run(returned));
  assert.equal(complete.status, "completed", complete.error);
  await view("returned-after");
  await record("returned-effects", () => boundary.call("snapshot"));
  const retained = await peer.call("snapshot");
  // The runtime conservatively retains stopped workflows after a refusal: HTTP
  // denial alone does not universally establish non-execution. Never replay them.
  assert.equal(retained.state.httpContinuations.length, 0);
  assert.equal(retained.state.workflowContinuations.length, 3);
  for (const [index, checkpoint] of retained.state.workflowContinuations.entries()) {
    assert.equal(checkpoint.phase, "stopped");
    const unresolved = await record("stopped-resume-" + index, () =>
      tool("context_run", { id: "resume:" + checkpoint.runId }));
    assert.equal(unresolved.status, "pending");
    assert.equal(unresolved.pending.resumeId, undefined);
    assert.equal(phases.at(-1).requests, 0);
  }
  save("adaptation-final", await peer.call("snapshot"));
  save("adaptation-authority", await (await peer.http("/api/authority-evidence")).json());
  save("adaptation-summary", { status: "PARTIAL", ...options.counts(), phases: phases.length,
    scope: "same persistent runtime and retained goal; exposed controlled provider changes, not an independent holdout or a model trial" });
}
