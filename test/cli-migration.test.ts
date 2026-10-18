// Synthetic old-inference snapshots exercise continuity; the real version-22
// json_xs snapshot is tested separately by the frozen development replay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick, SEMANTICS } from "../src/runtime.ts";
import { hostSandbox, type Sandbox } from "../src/core/sandbox.ts";
import { MemoryStore } from "./helpers.ts";

const native = await hostSandbox();
const skip = native ? false : "no host sandbox";
const input = '{"new":[17,"later"]}\n';
const id = "cli:structured:default";

async function fixture() {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-cli-migration-`));
  const program = `${dir}/structured`;
  writeFileSync(program, `#!/bin/sh
if [ "$1" = "--help" ]; then printf 'usage: structured [FILE]\\n'; exit 0; fi
[ "$#" = 0 ] || exit 65
input=$(cat)
case "$input" in '{'*) printf '%s\\n' "$input";; *) exit 65;; esac
`, { mode: 0o755 });
  const calls: Array<{ purpose?: string }> = [];
  const sandbox: Sandbox = { ...native!, async run(bin, args, opts = {}) {
    calls.push({ purpose: opts.purpose });
    return native!.run(bin, args, opts);
  } };
  const store = new MemoryStore();
  const create = (investigate = true, execute = true, available = true) => RightClick.create({
    directories: [], store, sandbox: available ? sandbox : null,
    network: { origins: [], blockPrivate: true },
    authority: { investigate: investigate ? [program] : [], execute: execute ? [program] : [], shareEvidence: true },
    fetch: async () => { throw new Error("unexpected network"); },
  });
  const rc = await create();
  await rc.learn({ source: `cli:${program}` });
  const goal = await rc.compose({ have: { json: { type: "json", value: input } }, want: "json", through: [id], origins: [], run: true, publish: "retained identity" });
  assert.equal(goal.executed?.status, "completed");
  await rc.flush();
  const caps = store.state!.reflections.flatMap(r => r.capabilities).filter(c => c.invoke.kind === "cli");
  const original = caps.find(c => c.id === id)!;
  assert.equal(original.invoke.kind, "cli");
  const inv = original.invoke as import("../src/core/types.ts").CliInvoke;
  const first = inv.examples![0];
  const legacy = createHash("sha256").update(JSON.stringify([[first.stdin, first.outputPreview], [first.stdin, first.outputPreview]])).digest("hex").slice(0, 16);
  const current = inv.behaviour!.slice(0, 16);
  assert.notEqual(legacy, current);
  for (const c of caps) if (c.invoke.kind === "cli" && c.invoke.behaviour) {
    c.invoke.behaviour = c.invoke.behaviour.replace(current, legacy);
    c.invoke.examples = [c.invoke.examples![0], c.invoke.examples![0]];
  }
  for (const anchor of store.state!.published![0].anchors!) anchor.operation = anchor.operation!.replace(current, legacy);
  store.state!.semantics = 22;
  return { program, calls, store, create, caps, legacy, anchors: structuredClone(store.state!.published![0].anchors) };
}

test("old operation identity survives new probe coverage, restart and compatible repair without repinning", { skip }, async () => {
  const f = await fixture();
  const migrated = await f.create();
  assert.equal((await migrated.run(id, { json: input })).status, "completed");
  const run = await migrated.run("goal:retained-identity", { json: input });
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(run.output, JSON.parse(input));
  assert.notEqual(run.verification.status, "verified");
  await migrated.flush();
  assert.deepEqual(f.store.state!.published![0].anchors, f.anchors);
  const count = f.calls.length;
  const fresh = await f.create();
  assert.equal(f.calls.length, count, "same-version restart must not investigate");
  assert.equal((await fresh.run("goal:retained-identity", { json: input })).status, "completed");
  assert.equal(f.calls.slice(count).filter(c => c.purpose !== "execution").length, 0);
  writeFileSync(f.program, readFileSync(f.program, "utf8") + "\n# compatible wrapper revision\n");
  const repaired = await fresh.run("goal:retained-identity", { json: input });
  assert.equal(repaired.status, "completed", repaired.error);
  assert.deepEqual(repaired.output, JSON.parse(input));
  await fresh.flush();
  assert.deepEqual(f.store.state!.published![0].anchors, f.anchors);
  writeFileSync(f.program, readFileSync(f.program, "utf8").replace('printf \'%s\\n\' "$input"', 'printf \'{"changed":true}\\n\''));
  const before = f.calls.length;
  const refused = await fresh.run("goal:retained-identity", { json: input });
  assert.equal(refused.status, "failed");
  assert.equal(f.calls.slice(before).filter(c => c.purpose === "execution").length, 0);
});

test("migration refuses mismatched evidence, changed invocation and unresolved prior meaning", { skip }, async () => {
  for (const change of ["output", "arguments", "input-type", "options", "no-examples", "meaning"] as const) {
    const f = await fixture();
    for (const cap of f.caps) if (cap.invoke.kind === "cli") {
      if (change === "output") cap.invoke.examples![0].outputSha256 = "0".repeat(64);
      if (change === "arguments") cap.invoke.args.push("--different-operation");
      if (change === "input-type") cap.inputs[0].type = "different:input";
      if (change === "options") cap.invoke.options = { port: "options", allowed: [{ flags: ["--different-operation"], arg: false }] };
      if (change === "no-examples") cap.invoke.examples = [];
    }
    if (change === "meaning") f.store.state!.meaningChanges = [{ id, source: `cli:${f.program}`, at: new Date().toISOString(), before: "unresolved older operation", after: "changed" }];
    const fresh = await f.create();
    const before = f.calls.length;
    const result = await fresh.run(id, { json: input });
    assert.equal(result.status, "failed", change);
    assert.match(result.error!, /changed meaning/);
    assert.equal(f.calls.length, before);
  }
});

test("migration continuity does not supply investigation, execution authority or a sandbox", { skip }, async () => {
  for (const setting of [[false, true, true], [true, false, true], [true, true, false]]) {
    const f = await fixture();
    const before = f.calls.length;
    const fresh = await f.create(...setting as [boolean, boolean, boolean]);
    if (fresh.graph.get(id)) assert.equal((await fresh.run(id, { json: input })).status, "failed");
    else await assert.rejects(() => fresh.run(id, { json: input }), /unknown capability/);
    assert.equal(f.calls.slice(before).filter(c => c.purpose === "execution").length, 0);
    if (!setting[0] || !setting[2]) assert.equal(f.calls.length, before);
  }
});

test("portable knowledge declares inference version and cannot import stale contracts or local lineage", { skip }, async () => {
  const f = await fixture();
  const current = await f.create();
  const bundle = current.exportKnowledge();
  assert.equal((bundle.source as any).semantics, SEMANTICS);
  assert.ok(bundle.programs.every(p => p.capabilities.every(c => !(c.invoke as any).continuity)));
  for (const version of [undefined, 22, SEMANTICS + 1]) {
    const old = structuredClone(bundle);
    (old.source as any).semantics = version;
    const receiver = await RightClick.create({ directories: [], sandbox: native, authority: { investigate: [f.program] } });
    const result = await receiver.importKnowledge(old);
    assert.ok(result.programs.every(p => p.status === "refused" && p.revalidationRuns === 0));
    assert.match(result.programs[0].reason!, /inference version/);
    assert.equal(receiver.graph.get(id), undefined);
  }
  const receiver = await RightClick.create({ directories: [], sandbox: native, authority: { investigate: [f.program] } });
  (bundle.programs[0].capabilities[0].invoke as any).continuity = [{ behaviour: "forged-old-identity", examples: [] }];
  const result = await receiver.importKnowledge(bundle);
  assert.ok(result.programs[0].capabilities.some(c => c.id === id && c.status === "accepted"));
  assert.equal((receiver.graph.get(id)!.invoke as any).continuity, undefined);
  assert.deepEqual((await receiver.run(id, { json: input })).output, JSON.parse(input));
});
