import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { RightClick, type OperatorAuthority, type RunRecord } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { CONFINED_POLICY, hostSandbox, makeSandbox, type Sandbox, type SandboxRun } from "../src/core/sandbox.ts";
import type { Capability, CliInvoke } from "../src/core/types.ts";
import type { OutcomeWitness } from "../src/core/verify.ts";
import type { CliEnvironment } from "../src/core/cli-environment.ts";

const native = await hostSandbox();
const local = { skip: native ? false : "native host sandbox unavailable", timeout: 120_000 };
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const executable = (file: string, body: string) => { writeFileSync(file, body); chmodSync(file, 0o755); };

function cli(cap: Capability | undefined): CliInvoke {
  assert.ok(cap, "the capability must have been learned");
  assert.equal(cap.invoke.kind, "cli");
  return cap.invoke as CliInvoke;
}

// Only fixtures understand gzip, SQLite, or the test protocol. Every invocation is
// a real native sandbox run; the observer neither substitutes output nor weakens policy.
async function fixture(t: TestContext, name: string, writable = false) {
  assert.ok(native);
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-cli-validity-`));
  const deps = `${dir}/path`;
  const data = `${dir}/data`;
  const effects = `${dir}/effects`;
  for (const path of [deps, data, effects]) mkdirSync(path);
  const bin = `${dir}/${name}`;
  const calls: Array<{ bin: string; args: string[]; purpose: string; result?: SandboxRun }> = [];
  const actual = makeSandbox(native.kind, {
    ...CONFINED_POLICY,
    readRoots: [dir], readDenyRoots: [], writeRoots: writable ? [effects] : [],
    pathDirs: [deps, "/usr/bin", "/bin"], network: false,
    limits: { ...CONFINED_POLICY.limits, timeoutMs: 10_000 },
  }, existsSync("/usr/bin/bwrap") ? "/usr/bin/bwrap" : "/bin/bwrap");
  const sandbox: Sandbox = { ...actual, async run(program, args, options) {
    const call: (typeof calls)[number] = { bin: program, args: [...args], purpose: options?.purpose ?? "unknown" };
    calls.push(call);
    return call.result = await actual.run(program, args, options);
  } };
  // A restart transfers ownership of this shared file to the newly created
  // runtime. An older snapshot must not flush after the successor has written.
  let current: RightClick | undefined;
  let discoveries = 0;
  const storePath = `${dir}/state.json`;
  const create = async (authority: OperatorAuthority = {}, sb: Sandbox | null = sandbox,
    network: { origins?: string[]; blockPrivate: boolean } = { origins: [], blockPrivate: true }) => {
    if (current) await current.flush();
    const rc = await RightClick.create({
      directories: [], store: new FileStore(storePath), sandbox: sb,
      authority: { investigate: [bin], execute: [bin], ...authority },
      network,
      fetch: async () => { assert.fail("local validity must not fall back to network discovery"); },
      onInvestigationStart: () => { discoveries++; },
    });
    current = rc;
    return rc;
  };
  t.after(async () => {
    try { if (current) await current.flush(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  const learn = async (rc: RightClick, program = bin) => {
    const result = await rc.learn({ source: `cli:${program}` });
    assert.equal(result.results[0]?.error, undefined, JSON.stringify(result.results));
    assert.ok(result.results[0]?.learned.length, JSON.stringify(result.results));
  };
  return { dir, deps, data, effects, bin, calls, sandbox, create, learn, discoveries: () => discoveries };
}

function dispatcher(name: string, body: string, json = false): string {
  const top = `Usage: ${name} [OPTIONS] COMMAND [ARGS]...\n\nOptions:\n${json ? "  --json  JSON output (default).\n" : ""}  --help  Show help.\n\nCommands:\n  report  Read and report records.\n`;
  const sub = `Usage: ${name} report [OPTIONS] [FILE]\n\n  Read records from standard input or FILE.\n\nOptions:\n  --help  Show help.\n`;
  return `#!/bin/sh
if [ "$1" = "--help" ]; then printf '%s' ${quote(top)}; exit 0; fi
if [ "$1" = "--version" ]; then printf 'fixture 1\\n'; exit 0; fi
if [ "$1" = "report" ] && [ "$2" = "--help" ]; then printf '%s' ${quote(sub)}; exit 0; fi
if [ "$1" != "report" ]; then exit 2; fi
shift
${body}
`;
}

function validity(run: RunRecord, environment: "unchanged" | "changed" | "unrecorded", application: "not-assessed" | "reported-error" | "not-established") {
  const evidence = run.cliValidity;
  assert.ok(evidence, "the run must distinguish bounded environment evidence from an outcome proof");
  assert.equal(evidence.coverage, "partial");
  assert.equal(evidence.environment, environment);
  assert.equal(evidence.application, application);
  assert.equal(typeof evidence.observed, "string");
  assert.ok(evidence.observed.length);
  assert.ok(evidence.limitation.trim(), "partial coverage needs an explicit limitation");
  assert.deepEqual(run.receipt.cliValidity, evidence, "receipt and run must report the same evidence");
  if (environment === "unchanged") assert.equal(evidence.expected, evidence.observed);
  if (environment === "changed") assert.notEqual(evidence.expected, evidence.observed);
  return evidence;
}

function refusedEnvironment(run: RunRecord) {
  assert.equal(run.status, "failed", run.error);
  assert.equal(run.receipt.status, "failed");
  assert.equal(run.output, undefined, "unaccepted output must not escape as a result");
  assert.notEqual(run.verification.status, "verified");
  assert.equal(run.healing?.retried, undefined, "environment drift cannot authorise healing or replay");
  assert.match(run.error ?? "", /environment|dependenc/i);
  return validity(run, "changed", "not-assessed");
}

const workflows = [
  { name: "log-dispatch", dependency: "gzip", real: "/usr/bin/gzip", expected: "errors=2 bytes=12\n" },
  { name: "inventory-dispatch", dependency: "sqlite3", real: "/usr/bin/sqlite3", expected: "bolts|12\nnuts|7\n" },
] as const;

for (const workflow of workflows) {
  for (const replacement of ["compatible", "incompatible", "removed"] as const) {
    test(`${workflow.dependency}: ${replacement} PATH dependency refuses unchanged dispatcher before and after FileStore restart`, {
      ...local, skip: local.skip || (!existsSync(workflow.real) && `${workflow.real} unavailable`),
    }, async t => {
      const f = await fixture(t, workflow.name);
      const dependency = `${f.deps}/${workflow.dependency}`;
      // Symlinks keep signed system binaries at their native macOS location.
      symlinkSync(workflow.real, dependency);
      if (workflow.dependency === "gzip") {
        const archive = `${f.data}/events.gz`;
        writeFileSync(archive, gzipSync("09:01 INFO 3\n09:02 ERROR 5\n09:03 ERROR 7\n"));
        executable(f.bin, dispatcher(workflow.name, `gzip -dc ${quote(archive)} > events.log || exit $?
/usr/bin/awk '$2 == "ERROR" { n++; bytes += $3 } END { printf "errors=%d bytes=%d\\n", n, bytes }' events.log`));
      } else {
        const database = `${f.data}/inventory.sqlite`;
        execFileSync(workflow.real, [database, "CREATE TABLE inventory(item TEXT, quantity INTEGER); INSERT INTO inventory VALUES ('nuts',7),('bolts',12);"]);
        executable(f.bin, dispatcher(workflow.name, `exec sqlite3 -readonly ${quote(database)} 'SELECT item, quantity FROM inventory ORDER BY item;'`));
      }
      const id = `cli:${workflow.name}:report`;
      // Even an explicit retry grant cannot turn an environment mismatch into permission to replay.
      const authority = { retry: [id] };
      const rc = await f.create(authority);
      await f.learn(rc);
      const original = structuredClone(cli(rc.graph.get(id)));
      const metadata = structuredClone(rc.graph.providers.get(rc.graph.get(id)!.provider)!.meta!.cliEnvironment) as CliEnvironment;
      assert.deepEqual(original.okExit, [0], "documented subcommands have no observed nonzero success convention");
      assert.equal(original.examples, undefined);
      assert.equal(original.environment?.version, 1);
      assert.equal(original.environment?.coverage, "partial");
      assert.ok(original.environment?.digest);
      assert.ok(metadata, "full bounded local environment evidence belongs to the provider");
      assert.equal(metadata.version, 1);
      assert.equal(metadata.coverage, "partial");
      assert.equal(metadata.digest, original.environment.digest);
      assert.ok(metadata.limitations.length);
      assert.deepEqual(metadata.entries.find(e => e.path === dependency), {
        path: dependency, real: realpathSync(dependency), sha256: digest(dependency), state: "observed",
      });
      assert.ok(metadata.entries.some(e => e.path === "/bin/sh" && e.state === "observed"), "the literal shebang interpreter is recorded");
      assert.ok(!metadata.entries.some(e => e.path === f.bin), "primary bytes are a separate pin");
      const entrySha = digest(f.bin);
      f.calls.length = 0;
      for (let i = 0; i < 2; i++) {
        const unchanged = await rc.run(id);
        assert.equal(unchanged.status, "completed", unchanged.error);
        assert.equal(unchanged.output, workflow.expected);
        assert.equal(unchanged.verification.status, "unverified");
        assert.equal(validity(unchanged, "unchanged", "not-established").processExit, 0);
      }
      assert.deepEqual(f.calls.map(c => c.purpose), ["execution", "execution"], "no compatibility experiments on an unchanged dependency");
      const discoveries = f.discoveries();
      await f.learn(rc);
      assert.equal(f.discoveries(), discoveries, "unchanged explicit learn can reuse its evidence");
      assert.equal(f.calls.length, 2);
      await rc.flush();

      rmSync(dependency);
      if (replacement === "compatible") {
        executable(dependency, `#!/bin/sh\n# same real tool, different executable entry\nexec ${quote(workflow.real)} "$@"\n`);
      } else if (replacement === "incompatible") {
        // Keep executing the real dependency, but substitute a plausible, wrong result.
        executable(dependency, workflow.dependency === "gzip"
          ? `#!/bin/sh\n/usr/bin/gzip "$@" > original.log || exit $?\nprintf '09:04 ERROR 99\\n'\n`
          : `#!/bin/sh\n/usr/bin/sqlite3 "$@" > original.rows || exit $?\nprintf 'bolts|99\\nnuts|7\\n'\n`);
      }
      assert.equal(digest(f.bin), entrySha, "the dispatcher itself never changed");
      f.calls.length = 0;
      const rejected = await rc.run(id);
      assert.equal(refusedEnvironment(rejected).processExit, undefined);
      assert.equal(f.calls.length, 0, "refuse before any subprocess, even for a compatible replacement");
      assert.deepEqual(cli(rc.graph.get(id)), original, "refused evidence is not adopted or withdrawn");
      await rc.flush();
      const restarted = await f.create(authority);
      assert.deepEqual(cli(restarted.graph.get(id)), original);
      assert.deepEqual(restarted.graph.providers.get(restarted.graph.get(id)!.provider)!.meta!.cliEnvironment, metadata);
      const persisted = restarted.chain.receipts.find(r => r.runId === rejected.runId);
      assert.deepEqual(persisted?.cliValidity, rejected.cliValidity);
      assert.equal((await restarted.verifyReceipts()).intact, true);
      refusedEnvironment(await restarted.run(id));
      assert.equal(f.calls.length, 0, "restart must not convert a refusal into a fresh discovery or replay");
      assert.deepEqual(cli(restarted.graph.get(id)), original);

      if (replacement !== "removed") {
        const beforeLearn = f.discoveries();
        await f.learn(restarted);
        assert.equal(f.discoveries(), beforeLearn + 1, "same-byte source refresh requires fresh discovery");
        assert.ok(f.calls.length && f.calls.every(c => c.purpose === "investigation"));
        const refreshed = cli(restarted.graph.get(id));
        assert.equal(refreshed.sha256, original.sha256);
        assert.notEqual(refreshed.environment?.digest, original.environment?.digest);
        f.calls.length = 0;
        const checked = await restarted.run(id, {}, { verify: [{ op: "equals", value: workflow.expected }] });
        assert.equal(checked.status, replacement === "compatible" ? "completed" : "failed", checked.error);
        assert.equal(checked.verification.status, replacement === "compatible" ? "checked" : "refuted", "relearning an environment does not discharge the result obligation");
        validity(checked, "unchanged", "not-established");
        assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
      }
    });
  }
}

function waitForFile(file: string): Promise<void> {
  if (existsSync(file)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = watch(file.slice(0, file.lastIndexOf("/")), () => {
      if (existsSync(file)) { clearTimeout(timer); watcher.close(); resolve(); }
    });
    const timer = setTimeout(() => { watcher.close(); reject(new Error(`sandbox did not signal ${file}`)); }, 5000);
    if (existsSync(file)) { clearTimeout(timer); watcher.close(); resolve(); }
  });
}

test("dependency replacement while the subprocess is alive discards its real output without replay", local, async t => {
  const f = await fixture(t, "gated-report", true);
  const dep = `${f.deps}/payload`;
  executable(dep, "#!/bin/sh\nprintf 'ORIGINAL\\n'\n");
  executable(f.bin, dispatcher("gated-report", `printf 'ready' > ${quote(`${f.effects}/ready`)}
while [ ! -f ${quote(`${f.effects}/release`)} ]; do /bin/sleep 0.01; done
exec payload`));
  const rc = await f.create({ retry: ["cli:gated-report:report"] });
  await f.learn(rc);
  const original = structuredClone(cli(rc.graph.get("cli:gated-report:report")));
  f.calls.length = 0;
  const ready = waitForFile(`${f.effects}/ready`);
  const running = rc.run("cli:gated-report:report");
  let readinessFailure: unknown;
  try {
    await ready;
    executable(dep, "#!/bin/sh\nprintf 'UNTRUSTED RESULT\\n'\n");
  } catch (error) {
    readinessFailure = error;
  } finally {
    writeFileSync(`${f.effects}/release`, "release");
  }
  const result = await running;
  if (readinessFailure) throw readinessFailure;
  assert.equal(result.status, "failed");
  assert.equal(result.output, undefined);
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
  assert.equal(f.calls[0].result?.stdout, "UNTRUSTED RESULT\n", "a real subprocess produced the withheld output");
  assert.deepEqual(cli(rc.graph.get(result.capability)), original);
  refusedEnvironment(await rc.run(result.capability));
  assert.equal(f.calls.length, 1, "neither the racing output nor a repeat call authorises adoption");
  assert.equal(refusedEnvironment(result).processExit, 0);
});

test("a changed literal shebang interpreter outside PATH is still a bounded dependency", local, async t => {
  const f = await fixture(t, "interpreter-report");
  const interpreter = `${f.data}/shell`;
  symlinkSync("/bin/sh", interpreter);
  executable(f.bin, dispatcher("interpreter-report", "printf 'report\\n'").replace("#!/bin/sh", `#!${interpreter}`));
  const rc = await f.create();
  await f.learn(rc);
  const id = "cli:interpreter-report:report";
  assert.equal((await rc.run(id)).status, "completed");
  f.calls.length = 0;
  rmSync(interpreter);
  refusedEnvironment(await rc.run(id));
  assert.equal(f.calls.length, 0);
});

test("configuration outside PATH can change a plausible result while coverage stays partial and unverified", local, async t => {
  const f = await fixture(t, "configured-report");
  const config = `${f.data}/totals.json`;
  writeFileSync(config, '{"total":12}\n');
  executable(f.bin, dispatcher("configured-report", `exec /bin/cat ${quote(config)}`, true));
  const rc = await f.create();
  await f.learn(rc);
  const id = "cli:configured-report:report";
  const initial = structuredClone(cli(rc.graph.get(id)));
  const first = await rc.run(id);
  assert.deepEqual(first.output, { total: 12 });
  assert.equal(first.verification.status, "unverified");
  validity(first, "unchanged", "not-established");
  writeFileSync(config, '{"total":99}\n');
  f.calls.length = 0;
  const changed = await rc.run(id);
  assert.equal(changed.status, "completed", changed.error);
  assert.deepEqual(changed.output, { total: 99 });
  assert.equal(changed.verification.status, "unverified", "bounded environment equality does not assess business correctness");
  validity(changed, "unchanged", "not-established");
  assert.deepEqual(cli(rc.graph.get(id)), initial);
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
});

test("exit-zero error envelopes fail once, while nested business fields and empty errors remain unverified", local, async t => {
  const errors: unknown[] = [
    { error: "backend unavailable" }, { error: { code: "quota" }, message: "try later" },
    { isError: true, content: [] }, { ok: false, result: "plausible" }, { success: false },
  ];
  const controls: unknown[] = [
    { error: null }, { error: "" }, { error: {} },
    { result: { error: "business field", ok: false, success: false } },
    { error: "business annotation", records: [1, 2] }, { ok: true, success: true },
  ];
  const values = [...errors, ...controls];
  const f = await fixture(t, "envelope-report");
  const cases = values.map((value, i) => `${i}) printf '%s\\n' ${quote(JSON.stringify(value))};;`).join("\n");
  executable(f.bin, dispatcher("envelope-report", `case "$(/bin/cat)" in\n${cases}\n*) exit 2;;\nesac`, true));
  const id = "cli:envelope-report:report";
  const rc = await f.create({ retry: [id] });
  await f.learn(rc);
  assert.deepEqual(cli(rc.graph.get(id)).okExit, [0]);
  f.calls.length = 0;
  for (let i = 0; i < values.length; i++) {
    const before = f.calls.length;
    const result = await rc.run(id, { input: String(i) });
    const isError = i < errors.length;
    assert.equal(result.status, isError ? "failed" : "completed", JSON.stringify(values[i]));
    assert.equal(result.receipt.status, result.status);
    assert.equal(validity(result, "unchanged", isError ? "reported-error" : "not-established").processExit, 0);
    assert.equal(result.healing?.retried, undefined);
    assert.equal(f.calls.length, before + 1, "even an explicit retry grant is not permission to replay a reported application error");
    assert.equal(f.calls.at(-1)?.purpose, "execution");
    assert.equal(f.calls.at(-1)?.result?.code, 0, "this is an application failure, not a process failure");
    if (!isError) {
      assert.deepEqual(result.output, values[i]);
      assert.equal(result.verification.status, "unverified", "absence of a conventional envelope is not semantic success");
    }
  }
});

test("text-output error envelopes survive unsafe numbers and duplicate keys without treating ordinary text as failure", local, async t => {
  // Literal protocol bytes are intentional: JSON.stringify would already round
  // unsafe integers, erase duplicate keys, and turn an infinite number into null.
  const errors = [
    '{"ok":false,"requestId":9007199254740993}',
    '{"ok":false,"requestId":1,"requestId":2}',
    '{"ok":false,"requestId":1e999999}',
  ];
  const controls = [
    'ordinary report: requestId=9007199254740993',
    'log record: {"ok":false,"requestId":9007199254740993}',
    'error: a word in a log record; exponent=1e999999',
    '{"result":{"ok":false},"requestId":9007199254740993}',
    '{"ok":true,"requestId":9007199254740993}',
  ];
  const values = [...errors, ...controls];
  const f = await fixture(t, "literal-envelope-report");
  const cases = values.map((value, i) => `${i}) printf '%s\\n' ${quote(value)};;`).join("\n");
  executable(f.bin, dispatcher("literal-envelope-report", `case "$(/bin/cat)" in\n${cases}\n*) exit 2;;\nesac`));
  const id = "cli:literal-envelope-report:report";
  const rc = await f.create({ retry: [id] });
  await f.learn(rc);
  assert.equal(cli(rc.graph.get(id)).output, "text", "this exercises error detection, not strict JSON output conversion");
  f.calls.length = 0;
  for (const [i, value] of values.entries()) {
    const before = f.calls.length;
    const result = await rc.run(id, { input: String(i) });
    const isError = i < errors.length;
    assert.equal(result.status, isError ? "failed" : "completed", value);
    assert.equal(result.receipt.status, result.status);
    assert.equal(validity(result, "unchanged", isError ? "reported-error" : "not-established").processExit, 0);
    assert.equal(result.healing?.retried, undefined);
    assert.equal(f.calls.length, before + 1, "an error envelope cannot authorise retry or rediscovery");
    assert.equal(f.calls.at(-1)?.purpose, "execution");
    assert.equal(f.calls.at(-1)?.result?.code, 0);
    assert.equal(f.calls.at(-1)?.result?.stdout, `${value}\n`, "the native subprocess emitted the original protocol bytes");
    if (isError) {
      assert.equal(result.output, undefined, "reported errors cannot escape as completed output");
      assert.equal(result.verification.status, "refuted");
    } else {
      assert.equal(result.output, `${value}\n`);
      assert.equal(result.verification.status, "unverified");
    }
  }
});

test("plain text mentioning errors is not an application-error oracle, and documented exit one is refused", local, async t => {
  const f = await fixture(t, "text-report");
  executable(f.bin, dispatcher("text-report", `mode="$(/bin/cat)"
printf 'error: a word in a log record\\n'
if [ "$mode" = "nonzero" ]; then exit 1; fi`));
  const id = "cli:text-report:report";
  const rc = await f.create();
  await f.learn(rc);
  f.calls.length = 0;
  const text = await rc.run(id);
  assert.equal(text.status, "completed", text.error);
  assert.equal(text.verification.status, "unverified");
  validity(text, "unchanged", "not-established");
  const badExit = await rc.run(id, { input: "nonzero" });
  assert.equal(badExit.status, "failed");
  assert.match(badExit.error ?? "", /exit.*1/);
  assert.equal(badExit.cliValidity?.processExit, 1);
  assert.deepEqual(badExit.receipt.cliValidity, badExit.cliValidity);
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution", "execution"]);
});

test("real diff retains its observed nonzero result convention rather than imposing subcommand exits globally", {
  ...local, skip: local.skip || (!existsSync("/usr/bin/diff") && "/usr/bin/diff unavailable"),
}, async t => {
  const f = await fixture(t, "observed-difference");
  executable(f.bin, `#!/bin/sh
if [ "$1" = "--help" ]; then printf 'Usage: observed-difference FILE1 FILE2\\nCompare two text files.\\n'; exit 0; fi
exec /usr/bin/diff "$@"
`);
  const rc = await f.create();
  await f.learn(rc);
  const cap = rc.graph.get("cli:observed-difference:default")!;
  const invoke = cli(cap);
  assert.ok(invoke.okExit.includes(1), "exit one must have been observed on real differing inputs");
  const operands = invoke.args.filter((a): a is { input: string; literal?: boolean } => typeof a !== "string" && !a.literal);
  assert.equal(operands.length, 2);
  f.calls.length = 0;
  const result = await rc.run(cap.id, { [operands[0].input]: "alpha\n", [operands[1].input]: "beta\n" });
  assert.equal(result.status, "completed", result.error);
  assert.match(String(result.output), /alpha/);
  assert.match(String(result.output), /beta/);
  assert.equal(validity(result, "unchanged", "not-established").processExit, 1);
  assert.equal(result.verification.status, "unverified");
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
});

test("unrecorded legacy CLI environments are labelled rather than upgraded into a proof", local, async t => {
  const f = await fixture(t, "legacy-report");
  executable(f.bin, dispatcher("legacy-report", "printf 'legacy\\n'"));
  const rc = await f.create();
  await f.learn(rc);
  const cap = rc.graph.get("cli:legacy-report:report")!;
  delete cli(cap).environment;
  delete rc.graph.providers.get(cap.provider)!.meta!.cliEnvironment;
  await rc.flush();
  const restarted = await f.create();
  f.calls.length = 0;
  const result = await restarted.run(cap.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.verification.status, "unverified");
  const evidence = validity(result, "unrecorded", "not-established");
  assert.equal(evidence.expected, undefined);
  assert.equal(cli(restarted.graph.get(cap.id)).environment, undefined, "running is not explicit rediscovery");
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
});

for (const revoked of ["execute", "investigate", "sandbox", "execution-policy"] as const) {
  test(`revoked ${revoked} cannot authorise changed-program observations or dispatch`, local, async t => {
    const f = await fixture(t, "revocable-report");
    const body = dispatcher("revocable-report", "printf 'records\\n'");
    executable(f.bin, body);
    const id = "cli:revocable-report:report";
    const rc = await f.create({ retry: [id] });
    await f.learn(rc);
    assert.equal((await rc.run(id)).status, "completed");
    await rc.flush();
    executable(f.bin, body.replace("#!/bin/sh", "#!/bin/sh\n# compatible rebuild"));
    const authority: OperatorAuthority = {
      retry: [id],
      ...(revoked === "execute" ? { execute: [] } : {}),
      ...(revoked === "investigate" ? { investigate: [] } : {}),
      ...(revoked === "execution-policy" ? { execution: { deniedCapabilities: [id] } } : {}),
    };
    const restarted = await f.create(authority, revoked === "sandbox" ? null : f.sandbox);
    f.calls.length = 0;
    const before = f.discoveries();
    const result = await restarted.run(id);
    assert.equal(result.status, "failed");
    assert.match(`${result.error} ${result.healing?.note}`, revoked === "sandbox" ? /no sandbox/ : revoked === "execution-policy" ? /execution policy/ : /not authorised/);
    assert.equal(f.calls.length, 0, "authority is checked before help, examples, receipt replay, or execution");
    assert.equal(f.discoveries(), before);
    if (revoked === "investigate" || revoked === "sandbox") {
      const learned = await restarted.learn({ source: `cli:${f.bin}` });
      assert.ok(learned.results[0]?.error);
      assert.equal(f.calls.length, 0);
    }
    if (revoked === "execute") {
      await f.learn(restarted); // Discovery authority is distinct from execution authority.
      assert.ok(f.calls.length && f.calls.every(c => c.purpose === "investigation"));
      f.calls.length = 0;
      assert.equal((await restarted.run(id)).status, "failed");
      assert.equal(f.calls.length, 0);
    }
  });
}

for (const authorised of [false, true]) {
  test(`documented read with a receipt ${authorised ? "uses an explicit retry grant" : "cannot replay unknown side effects"}`, local, async t => {
    const f = await fixture(t, "receipt-report", true);
    const countFile = `${f.effects}/calls`;
    // This deliberately contradicts the help-derived read label. Only the test
    // fixture writes here, and the actual sandbox declares this write root.
    const body = dispatcher("receipt-report", `printf 'called\\n' >> ${quote(countFile)}\nprintf 'same result\\n'`);
    executable(f.bin, body);
    const id = "cli:receipt-report:report";
    const authority = authorised ? { retry: [id] } : {};
    const rc = await f.create(authority);
    await f.learn(rc);
    const old = structuredClone(cli(rc.graph.get(id)));
    assert.equal(rc.graph.get(id)!.risk, "read", "a help label is not a side-effect guarantee");
    assert.equal(old.examples, undefined);
    assert.equal(existsSync(countFile), false, "documented discovery must not execute the subcommand");
    assert.equal((await rc.run(id)).status, "completed");
    assert.equal(readFileSync(countFile, "utf8"), "called\n");
    await rc.flush();
    executable(f.bin, body.replace("#!/bin/sh", "#!/bin/sh\n# reinstall with identical observable output"));
    const restarted = await f.create(authority);
    f.calls.length = 0;
    const result = await restarted.run(id);
    if (!authorised) {
      assert.equal(result.status, "failed");
      assert.equal(result.healing?.retried, undefined);
      assert.equal(f.calls.length, 0, "a receipt and a read label permit neither caller-input replay nor help observations");
      assert.equal(readFileSync(countFile, "utf8"), "called\n");
      assert.deepEqual(cli(restarted.graph.get(id)), old);
      assert.equal((await restarted.run(id)).status, "failed");
      assert.equal(f.calls.length, 0);
    } else {
      assert.equal(result.status, "completed", result.error);
      assert.equal(result.output, "same result\n");
      assert.equal(result.verification.status, "unverified");
      assert.equal(result.healing?.retried, id);
      assert.equal(readFileSync(countFile, "utf8"), "called\ncalled\ncalled\n", "exactly one authorised compatibility call and one retry");
      assert.equal(f.calls.filter(c => c.args[0] === "report" && c.args[1] !== "--help").length, 2);
      assert.ok(f.calls.some(c => c.purpose === "investigation"));
      assert.notEqual(cli(restarted.graph.get(id)).sha256, old.sha256);
    }
  });
}

for (const authorised of [false, true]) {
  test(`outer composition ${authorised ? "uses an explicit saved-goal retry grant" : "cannot repeat a read-labelled saved goal's hidden CLI write"}`, local, async t => {
    const f = await fixture(t, "goal-receipt", true);
    const countFile = `${f.effects}/calls`;
    executable(f.bin, dispatcher("goal-receipt", `printf 'called\\n' >> ${quote(countFile)}\nexec /bin/cat`));
    const sourceId = "cli:goal-receipt:report";
    const goalId = "goal:retained-report";
    const tail = `${f.dir}/outer-spacing`;
    const tailId = "cli:outer-spacing:default";
    const tailBody = `#!/bin/sh
if [ "$1" = "--help" ]; then printf 'Usage: outer-spacing FILE\\nSqueeze repeated spaces in a text file.\\n'; exit 0; fi
/usr/bin/tr -s ' ' < "$1"
`;
    executable(tail, tailBody);
    // Only the final report step is retry-authorised in the negative case.
    // Its failure must not accidentally supply authority for the saved goal.
    const rc = await f.create({
      investigate: [f.bin, tail],
      execute: [f.bin, tail],
      retry: [tailId, ...(authorised ? [goalId] : [])],
    }, f.sandbox, { blockPrivate: true });
    // Saved goals have dynamic planner egress, so an origins: [] filter would
    // exclude them before this regression. Actual subprocesses still cannot
    // access the network, and the fixture rejects every network fetch.
    assert.equal(f.sandbox.policy.network, false);
    await f.learn(rc);
    await f.learn(rc, tail);
    assert.equal(existsSync(countFile), false, "help-derived discovery cannot perform the hidden write");
    const published = await rc.compose({
      have: { input: { type: "report.request", value: "seed" } }, want: "text", through: [sourceId],
      run: true, publish: "Retained report", crystallize: false, acquire: false, maxSteps: 1,
    });
    assert.equal(published.executed?.status, "completed", JSON.stringify(published));
    assert.equal(published.published?.id, goalId);
    assert.equal(rc.graph.get(goalId)?.invoke.kind, "goal");
    assert.equal(rc.graph.get(goalId)?.risk, "read", "a saved goal's label does not describe its hidden effect");
    assert.equal(readFileSync(countFile, "utf8"), "called\n");
    // A nominal request enters the goal; only its text result fits the file
    // transform. This forces the hidden effect to precede the failing step.
    const options = {
      have: { input: { type: "report.request", value: "caller" } }, want: "text", through: [goalId, tailId],
      crystallize: false, acquire: false, maxSteps: 2,
    };
    const planned = await rc.compose(options);
    const plan = planned.plans[0];
    assert.ok(plan, JSON.stringify(planned));
    assert.deepEqual(plan.steps.map(step => step.capability), [goalId, tailId],
      "the outer pipeline must execute the saved goal before a distinct failing step");
    const originalTail = structuredClone(cli(rc.graph.get(tailId)));
    // The outer plan encounters changed primary bytes only after the goal has
    // completed. Rediscovering this compatible rebuild could repeat that goal.
    executable(tail, tailBody.replace("#!/bin/sh", "#!/bin/sh\n# compatible final-step rebuild"));
    f.calls.length = 0;
    const result = await rc.compose({ ...options, run: true });
    assert.equal(result.executed?.status, authorised ? "completed" : "failed", JSON.stringify(result));
    assert.equal(result.executed?.attempts.length, 1, "exactly one failed outer plan");
    assert.equal(result.executed?.attempts[0].failed, tailId);
    assert.match(result.executed?.attempts[0].error ?? "", /program changed|changed since/i);
    const writes = f.calls.filter(call => call.bin === f.bin && call.args[0] === "report" && call.args[1] !== "--help");
    assert.equal(writes.length, authorised ? 2 : 1, "only an explicit goal grant permits replay of its hidden CLI write");
    assert.equal(readFileSync(countFile, "utf8"), "called\n".repeat(authorised ? 3 : 2));
    assert.equal(f.calls.filter(call => call.purpose === "execution").length, authorised ? 3 : 1);
    if (authorised) {
      assert.equal(result.executed?.output, "caller");
      assert.ok(f.calls.some(call => call.bin === tail && call.purpose === "investigation"));
      assert.notEqual(cli(rc.graph.get(tailId)).sha256, originalTail.sha256);
    } else {
      assert.match(result.executed?.attempts[0].healing ?? "", /not retried:.*goal:retained-report.*authority\.retry/);
      assert.equal(result.executed?.output, null);
      assert.equal(f.calls.length, 1, "refuse before rediscovery or an alternative pipeline can repeat effects");
      assert.deepEqual(cli(rc.graph.get(tailId)), originalTail);
      assert.equal(result.crystallized, undefined);
      assert.equal(result.published, undefined);
    }
  });
}

test("confinement alone does not make a documented-only receipt safe to replay", local, async t => {
  const f = await fixture(t, "confined-receipt");
  const body = dispatcher("confined-receipt", "printf 'records\\n'");
  executable(f.bin, body);
  const rc = await f.create();
  await f.learn(rc);
  const id = "cli:confined-receipt:report";
  const original = structuredClone(cli(rc.graph.get(id)));
  assert.equal(original.examples, undefined);
  assert.equal(rc.graph.get(id)!.risk, "read");
  assert.equal(f.sandbox.policy.network, false);
  assert.deepEqual(f.sandbox.policy.writeRoots, []);
  assert.equal((await rc.run(id)).status, "completed");
  executable(f.bin, body.replace("#!/bin/sh", "#!/bin/sh\n# same interface and output"));
  f.calls.length = 0;
  const refused = await rc.run(id);
  assert.equal(refused.status, "failed");
  assert.equal(refused.healing?.retried, undefined);
  assert.equal(f.calls.length, 0, "caller receipts are not the generic synthetic-example exception");
  assert.deepEqual(cli(rc.graph.get(id)), original);
});

test("generic synthetic examples may be replayed under an actually confined sandbox without a retry grant", local, async t => {
  const f = await fixture(t, "sample-copy");
  const body = "#!/bin/sh\nexec /bin/cat \"$@\"\n";
  executable(f.bin, body);
  assert.equal(f.sandbox.policy.network, false);
  assert.deepEqual(f.sandbox.policy.writeRoots, []);
  const rc = await f.create();
  await f.learn(rc);
  const cap = rc.graph.get("cli:sample-copy:default")!;
  const invoke = cli(cap);
  assert.ok(invoke.examples?.length);
  assert.equal(rc.chain.receipts.length, 0, "this control must use synthetic examples, not a caller's receipt");
  executable(f.bin, body.replace("#!/bin/sh", "#!/bin/sh\n# same generic behaviour"));
  f.calls.length = 0;
  const result = await rc.run(cap.id, { [cap.inputs[0].name]: "fresh content\n" });
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.output, "fresh content\n");
  assert.equal(result.verification.status, "unverified");
  assert.equal(result.healing?.retried, cap.id);
  assert.ok(f.calls.some(c => c.purpose === "revalidation"));
  assert.ok(f.calls.some(c => c.purpose === "investigation"));
  assert.equal(f.calls.filter(c => c.purpose === "execution").length, 1);
});

test("a PATH helper replaced after successful synthetic replay cannot be automatically adopted", local, async t => {
  const f = await fixture(t, "replay-copy");
  const dep = `${f.deps}/payload`;
  const helper = '#!/bin/sh\nexec /bin/cat "$@"\n';
  const body = '#!/bin/sh\nexec payload "$@"\n';
  executable(dep, helper);
  executable(f.bin, body);
  let replaced = false;
  const sandbox: Sandbox = { ...f.sandbox, async run(program, args, options) {
    const result = await f.sandbox.run(program, args, options);
    // Observe the lifecycle of a real subprocess; never substitute its result.
    if (options?.purpose === "revalidation" && !replaced) {
      assert.equal(result.code, 0);
      executable(dep, helper.replace("#!/bin/sh", "#!/bin/sh\n# same output, unapproved helper bytes"));
      replaced = true;
    }
    return result;
  } };
  const rc = await f.create({}, sandbox);
  await f.learn(rc);
  const cap = rc.graph.get("cli:replay-copy:default")!;
  const original = structuredClone(cli(cap));
  const provider = structuredClone(rc.graph.providers.get(cap.provider)!);
  assert.ok(original.examples?.length, "the replay must use real retained synthetic examples");
  assert.equal(rc.chain.receipts.length, 0, "no caller receipt can authorise replay");
  assert.deepEqual(sandbox.policy.writeRoots, []);
  assert.equal(sandbox.policy.network, false);
  const helperSha = digest(dep);
  executable(f.bin, body.replace("#!/bin/sh", "#!/bin/sh\n# compatible primary rebuild"));
  f.calls.length = 0;
  const result = await rc.run(cap.id, { [cap.inputs[0].name]: "caller content must not execute\n" });
  assert.equal(replaced, true, "the race must happen after a real successful replay subprocess");
  assert.notEqual(digest(dep), helperSha);
  const replays = f.calls.filter(c => c.purpose === "revalidation");
  assert.ok(replays.length > 0);
  for (const [i, replay] of replays.entries()) {
    assert.equal(replay.result?.code, 0);
    assert.equal(createHash("sha256").update(replay.result!.stdout).digest("hex"), original.examples![i].outputSha256,
      "revalidation output still matches; only the environment changed");
  }
  refusedEnvironment(result);
  assert.equal(f.calls.filter(c => c.purpose === "execution").length, 0, "no caller execution after the helper replacement");
  assert.deepEqual(cli(rc.graph.get(cap.id)), original, "automatic learning must not adopt either new pin");
  assert.deepEqual(rc.graph.providers.get(cap.provider), provider, "provider evidence must not adopt the replaced helper");
  const callsAfterRefusal = f.calls.length;
  refusedEnvironment(await rc.run(cap.id, { [cap.inputs[0].name]: "caller content must not execute\n" }));
  assert.equal(f.calls.length, callsAfterRefusal, "a refusal cannot lead to another replay or discovery");
  await rc.flush();
  const restarted = await f.create({}, sandbox);
  assert.deepEqual(cli(restarted.graph.get(cap.id)), original);
  assert.deepEqual(restarted.graph.providers.get(cap.provider), JSON.parse(JSON.stringify(provider)), "FileStore keeps the original evidence, omitting only undefined metadata");
  refusedEnvironment(await restarted.run(cap.id, { [cap.inputs[0].name]: "caller content must not execute\n" }));
  assert.equal(f.calls.length, callsAfterRefusal, "restart cannot turn a refused helper into accepted evidence");
});

test("saved witness obligations survive restart, checker loss/change, explicit relearn, and hidden configuration changes", local, async t => {
  const f = await fixture(t, "upper-source");
  const config = `${f.data}/mode.conf`;
  const dep = `${f.deps}/transform`;
  const checker = `${f.dir}/independent-checker`;
  const spacing = `${f.dir}/line-spacing`;
  executable(spacing, "#!/bin/sh\nexec /usr/bin/tr -s ' '\n");
  writeFileSync(config, "upper\n");
  const transform = "#!/bin/sh\nexec /usr/bin/tr a-z A-Z\n";
  executable(dep, transform);
  executable(f.bin, `#!/bin/sh
if [ "$1" = "--help" ]; then printf 'Usage: upper-source [FILE]\\nConvert standard input to uppercase text.\\n'; exit 0; fi
read mode < ${quote(config)}
if [ "$mode" = "upper" ]; then /bin/cat "$@" | transform; else /bin/cat "$@"; fi
`);
  const checkerBody = dispatcher("independent-checker", `if [ "$(/bin/cat)" = "ALPHA" ]; then printf '{"valid":true}\\n'; else printf '{"valid":false}\\n'; fi`, true);
  executable(checker, checkerBody);
  const authority = { investigate: [f.bin, checker, spacing], execute: [f.bin, checker, spacing] };
  const rc = await f.create(authority);
  await f.learn(rc);
  await f.learn(rc, checker);
  await f.learn(rc, spacing);
  const source = rc.graph.get("cli:upper-source:default")!;
  cli(source);
  const spacingId = "cli:line-spacing:default";
  cli(rc.graph.get(spacingId));
  const witnessId = "cli:independent-checker:report";
  const witnesses: OutcomeWitness[] = [{ capability: witnessId, args: { input: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }];
  const first = await rc.compose({
    have: { input: { type: "text", value: "alpha\n" } }, want: "text", through: [source.id, spacingId],
    run: true, publish: "Pinned uppercase", witnesses,
    verify: [{ op: "matches", pattern: "^[A-Z]+\\n$" }],
  });
  assert.equal(first.executed?.status, "completed", JSON.stringify(first));
  assert.equal(first.executed?.output, "ALPHA\n");
  assert.equal(first.executed?.verification.status, "verified");
  assert.ok(first.crystallized);
  assert.equal(first.published?.id, "goal:pinned-uppercase");
  await rc.flush();
  const restarted = await f.create(authority);
  const goalId = "goal:pinned-uppercase";
  const correct = await restarted.run(goalId, { input: "alpha\n" });
  assert.equal(correct.status, "completed", correct.error);
  assert.equal(correct.verification.status, "verified");
  const direct = await restarted.run(source.id, { [source.inputs[0].name]: "alpha\n" });
  assert.equal(direct.verification.status, "unverified", "a successful independent check is scoped to its result, not the provider");
  validity(direct, "unchanged", "not-established");
  const another = await restarted.run(goalId, { input: "beta\n" }, { verify: [{ op: "type", value: "string" }] });
  assert.equal(another.status, "failed", "a valid uppercase value still needs this goal's pinned witness");
  assert.equal(another.verification.status, "refuted");
  assert.equal(another.witnesses?.[0].status, "failed");

  const witnessCap = structuredClone(restarted.graph.get(witnessId)!);
  const witnessProvider = structuredClone(restarted.graph.providers.get(witnessCap.provider)!);
  for (const change of ["unavailable", "contract", "bytes"] as const) {
    if (change === "unavailable") rmSync(checker);
    if (change === "bytes") executable(checker, checkerBody.replace("#!/bin/sh", "#!/bin/sh\n# unapproved checker build"));
    if (change === "contract") restarted.graph.add({ provider: witnessProvider, capabilities: [{ ...witnessCap, inputs: [...witnessCap.inputs, { name: "new_policy", type: "text", required: true }] }] });
    f.calls.length = 0;
    for (const id of [first.crystallized.id, goalId]) {
      const refused = await restarted.run(id, { input: "alpha\n" }, { verify: [{ op: "type", value: "string" }] });
      assert.equal(refused.status, "failed", `${change}: ${id}`);
      assert.ok(["refuted", "unverified"].includes(refused.verification.status), `${change}: unavailable evidence cannot establish a successful outcome`);
      // Refusing a missing/changed checker need not claim the result itself was
      // refuted. A contract rejection may also happen before a witness run.
      if (change !== "contract") {
        assert.ok(refused.witnesses?.some(w => w.capability === witnessId && w.status === "failed"), `${change}: the retained witness cannot disappear`);
      }
      if (change === "contract") assert.match(`${refused.error} ${refused.witnesses?.[0].error}`, /witness contract changed/);
    }
    assert.ok(!f.calls.some(c => c.bin === checker), `${change}: never repair or substitute a pinned checker`);
    assert.ok(f.calls.every(c => c.purpose === "execution"), "no implicit rediscovery to drop an obligation");
    if (change !== "contract") assert.equal(f.calls.length, 0, `${change}: refuse the pinned checker before ANY producer subprocess`);
    executable(checker, checkerBody);
    restarted.graph.add({ provider: witnessProvider, capabilities: [structuredClone(witnessCap)] });
  }

  const originalPin = cli(restarted.graph.get(source.id)).environment?.digest;
  executable(dep, transform.replace("#!/bin/sh", "#!/bin/sh\n# compatible dependency reinstall"));
  f.calls.length = 0;
  refusedEnvironment(await restarted.run(source.id, { [source.inputs[0].name]: "alpha\n" }));
  assert.equal(f.calls.length, 0);
  const beforeLearn = f.discoveries();
  await f.learn(restarted);
  assert.equal(f.discoveries(), beforeLearn + 1);
  assert.notEqual(cli(restarted.graph.get(source.id)).environment?.digest, originalPin);
  await f.learn(restarted, spacing);
  // The shared PATH pin of the independent checker also changed. Refreshing the
  // producers must not silently refresh this separate, pinned obligation.
  f.calls.length = 0;
  const staleWitness = await restarted.run(goalId, { input: "alpha\n" });
  refusedEnvironment(staleWitness);
  assert.equal(f.calls.length, 0, "the stale checker is required even before the producers run");

  // Restore the PATH entry exactly to test hidden, out-of-coverage input changes
  // against the existing saved proof, without replacing that proof's checker.
  executable(dep, transform);
  await f.learn(restarted);
  await f.learn(restarted, spacing);
  const again = await restarted.run(goalId, { input: "alpha\n" });
  assert.equal(again.status, "completed", again.error);
  assert.equal(again.verification.status, "verified");
  const stablePin = cli(restarted.graph.get(source.id)).environment?.digest;
  writeFileSync(config, "identity\n");
  f.calls.length = 0;
  const hidden = await restarted.run(source.id, { [source.inputs[0].name]: "alpha\n" });
  assert.equal(hidden.status, "completed", hidden.error);
  assert.equal(hidden.output, "alpha\n");
  assert.equal(hidden.verification.status, "unverified", "a hidden configuration change is not guessed into either success or discovered drift");
  assert.equal(validity(hidden, "unchanged", "not-established").expected, stablePin);
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
  const unmet = await restarted.run(goalId, { input: "alpha\n" }, { verify: [{ op: "type", value: "string" }] });
  assert.equal(unmet.status, "failed");
  assert.equal(unmet.verification.status, "refuted", "fresh caller predicates cannot replace stored result or witness obligations");
});
