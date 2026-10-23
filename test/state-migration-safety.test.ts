// Persistent state belongs to the operator. A diagnostic must never change it, and a format
// migration must never destroy the only copy of what it replaced.
//
// Reproduced 2026-10-23: `rcx doctor` built a full runtime over the real state file, the runtime
// re-saved a legacy (version-1) file in the version-2 envelope 50 ms after loading it, and no
// copy of the original was kept. The previous main reader then failed on the migrated file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { KvStore } from "../src/entry/edge.ts";
import { decodeState, STATE_FORMAT } from "../src/core/state-format.ts";
import { MemoryStore } from "./helpers.ts";

const RCX = fileURLToPath(new URL("../bin/rcx.ts", import.meta.url));
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const root = process.getuid?.() === 0;

/** A real legacy file: the state a version-1 runtime wrote, with a published goal and a receipt. */
async function legacyState(): Promise<Record<string, any>> {
  const memory = new MemoryStore();
  const seed = await RightClick.create({ store: memory, sandbox: null, directories: [] });
  const r = await seed.compose({ have: { text: { type: "text", value: "first" } }, want: "hash",
    through: ["builtin:text.sha256"], run: true, publish: "Retained hash", verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }] });
  assert.equal(r.executed?.status, "completed");
  await seed.flush();
  // main at f5d593d writes version 1 with inference SEMANTICS 13. A stale inference version is what
  // makes the current runtime re-derive and re-save on load, which is how a diagnostic migrated it.
  const legacy: Record<string, any> = { ...memory.state!, version: 1, semantics: 13 };
  delete legacy.requirements;
  return legacy;
}

function fixture(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "rcx-state-safety-"));
  const file = join(dir, "state.json");
  writeFileSync(file, content);
  return { dir, file };
}

function doctor(file: string) {
  return spawnSync(process.execPath, [RCX, "doctor"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", RCX_STATE_FILE: file },
  });
}

// ------------------------------------------------------------------ diagnostics are read-only

test("rcx doctor leaves a legacy state file byte-for-byte unchanged and says it would be migrated", async () => {
  const { dir, file } = fixture(JSON.stringify(await legacyState()));
  try {
    const before = sha(file);
    const r = doctor(file);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sha(file), before, "doctor rewrote the state file");
    assert.deepEqual(readdirSync(dir), ["state.json"], "doctor created files beside the state");
    assert.match(r.stdout, /legacy format \(version 1\)/);
    assert.match(r.stdout, /keeps the original as state\.json\.v1-backup-/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rcx doctor reports current, future and corrupt state without writing any of them", async () => {
  const current = await (async () => {
    const d = mkdtempSync(join(tmpdir(), "rcx-state-safety-"));
    const rc = await RightClick.create({ store: new FileStore(join(d, "state.json")), sandbox: null, directories: [] });
    await rc.flush();
    const text = readFileSync(join(d, "state.json"), "utf8");
    rmSync(d, { recursive: true, force: true });
    return text;
  })();
  const cases: Array<[string, string, RegExp]> = [
    ["current", current, new RegExp(`${STATE_FORMAT.replace(/[/@]/g, "\\$&")}`)],
    ["future", JSON.stringify({ format: "rightclick-x/runtime-state@3", version: 1, state: {} }), /unreadable: unsupported runtime state format: rightclick-x\/runtime-state@3.*never overwrites it/],
    ["corrupt", "{ not json", /unreadable: .*never overwrites it/],
  ];
  for (const [name, content, expected] of cases) {
    const { dir, file } = fixture(content);
    try {
      const before = sha(file);
      const r = doctor(file);
      assert.equal(sha(file), before, `doctor rewrote ${name} state`);
      assert.deepEqual(readdirSync(dir), ["state.json"], `doctor created files beside ${name} state`);
      assert.match(r.stdout, expected, `${name}: ${r.stdout}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("rcx doctor does not create a missing state directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-state-safety-"));
  try {
    const r = doctor(join(dir, "not-yet", "state.json"));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(dir, "not-yet")), false, "doctor created the state directory");
    assert.match(r.stdout, /created on first use/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------ migrations keep the original

test("migrating a legacy file keeps a byte-exact backup and loses no capability, goal or receipt", async () => {
  const legacy = await legacyState();
  const original = JSON.stringify(legacy, null, 1); // any byte layout must survive, not just ours
  const { dir, file } = fixture(original);
  try {
    const backups: string[] = [];
    const rc = await RightClick.create({ store: new FileStore(file, { onBackup: (p) => backups.push(p) }), sandbox: null, directories: [] });
    await rc.flush();
    const kept = readdirSync(dir).filter((f) => f.startsWith("state.json.v1-backup-"));
    assert.equal(kept.length, 1, `expected one backup, found ${readdirSync(dir).join(", ")}`);
    assert.deepEqual(backups, [join(dir, kept[0])]);
    assert.equal(readFileSync(join(dir, kept[0]), "utf8"), original, "the backup is not the original bytes");
    const migrated = decodeState(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(migrated.version, 2);
    const ids = (s: any) => s.reflections.flatMap((r: any) => r.capabilities.map((c: any) => c.id)).sort();
    assert.deepEqual(ids(migrated), ids(legacy));
    assert.deepEqual(migrated.published?.map((g) => g.slug), legacy.published.map((g: any) => g.slug));
    assert.equal(migrated.receipts.length, legacy.receipts.length);
    // Already current: later saves make no further backups.
    await rc.flush();
    const again = await RightClick.create({ store: new FileStore(file), sandbox: null, directories: [] });
    await again.flush();
    assert.equal(readdirSync(dir).filter((f) => f.startsWith("state.json.v1-backup-")).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a migration that cannot keep its backup fails and leaves the original untouched", { skip: root && "root ignores directory permissions" }, async () => {
  const { dir, file } = fixture(JSON.stringify(await legacyState()));
  try {
    const before = sha(file);
    const store = new FileStore(file);
    const rc = await RightClick.create({ store, sandbox: null, directories: [] });
    chmodSync(dir, 0o555);
    try {
      await assert.rejects(rc.flush());
    } finally { chmodSync(dir, 0o755); }
    assert.equal(sha(file), before, "a failed migration changed the original");
    assert.deepEqual(readdirSync(dir), ["state.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unsupported future format is refused by the runtime and never overwritten", async () => {
  const { dir, file } = fixture(JSON.stringify({ format: "rightclick-x/runtime-state@3", version: 1, reflections: { requires: "rightclick-x/runtime-state@3" }, state: { version: 3 } }));
  try {
    const before = sha(file);
    await assert.rejects(RightClick.create({ store: new FileStore(file), sandbox: null, directories: [] }), /unsupported runtime state format/);
    assert.equal(sha(file), before);
    assert.deepEqual(readdirSync(dir), ["state.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the KV adapter keeps the legacy value under a backup key before migrating it", async () => {
  const original = JSON.stringify(await legacyState());
  const values = new Map<string, string>([["rcx-state", original]]);
  const kv = { get: async (k: string) => values.get(k) ?? null, put: async (k: string, v: string) => { values.set(k, v); } };
  const rc = await RightClick.create({ store: new KvStore(kv), sandbox: null, directories: [] });
  await rc.flush();
  const backups = [...values.keys()].filter((k) => k.startsWith("rcx-state.v1-backup-"));
  assert.equal(backups.length, 1);
  assert.equal(values.get(backups[0]), original);
  assert.equal(JSON.parse(values.get("rcx-state")!).format, STATE_FORMAT);
});

test("an ordinary command that migrates legacy state says so and names the backup", async () => {
  const original = JSON.stringify(await legacyState());
  const { dir, file } = fixture(original);
  try {
    const r = spawnSync(process.execPath, [RCX, "capabilities", "--json"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", RCX_STATE_FILE: file },
    });
    assert.equal(r.status, 0, r.stderr);
    const kept = readdirSync(dir).filter((f) => f.startsWith("state.json.v1-backup-"));
    assert.equal(kept.length, 1);
    assert.equal(readFileSync(join(dir, kept[0]), "utf8"), original);
    assert.match(r.stderr, new RegExp(`the original is kept at .*${kept[0]}`));
    assert.equal(JSON.parse(readFileSync(file, "utf8")).format, STATE_FORMAT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// -------------------------------------------- inference migration never drops what it cannot redo

const sandboxed = (await (await import("../src/core/sandbox.ts")).hostSandbox()) ? false : "no host sandbox on this platform";
const PROGRAM = "/usr/bin/sort";

/** State written by this runtime with one investigated program, then marked as an older build's. */
async function staleCliState(dir: string) {
  const file = join(dir, "state.json");
  const rc = await RightClick.create({ directories: [], store: new FileStore(file), authority: { investigate: [PROGRAM] } });
  await rc.learn({ source: `cli:${PROGRAM}` });
  await rc.flush();
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  const ids = envelope.state.reflections.flatMap((r: any) => r.capabilities.map((c: any) => c.id)).sort();
  assert.ok(ids.length > 0, "fixture program produced no capabilities");
  envelope.state.semantics = 26; // as an earlier adaptive build wrote it
  writeFileSync(file, JSON.stringify(envelope));
  return { file, ids };
}

test("an inference migration without program authority keeps the program's capabilities deferred, not lost", { skip: sandboxed }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-state-safety-"));
  try {
    const { file, ids } = await staleCliState(dir);
    const original = readFileSync(file, "utf8");
    // A process with no program authority, e.g. an MCP client started without RCX_INVESTIGATE.
    const rc = await RightClick.create({ directories: [], store: new FileStore(file) });
    for (const id of ids) assert.equal(rc.graph.get(id), undefined, "a stale program capability stayed executable");
    await rc.flush();
    const saved = decodeState(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(saved.reflections.filter((r) => r.provider.source === "cli").length, 0);
    assert.deepEqual(saved.deferredInference?.flatMap((d) => d.reflection.capabilities.map((c) => c.id)).sort(), ids, "the program's capabilities were dropped");
    assert.deepEqual(saved.deferredInference?.map((d) => d.semantics), [26]);
    const kept = readdirSync(dir).filter((f) => f.startsWith("state.json.semantics-26-backup-"));
    assert.equal(kept.length, 1, `files: ${readdirSync(dir).join(", ")}`);
    assert.equal(readFileSync(join(dir, kept[0]), "utf8"), original);
    // doctor reports the deferral without changing anything.
    const before = sha(file);
    assert.match(doctor(file).stdout, /1 deferred reflections awaiting re-derivation/);
    assert.equal(sha(file), before);
    // A later process that may investigate the program re-derives it and clears the deferral.
    const later = await RightClick.create({ directories: [], store: new FileStore(file), authority: { investigate: [PROGRAM] } });
    for (const id of ids) assert.ok(later.graph.get(id), `${id} was not re-derived`);
    await later.flush();
    const done = decodeState(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(done.deferredInference, undefined);
    assert.ok(!done.requirements?.includes("deferred-inference@1"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state with deferred reflections declares its requirement, so a reader without it refuses", { skip: sandboxed }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcx-state-safety-"));
  try {
    const { file } = await staleCliState(dir);
    const rc = await RightClick.create({ directories: [], store: new FileStore(file) });
    await rc.flush();
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(envelope.state.requirements.includes("deferred-inference@1"));
    // Stripping the requirement is what an unaware writer would produce; it must not decode.
    envelope.state.requirements = envelope.state.requirements.filter((r: string) => r !== "deferred-inference@1");
    assert.throws(() => decodeState(envelope), /missing the deferred inference requirement/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
