import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../experiments/secure-memory/protected-concurrent-worker.ts", import.meta.url));
const firstValue = "synthetic-concurrent-principal-a-31294e";
const secondValue = "synthetic-concurrent-principal-b-580d72";

function actor(dir: string, principal: string, own: string, wrong?: string) {
  const state = join(dir, `${principal}.json`);
  const child = fork(worker, [state], { stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir(), RCX_FIXTURE_PRINCIPAL: principal, RCX_FIXTURE_VALUE: own,
      ...(wrong ? { RCX_FIXTURE_WRONG_VALUE: wrong } : {}) } });
  const messages: any[] = [], waiters: Array<{ resolve: (v: any) => void; reject: (e: Error) => void }> = [];
  let finished = false;
  child.on("message", message => { const waiter = waiters.shift(); if (waiter) waiter.resolve(message); else messages.push(message); });
  child.on("error", () => { finished = true; for (const w of waiters.splice(0)) w.reject(new Error("fixture process error")); });
  child.on("exit", () => { finished = true; for (const w of waiters.splice(0)) w.reject(new Error("fixture process exited before a required event")); });
  const next = () => messages.length ? Promise.resolve(messages.shift()) : finished ? Promise.reject(new Error("fixture process exited")) :
    new Promise<any>((resolve, reject) => waiters.push({ resolve, reject }));
  const send = (message: string) => { if (!child.connected) throw new Error("fixture IPC closed"); child.send(message); };
  return { child, state, next, send };
}
type Actor = ReturnType<typeof actor>;
function stop(children: ChildProcess[]) { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(); }
async function event(a: Actor, phase: string) { const value = await a.next(); assert.equal(value.phase, phase); return value; }

async function overlap(unsafe: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "rcx-protected-overlap-"));
  const a = actor(dir, "actor-a", firstValue), b = actor(dir, "actor-b", secondValue, unsafe ? firstValue : undefined);
  try {
    const [aResolver, bResolver] = await Promise.all([event(a, "resolver"), event(b, "resolver")]);
    assert.equal(aResolver.principal, "actor-a"); assert.equal(bResolver.principal, "actor-b");
    // Both resolvers have entered and are held before either credential dispatches.
    a.send("dispatch"); b.send("dispatch");
    const [aProvider, bProvider] = await Promise.all([event(a, "provider"), event(b, "provider")]);
    assert.equal(aProvider.ownHeader, true);
    assert.equal(bProvider.ownHeader, !unsafe, unsafe ? "the negative control did not detect cross-principal binding" : "B did not receive its own value");
    // Each fake provider is now paused with an in-flight call. A new grant is
    // denied after revocation, but the already dispatched call is not cancelled.
    a.send("revoke-now"); b.send("revoke-now");
    await Promise.all([event(a, "revoked-in-flight"), event(b, "revoked-in-flight")]);
    a.send("release"); b.send("release");
    const [aFirst, bFirst] = await Promise.all([event(a, "first"), event(b, "first")]);
    assert.equal(aFirst.status, "completed"); assert.equal(aFirst.output, true);
    assert.equal(bFirst.status, "completed"); assert.equal(bFirst.output, !unsafe);
    a.send("rerun"); b.send("rerun");
    const [aRevoked, bRevoked] = await Promise.all([event(a, "revoked"), event(b, "revoked")]);
    for (const result of [aRevoked, bRevoked]) {
      assert.equal(result.status, "failed");
      assert.equal(result.resolutions, 2, "the second call must recheck the resolver grant");
      assert.equal(result.providerCalls, 1, "a revoked grant must not reach the provider again");
    }
    for (const file of [a.state, b.state]) {
      const text = readFileSync(file, "utf8");
      assert.ok(!text.includes(firstValue) && !text.includes(secondValue), "synthetic credential appeared in persistent state");
    }
  } finally { stop([a.child, b.child]); rmSync(dir, { recursive: true, force: true }); }
}

test("overlapping protected calls use each principal's own credential and recheck revocation", { timeout: 30000 }, async () => overlap(false));
test("negative control detects a resolver that substitutes another principal's credential", { timeout: 30000 }, async () => overlap(true));
