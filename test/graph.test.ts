import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGraph } from "../src/core/graph.ts";
import { Ledger } from "../src/core/ledger.ts";
import { plan } from "../src/core/planner.ts";
import type { Capability, SemType } from "../src/core/types.ts";

function cap(id: string, inputs: SemType[], outputs: SemType[], title = id): Capability {
  return {
    id,
    title,
    description: "",
    provider: `p:${id}`,
    source: "builtin",
    inputs: inputs.map((t, i) => ({ name: `in${i}`, type: t, required: true })),
    outputs: outputs.map((t, i) => ({ name: i ? `out${i}` : "", type: t, required: true })),
    risk: "read",
    tags: [],
    invoke: { kind: "builtin", fn: id },
  };
}

function add(g: CapabilityGraph, c: Capability) {
  return g.add({ provider: { id: c.provider, title: c.id, source: "builtin", origin: "t", learnedAt: "", capabilityIds: [] }, capabilities: [c] });
}

test("powers count capabilities, typed links and 3-step chains", () => {
  const g = new CapabilityGraph();
  add(g, cap("a", ["url"], ["html"]));
  add(g, cap("b", ["html"], ["text"]));
  const d = add(g, cap("c", ["text"], ["language"]));
  const p = g.powers();
  assert.deepEqual([p.capabilities, p.edges, p.chains3], [3, 2, 1]);
  assert.equal(p.total, 6);
  assert.equal(d.newPowers, 3, "adding c adds itself, the b→c link and the a→b→c chain");
});

test("one new provider can add more powers than capabilities (network effect)", () => {
  const g = new CapabilityGraph();
  for (let i = 0; i < 6; i++) add(g, cap(`text${i}`, ["text"], ["text"]));
  const d = add(g, cap("hub", ["text"], ["text"]));
  assert.equal(d.capabilitiesAdded, 1);
  assert.ok(d.newPowers > 50, `newPowers=${d.newPowers}`);
});

test("planner chains through types and ranks by intent", () => {
  const g = new CapabilityGraph();
  add(g, cap("geo", ["place"], ["geo.lat", "geo.lon"], "Geocode"));
  const wx = cap("wx", ["geo.lat", "geo.lon"], ["text"], "Weather forecast");
  add(g, wx);
  add(g, cap("echo", ["place"], ["text"], "Describe place"));
  const plans = plan(g, new Ledger(), { have: { p: "place" }, want: "text", intent: "weather" });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].steps.map((s) => s.capability), ["geo", "wx"]);
  assert.deepEqual(plans[0].steps[1].bindings, [{ port: "in0", from: "0." }, { port: "in1", from: "0.out1" }]);
  const any = plan(g, new Ledger(), { have: { p: "place" }, want: "text" });
  assert.equal(any[0].steps[0].capability, "echo", "without intent, the cheapest plan wins");
});

test("planner routes around excluded capabilities and learns from the ledger", () => {
  const g = new CapabilityGraph();
  add(g, cap("fast", ["url"], ["text"], "Read A"));
  add(g, cap("slow", ["url"], ["text"], "Read B"));
  const ledger = new Ledger();
  for (let i = 0; i < 5; i++) ledger.record("fast", false, 50);
  for (let i = 0; i < 5; i++) ledger.record("slow", true, 50);
  assert.equal(plan(g, ledger, { have: { u: "url" }, want: "text" })[0].steps[0].capability, "slow");
  assert.equal(plan(g, ledger, { have: { u: "url" }, want: "text", exclude: new Set(["slow"]) })[0].steps[0].capability, "fast");
});

test("search ranks by relevance across titles, tags and ports", () => {
  const g = new CapabilityGraph();
  add(g, cap("t", ["text", "language"], ["text"], "Translate text"));
  add(g, cap("w", ["geo.lat", "geo.lon"], ["text"], "Weather forecast"));
  assert.equal(g.search("translation")[0].capability.id, "t");
  assert.equal(g.search("forecast weather")[0].capability.id, "w");
});

test("events: learn and forget are observable", () => {
  const g = new CapabilityGraph();
  const seen: string[] = [];
  g.subscribe((e) => seen.push(e.kind));
  add(g, cap("a", ["url"], ["html"]));
  g.forget("p:a");
  assert.deepEqual(seen, ["provider.learned", "provider.forgotten"]);
  assert.equal(g.capabilities.size, 0);
});
