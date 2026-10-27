import { test } from "node:test";
import assert from "node:assert/strict";
import { makePortableGoal, parsePortableGoal, parseProtectedValueRef } from "../src/core/portable-capability.ts";
import type { PublishedGoal } from "../src/runtime.ts";
import { RightClick } from "../src/runtime.ts";
import { ProcessMemoryStore } from "../src/entry/node-host.ts";

const ref = { kind: "protected-value-ref" as const, version: 1 as const, slot: "api-token", purpose: "provider-auth", requiredScope: "orders:read" };
const goal = (): PublishedGoal => ({ slug: "lookup", revision: "revision-1", title: "Lookup", have: { token: "text", region: "text" }, want: "text", through: ["builtin:text.sha256"], fixed: { region: "GB" }, publishedAt: "2026-01-01", calls: 10, trust: "verified" });
const approval = { approveDefinition: true as const, portableFixedInputs: ["region"] };

test("portable goal explicitly declassifies ordinary fixed inputs without copying observations", () => {
  const artifact = makePortableGoal(goal(), { token: ref }, approval);
  assert.equal(artifact.goal.fixed?.region, "GB");
  assert.deepEqual(artifact.protectedInputs.token, ref);
  assert.ok(!("calls" in artifact.goal)); assert.ok(!("trust" in artifact.goal)); assert.ok(!("publishedAt" in artifact.goal));
  assert.deepEqual(parsePortableGoal(JSON.parse(JSON.stringify(artifact))), artifact);
});

test("unapproved fixed values and unapproved definitions refuse without echoing canaries", () => {
  const unsafe = goal(); unsafe.fixed = { region: "opaque-synthetic-canary" };
  assert.throws(() => makePortableGoal(unsafe, { token: ref }, { approveDefinition: true, portableFixedInputs: [] }), (e: unknown) => e instanceof Error && !e.message.includes("opaque-synthetic-canary"));
  assert.throws(() => makePortableGoal(unsafe, { token: ref }, { approveDefinition: false as true, portableFixedInputs: ["region"] }), /unapproved/);
  // A host may deliberately declassify a literal. The runtime cannot identify
  // an arbitrary value's sensitivity, so that is a trusted-host decision.
  assert.equal(makePortableGoal(unsafe, { token: ref }, approval).goal.fixed?.region, "opaque-synthetic-canary");
});

test("arbitrary root and nested metadata are refused rather than promoted", () => {
  const artifact = makePortableGoal(goal(), { token: ref }, approval);
  const root = { ...artifact, metadata: { description: "opaque-synthetic-canary" } };
  assert.throws(() => parsePortableGoal(root), /invalid/);
  const nested = structuredClone(artifact) as any;
  nested.goal.anchors = [{ id: "a", title: "a", risk: "read", inputTypes: ["text"], outputTypes: ["text"], examples: { safe: "opaque-synthetic-canary" } }];
  assert.throws(() => parsePortableGoal(nested), /invalid/);
  const published = goal() as any; published.description = "opaque-synthetic-canary";
  assert.throws(() => makePortableGoal(published, { token: ref }, approval), /invalid/);
});

test("protected references use an exact versioned shape and cannot masquerade as fixed values", () => {
  for (const malformed of [null, {}, { ...ref, version: 2 }, { ...ref, extra: "value" }, { ...ref, slot: "a bearer secret" }, { ...ref, requiredScope: "" }])
    assert.throws(() => parseProtectedValueRef(malformed), /invalid/);
  const bad = goal(); bad.fixed = { token: ref };
  assert.throws(() => makePortableGoal(bad, {}, { approveDefinition: true, portableFixedInputs: ["token"] }), /invalid/);
  assert.throws(() => makePortableGoal(goal(), { region: ref }, approval), /invalid/);
  const retained = Object.assign(goal(), { protectedInputs: { token: ref } });
  assert.throws(() => makePortableGoal(retained, {}, approval), /invalid/);
  assert.throws(() => makePortableGoal(retained, { token: { ...ref, slot: "other" } }, approval), /invalid/);
  assert.deepEqual(makePortableGoal(retained, { token: ref }, approval).protectedInputs.token, ref);
  const tooMany = makePortableGoal(goal(), {}, approval) as any;
  tooMany.goal.have = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`port${i}`, "text"]));
  delete tooMany.goal.fixed;
  tooMany.protectedInputs = Object.fromEntries(Object.keys(tooMany.goal.have).map(k => [k, ref]));
  assert.throws(() => parsePortableGoal(tooMany), /invalid/);
});

test("witness contracts and bindings reject unknown data and legacy hashes", () => {
  const artifact = makePortableGoal(goal(), { token: ref }, approval);
  const witness = { capability: "mcp:independent:check", contract: `sha256:${"a".repeat(64)}`, args: { input: { input: "token" } }, verify: [{ op: "exists" as const }] };
  artifact.goal.witnesses = [witness];
  assert.deepEqual(parsePortableGoal(artifact).goal.witnesses, [witness]);
  const malformed = structuredClone(artifact) as any; malformed.goal.witnesses[0].contract = "deadbeef";
  assert.throws(() => parsePortableGoal(malformed), /invalid/);
  const extra = structuredClone(artifact) as any; extra.goal.witnesses[0].args.input.raw = "opaque-synthetic-canary";
  assert.throws(() => parsePortableGoal(extra), /invalid/);
});

test("host-approved ordinary goal transfers through runtime export and import with a new local revision", async () => {
  const source = await RightClick.create({ directories: [], sandbox: null, store: new ProcessMemoryStore(), authority: { shareEvidence: true } });
  const created = await source.compose({ have: { text: { type: "text", value: "synthetic-creator-input" } }, want: "hash", through: ["builtin:text.sha256"], run: true, publish: "Portable digest" });
  assert.ok(created.published);
  const artifact = source.exportPortableGoal("portable-digest", {}, { approveDefinition: true, portableFixedInputs: [] });
  assert.ok(!JSON.stringify(artifact).includes("synthetic-creator-input"));
  const receiver = await RightClick.create({ directories: [], sandbox: null, store: new ProcessMemoryStore() });
  await assert.rejects(receiver.importPortableGoal(artifact, { approveDefinition: false as true }), /approval/);
  const imported = await receiver.importPortableGoal(JSON.parse(JSON.stringify(artifact)), { approveDefinition: true });
  assert.notEqual(imported.revision, artifact.goal.revision);
  assert.equal(receiver.published.get("portable-digest")?.trust, "unverified");
  await assert.rejects(receiver.importPortableGoal(artifact, { approveDefinition: true }), /already exists/);
  const result = await receiver.run(imported.id, { text: "different-consumer-input" });
  assert.equal(result.status, "completed", result.error);
});

test("portable import refuses uncoordinated stores and reports uncertain writes without echoing store data", async () => {
  const artifact = makePortableGoal(goal(), {}, approval);
  const uncoordinated = await RightClick.create({ directories: [], sandbox: null, store: { load: async () => null, save: async () => {} } });
  await assert.rejects(uncoordinated.importPortableGoal(artifact, { approveDefinition: true }), /authoritative coordinated store/);
  const failing = await RightClick.create({ directories: [], sandbox: null, store: {
    load: async () => null,
    save: async () => { throw new Error("opaque-synthetic-canary"); },
    withGoalLease: async (_pins, invoke) => invoke(),
  } });
  await assert.rejects(failing.importPortableGoal(artifact, { approveDefinition: true }), (e: unknown) => e instanceof Error && /outcome.*unknown/i.test(e.message) && !e.message.includes("opaque-synthetic-canary"));
  assert.equal(failing.graph.get("goal:lookup"), undefined);
});

test("protected-input import persists the requirement and refuses unsupported execution after restart", async () => {
  const artifact = makePortableGoal(goal(), { token: ref }, approval);
  const store = new ProcessMemoryStore();
  const receiving = await RightClick.create({ directories: [], sandbox: null, store });
  await receiving.importPortableGoal(artifact, { approveDefinition: true });
  assert.ok((await store.load())?.requirements?.includes("protected-value-slots@1"));
  const fresh = await RightClick.create({ directories: [], sandbox: null, store });
  assert.ok(fresh.graph.get("goal:lookup"));
  const rejected = await fresh.run("goal:lookup", {});
  assert.notEqual(rejected.status, "completed");
});
