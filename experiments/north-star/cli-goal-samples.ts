// Exposed json_xs development replay. Fresh processes, native sandbox, no models/network.
// This fixture is not application-specific integration code in the product.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Capability } from "../../src/core/types.ts";
import type { Sandbox } from "../../src/core/sandbox.ts";

const self = fileURLToPath(import.meta.url);
const repo = resolve(dirname(self), "../..");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
const identity = (path: string) => existsSync(path) ? { real: realpathSync(path), sha256: hash(readFileSync(path)) } : null;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

if (process.argv[2] === "--worker") {
  const cfg = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const { RightClick } = await import(pathToFileURL(`${cfg.root}/src/runtime.ts`).href);
  const { FileStore } = await import(pathToFileURL(`${cfg.root}/src/entry/node-host.ts`).href);
  const { hostSandbox } = await import(pathToFileURL(`${cfg.root}/src/core/sandbox.ts`).href);
  const base: Sandbox | null = await hostSandbox();
  if (!base) throw new Error("native sandbox unavailable");
  const wires: unknown[] = [], investigations: string[] = [], network: string[] = [];
  const sb: Sandbox = { ...base, async run(program, args, opts = {}) {
    const before = identity(program);
    const result = await base.run(program, args, opts);
    wires.push({ program, args, opts, before, after: identity(program), result });
    return result;
  } };
  const authority = {
    investigate: cfg.denied === "investigation" ? [] : [cfg.program],
    execute: cfg.denied === "execution" ? [] : [cfg.program],
  };
  const start = performance.now();
  const rc = await RightClick.create({ directories: [], store: new FileStore(cfg.state), authority,
    sandbox: sb, network: { blockPrivate: true, origins: [] },
    fetch: async (url: unknown) => { network.push(String(url)); throw new Error("network forbidden in diagnostic"); },
    onInvestigationStart: (program: string) => investigations.push(program),
  });
  const learned = cfg.mode === "seed" || cfg.mode === "return-learn" ? await rc.learn({ source: `cli:${cfg.program}` }) : undefined;
  const cap: Capability | undefined = rc.graph.get("cli:json-xs:stdout");
  let response: unknown;
  if (cfg.mode === "seed") {
    if (!cap || cap.invoke.kind !== "cli") throw new Error("no retained raw-output capability");
    response = await rc.compose({ have: { [cap.invoke.stdin!]: { type: "json", value: cfg.input } }, want: "text", through: [cap.id],
      origins: [], run: true, crystallize: false, publish: "repair pretty json", verify: [{ op: "matches", pattern: "\\n {2,}" }] });
  } else if (cfg.route === "goal") {
    const port = Object.keys(rc.published.get("repair-pretty-json").have)[0];
    response = await rc.run("goal:repair-pretty-json", { [port]: cfg.input });
  } else {
    // Port belongs to the retained contract, not to special product code.
    const port = cap?.invoke.kind === "cli" ? cap.invoke.stdin : cfg.port;
    response = await rc.run("cli:json-xs:stdout", { [port]: cfg.input }, { verify: [{ op: "matches", pattern: "\\n {2,}" }] });
  }
  const operationMs = performance.now() - start;
  await rc.flush();
  save(cfg.result, { pid: process.pid, sandbox: base.kind, cfg, authority, learned, cap,
    response, operationMs, investigations, wires, network,
    finalCapabilities: rc.graph.list().filter((c: Capability) => c.provider === "cli:json-xs").map((c: Capability) => c.id),
    stateSha256: hash(readFileSync(cfg.state)),
  });
} else {
  const [rootArg, revision, outArg, previousArg] = process.argv.slice(2);
  if (!rootArg || !revision || !outArg) throw new Error("usage: node cli-goal-samples.ts SOURCE_ROOT REVISION NEW_OUTPUT_DIR");
  const root = realpathSync(rootArg), out = resolve(outArg);
  mkdirSync(out); // Never overwrite an earlier attempt.
  const commit = git("rev-parse", `${revision}^{commit}`);
  const sourceHashes: Record<string, string> = {};
  for (const name of git("ls-tree", "-r", "--name-only", commit, "src").split("\n").filter(Boolean)) {
    const actual = hash(readFileSync(`${root}/${name}`));
    const frozen = hash(execFileSync("git", ["show", `${commit}:${name}`], { cwd: repo }));
    if (actual !== frozen) throw new Error(`unfrozen source: ${name}`);
    sourceHashes[name] = actual;
  }
  const harnessCommit = git("rev-parse", "HEAD");
  const harnessHashes = Object.fromEntries(["experiments/north-star/cli-goal-samples.ts", "experiments/north-star/check-cli-goal-samples.py"].map(name => {
    const actual = hash(readFileSync(`${repo}/${name}`));
    if (actual !== hash(execFileSync("git", ["show", `${harnessCommit}:${name}`], { cwd: repo }))) throw new Error(`unfrozen harness: ${name}`);
    return [name, actual];
  }));
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-json-repair-`));
  const program = `${dir}/json_xs`;
  const original = "/usr/bin/json_xs";
  symlinkSync(original, program);
  const compatible = `#!/bin/sh\nexec /usr/bin/json_xs "$@"\n`;
  const incompatible = `#!/bin/sh\n/usr/bin/json_xs "$@" | /usr/bin/rev\n`;
  const previous = previousArg ? resolve(previousArg) : undefined;
  const prior = previous ? JSON.parse(readFileSync(`${previous}/manifest.json`, "utf8")) : undefined;
  save(`${out}/manifest.json`, { schema: 1, classification: "exposed deterministic development replay; no model, holdout or independent-author claim",
    commit, sourceHashes, harnessCommit, harnessHashes, node: process.version, platform: process.platform,
    original: { path: original, ...identity(original) }, program, compatible, incompatible,
    ...(previous ? { migration: { previous, commit: prior.commit, program: prior.program, stateSha256: hash(readFileSync(`${previous}/seed.state.json`)) } } : {}),
    network: { blockPrivate: true, origins: [] },
  });
  const cases: Array<{ name: string; result: string; childMs: number }> = [];
  const invoke = (name: string, cfg: Record<string, unknown>, stateSource?: string, target = program) => {
    const state = `${out}/${name}.state.json`, result = `${out}/${name}.result.json`;
    if (stateSource) copyFileSync(stateSource, state);
    const path = `${out}/${name}.config.json`;
    save(path, { ...cfg, root, program: target, state, result, ...(stateSource ? { inputStateSha256: hash(readFileSync(stateSource)) } : {}) });
    const start = performance.now();
    try {
      const stdout = execFileSync(process.execPath, [self, "--worker", path], { cwd: root, timeout: 60_000, encoding: "utf8" });
      writeFileSync(`${out}/${name}.stdout`, stdout, { flag: "wx" });
    } catch (error) {
      const e = error as any;
      writeFileSync(`${out}/${name}.stderr`, String(e.stderr ?? e), { flag: "wx" });
      throw error;
    }
    cases.push({ name, result: `${name}.result.json`, childMs: performance.now() - start });
    writeFileSync(`${out}/cases.json`, JSON.stringify(cases, null, 2) + "\n");
    return state;
  };
  const seed = invoke("seed", { mode: "seed", input: '["seed",1,true]' });
  const seedReport = JSON.parse(readFileSync(`${out}/seed.result.json`, "utf8"));
  if (seedReport.response.executed?.status !== "completed") {
    save(`${out}/outcome.json`, { status: "blocked", phase: "seed-publication", cases: cases.length });
    console.log(JSON.stringify({ commit, status: "blocked", phase: "seed-publication", out }));
    process.exit(0);
  }
  for (const route of ["direct", "goal"]) invoke(`warm-${route}`, { route, input: '["warm",2,null]' }, seed);
  unlinkSync(program); writeFileSync(program, compatible, { mode: 0o755, flag: "wx" });
  for (const route of ["direct", "goal"]) {
    const repaired = invoke(`compatible-${route}`, { route, input: '["compatible",3,false]' }, seed);
    invoke(`reused-${route}`, { route, input: '["reused",4,true]' }, repaired);
  }
  for (const denied of ["investigation", "execution"]) for (const route of ["direct", "goal"]) {
    invoke(`revoked-${denied}-${route}`, { route, denied, input: '["revoked",5]' }, seed);
  }
  unlinkSync(program); writeFileSync(program, incompatible, { mode: 0o755, flag: "wx" });
  for (const route of ["direct", "goal"]) invoke(`incompatible-${route}`, { route, input: '["incompatible",6]' }, seed);
  unlinkSync(program);
  const removedStates: Record<string, string> = {};
  for (const route of ["direct", "goal"]) removedStates[route] = invoke(`removed-${route}`, { route, input: '["removed",7]' }, seed);
  writeFileSync(program, compatible, { mode: 0o755, flag: "wx" });
  invoke("returned-without-learn", { route: "goal", input: '["returned",8]' }, removedStates.goal);
  invoke("returned-after-learn", { mode: "return-learn", route: "goal", input: '["returned",9]' }, removedStates.goal);
  if (previous) {
    const migrated = invoke("upgrade", { route: "direct", input: '["upgrade",10]' }, `${previous}/seed.state.json`, prior.program);
    invoke("upgraded-reuse", { route: "direct", input: '["upgraded-reuse",11]' }, migrated, prior.program);
  }
  save(`${out}/outcome.json`, { status: "executed", cases: cases.length });
  console.log(JSON.stringify({ commit, cases: cases.length, out }));
}
