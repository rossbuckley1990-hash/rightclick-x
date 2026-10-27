import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { RightClick, type OperatorAuthority, type RunRecord } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { CONFINED_POLICY, hostSandbox, makeSandbox, type Sandbox, type SandboxRun } from "../src/core/sandbox.ts";
import { signature } from "../src/core/graph.ts";
import type { CliConformance } from "../src/core/cli-conformance.ts";
import type { Capability, CliInvoke } from "../src/core/types.ts";
import type { OutcomeWitness } from "../src/core/verify.ts";

// Serial, disposable fixtures only. Neither observer fabricates outputs nor relaxes
// confinement; importantly, it also observes the separate narrowed sample sandbox.
const native = process.platform === "darwin" ? await hostSandbox() : null;
const local = { skip: native ? false : "native macOS sandbox unavailable", timeout: 120_000, concurrency: false };
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const executable = (file: string, body: string) => { writeFileSync(file, body); chmodSync(file, 0o755); };
const rebuilt = (body: string) => body.replace("#!/bin/sh", "#!/bin/sh\n# compatible rebuild");

function cli(cap: Capability | undefined): CliInvoke {
  assert.ok(cap, "the documented capability must exist");
  assert.equal(cap.invoke.kind, "cli");
  return cap.invoke as CliInvoke;
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

const workflows = [
  {
    name: "ordered-records", real: "/usr/bin/sort",
    samples: [
      { args: { input: "pear\napple\n" }, output: "apple\npear\n" },
      { args: { input: "zebra\nfig\nbanana\n" }, output: "banana\nfig\nzebra\n" },
    ],
    caller: "violet\namber\nviolet\n", output: "amber\nviolet\nviolet\n",
  },
  {
    name: "record-checksum", real: "/usr/bin/cksum",
    // Independent POSIX CRC check vectors, not outputs captured from the candidate.
    samples: [
      { args: { input: "" }, output: "4294967295 0\n" },
      { args: { input: "abc" }, output: "1219131554 3\n" },
    ],
    caller: "123456789", output: "930766865 9\n",
  },
];
type Workflow = (typeof workflows)[number];
type Call = { bin: string; args: string[]; stdin?: string; purpose?: string; narrowed: boolean; writeRoots: string[]; network: boolean; result?: SandboxRun };

async function fixture(t: TestContext, workflow: Workflow = workflows[0], helper = false, writable = false) {
  assert.ok(native);
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-cli-conformance-`));
  const deps = `${dir}/path`, effects = `${dir}/effects`;
  mkdirSync(deps); mkdirSync(effects);
  const bin = `${dir}/${workflow.name}`, dependency = `${deps}/payload`;
  if (helper) symlinkSync(workflow.real, dependency);
  const body = dispatcher(workflow.name, `exec ${helper ? "payload" : quote(workflow.real)}`);
  executable(bin, body);
  const id = `cli:${workflow.name}:report`;
  const spec: CliConformance = { samples: structuredClone(workflow.samples) };
  const calls: Call[] = [];
  const observe = (actual: Sandbox, narrowed = false): Sandbox => ({
    ...actual,
    forRevalidation: actual.forRevalidation ? () => observe(actual.forRevalidation!(), true) : undefined,
    async run(program, args, options) {
      const call: Call = { bin: program, args: [...args], stdin: options?.stdin, purpose: options?.purpose,
        narrowed, writeRoots: [...actual.policy.writeRoots], network: actual.policy.network };
      calls.push(call);
      return call.result = await actual.run(program, args, options);
    },
  });
  const sandbox = observe(makeSandbox(native.kind, {
    ...CONFINED_POLICY, readRoots: [dir], readDenyRoots: [], writeRoots: writable ? [effects] : [],
    pathDirs: [deps, "/usr/bin", "/bin"], network: false,
    limits: { ...CONFINED_POLICY.limits, timeoutMs: 10_000 },
  }));
  let discoveries = 0;
  // Restart transfers ownership of each state file to the new runtime. An
  // older snapshot must not be flushed after its successor changes the file.
  const current = new Map<string, RightClick>();
  const storePath = `${dir}/state.json`;
  const create = async (authority: OperatorAuthority = {}, sb: Sandbox | null = sandbox, file = storePath) => {
    if (current.has(file)) await current.get(file)!.flush();
    const rc = await RightClick.create({
      directories: [], store: new FileStore(file), sandbox: sb,
      authority: { investigate: [bin], execute: [bin], cliConformance: { [id]: spec }, ...authority },
      // Goals may plan, but all actual subprocesses remain network-denied.
      network: { blockPrivate: true },
      fetch: async () => { assert.fail("local conformance must not trigger network discovery"); },
      onInvestigationStart: () => { discoveries++; },
    });
    current.set(file, rc);
    return rc;
  };
  t.after(async () => {
    try { for (const rc of current.values()) await rc.flush(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  const learn = async (rc: RightClick, program = bin) => {
    const learned = await rc.learn({ source: `cli:${program}` });
    assert.equal(learned.results[0]?.error, undefined, JSON.stringify(learned.results));
    assert.ok(learned.results[0]?.learned.length, JSON.stringify(learned.results));
  };
  const state = async (rc: RightClick, file = storePath) => {
    await rc.flush();
    const saved = await new FileStore(file).load();
    assert.ok(saved);
    return saved;
  };
  // Tests that intentionally corrupt the on-disk file retire the previous
  // runtime first; teardown must not try to save its stale snapshot.
  const retire = (file = storePath) => { current.delete(file); };
  return { dir, bin, id, body, dependency, effects, spec, calls, sandbox, observe, create, learn, state, storePath, retire,
    discoveries: () => discoveries };
}

function samples(calls: Call[], spec: CliConformance, bin: string) {
  assert.equal(calls.length, spec.samples.length * 2, "each exact sample must be repeated twice");
  for (const [i, call] of calls.entries()) {
    const sample = spec.samples[Math.floor(i / 2)];
    assert.equal(call.bin, bin);
    assert.deepEqual(call.args, ["report"]);
    assert.equal(call.stdin, sample.args.input, "never replace synthetic inputs with the caller's input");
    assert.equal(call.purpose, "revalidation");
    assert.equal(call.narrowed, true, "samples must use forRevalidation().run, not merely a telemetry label");
    assert.deepEqual(call.writeRoots, []);
    assert.equal(call.network, false);
    assert.equal(call.result?.code, 0, call.result?.stderr);
    assert.deepEqual(sample.format === "json" ? JSON.parse(call.result!.stdout) : call.result?.stdout, sample.output);
  }
}

function refused(run: RunRecord) {
  assert.equal(run.status, "failed", run.error);
  assert.equal(run.receipt.status, "failed");
  // A refused direct run has no output; a refused goal or composite run reports it as null.
  assert.equal(run.output ?? undefined, undefined, "no unaccepted caller output may escape");
  assert.notEqual(run.verification.status, "verified");
  assert.equal(run.healing?.retried, undefined, "conformance does not authorize caller replay");
  assert.deepEqual(run.receipt.cliValidity, run.cliValidity);
}

for (const workflow of workflows) for (const replacement of ["primary", "helper"] as const) {
  test(`${workflow.real}: compatible ${replacement} replacement accepts only exact native samples, not new graph signatures`, {
    ...local, skip: local.skip || (!existsSync(workflow.real) && `${workflow.real} unavailable`),
  }, async t => {
    const f = await fixture(t, workflow, replacement === "helper");
    const rc = await f.create();
    assert.equal(f.calls.length, 0, "configuration alone does not acquire evidence");
    await f.learn(rc);
    const cap = rc.graph.get(f.id)!;
    assert.equal(cap.risk, "read");
    const original = structuredClone(cli(cap)), originalSignature = signature(cap);
    assert.equal(original.examples, undefined, "documented operations have no old generic replay examples");
    samples(f.calls.filter(c => c.purpose === "revalidation"), f.spec, f.bin);
    assert.equal(f.calls.filter(c => c.purpose === "execution").length, 0);
    assert.equal(rc.chain.receipts.length, 0, "acquisition is not a caller run");
    const before = await f.state(rc);
    assert.ok(before.requirements?.includes("cli-conformance@1"));
    const initialPin = before.cliConformance?.find(p => p.capability === f.id);
    assert.ok(initialPin);
    assert.equal(initialPin.checks, 4);
    assert.equal(initialPin.sha256, digest(f.bin));
    assert.equal(initialPin.environment, original.environment?.digest);
    const provider = structuredClone(rc.graph.providers.get(cap.provider));
    const discoveries = f.discoveries();
    f.calls.length = 0;
    const unchanged = await rc.run(f.id, { input: workflow.caller });
    assert.equal(unchanged.status, "completed", unchanged.error);
    assert.equal(unchanged.output, workflow.output);
    assert.equal(unchanged.verification.status, "unverified");
    assert.deepEqual(f.calls.map(c => c.purpose), ["execution"], "unchanged identity needs no experiments");

    if (replacement === "primary") executable(f.bin, rebuilt(f.body));
    else {
      rmSync(f.dependency);
      executable(f.dependency, `#!/bin/sh\n# compatible helper replacement\nexec ${quote(workflow.real)} "$@"\n`);
      assert.equal(digest(f.bin), original.sha256, "the harness bytes did not change");
    }
    f.calls.length = 0;
    const run = await rc.run(f.id, { input: workflow.caller });
    assert.equal(run.status, "completed", run.error);
    assert.equal(run.output, workflow.output);
    assert.equal(run.verification.status, "unverified", "sample equivalence is not an outcome proof");
    assert.equal(run.healing?.retried, undefined);
    samples(f.calls.slice(0, 4), f.spec, f.bin);
    assert.equal(f.calls.length, 5);
    assert.equal(f.calls[4].purpose, "execution");
    assert.equal(f.calls[4].narrowed, false);
    assert.equal(f.calls[4].stdin, workflow.caller);
    assert.equal(f.discoveries(), discoveries, "never rediscover or relearn a compatible replacement");
    assert.equal(run.cliValidity?.coverage, "partial");
    assert.equal(run.cliValidity?.application, "not-established");
    assert.equal(run.cliValidity?.conformance?.status, "matched");
    assert.equal(run.cliValidity?.conformance?.checks, 4);
    assert.match(run.cliValidity?.limitation ?? "", /samples|synthetic/i);
    assert.deepEqual(run.receipt.cliValidity, run.cliValidity);
    assert.deepEqual(cli(rc.graph.get(f.id)), original);
    assert.equal(signature(rc.graph.get(f.id)!), originalSignature);
    assert.deepEqual(rc.graph.providers.get(cap.provider), provider);
    const accepted = await f.state(rc);
    const pin = accepted.cliConformance!.find(p => p.capability === f.id)!;
    assert.equal(pin.sha256, digest(f.bin));
    assert.equal(pin.environment, run.cliValidity?.observed);
    assert.equal(pin.sha256, run.cliValidity?.conformance?.sha256);
    assert.equal(pin.contract, run.cliValidity?.conformance?.contract);
    assert.equal(pin.samples, run.cliValidity?.conformance?.samples);
    assert.equal(pin.policy, initialPin.policy);
    assert.equal(pin.contract, initialPin.contract);
    assert.equal(pin.samples, initialPin.samples);
    assert.notDeepEqual(pin, initialPin);
    assert.equal(replacement === "primary" ? pin.environment : pin.sha256,
      replacement === "primary" ? initialPin.environment : initialPin.sha256);

    f.calls.length = 0;
    const restarted = await f.create();
    assert.equal(f.calls.length, 0, "restoring accepted evidence is not acquisition");
    assert.deepEqual(cli(restarted.graph.get(f.id)), original);
    assert.equal(signature(restarted.graph.get(f.id)!), originalSignature);
    assert.deepEqual(restarted.chain.receipts.find(r => r.runId === run.runId)?.cliValidity, run.cliValidity);
    assert.equal((await restarted.verifyReceipts()).intact, true);
    const afterRestart = await restarted.run(f.id, { input: workflow.caller });
    assert.equal(afterRestart.status, "completed", afterRestart.error);
    assert.equal(afterRestart.output, workflow.output);
    assert.equal(afterRestart.verification.status, "unverified");
    assert.deepEqual(afterRestart.receipt.cliValidity, afterRestart.cliValidity);
    assert.deepEqual(f.calls.map(c => c.purpose), ["execution"], "accepted bindings survive restart without sample replay");
    assert.deepEqual((await f.state(restarted)).cliConformance, accepted.cliConformance);
    assert.equal(f.discoveries(), discoveries);
  });
}

for (const [index, replacement] of ["primary", "helper"].entries()) {
  test(`R2: mismatched ${replacement} samples refuse before caller dispatch and keep both pins`, local, async t => {
    const workflow = workflows[index];
    const f = await fixture(t, workflow, replacement === "helper");
    const rc = await f.create({ retry: [f.id] });
    await f.learn(rc);
    const original = structuredClone(cli(rc.graph.get(f.id))), originalSignature = signature(rc.graph.get(f.id)!);
    const before = await f.state(rc), discoveries = f.discoveries();
    if (replacement === "primary") executable(f.bin, dispatcher(workflow.name, "exec /usr/bin/sort -r"));
    else {
      rmSync(f.dependency);
      executable(f.dependency, "#!/bin/sh\n{ printf 'prefix'; /bin/cat; } | /usr/bin/cksum\n");
      assert.equal(digest(f.bin), original.sha256);
    }
    f.calls.length = 0;
    const run = await rc.run(f.id, { input: workflow.caller });
    refused(run);
    assert.match(run.error ?? "", /sample.*differs|expected.*differs/i);
    assert.equal(run.cliValidity?.conformance?.status, "refused");
    assert.equal(f.calls.length, 1, "stop at the first mismatched exact sample");
    assert.equal(f.calls[0].purpose, "revalidation");
    assert.equal(f.calls[0].narrowed, true);
    assert.equal(f.calls[0].stdin, f.spec.samples[0].args.input);
    assert.equal(f.calls[0].result?.code, 0, "a real successful process can still have changed meaning");
    assert.notEqual(f.calls[0].result?.stdout, f.spec.samples[0].output);
    assert.equal(f.discoveries(), discoveries);
    assert.deepEqual(cli(rc.graph.get(f.id)), original);
    assert.equal(signature(rc.graph.get(f.id)!), originalSignature);
    assert.deepEqual((await f.state(rc)).cliConformance, before.cliConformance);
    refused(await rc.run(f.id, { input: workflow.caller }));
    assert.equal(f.calls.length, 1, "a refused candidate is not repeatedly experimented on");
    await rc.flush();
    const restarted = await f.create({ retry: [f.id] });
    f.calls.length = 0;
    refused(await restarted.run(f.id, { input: workflow.caller }));
    assert.ok(f.calls.every(c => c.purpose === "revalidation" && c.stdin !== workflow.caller));
    assert.deepEqual((await f.state(restarted)).cliConformance, before.cliConformance);
    assert.deepEqual(cli(restarted.graph.get(f.id)), original);
  });
}

test("R3: successful samples do not complete or replay an exit-zero error on the real caller input", local, async t => {
  const f = await fixture(t);
  const rc = await f.create({ retry: [f.id] });
  await f.learn(rc);
  const original = structuredClone(cli(rc.graph.get(f.id))), discoveries = f.discoveries();
  const caller = "billing-lookup\n";
  executable(f.bin, dispatcher(workflows[0].name, `/bin/cat > request
/usr/bin/sort < request > sorted || exit $?
if [ "$(/bin/cat request)" = "billing-lookup" ]; then
  printf '{"ok":false,"error":"backend unavailable"}\\n'
else /bin/cat sorted; fi`));
  f.calls.length = 0;
  const run = await rc.run(f.id, { input: caller });
  refused(run);
  assert.equal(run.verification.status, "refuted");
  assert.equal(run.cliValidity?.conformance?.status, "matched");
  assert.equal(run.cliValidity?.conformance?.checks, 4);
  assert.equal(run.cliValidity?.application, "reported-error");
  assert.equal(run.cliValidity?.processExit, 0);
  samples(f.calls.slice(0, 4), f.spec, f.bin);
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[4].purpose, "execution");
  assert.equal(f.calls[4].stdin, caller);
  assert.equal(f.calls[4].result?.code, 0);
  assert.deepEqual(JSON.parse(f.calls[4].result!.stdout), { ok: false, error: "backend unavailable" });
  assert.equal(f.discoveries(), discoveries);
  assert.deepEqual(cli(rc.graph.get(f.id)), original);
});

test("fresh configuration and caller receipts cannot acquire samples without explicit learn", local, async t => {
  const f = await fixture(t);
  const rc = await f.create({ cliConformance: {} });
  await f.learn(rc);
  assert.ok(f.calls.every(c => c.purpose === "investigation"));
  assert.equal((await rc.run(f.id, { input: workflows[0].caller })).status, "completed");
  assert.equal((await f.state(rc)).cliConformance?.length ?? 0, 0);
  f.calls.length = 0;
  const fresh = await f.create();
  assert.equal(f.calls.length, 0);
  assert.equal((await fresh.run(f.id, { input: workflows[0].caller })).status, "completed");
  assert.deepEqual(f.calls.map(c => c.purpose), ["execution"]);
  assert.equal((await f.state(fresh)).cliConformance?.length ?? 0, 0);
  const original = structuredClone(cli(fresh.graph.get(f.id))), discoveries = f.discoveries();
  executable(f.bin, rebuilt(f.body));
  f.calls.length = 0;
  refused(await fresh.run(f.id, { input: workflows[0].caller }));
  assert.equal(f.calls.length, 0, "new authority cannot retroactively establish old-program evidence");
  assert.equal(f.discoveries(), discoveries);
  assert.deepEqual(cli(fresh.graph.get(f.id)), original);
  assert.equal((await f.state(fresh)).cliConformance?.length ?? 0, 0);
  await f.learn(fresh);
  samples(f.calls.filter(c => c.purpose === "revalidation"), f.spec, f.bin);
  assert.equal((await f.state(fresh)).cliConformance?.length, 1, "explicit learn may now acquire evidence");
});

for (const revoked of ["samples", "execute", "investigate", "execution-policy", "changed-samples", "changed-policy", "sandbox", "narrowed-sandbox", "read-risk"] as const) {
  test(`current ${revoked} authority is required even with retained conformance`, local, async t => {
    const f = await fixture(t);
    const rc = await f.create();
    await f.learn(rc);
    const before = await f.state(rc), original = structuredClone(cli(rc.graph.get(f.id)));
    const changedSpec = structuredClone(f.spec);
    changedSpec.samples[1].output = "different expected result\n";
    const authority: OperatorAuthority = {
      retry: [f.id],
      ...(revoked === "samples" ? { cliConformance: {} } : {}),
      ...(revoked === "changed-samples" ? { cliConformance: { [f.id]: changedSpec } } : {}),
      ...(revoked === "execute" ? { execute: [] } : {}),
      ...(revoked === "investigate" ? { investigate: [] } : {}),
      ...(revoked === "execution-policy" ? { execution: { deniedCapabilities: [f.id] } } : {}),
    };
    const sb = revoked === "sandbox" ? null : revoked === "narrowed-sandbox" ? { ...f.sandbox, forRevalidation: undefined }
      : revoked === "changed-policy" ? f.observe(makeSandbox(native!.kind, {
        ...f.sandbox.policy, limits: { ...f.sandbox.policy.limits, timeoutMs: 9000 },
      })) : f.sandbox;
    const restarted = await f.create(authority, sb);
    if (revoked === "read-risk") restarted.graph.get(f.id)!.risk = "write";
    const discoveries = f.discoveries();
    f.calls.length = 0;
    // Check current authority both before drift and after a compatible replacement.
    for (const changed of [false, true]) {
      if (changed) executable(f.bin, rebuilt(f.body));
      const run = await restarted.run(f.id, { input: workflows[0].caller });
      refused(run);
      assert.match(run.error ?? "", /conformance|authori[sz]|execution policy|sandbox/i);
      assert.equal(f.calls.length, 0, "revocation precedes samples, help, and caller dispatch");
      assert.equal(f.discoveries(), discoveries);
      assert.deepEqual(cli(restarted.graph.get(f.id)), original);
      assert.deepEqual((await f.state(restarted)).cliConformance, before.cliConformance);
    }
  });
}

test("invalid exact sample contracts refuse configuration before any native discovery", local, async t => {
  const f = await fixture(t);
  const first = f.spec.samples[0], second = f.spec.samples[1];
  for (const cliConformance of [
    { [f.id]: { samples: [first] } },
    { [f.id]: { samples: [first, { ...second, args: first.args }] } },
    { [f.id]: { samples: [first, { ...second, output: first.output }] } },
    { "cli:ordered-records:*": f.spec },
  ]) {
    await assert.rejects(f.create({ cliConformance }), /conformance|distinct|exact/i);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.discoveries(), 0);
});

for (const phase of ["acquisition", "replacement"] as const) {
  test(`native ${phase} samples deny hidden writes despite the original declared write root`, local, async t => {
    const f = await fixture(t, workflows[0], false, true);
    const rc = await f.create();
    if (phase === "replacement") await f.learn(rc);
    const before = await f.state(rc);
    const allowedFile = `${f.effects}/control`, hidden = `${f.effects}/hidden`;
    const control = await f.sandbox.run("/bin/sh", ["-c", `printf 'allowed' > ${quote(allowedFile)}`], { purpose: "agent-run" });
    assert.equal(control.code, 0, control.stderr);
    assert.equal(readFileSync(allowedFile, "utf8"), "allowed", "original native sandbox genuinely permits this write root");
    executable(f.bin, dispatcher(workflows[0].name, `printf 'hidden' > ${quote(hidden)} || exit $?
exec /usr/bin/sort`));
    f.calls.length = 0;
    if (phase === "acquisition") {
      const result = await rc.learn({ source: `cli:${f.bin}` });
      assert.match(result.results[0]?.error ?? "", /conformance.*refused/i);
      assert.equal(rc.graph.get(f.id), undefined, "failed acquisition installs no capability");
    } else refused(await rc.run(f.id, { input: workflows[0].caller }));
    const attempts = f.calls.filter(c => c.purpose === "revalidation");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].narrowed, true);
    assert.deepEqual(attempts[0].writeRoots, []);
    assert.equal(attempts[0].network, false);
    assert.notEqual(attempts[0].result?.code, 0);
    assert.match(attempts[0].result?.stderr ?? "", /permi|denied/i);
    assert.equal(existsSync(hidden), false, "the kernel denied the sample's hidden write");
    assert.ok(!f.calls.some(c => c.purpose === "execution"));
    assert.deepEqual((await f.state(rc)).cliConformance, before.cliConformance);
  });
}

test("FileStore rejects missing conformance requirements and malformed pins without overwriting state", local, async t => {
  const f = await fixture(t);
  const rc = await f.create();
  await f.learn(rc);
  await rc.flush();
  const original = JSON.parse(readFileSync(f.storePath, "utf8"));
  assert.equal(original.state.cliConformance.length, 1);
  f.retire();
  for (const change of ["requirement", "hash", "checks", "duplicate"] as const) {
    const malformed = structuredClone(original);
    if (change === "requirement") malformed.state.requirements = malformed.state.requirements.filter((r: string) => r !== "cli-conformance@1");
    if (change === "hash") malformed.state.cliConformance[0].sha256 = "not-a-digest";
    if (change === "checks") malformed.state.cliConformance[0].checks = 1;
    if (change === "duplicate") malformed.state.cliConformance.push(structuredClone(malformed.state.cliConformance[0]));
    const bytes = JSON.stringify(malformed);
    writeFileSync(f.storePath, bytes);
    f.calls.length = 0;
    await assert.rejects(f.create(), /retained CLI conformance evidence/i);
    assert.equal(readFileSync(f.storePath, "utf8"), bytes, `${change}: rejection must not discard stored data`);
    assert.equal(f.calls.length, 0);
  }
});

test("graph and knowledge exports carry no local conformance authority, and import cannot acquire it", local, async t => {
  const f = await fixture(t);
  const rc = await f.create({ shareEvidence: true });
  await f.learn(rc);
  executable(f.bin, rebuilt(f.body));
  assert.equal((await rc.run(f.id, { input: workflows[0].caller })).status, "completed");
  const saved = await f.state(rc);
  assert.equal(saved.cliConformance?.length, 1);
  for (const exported of [rc.exportGraph(), rc.exportKnowledge()]) {
    const serialized = JSON.stringify(exported);
    assert.ok(!serialized.includes('"cliConformance"'));
    assert.ok(!serialized.includes(saved.cliConformance![0].samples), "local sample authorization digest is not portable authority");
    for (const sample of f.spec.samples) assert.ok(!serialized.includes(JSON.stringify(sample.args.input)));
  }
  const bundle = rc.exportKnowledge();
  assert.equal(bundle.programs.length, 1);
  assert.equal((bundle.programs[0].capabilities[0].invoke as CliInvoke).examples, undefined);
  // Extra untrusted fields must not turn the exporter's local binding into ours,
  // even when the receiver independently has an exact sample configuration.
  Object.assign(bundle, { cliConformance: saved.cliConformance, authority: { cliConformance: { [f.id]: f.spec } } });
  f.calls.length = 0;
  const receiverFile = `${f.dir}/receiver.json`;
  const receiver = await f.create({}, f.sandbox, receiverFile);
  const report = await receiver.importKnowledge(bundle);
  assert.equal(report.programs[0].status, "refused");
  assert.equal(report.programs[0].revalidationRuns, 0);
  assert.match(report.programs[0].capabilities[0].reason ?? "", /no conformance examples/i);
  assert.equal(receiver.graph.get(f.id), undefined);
  assert.equal((await f.state(receiver, receiverFile)).cliConformance?.length ?? 0, 0);
  assert.equal(f.calls.length, 0, "import is not explicit learn or sample authorization");
});

test("saved goal and composite preserve verify/witness obligations across source acceptance and never repin a changed witness", local, async t => {
  const f = await fixture(t);
  const spacing = `${f.dir}/line-spacing`, checker = `${f.dir}/independent-checker`;
  const spacingId = "cli:line-spacing:report", witnessId = "cli:independent-checker:report";
  executable(spacing, dispatcher("line-spacing", "exec /usr/bin/tr -s ' '"));
  const checkerBody = dispatcher("independent-checker", `exec /usr/bin/awk 'BEGIN { valid=1 } NR==1 { first=$0 } NR>1 && $0<previous { valid=0 } { previous=$0; n++ } END { printf "{\\"valid\\":%s}\\n", (valid && n>=2 && first=="amber" ? "true" : "false") }'`, true);
  executable(checker, checkerBody);
  const checkerSpec: CliConformance = { samples: [
    { args: { input: "amber\nviolet\n" }, output: { valid: true }, format: "json" },
    { args: { input: "violet\namber\n" }, output: { valid: false }, format: "json" },
  ] };
  const authority: OperatorAuthority = {
    investigate: [f.bin, spacing, checker], execute: [f.bin, spacing, checker],
    cliConformance: { [f.id]: f.spec, [witnessId]: checkerSpec },
  };
  const rc = await f.create(authority);
  await f.learn(rc); await f.learn(rc, spacing); await f.learn(rc, checker);
  samples(f.calls.filter(c => c.purpose === "revalidation" && c.bin === checker), checkerSpec, checker);
  const witnesses: OutcomeWitness[] = [{ capability: witnessId, args: { input: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }];
  const first = await rc.compose({
    have: { input: { type: "text", value: workflows[0].caller } }, want: "text", through: [f.id, spacingId],
    run: true, publish: "Conforming ordered records", witnesses,
    verify: [{ op: "matches", pattern: "^[a-z]+\\n[a-z]+\\n[a-z]+\\n$" }], acquire: false, maxSteps: 2,
  });
  assert.equal(first.executed?.status, "completed", JSON.stringify(first));
  assert.equal(first.executed?.verification.status, "verified");
  assert.ok(first.crystallized);
  assert.equal(first.published?.id, "goal:conforming-ordered-records");
  const derived = [first.crystallized.id, first.published.id];
  const originalSource = structuredClone(cli(rc.graph.get(f.id))), originalSignature = signature(rc.graph.get(f.id)!);
  const obligations = derived.map(id => structuredClone(rc.graph.get(id)!.invoke));
  const before = await f.state(rc), discoveries = f.discoveries();
  const restarted = await f.create(authority);
  executable(f.bin, rebuilt(f.body));
  f.calls.length = 0;
  for (const id of derived) {
    const run = await restarted.run(id, { input: workflows[0].caller });
    assert.equal(run.status, "completed", `${id}: ${run.error}`);
    assert.equal(run.output, workflows[0].output);
    assert.equal(run.verification.status, "verified");
    assert.equal(run.witnesses?.[0].capability, witnessId);
    assert.equal(run.witnesses?.[0].status, "completed");
  }
  samples(f.calls.filter(c => c.purpose === "revalidation"), f.spec, f.bin);
  assert.deepEqual(f.calls.slice(0, 4).map(c => c.purpose), Array(4).fill("revalidation"));
  assert.equal(f.calls.filter(c => c.purpose === "execution" && c.bin === f.bin).length, 2, "once per requested saved run, never replayed");
  assert.deepEqual(cli(restarted.graph.get(f.id)), originalSource);
  assert.equal(signature(restarted.graph.get(f.id)!), originalSignature);
  assert.deepEqual(derived.map(id => restarted.graph.get(id)!.invoke), obligations);
  assert.equal(f.discoveries(), discoveries);
  assert.equal((await restarted.run(f.id, { input: workflows[0].caller })).verification.status, "unverified");

  executable(checker, rebuilt(checkerBody));
  f.calls.length = 0;
  for (const id of derived) {
    const run = await restarted.run(id, { input: workflows[0].caller }, { verify: [{ op: "type", value: "string" }] });
    refused(run);
    assert.match(`${run.error} ${run.witnesses?.[0]?.error}`, /witness program changed/i);
  }
  assert.equal(f.calls.length, 0, "a changed independent witness blocks even producer samples despite its own exact sample grant");
  const after = await f.state(restarted);
  assert.deepEqual(after.cliConformance?.find(p => p.capability === witnessId), before.cliConformance?.find(p => p.capability === witnessId));
  assert.deepEqual(derived.map(id => restarted.graph.get(id)!.invoke), obligations);

  executable(checker, checkerBody);
  for (const id of derived) {
    const failedWitness = await restarted.run(id, { input: "beta\nalpha\nbeta\n" }, { verify: [{ op: "type", value: "string" }] });
    assert.equal(failedWitness.status, "failed");
    assert.equal(failedWitness.verification.status, "refuted");
    assert.equal(failedWitness.witnesses?.[0].status, "failed", "fresh predicates do not replace the stored independent check");
    const failedPredicate = await restarted.run(id, { input: "amber\nviolet\n" }, { verify: [{ op: "type", value: "string" }] });
    assert.equal(failedPredicate.status, "failed", "two valid ordered lines do not discharge the saved three-line predicate");
    assert.equal(failedPredicate.verification.status, "refuted");
  }
  assert.equal(f.discoveries(), discoveries);
});

test("saved goal preserves verify/witness obligations across source acceptance and never repins a changed witness", local, async t => {
  const f = await fixture(t);
  const checker = `${f.dir}/independent-checker`, witnessId = "cli:independent-checker:report";
  const checkerBody = dispatcher("independent-checker", `exec /usr/bin/awk 'BEGIN { valid=1 } NR==1 { first=$0 } NR>1 && $0<previous { valid=0 } { previous=$0; n++ } END { printf "{\\"valid\\":%s}\\n", (valid && n>=2 && first=="amber" ? "true" : "false") }'`, true);
  executable(checker, checkerBody);
  const checkerSpec: CliConformance = { samples: [
    { args: { input: "amber\nviolet\n" }, output: { valid: true }, format: "json" },
    { args: { input: "violet\namber\n" }, output: { valid: false }, format: "json" },
  ] };
  const authority: OperatorAuthority = {
    investigate: [f.bin, checker], execute: [f.bin, checker],
    cliConformance: { [f.id]: f.spec, [witnessId]: checkerSpec },
  };
  const rc = await f.create(authority);
  await f.learn(rc); await f.learn(rc, checker);
  samples(f.calls.filter(c => c.purpose === "revalidation" && c.bin === checker), checkerSpec, checker);
  const witnesses: OutcomeWitness[] = [{ capability: witnessId, args: { input: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }];
  const first = await rc.compose({
    have: { input: { type: "text", value: workflows[0].caller } }, want: "text", through: [f.id],
    run: true, publish: "Conforming ordered records", witnesses,
    verify: [{ op: "matches", pattern: "^[a-z]+\\n[a-z]+\\n[a-z]+\\n$" }], acquire: false, maxSteps: 1,
  });
  assert.equal(first.executed?.status, "completed", JSON.stringify(first));
  assert.equal(first.executed?.verification.status, "verified");
  assert.equal(first.published?.id, "goal:conforming-ordered-records");
  const goalId = first.published.id;
  const originalSource = structuredClone(cli(rc.graph.get(f.id))), originalSignature = signature(rc.graph.get(f.id)!);
  const obligation = structuredClone(rc.graph.get(goalId)!.invoke);
  const before = await f.state(rc), discoveries = f.discoveries();

  // A compatible rebuild of the producer is accepted by its samples in a fresh runtime.
  const restarted = await f.create(authority);
  executable(f.bin, rebuilt(f.body));
  f.calls.length = 0;
  const run = await restarted.run(goalId, { input: workflows[0].caller });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, workflows[0].output);
  assert.equal(run.verification.status, "verified");
  assert.equal(run.witnesses?.[0].capability, witnessId);
  assert.equal(run.witnesses?.[0].status, "completed");
  samples(f.calls.filter(c => c.purpose === "revalidation"), f.spec, f.bin);
  assert.equal(f.calls.filter(c => c.purpose === "execution" && c.bin === f.bin).length, 1, "once for the requested run, never replayed");
  assert.deepEqual(cli(restarted.graph.get(f.id)), originalSource);
  assert.equal(signature(restarted.graph.get(f.id)!), originalSignature);
  assert.deepEqual(restarted.graph.get(goalId)!.invoke, obligation);
  assert.equal(f.discoveries(), discoveries);

  // A changed independent witness is refused, even with its own sample grant, and not repinned.
  executable(checker, rebuilt(checkerBody));
  f.calls.length = 0;
  const changed = await restarted.run(goalId, { input: workflows[0].caller }, { verify: [{ op: "type", value: "string" }] });
  refused(changed);
  assert.match(`${changed.error} ${changed.witnesses?.[0]?.error}`, /witness program changed/i);
  assert.equal(f.calls.length, 0, "a changed independent witness blocks even producer samples");
  const after = await f.state(restarted);
  assert.deepEqual(after.cliConformance?.find(p => p.capability === witnessId), before.cliConformance?.find(p => p.capability === witnessId));
  assert.deepEqual(restarted.graph.get(goalId)!.invoke, obligation);

  // Restored witness: fresh predicates never replace the stored independent check.
  executable(checker, checkerBody);
  const failedWitness = await restarted.run(goalId, { input: "beta\nalpha\nbeta\n" }, { verify: [{ op: "type", value: "string" }] });
  assert.equal(failedWitness.status, "failed");
  assert.equal(failedWitness.verification.status, "refuted");
  assert.equal(failedWitness.witnesses?.[0].status, "failed");
  assert.equal(f.discoveries(), discoveries);
});
