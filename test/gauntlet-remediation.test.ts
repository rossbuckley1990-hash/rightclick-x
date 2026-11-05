// Regression tests for the failures an independent acceptance evaluation of PR #57 found
// (counterexamples CE1-CE5, preserved outside this repository). They are now known development
// cases, not held-out acceptance:
//
//   CE2/CE3  a run that exited 1 was reported "completed", with an empty or partial output
//            returned as an artefact (artefact mode accepted any learned exit code);
//   CE5      the 512 MiB store bound held per process only, a truncated file at a content address
//            was accepted on put, the read cache was unbounded, and a digest read anything;
//   CE1      "--sort=numeric" beside "-n, --numeric-sort" made -n take a value;
//   CE4      "-crop <x> <y> <w> <h>" was learned with one value, so a correct call was refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { ArtefactStore, sha256Hex } from "../src/core/artefacts.ts";
import { classifyExit } from "../src/core/cli-outcome.ts";
import { fileRole, parseUsage, semanticExits, validateOptions } from "../src/reflectors/cli.ts";
import { redact } from "../src/core/secrets.ts";
import { dispatch } from "../src/interface/tools.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const bytes = (s: string) => ({ type: "bytes" as const, base64: b64(Buffer.from(s, "latin1")) });

function program(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

// ------------------------------------------------------------------ exit status contract (CE2, CE3)

test("exit classification: 0 is success, a nonzero code needs a recorded meaning and is re-checked on every run", () => {
  const declared = { okExit: [0] };
  const legacy = { okExit: [0, 1] }; // what PR #57 persisted for every declared interface
  const diffLike = { okExit: [0, 1], exitSemantics: { "1": { meaning: "inputs differ", evidence: "observed" } } };
  assert.equal(classifyExit(declared, { code: 0, stderr: "", producedOutput: false }).classification, "success", "exit 0 with no output is an empty success");
  assert.equal(classifyExit(declared, { code: 1, stderr: "", producedOutput: true }).classification, "reported-error");
  assert.match(classifyExit(legacy, { code: 1, stderr: "", producedOutput: true }).basis, /no demonstrated meaning/, "a listed code without evidence is not a success");
  assert.equal(classifyExit(diffLike, { code: 1, stderr: "", producedOutput: true }).classification, "semantic-nonzero");
  assert.equal(classifyExit(diffLike, { code: 1, stderr: "warning: x\n", producedOutput: true }).classification, "reported-error", "a diagnostic voids the semantic meaning");
  assert.equal(classifyExit(diffLike, { code: 1, stderr: "", producedOutput: false }).classification, "reported-error", "a semantic code needs output");
  assert.equal(classifyExit(diffLike, { code: 2, stderr: "", producedOutput: true }).classification, "reported-error");
  assert.equal(classifyExit(diffLike, { code: null, stderr: "", producedOutput: true }).classification, "reported-error");
});

test("learning a nonzero exit needs quiet output on every such trial and exit 0 on another input", () => {
  const run = (code: number, stdout: string, stderr = "") => ({ r: { code, stdout, stderr } });
  const ok = run(1, "< a\n> b\n");
  assert.deepEqual(Object.keys(semanticExits([ok], [ok, run(0, "")])), ["1"], "diff-like: differences on exit 1, identical inputs exit 0");
  assert.deepEqual(semanticExits([ok], [ok]), {}, "never observed exiting 0: exit 1 may mean trouble");
  assert.deepEqual(semanticExits([ok], [ok, run(0, ""), run(1, "", "tiffcp: truncated\n")]), {}, "the same code with a diagnostic elsewhere");
  assert.deepEqual(semanticExits([ok], [ok, run(0, ""), run(1, "")]), {}, "the same code with no output elsewhere");
});

// A container joiner documented by file operands only. Generic text samples are rejected by name,
// so it is offered as a declared interface: exactly the shape of tiffcp in the evaluation.
const TCONV = `if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then cat <<'EOF'
usage: tconv [-q] input... output
Join TCNV containers into one output container.
  -q    quiet: print nothing on success
EOF
exit 0; fi
quiet=0; if [ "$1" = "-q" ]; then quiet=1; shift; fi
if [ $# -lt 2 ]; then echo "usage: tconv [-q] input... output" >&2; exit 2; fi
out=""; for a in "$@"; do out="$a"; done
n=$#; i=0
printf 'TCNV' > "$out"
for a in "$@"; do i=$((i+1)); [ $i -eq $n ] && break
  case "$(head -c 4 "$a")" in TCNV) ;; *) echo "tconv: $a: not a TCNV file" >&2; exit 1;; esac
  case "$(tail -c 3 "$a")" in CUT) echo "tconv: $a: truncated container" >&2; exit 1;; esac
  if [ "$(tail -c 4 "$a")" = "HANG" ]; then sleep 30; fi
  tail -c +5 "$a" >> "$out"
done
[ $quiet -eq 1 ] || echo "joined $((n-1)) input(s)"`;

async function declaredTconv() {
  const dir = tmp("rcx-tconv-");
  const bin = program(dir, "tconv", TCONV);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin] } });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.list().find((c) => c.provider === "cli:tconv" && (c.invoke as any).outputsPort);
  assert.ok(cap, rc.graph.list().map((c) => c.id).join(", "));
  return { rc, cap: cap!, dir };
}

test("CE3 regression: a failed multi-input transformation returns no output, only its failure evidence", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  assert.ok(cap.tags.includes("declared-only"), "the program's behaviour was never observed");
  assert.deepEqual((cap.invoke as any).okExit, [0], "a declared interface has no nonzero success code");
  const good = "TCNVpage-one;";
  const r = await rc.run(cap.id, { files: { "a.tcn": bytes(good), "b.tcn": bytes("TCNVpage-twCUT") }, operands: ["a.tcn", "b.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(r.status, "failed");
  assert.match(String(r.error), /exited 1\b.*truncated container/);
  assert.equal(r.output, undefined, "no result, so no artefact is returned");
  const v: any = r.cliValidity;
  assert.equal(v.outcome, "not-established");
  assert.deepEqual({ process: v.exitStatus.process, code: v.exitStatus.code, classification: v.exitStatus.classification }, { process: "completed", code: 1, classification: "reported-error" });
  // The partial file the program left is evidence by digest only: it was never stored.
  const partial = Buffer.from("TCNVpage-one;", "latin1");
  assert.deepEqual(v.failure.unacceptedOutputs, [{ name: "out.tcn", sha256: await sha256Hex(partial), bytes: partial.length }]);
  assert.match(v.failure.stderrPreview, /truncated container/);
  assert.deepEqual(v.artefacts.outputs, [], "provenance attributes no output to a failed run");
  assert.deepEqual(await rc.artefacts.usage(), { bytes: 0, artefacts: 0 }, "nothing was stored: not the partial output, not the inputs");
  // The same call with intact inputs is a result.
  const ok = await rc.run(cap.id, { files: { "a.tcn": bytes(good), "b.tcn": bytes("TCNVpage-two;") }, operands: ["a.tcn", "b.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(ok.status, "completed", String(ok.error));
  assert.equal((ok.cliValidity as any).outcome, "result-established");
  assert.equal((ok.cliValidity as any).exitStatus.classification, "success");
  const out = (ok.output as any).outputs["out.tcn"];
  assert.equal(Buffer.from((await rc.readArtefact(out.ref)).base64, "base64").toString("latin1"), "TCNVpage-one;page-two;");
  rmSync(dir, { recursive: true, force: true });
});

test("CE2 regression: exit 1 with an empty stdout artefact is a failure; exit 0 with empty stdout is a result", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  const bad = await rc.run(cap.id, { files: { "x.bin": bytes("not a container") }, operands: ["x.bin", "o.tcn"], outputs: ["o.tcn"], stdoutAs: "artefact" });
  assert.equal(bad.status, "failed");
  assert.match(String(bad.error), /exited 1\b.*not a TCNV file/);
  assert.equal((bad.cliValidity as any).failure.stdout.bytes, 0, "the empty stdout is evidence, not a result");
  assert.equal(bad.output, undefined);
  // Quiet success: nothing printed, exit 0. An empty result is legitimate.
  const quiet = await rc.run(cap.id, { files: { "a.tcn": bytes("TCNVx") }, options: ["-q"], operands: ["a.tcn", "o.tcn"], outputs: ["o.tcn"], stdoutAs: "artefact" });
  assert.equal(quiet.status, "completed", String(quiet.error));
  assert.equal((quiet.output as any).stdout.bytes, 0);
  assert.equal((await rc.readArtefact((quiet.output as any).stdout.ref)).base64, "");
  rmSync(dir, { recursive: true, force: true });
});

test("state persisted before this change (okExit [0,1], no evidence) cannot turn exit 1 into a result", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  (cap.invoke as any).okExit = [0, 1]; // exactly what 20bc3a7 learned for every declared interface
  const r = await rc.run(cap.id, { files: { "a.tcn": bytes("TCNVok"), "b.tcn": bytes("TCNVxCUT") }, operands: ["a.tcn", "b.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(r.status, "failed");
  assert.match(String(r.error), /no demonstrated meaning/);
  assert.equal(r.output, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("a timed-out run that wrote part of its output returns nothing", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  const r = await rc.run(cap.id, { files: { "a.tcn": bytes("TCNVfirst"), "b.tcn": bytes("TCNVHANG") }, operands: ["a.tcn", "b.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(r.status, "failed");
  assert.match(String(r.error), /timed out/);
  assert.equal((r.cliValidity as any).exitStatus.process, "timed-out");
  assert.equal((r.cliValidity as any).outcome, "not-established");
  assert.deepEqual((r.cliValidity as any).failure.unacceptedOutputs, [], "the sandbox returns no file from an unclean run");
  assert.deepEqual(await rc.artefacts.usage(), { bytes: 0, artefacts: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("transport-complete is not a verified outcome: malformed output on exit 0 stays unverified", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  // The joiner copies payloads blindly: this "container" is garbage, and the program says exit 0.
  const r = await rc.run(cap.id, { files: { "a.tcn": bytes("TCNVÿ\u0000garbage") }, operands: ["a.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(r.status, "completed", String(r.error));
  assert.equal((r.cliValidity as any).exitStatus.classification, "success");
  assert.notEqual(r.verification.status, "verified", "nothing independent checked the output");
  assert.ok(["unverified", "checked"].includes(r.verification.status));
  rmSync(dir, { recursive: true, force: true });
});

test("a diff-like nonzero exit is learned with its evidence, and refused at run time without its observable basis", { skip: skip || (!existsSync("/usr/bin/diff") && "/usr/bin/diff unavailable"), timeout: 120_000 }, async () => {
  const dir = tmp("rcx-cmpx-");
  const bin = program(dir, "cmpx", `if [ "$1" = "--help" ]; then printf 'Usage: cmpx FILE1 FILE2\\nCompare two text files.\\n'; exit 0; fi
if grep -q WARNME "$1"; then echo "cmpx: warning: odd input" >&2; fi
exec /usr/bin/diff "$@"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin] } });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.get("cli:cmpx:default")!;
  const inv: any = cap.invoke;
  assert.deepEqual(inv.okExit, [0, 1]);
  assert.match(inv.exitSemantics["1"].evidence, /exited 1, every one printing output and nothing on standard error.*exited 0/);
  const ports = inv.args.filter((a: any) => typeof a !== "string" && !a.literal).map((a: any) => a.input);
  const differ = await rc.run(cap.id, { [ports[0]]: "alpha\n", [ports[1]]: "beta\n" });
  assert.equal(differ.status, "completed", String(differ.error));
  assert.equal((differ.cliValidity as any).exitStatus.classification, "semantic-nonzero");
  const same = await rc.run(cap.id, { [ports[0]]: "alpha\n", [ports[1]]: "alpha\n" });
  assert.equal(same.status, "completed", String(same.error));
  assert.equal(same.output, "");
  const warned = await rc.run(cap.id, { [ports[0]]: "WARNME\n", [ports[1]]: "beta\n" });
  assert.equal(warned.status, "failed", "exit 1 with a diagnostic is the program reporting trouble");
  assert.match(String(warned.error), /wrote to standard error/);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ artefact store (CE5)

const STORE = new URL("../src/core/artefacts.ts", import.meta.url).href;
function childScript(dir: string): string {
  const p = join(dir, "child.mjs");
  writeFileSync(p, `import { ArtefactStore } from ${JSON.stringify(STORE)};
const [dir, seed, count, size, limit] = process.argv.slice(2);
const st = new ArtefactStore(dir, { maxStoreBytes: Number(limit) });
const out = [];
for (let i = 0; i < Number(count); i++) {
  const b = Buffer.alloc(Number(size), (Number(seed) + i) % 251);
  b.write(String(seed) + ":" + i);
  try { out.push({ ok: true, ref: (await st.put(b, { holder: "run:child" })).ref }); } catch (e) { out.push({ ok: false, error: e.message.slice(0, 120) }); }
}
console.log(JSON.stringify(out));`);
  return p;
}
const contentBytes = (d: string) => readdirSync(d).filter((f) => /^[0-9a-f]{64}$/.test(f)).reduce((s, f) => s + lstatSync(join(d, f)).size, 0);
/** Every byte the store keeps on disk: content, holds and temporary files. */
const storeBytes = (d: string) => readdirSync(d).filter((f) => /^[0-9a-f]{64}(\.holds)?$|^\.tmp-/.test(f)).reduce((s, f) => s + lstatSync(join(d, f)).size, 0);
/** What this process writes into a lock as the scope its pid is valid in (host and pid namespace). */
function pidScope(): string {
  let ns = "";
  try { ns = readlinkSync("/proc/self/ns/pid"); } catch { /* none here */ }
  return `${hostname()}|${ns}`;
}
const deadPid = () => Number(spawnSync(process.execPath, ["-e", "console.log(process.pid)"]).stdout.toString().trim());

test("CE5 regression: the total bound holds across restarts, not per process", () => {
  const work = tmp("rcx-store-"); const d = join(work, "store"); const child = childScript(work);
  const limit = 1_000_000, size = 300_000;
  const a = JSON.parse(spawnSync(process.execPath, [child, d, "1", "4", String(size), String(limit)]).stdout.toString());
  const b = JSON.parse(spawnSync(process.execPath, [child, d, "100", "4", String(size), String(limit)]).stdout.toString());
  assert.deepEqual(a.map((x: any) => x.ok), [true, true, true, false], "the first process fills the store");
  assert.ok(b.every((x: any) => !x.ok && /store is full/.test(x.error)), "a restarted process sees the same usage");
  assert.ok(contentBytes(d) <= limit, `${contentBytes(d)} bytes on disk`);
  rmSync(work, { recursive: true, force: true });
});

test("CE5 regression: concurrent writers in several processes cannot exceed the bound together", async () => {
  const work = tmp("rcx-store-"); const d = join(work, "store"); const child = childScript(work);
  // Room for exactly 8 artefacts and their holds metadata (which counts too), not for a ninth.
  const size = 250_000, limit = 8 * size + 64 * 1024;
  const runs = await Promise.all([0, 1, 2, 3].map((k) => new Promise<any[]>((res) => {
    const p = spawn(process.execPath, [child, d, String(1000 * (k + 1)), "4", String(size), String(limit)]);
    let o = ""; p.stdout.on("data", (x) => (o += x)); p.on("exit", () => res(JSON.parse(o)));
  })));
  const stored = runs.flat().filter((x) => x.ok);
  assert.equal(stored.length, 8, "exactly as many as fit, across all writers");
  assert.ok(storeBytes(d) <= limit, `${storeBytes(d)} bytes of content and metadata on disk`);
  const st = new ArtefactStore(d, { maxStoreBytes: limit });
  for (const x of stored) assert.equal((await st.get(x.ref)).length, size, "every acknowledged write reads back whole");
  assert.deepEqual(readdirSync(d).filter((f) => f.startsWith(".tmp-") || f === ".lock"), [], "no temporary file or lock left behind");
  rmSync(work, { recursive: true, force: true });
});

test("CE5 regression: a truncated file at the content address is replaced, never acknowledged as the content", async () => {
  const d = tmp("rcx-store-");
  const b = Buffer.alloc(1 << 20, 7); b.write("whole");
  const hex = await sha256Hex(b);
  writeFileSync(join(d, hex), b.subarray(0, 1000)); // a crash mid-write under the old, non-atomic store
  const put = await new ArtefactStore(d).put(b, { holder: "run:t" });
  assert.equal(lstatSync(join(d, hex)).size, b.length, "the address now holds the whole content");
  assert.ok((await new ArtefactStore(d).get(put.ref)).equals(b), "and a restarted process reads it exactly");
  // A symbolic link planted at the address is replaced too, and never followed.
  const other = tmp("rcx-target-"); writeFileSync(join(other, "t"), "host file");
  const c = Buffer.from("linked content"); const chex = await sha256Hex(c);
  symlinkSync(join(other, "t"), join(d, chex));
  const lp = await new ArtefactStore(d).put(c, { holder: "run:t" });
  assert.ok(lstatSync(join(d, chex)).isFile());
  assert.ok((await new ArtefactStore(d).get(lp.ref)).equals(c));
  rmSync(d, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
});

test("an interrupted write's temporary file is recovered, and a lock left by a dead process is broken", async () => {
  const d = tmp("rcx-store-");
  const dead = deadPid();
  writeFileSync(join(d, `.tmp-${dead}-abandoned`), Buffer.alloc(600_000));
  writeFileSync(join(d, ".lock"), JSON.stringify({ pid: dead, scope: pidScope(), at: Date.now(), nonce: "crashed" }));
  const st = new ArtefactStore(d, { maxStoreBytes: 1_000_000 });
  const r = await st.put(Buffer.alloc(500_000, 1), { holder: "run:t" });
  assert.ok(r.ref, "the dead writer's lock and temporary file did not block or count");
  assert.deepEqual(readdirSync(d).filter((f) => f.startsWith(".tmp-") || f.startsWith(".lock")), []);
  rmSync(d, { recursive: true, force: true });
});

test("the store lock stays exclusive while locks left by crashed writers are broken", { timeout: 240_000 }, async () => {
  // Contenders enter the store's critical section and claim a marker exclusively inside it; a
  // claim that finds the marker already there means two processes held the lock at once. Locks in
  // the shape a crashed writer leaves are planted whenever the lock is free, so the contenders
  // break stale locks continually. The previous rename-aside breaking failed this in 4 of 6 runs
  // (8 contenders x 150 rounds: 14 overlapping critical sections), by moving a live lock aside.
  const work = tmp("rcx-lock-"); const d = join(work, "store");
  const worker = join(work, "worker.mjs");
  writeFileSync(worker, `import { ArtefactStore } from ${JSON.stringify(STORE)};
import { writeFileSync, unlinkSync } from "node:fs";
const [dir, rounds] = process.argv.slice(2);
const st = new ArtefactStore(dir);
let overlaps = 0;
for (let i = 0; i < Number(rounds); i++) await st["locked"](async () => {
  try { writeFileSync(dir + "/cs-marker", "x", { flag: "wx" }); } catch { overlaps++; return; }
  await new Promise((r) => setTimeout(r, 1));
  unlinkSync(dir + "/cs-marker");
});
console.log(JSON.stringify({ overlaps }));`);
  mkdirSync(d, { mode: 0o700 });
  const dead = deadPid(), scope = pidScope();
  let overlaps = 0, planted = 0;
  for (let round = 0; round < 3; round++) {
    let running = true;
    const plant = () => {
      if (!running) return;
      try { writeFileSync(join(d, ".lock"), JSON.stringify({ pid: dead, scope, at: Date.now(), nonce: "crashed" }), { flag: "wx" }); planted++; } catch { /* held */ }
      setTimeout(plant, Math.random() * 4);
    };
    const kids = Array.from({ length: 8 }, () => new Promise<number>((res) => {
      const p = spawn(process.execPath, [worker, d, "100"]);
      let o = ""; p.stdout.on("data", (x) => (o += x)); p.on("exit", () => res(JSON.parse(o).overlaps));
    }));
    plant();
    overlaps += (await Promise.all(kids)).reduce((a, b) => a + b, 0);
    running = false;
  }
  assert.ok(planted > 20, `stale locks were planted (${planted})`);
  assert.equal(overlaps, 0, "no two processes were ever inside the critical section together");
  rmSync(work, { recursive: true, force: true });
});

test("a lock from another host or pid namespace is never broken by its pid, only once it is long abandoned", async () => {
  const d = tmp("rcx-store-");
  // A pid this process cannot check (another container sharing the volume): a live holder must
  // not be judged dead because its pid does not exist here.
  writeFileSync(join(d, ".lock"), JSON.stringify({ pid: deadPid(), scope: "another-host|pid:[1]", at: Date.now(), nonce: "foreign" }));
  const st = new ArtefactStore(d, { lockWaitMs: 300 });
  await assert.rejects(st.put(Buffer.from("x"), { holder: "run:t" }), /store is busy.*another-host.*remove that file/);
  // So is a lock written before locks recorded where their pid is valid.
  writeFileSync(join(d, ".lock"), JSON.stringify({ pid: deadPid(), at: Date.now() }));
  await assert.rejects(st.put(Buffer.from("x"), { holder: "run:t" }), /store is busy/);
  // Older than any critical section: abandoned.
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(join(d, ".lock"), old, old);
  assert.ok((await st.put(Buffer.from("x"), { holder: "run:t" })).ref);
  assert.deepEqual(readdirSync(d).filter((f) => f.startsWith(".lock")), []);
  rmSync(d, { recursive: true, force: true });
});

test("metadata counts against the bound: many tiny artefacts cannot grow the store past it", async () => {
  const d = tmp("rcx-store-");
  const limit = 4096;
  const st = new ArtefactStore(d, { maxStoreBytes: limit });
  let stored = 0;
  for (let i = 0; i < 200; i++) {
    try { await st.put(Buffer.from([i]), { holder: "run:t" }); stored++; } catch (e) { assert.match(String(e), /store is full/); break; }
  }
  assert.ok(stored > 0 && stored < 200, `${stored} one-byte artefacts fit: content alone would have allowed all 200`);
  assert.ok(storeBytes(d) <= limit, `${storeBytes(d)} bytes on disk, bound ${limit}`);
  rmSync(d, { recursive: true, force: true });
});

test("retention: holds expire, expired content is deleted, and release ends one hold only", async () => {
  let now = 1_000_000;
  const d = tmp("rcx-store-");
  const st = new ArtefactStore(d, { retentionMs: 1000, now: () => now });
  const a = await st.put(Buffer.from("shared"), { holder: "run:a" });
  const b = await st.put(Buffer.from("shared"), { holder: "run:b" });
  assert.notEqual(a.ref, b.ref, "each holder gets its own grant on the same content");
  assert.deepEqual(await st.release(a.ref), { released: true, deleted: false, remainingHolds: 1 });
  await assert.rejects(st.get(a.ref), /unknown artefact/, "a released grant reads nothing");
  assert.equal((await st.get(b.ref)).toString(), "shared", "the other hold is untouched");
  now += 1001;
  await assert.rejects(st.get(b.ref), /expired/);
  assert.deepEqual(await st.sweep(), { deleted: 1, bytesFreed: 6, temporaryFilesRemoved: 0 });
  assert.deepEqual(await st.usage(), { bytes: 0, artefacts: 0 });
  assert.deepEqual(readdirSync(d), [], "content and holds are gone");
  rmSync(d, { recursive: true, force: true });
});

test("authority: a digest, a forged grant or another store's grant reads nothing", async () => {
  const d1 = tmp("rcx-store-"), d2 = tmp("rcx-store-");
  const secret = Buffer.from("predictable private content");
  const hex = await sha256Hex(secret);
  const mine = await new ArtefactStore(d1).put(secret, { holder: "run:owner" });
  const reader = new ArtefactStore(d1);
  await assert.rejects(reader.get(`sha256:${hex}`), /content digest, not a read grant/, "anyone can compute the digest of content they guess");
  await assert.rejects(reader.get(`sha256:${hex}.${"A".repeat(22)}`), /unknown artefact/);
  const theirs = await new ArtefactStore(d2).put(secret, { holder: "run:other" });
  await assert.rejects(new ArtefactStore(d2).get(mine.ref), /unknown artefact/, "a grant is for one store");
  assert.notEqual(mine.ref, theirs.ref);
  assert.ok((await reader.get(mine.ref)).equals(secret));
  // Logs keep the identity, never the grant.
  const logged = JSON.stringify(redact({ files: { "k": { type: "artefact", ref: mine.ref } } }));
  assert.ok(!logged.includes(mine.ref.split(".")[1]), logged);
  assert.match(logged, new RegExp(`sha256:${hex}`));
  rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true });
});

test("the read cache is bounded", async () => {
  const d = tmp("rcx-store-");
  const st = new ArtefactStore(d, { cacheBytes: 300_000 });
  const refs = [];
  for (let i = 0; i < 6; i++) refs.push((await st.put(Buffer.alloc(100_000, i), { holder: "run:t" })).ref);
  const reader = new ArtefactStore(d, { cacheBytes: 300_000 });
  for (const r of refs) await reader.get(r);
  assert.ok((reader as any).cached <= 300_000, `${(reader as any).cached} bytes cached`);
  rmSync(d, { recursive: true, force: true });
});

test("runtime: inline inputs are not retained; records carry digests, results carry grants; MCP releases", { skip, timeout: 120_000 }, async () => {
  const { rc, cap, dir } = await declaredTconv();
  const r = await rc.run(cap.id, { files: { "a.tcn": bytes("TCNVone;"), "b.tcn": bytes("TCNVtwo;") }, operands: ["a.tcn", "b.tcn", "out.tcn"], outputs: ["out.tcn"] });
  assert.equal(r.status, "completed", String(r.error));
  const out = (r.output as any).outputs["out.tcn"];
  assert.deepEqual(await rc.artefacts.usage(), { bytes: out.bytes, artefacts: 1 }, "only the output is held");
  const prov: any = (r.cliValidity as any).artefacts;
  assert.equal(prov.outputs[0].ref, `sha256:${out.sha256}`, "the record names the content, not a grant");
  assert.ok(prov.inputs.every((i: any) => i.ref === undefined), "inline inputs were staged, not stored");
  await assert.rejects(dispatch(rc, "context_run_status", { artefact: prov.outputs[0].ref }), /not a read grant/);
  // A later run consumes the output by its grant, and records it by digest.
  const again = await rc.run(cap.id, { files: { "c.tcn": { type: "artefact", ref: out.ref } }, operands: ["c.tcn", "d.tcn"], outputs: ["d.tcn"] });
  assert.equal(again.status, "completed", String(again.error));
  assert.equal((again.cliValidity as any).artefacts.inputs[0].ref, `sha256:${out.sha256}`);
  // The second run wrote identical bytes, so the content has two holders; releasing one grant
  // leaves the other's.
  const second = (again.output as any).outputs["d.tcn"];
  assert.equal(second.sha256, out.sha256);
  const rel: any = await dispatch(rc, "context_run_status", { artefact: out.ref, release: true });
  assert.deepEqual({ released: rel.released, deleted: rel.deleted, remainingHolds: rel.remainingHolds }, { released: true, deleted: false, remainingHolds: 1 });
  await assert.rejects(rc.readArtefact(out.ref), /unknown artefact/);
  assert.equal((await rc.readArtefact(second.ref)).bytes, out.bytes);
  const last: any = await dispatch(rc, "context_run_status", { artefact: second.ref, release: true });
  assert.equal(last.deleted, true, "no holder left: the content is deleted");
  assert.deepEqual(await rc.artefacts.usage(), { bytes: 0, artefacts: 0 });
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ option grammar (CE1, CE4)

// Excerpts of real help texts (option lines only).
const MAC_SORT = `     -n, --numeric-sort, --sort=numeric
             Sort fields numerically by arithmetic value.  Fields are supposed
             to have optional blanks in the beginning.
     -k field1[,field2], --key=field1[,field2]
             Define a restricted sort key.
     -o output, --output=output
             Print the output to the output file instead of the standard
             output.
     --compress-program=PROGRAM
             Use PROGRAM to compress temporary files.
     -T dir, --temporary-directory=dir
             Store temporary files in the directory dir.`;
const GNU_SORT = `  -n, --numeric-sort          compare according to string numerical value
      --sort=WORD             sort according to WORD:
                                general-numeric -g, human-numeric -h, month -M,
                                numeric -n, random -R, version -V
  -k, --key=KEYDEF          sort via a key; KEYDEF gives location and type`;
const DWEBP = `Usage: dwebp in_file [options] [-o out_file]

Use following options to convert into alternate image formats:
  -pam ......... save the raw RGBA samples as a color PAM
  -ppm ......... save the raw RGB samples as a color PPM
 Other options are:
  -nofancy ..... don't use the fancy YUV420 upscaler
  -crop <x> <y> <w> <h> ... crop output with the given rectangle
  -resize <w> <h> ......... resize output (*after* any cropping)
  -flip ........ flip the output vertically
  -alpha_dither  use alpha-plane dithering if needed
  -o <string> .. output file`;
const TIFFCP = `usage: tiffcp [options] input... output
where options are:
 -a              append to output instead of overwriting
 -o offset       set initial directory offset
 -r #            make each strip have no more than # rows
 -B              write big-endian instead of native byte order
 -c none         use no compression algorithm on output
 -c lzw[:opts]   compress output with Lempel-Ziv & Welch encoding`;
const opt = (text: string, flag: string) => parseUsage(text).options.find((o) => o.flags.includes(flag) || o.fixed?.includes(flag));
const contract = (text: string) => parseUsage(text).options.map((o) => ({ flags: [...o.flags, ...(o.fixed ?? [])], arg: !!o.arg, ...((o.args?.length ?? 1) > 1 ? { arity: o.args!.length } : {}), ...(fileRole(o) ? { file: fileRole(o)! } : {}) }));

test("CE1 regression: an enumerated spelling beside a flag does not give the flag a value", () => {
  const n = opt(MAC_SORT, "-n")!;
  assert.equal(n.arg, undefined, "-n takes nothing");
  assert.deepEqual(n.fixed, ["--sort=numeric"], "--sort=numeric is the same option with its value fixed");
  assert.deepEqual(validateOptions(["-n"], contract(MAC_SORT)), ["-n"]);
  assert.deepEqual(validateOptions(["--sort=numeric"], contract(MAC_SORT)), ["--sort=numeric"]);
  assert.equal(opt(GNU_SORT, "-n")!.arg, undefined);
  assert.equal(opt(GNU_SORT, "-k")!.arg, "KEYDEF", "a placeholder on the long spelling still belongs to the short one");
  assert.deepEqual(validateOptions(["-k", "2,2"], contract(GNU_SORT)), ["-k", "2,2"]);
  assert.equal(opt(GNU_SORT, "--sort")!.arg, "WORD");
});

test("CE4 regression: options with several values, '#' and bracketed values are learned whole", () => {
  assert.deepEqual(opt(DWEBP, "-crop")!.args, ["<x>", "<y>", "<w>", "<h>"]);
  assert.deepEqual(opt(DWEBP, "-resize")!.args, ["<w>", "<h>"]);
  assert.equal(opt(DWEBP, "-flip")!.arg, undefined, "dot leaders are layout, not a value");
  assert.equal(opt(DWEBP, "-flip")!.description, "flip the output vertically");
  const c = contract(DWEBP);
  assert.deepEqual(validateOptions(["-crop", "7", "5", "12", "9", "-flip"], c), ["-crop", "7", "5", "12", "9", "-flip"]);
  assert.deepEqual(validateOptions(["-crop", "-5", "0", "10", "10"], c), ["-crop", "-5", "0", "10", "10"], "negative numbers are values");
  assert.throws(() => validateOptions(["-crop", "7", "5"], c), /needs 4 values/);
  assert.throws(() => validateOptions(["-crop", "/etc/hosts", "0", "1", "1"], c), /host path/, "every value is checked");
  assert.equal(opt(TIFFCP, "-c")!.arg, "none");
  assert.deepEqual(validateOptions(["-c", "lzw:2"], contract(TIFFCP)), ["-c", "lzw:2"]);
  assert.equal(opt(TIFFCP, "-r")!.arg, "#");
  assert.deepEqual(validateOptions(["-r", "16", "-B"], contract(TIFFCP)), ["-r", "16", "-B"]);
  assert.equal(opt(TIFFCP, "-a")!.arg, undefined);
});

test("option grammar: zero, one and attached values; unknown options, host paths and option-like names refused", () => {
  const help = `usage: tool [options] file
  -v              verbose
  -n num          number of items
  --level=LEVEL   compression level
  -k keyfile      read the key from keyfile`;
  const c = contract(help);
  assert.deepEqual(validateOptions(["-v"], c), ["-v"]);
  assert.deepEqual(validateOptions(["-n", "3"], c), ["-n", "3"]);
  assert.deepEqual(validateOptions(["-n3"], c), ["-n", "3"], "attached short value");
  assert.deepEqual(validateOptions(["--level=9"], c), ["--level=9"]);
  assert.deepEqual(validateOptions(["--level", "9"], c), ["--level", "9"]);
  assert.throws(() => validateOptions(["-x"], c), /not one this program documents/);
  assert.throws(() => validateOptions(["-n"], c), /needs a value/);
  const files = { inputs: ["key.bin"], outputs: [] };
  assert.deepEqual(validateOptions(["-k", "key.bin"], c, [], files), ["-k", "key.bin"]);
  assert.throws(() => validateOptions(["-k", "-v"], c, [], files), /looks like an option is refused/, "a value that looks like an option is refused before it is checked as a file name");
  assert.throws(() => validateOptions(["-k", "../key.bin"], c, [], files), /host path/);
  assert.throws(() => validateOptions(["-k", "~/key.bin"], c, [], files), /host path/);
});

test("an option whose value is a program is never offered; a directory is not a file role", () => {
  const prog = opt(MAC_SORT, "--compress-program")!;
  assert.ok(!contract(MAC_SORT).some((o) => o.flags.includes("--compress-program") && o.file === "read"), "never a staged-file read");
  assert.equal(fileRole(prog), undefined);
  assert.equal(fileRole(opt(MAC_SORT, "-T")!), undefined, "a directory is not a file this runtime stages or collects");
  assert.equal(fileRole(opt(MAC_SORT, "-o")!), "write");
});

test("runtime: a multi-value option reaches the program as separate, exact arguments", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-crop-");
  const bin = program(dir, "argshow", `if [ "$1" = "--help" ]; then cat <<'EOF'
usage: argshow [options] file
  -crop <x> <y> <w> <h> ... crop the input
  -n, --numeric, --mode=numeric
                 numeric mode
EOF
exit 0; fi
for a in "$@"; do printf '[%s]' "$a"; done; echo; cat "$(eval echo \\\${$#})"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin] } });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.list().find((c) => c.provider === "cli:argshow" && (c.invoke as any).options);
  assert.ok(cap, rc.graph.list().map((c) => c.id).join(", "));
  const r = await rc.run(cap!.id, { files: { "in.txt": "payload\n" }, options: ["-crop", "7", "-5", "12", "9", "-n"], operands: ["in.txt"] });
  assert.equal(r.status, "completed", String(r.error));
  assert.match(String(r.output), /^\[-crop\]\[7\]\[-5\]\[12\]\[9\]\[-n\]\[in\.txt\]/);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ integration review (PR #59 review findings)

test("an option value that looks like an option is refused, so a misread contract cannot carry an excluded option", () => {
  // CE1's misreading: the contract gave -n a value. Without this check, the excluded
  // --compress-program would reach sort as "-n's value" and sort would run the program it names.
  const misread = [{ flags: ["-n"], arg: true }, { flags: ["-k", "--key"], arg: true }, { flags: ["-e"], arg: true }, { flags: ["-crop"], arg: true, arity: 4 }];
  const excluded = ["--compress-program"];
  assert.throws(() => validateOptions(["-n", "--compress-program=sh"], misread, excluded), /looks like an option is refused/);
  assert.throws(() => validateOptions(["-crop", "1", "2", "--exec=x", "4"], misread, excluded), /looks like an option is refused/);
  assert.throws(() => validateOptions(["-k", "-x"], misread, excluded), /Attach it instead: "-k-x"/);
  assert.throws(() => validateOptions(["--key", "-x"], misread, excluded), /Attach it instead: "--key=-x"/);
  // Numbers and "-" are values; the attached forms are unambiguous and stay accepted.
  assert.deepEqual(validateOptions(["-crop", "7", "-5", "-0.25", "1e3"], misread, excluded), ["-crop", "7", "-5", "-0.25", "1e3"]);
  assert.deepEqual(validateOptions(["-n", "-"], misread, excluded), ["-n", "-"]);
  assert.deepEqual(validateOptions(["--key=-x", "-e-pattern"], misread, excluded), ["--key=-x", "-e", "-pattern"]);
});

test("a contract retained from before exit semantics is investigated again, not reused, so its outcome is re-established", { skip: skip || (!existsSync("/usr/bin/diff") && "/usr/bin/diff unavailable"), timeout: 180_000 }, async () => {
  const dir = tmp("rcx-legacy-");
  const bin = program(dir, "cmpx", `if [ "$1" = "--help" ]; then printf 'Usage: cmpx FILE1 FILE2\\nCompare two text files.\\n'; exit 0; fi
exec /usr/bin/diff "$@"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin] } });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.get("cli:cmpx:default")!;
  const inv: any = cap.invoke;
  assert.ok(inv.exitSemantics?.["1"], "learned now: exit 1 with its evidence");
  // Exactly what main (9abbb51) persisted for this program: exit 1 listed, no evidence for it.
  delete inv.exitSemantics;
  const ports = inv.args.filter((a: any) => typeof a !== "string" && !a.literal).map((a: any) => a.input);
  const differ = await rc.run(cap.id, { [ports[0]]: "alpha\n", [ports[1]]: "beta\n" });
  assert.equal(differ.status, "completed", `repair re-learns the contract instead of reusing it: ${String(differ.error)}`);
  assert.equal((differ.cliValidity as any).exitStatus.classification, "semantic-nonzero");
  assert.ok((rc.graph.get(cap.id)!.invoke as any).exitSemantics?.["1"], "the retained contract now carries the evidence");
  // An explicit re-learn of an unchanged, current contract is still a no-op.
  const again = await rc.learn({ source: `cli:${bin}` });
  assert.match(JSON.stringify(again.results[0]?.probes ?? []), /already learned and unchanged/);
  rmSync(dir, { recursive: true, force: true });
});

test("collected outputs: a FIFO is refused without blocking, and only regular files are read", { skip, timeout: 60_000 }, async () => {
  const sb = (await hostSandbox())!;
  const fifo = await sb.run("/usr/bin/mkfifo", ["out.bin"], { collect: ["out.bin"] });
  assert.equal(fifo.outputs?.["out.bin"], undefined);
  assert.match(String(fifo.outputRefusals?.["out.bin"]), /not a regular file/);
  const ok = await sb.run("/bin/sh", ["-c", "printf 'exact\\000bytes' > out.bin"], { collect: ["out.bin"] });
  assert.equal(Buffer.from(ok.outputs!["out.bin"]).toString("latin1"), "exact\u0000bytes");
});

test("re-storing content whose holds expired, in a full store, stores it again rather than granting a deleted file", async () => {
  let now = 1_000_000;
  const d = tmp("rcx-store-");
  const big = Buffer.alloc(3000, 3);
  await new ArtefactStore(d, { retentionMs: 1000, now: () => now }).put(big, { holder: "run:a" });
  // Too full for one more hold. Its start-up sweep runs now, while run:a's hold is still live.
  const st = new ArtefactStore(d, { maxStoreBytes: storeBytes(d) + 10, retentionMs: 1000, now: () => now });
  await st.usage();
  now += 5000; // run:a's hold has expired; the content stays on disk until the next sweep
  // This put finds the content valid, then must sweep for room, which deletes that very content.
  const again = await st.put(big, { holder: "run:b" });
  assert.ok((await st.get(again.ref)).equals(big), "the grant reads the content");
  rmSync(d, { recursive: true, force: true });
});
