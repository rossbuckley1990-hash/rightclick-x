import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { goalDefinitionDigest } from "../src/core/goal-identity.ts";

const worker = fileURLToPath(new URL("./fixtures/goal-lease-process.ts", import.meta.url));
function event(child: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`worker exited early: ${code}`)));
  });
}
function spawn(file: string, mode: string) { return fork(worker, [file, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] }); }

test("separate processes serialize goal invocation against replacement and refuse cached versions after revocation", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-goal-lease-"));
  const file = join(dir, "state.json"), children: ChildProcess[] = [];
  try {
    const seed = await RightClick.create({ store: new FileStore(file), directories: [] });
    const created = await seed.compose({ have: { text: { type: "text", value: "old", fixed: true } }, want: "hash",
      through: ["builtin:text.sha256"], run: true, publish: "shared" });
    assert.equal(created.published?.durable, true);
    await seed.flush();
    const reader = spawn(file, "hold"), rival = spawn(file, "publish"); children.push(reader, rival);
    await Promise.all([event(reader), event(rival)]);
    const leased = event(reader); reader.send!("run"); assert.equal((await leased).event, "leased");
    const attempted = event(rival); rival.send!("run"); const denied = await attempted;
    assert.equal(denied.durable, false);
    assert.match(denied.refusal ?? "", /state conflict/);
    const revokeWhileActive = new FileStore(file); const pendingRevocation = await revokeWhileActive.load(); assert.ok(pendingRevocation);
    pendingRevocation.published = (pendingRevocation.published ?? []).filter(g => g.slug !== "shared");
    await assert.rejects(revokeWhileActive.save(pendingRevocation), /state conflict/);
    const finished = event(reader); reader.send!("release"); assert.equal((await finished).status, "completed");
    // A separately preloaded process must not run the old definition once a
    // fresh process has durably replaced the name.
    const stale = spawn(file, "invoke"), replacer = spawn(file, "publish"); children.push(stale, replacer);
    await Promise.all([event(stale), event(replacer)]);
    const replaced = event(replacer); replacer.send!("run"); assert.equal((await replaced).durable, true);
    const attemptedOld = event(stale); stale.send!("run");
    const old = await attemptedOld; assert.notEqual(old.status, "completed"); assert.match(old.error ?? "", /stale|revoked|conflict/);
    // Simulate an authoritative cooperative revocation with a new FileStore.
    const revokedReader = spawn(file, "invoke"); children.push(revokedReader); await event(revokedReader);
    const control = new FileStore(file); const state = await control.load(); assert.ok(state);
    state.published = (state.published ?? []).filter(g => g.slug !== "shared"); await control.save(state);
    const afterRevoke = event(revokedReader); revokedReader.send!("run");
    const revoked = await afterRevoke; assert.notEqual(revoked.status, "completed"); assert.match(revoked.error ?? "", /stale|revoked|conflict/);
  } finally { for (const child of children) if (child.connected) child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test("failed lease cleanup after an effect reports unknown and forbids replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-goal-cleanup-")), file = join(dir, "state.json");
  try {
    const store = new FileStore(file);
    const rc = await RightClick.create({ store, directories: [] });
    await rc.compose({ have: { text: { type: "text", value: "old", fixed: true } }, want: "hash",
      through: ["builtin:text.sha256"], run: true, publish: "shared" });
    await rc.flush();
    const goal = rc.published.get("shared")!;
    let effects = 0;
    await assert.rejects(store.withGoalLease([{ slug: "shared", digest: await goalDefinitionDigest(goal) }], async () => {
      effects++;
      await writeFile(`${file}.lock/obstruction`, "fixture");
    }), /outcome unknown.*do not replay/);
    assert.equal(effects, 1);
    await assert.rejects(store.withGoalLease([{ slug: "shared", digest: await goalDefinitionDigest(goal) }], async () => { effects++; }), /state conflict/);
    assert.equal(effects, 1, "a retained lock prevented replay");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a process killed while holding a goal lease leaves a fail-closed lock", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-goal-crash-")), file = join(dir, "state.json");
  let reader: ChildProcess | undefined;
  try {
    const seed = await RightClick.create({ store: new FileStore(file), directories: [] });
    await seed.compose({ have: { text: { type: "text", value: "old", fixed: true } }, want: "hash",
      through: ["builtin:text.sha256"], run: true, publish: "shared" });
    await seed.flush();
    reader = spawn(file, "hold"); await event(reader);
    const leased = event(reader); reader.send!("run"); assert.equal((await leased).event, "leased");
    const exited = new Promise<void>(resolve => reader!.once("exit", () => resolve()));
    reader.kill("SIGKILL"); await exited;
    const next = await RightClick.create({ store: new FileStore(file), directories: [] });
    const result = await next.run("goal:shared", {});
    assert.notEqual(result.status, "completed");
    assert.match(result.error ?? "", /state conflict/);
  } finally { if (reader?.connected) reader.kill(); await rm(dir, { recursive: true, force: true }); }
});

test("a stale nested goal is refused before any earlier composition step runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-goal-prefix-")), file = join(dir, "state.json");
  try {
    const writer = await RightClick.create({ store: new FileStore(file), directories: [] });
    const options = (value: string) => ({ have: { text: { type: "text" as const, value, fixed: true } }, want: "hash" as const,
      through: ["builtin:text.sha256"], run: true, publish: "shared" });
    await writer.compose(options("old")); await writer.flush();
    const stale = await RightClick.create({ store: new FileStore(file), directories: [] });
    await writer.compose(options("new")); await writer.flush();
    const before = (stale as any).runs.size;
    await assert.rejects((stale as any).runSteps([
      { capability: "builtin:text.sha256", bindings: [{ port: "text", from: "$in.text" }] },
      { capability: "goal:shared", bindings: [] },
    ], "1.", { text: "prefix" }), /stale|revoked|conflict/);
    assert.equal((stale as any).runs.size, before, "the prefix capability must not run");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a prestarted session-only replacement cannot commit while the old goal executes", async () => {
  const rc = await RightClick.create({ directories: [] });
  const options = (value: string) => ({ have: { text: { type: "text" as const, value, fixed: true } }, want: "hash" as const,
    through: ["builtin:text.sha256"], run: true, publish: "shared" });
  await rc.compose(options("old"));
  let publicationReady!: () => void, proceedPublication!: () => void, goalReady!: () => void, proceedGoal!: () => void;
  const ready = new Promise<void>(resolve => { publicationReady = resolve; });
  const waitPublication = new Promise<void>(resolve => { proceedPublication = resolve; });
  const started = new Promise<void>(resolve => { goalReady = resolve; });
  const waitGoal = new Promise<void>(resolve => { proceedGoal = resolve; });
  const finish = (rc as any).finishComposition.bind(rc);
  const execute = (rc as any).executeLeasedGoal.bind(rc);
  (rc as any).finishComposition = async (...args: unknown[]) => { publicationReady(); await waitPublication; return finish(...args); };
  (rc as any).executeLeasedGoal = async (...args: unknown[]) => { goalReady(); await waitGoal; return execute(...args); };
  const replacement = rc.compose(options("new"));
  await ready;
  const invocation = rc.run("goal:shared", {});
  await started;
  proceedPublication();
  const refused = await replacement;
  assert.equal(refused.published, undefined);
  assert.match(refused.publishRefused ?? "", /changed since execution began/);
  proceedGoal();
  assert.equal((await invocation).status, "completed");
});

test("provider learning and saved-goal execution exclude one another", async () => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const fetcher: typeof fetch = async () => { entered(); await wait; return Response.json({ openapi: "3.0.0", info: { title: "fixture", version: "1" }, paths: {} }); };
  const rc = await RightClick.create({ directories: [], fetch: fetcher });
  await rc.compose({ have: { text: { type: "text", value: "old", fixed: true } }, want: "hash",
    through: ["builtin:text.sha256"], run: true, publish: "shared" });
  const learning = rc.learn({ source: "https://fixture.test/openapi.json" });
  await ready;
  const denied = await rc.run("goal:shared", {});
  assert.notEqual(denied.status, "completed");
  assert.match(denied.error ?? "", /provider changes are in progress/);
  release(); await learning;
  let goalReady!: () => void, finishGoal!: () => void;
  const goalStarted = new Promise<void>(resolve => { goalReady = resolve; });
  const goalRelease = new Promise<void>(resolve => { finishGoal = resolve; });
  const execute = (rc as any).executeLeasedGoal.bind(rc);
  (rc as any).executeLeasedGoal = async (...args: unknown[]) => { goalReady(); await goalRelease; return execute(...args); };
  const invocation = rc.run("goal:shared", {}); await goalStarted;
  await assert.rejects(rc.learn({ source: "https://fixture.test/openapi.json" }), /blocked while a saved goal is executing/);
  assert.throws(() => rc.forget("openapi:fixture"), /blocked while a saved goal is executing/);
  finishGoal(); assert.equal((await invocation).status, "completed");
});
