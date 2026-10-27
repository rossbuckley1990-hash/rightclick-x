import { test } from "node:test";
import assert from "node:assert/strict";
import { RightClick } from "../src/runtime.ts";
import { StateCommitUnknownError, StateConflictError } from "../src/core/state-conflict.ts";
import { MemoryStore } from "./helpers.ts";

test("a conflicting replacement is not executable while pending or after refusal", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  const base = { have: { text: { type: "text" as const, value: "x" } }, want: "hash" as const,
    through: ["builtin:text.sha256"], run: true, publish: "shared" };
  const first = await rc.compose(base);
  assert.equal(first.published?.durable, true);
  await rc.flush();
  let entered!: () => void, rejectSave!: (error: Error) => void;
  const enteredSave = new Promise<void>(resolve => { entered = resolve; });
  store.save = async () => { entered(); await new Promise<void>((_, reject) => { rejectSave = reject; }); };
  const replacement = rc.compose({ ...base, have: { text: { type: "text", value: "other" } } });
  await enteredSave;
  const during = await rc.run("goal:shared", { text: "another" });
  assert.notEqual(during.status, "completed");
  assert.match(during.error ?? "", /publication is pending/);
  await assert.rejects(rc.compose(base), /publication pending/);
  rejectSave(new StateConflictError("snapshot changed"));
  const refused = await replacement;
  assert.equal(refused.published, undefined);
  assert.match(refused.publishRefused ?? "", /state conflict/);
  assert.equal(rc.published.has("shared"), false);
  assert.equal(rc.graph.get("goal:shared"), undefined);
  await assert.rejects(rc.run("goal:shared", { text: "x" }), /unknown capability/);
  assert.equal(store.state?.published?.some(goal => goal.slug === "shared"), true, "the previous stored definition was not overwritten");
});

test("a failed publication cannot leak through another slug or a queued flush", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  await rc.flush();
  const snapshots: string[][] = [];
  let entered!: () => void, rejectSave!: (error: Error) => void;
  const enteredSave = new Promise<void>(resolve => { entered = resolve; });
  let rejected = false;
  store.save = async state => {
    const slugs = (state.published ?? []).map(g => g.slug);
    if (!rejected && slugs.includes("alpha")) {
      rejected = true;
      entered();
      await new Promise<void>((_, reject) => { rejectSave = reject; });
    }
    snapshots.push(slugs);
    store.state = structuredClone(state);
  };
  const base = { have: { text: { type: "text" as const, value: "x" } }, want: "hash" as const,
    through: ["builtin:text.sha256"], run: true };
  const alpha = rc.compose({ ...base, publish: "alpha" });
  await enteredSave;
  const beta = rc.compose({ ...base, publish: "beta" });
  await new Promise<void>(resolve => setImmediate(resolve));
  const otherFlush = rc.flush();
  assert.equal(rc.graph.get("goal:alpha"), undefined);
  rejectSave(new StateConflictError("simulated temporary lock"));
  const [a, b] = await Promise.all([alpha, beta]);
  await otherFlush;
  assert.equal(a.published, undefined);
  assert.match(a.publishRefused ?? "", /state conflict/);
  assert.equal(b.published?.durable, true);
  assert.equal(rc.published.has("alpha"), false);
  assert.equal(rc.published.has("beta"), true);
  assert.equal(snapshots.some(slugs => slugs.includes("alpha")), false, "no unrelated save persisted the rejected candidate");
  assert.equal(store.state?.published?.some(goal => goal.slug === "beta"), true);
});

test("write-then-error reports unknown, withdraws the goal, and blocks later overwrites", async () => {
  const store = new MemoryStore();
  const rc = await RightClick.create({ store, sandbox: null, directories: [] });
  await rc.flush();
  const normalSave = store.save.bind(store);
  store.save = async state => {
    await normalSave(state);
    throw new StateCommitUnknownError("simulated failure after write");
  };
  const base = { have: { text: { type: "text" as const, value: "x" } }, want: "hash" as const,
    through: ["builtin:text.sha256"], run: true };
  const result = await rc.compose({ ...base, publish: "unknown result" });
  assert.equal(result.published, undefined);
  assert.match(result.publishRefused ?? "", /publication outcome unknown; reload/);
  assert.equal(rc.graph.get("goal:unknown-result"), undefined);
  assert.equal(store.state?.published?.some(goal => goal.slug === "unknown-result"), true, "the unknown write actually committed");
  store.save = normalSave;
  await assert.rejects(rc.flush(), /state commit outcome unknown/);
  const retry = await rc.compose({ ...base, publish: "different goal" });
  assert.match(retry.publishRefused ?? "", /publication outcome unknown; reload/);
  assert.equal(store.state?.published?.some(goal => goal.slug === "unknown-result"), true, "retry did not erase the committed candidate");
  assert.equal(store.state?.published?.some(goal => goal.slug === "different-goal"), false);
  const fresh = await RightClick.create({ store, sandbox: null, directories: [] });
  assert.equal((await fresh.run("goal:unknown-result", { text: "new" })).status, "completed");
});
