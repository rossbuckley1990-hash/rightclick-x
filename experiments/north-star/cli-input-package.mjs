// Exposed developer-path check. No model, holdout, comparative economics or independent-author claim.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const repo = resolve(import.meta.dirname, "../..");
const [rootArg, revision, outArg] = process.argv.slice(2);
if (!outArg) throw new Error("usage: node cli-input-package.mjs SOURCE_ROOT REVISION NEW_OUTPUT_DIR");
const root = realpathSync(rootArg), out = resolve(outArg);
mkdirSync(out); // Preserve earlier attempts.
const git = (...args) => execFileSync("git", args, { cwd: repo });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(`${out}/${name}`, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const commit = git("rev-parse", `${revision}^{commit}`).toString().trim();
const names = git("ls-tree", "-r", "--name-only", commit, "src", "bin", "package.json", "README.md", "LICENSE").toString().trim().split("\n");
function checkSource() {
  return Object.fromEntries(names.map(name => {
    const bytes = readFileSync(`${root}/${name}`);
    assert.deepEqual(bytes, git("show", `${commit}:${name}`), `unfrozen source ${name}`);
    return [name, hash(bytes)];
  }));
}
const harnessCommit = git("rev-parse", "HEAD").toString().trim();
const harness = readFileSync(new URL(import.meta.url));
assert.deepEqual(harness, git("show", `${harnessCommit}:experiments/north-star/cli-input-package.mjs`));
const stage = realpathSync(mkdtempSync(`${tmpdir()}/rcx-input-package-`));
const home = `${stage}/home`, cache = `${stage}/cache`, install = `${stage}/install`;
for (const path of [home, install]) mkdirSync(path);
writeFileSync(`${install}/package.json`, '{"private":true}\n');
const env = { PATH: process.env.PATH, HOME: home, LC_ALL: "C" };
const sourceHashes = checkSource();
save("manifest.json", { commit, harnessCommit, harnessSha256: hash(harness), sourceHashes, node: process.version, platform: process.platform,
  scope: "exposed json_xs and sort installed CLI workflow; no model, holdout or economics claim", authority: "two fixture programs only; no investigation permission after initial operator command" });
let sequence = 0;
function run(label, command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", timeout: 60000, ...options });
  const record = { sequence: ++sequence, label, command, args, input: options.input, status: result.status, signal: result.signal,
    error: result.error?.message, ms: performance.now() - started, stdout: result.stdout, stderr: result.stderr };
  appendFileSync(`${out}/commands.jsonl`, JSON.stringify(record) + "\n");
  assert.equal(result.signal, null, `${label}: ${result.error ?? result.stderr}`);
  return result;
}
function success(label, command, args, options) {
  const result = run(label, command, args, options);
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return result.stdout;
}
const npm = (label, args) => success(label, "npm", [...args, "--cache", cache, "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]);
try {
  success("build", "npm", ["run", "build"]);
  const packed = JSON.parse(npm("pack", ["pack", "--json", "--pack-destination", out]))[0];
  npm("install", ["install", "--prefix", install, `${out}/${packed.filename}`]);
  const cli = `${install}/node_modules/rightclick-x/dist/rcx.mjs`;
  const program = `${stage}/json_xs`;
  symlinkSync("/usr/bin/json_xs", program);
  const sorter = `${stage}/sort`;
  symlinkSync("/usr/bin/sort", sorter);
  const state = `${stage}/state.json`;
  const baseEnv = { ...env, RCX_STATE_FILE: state, RCX_WORKSPACE: stage, RCX_EXECUTE: `${program},${sorter}`,
    RCX_EXECUTION_POLICY: JSON.stringify({ allowedRisks: ["read"], allowedOrigins: [] }) };
  save("program.json", [{ original: "/usr/bin/json_xs", sha256: hash(readFileSync("/usr/bin/json_xs")), alias: program },
    { original: "/usr/bin/sort", sha256: hash(readFileSync("/usr/bin/sort")), alias: sorter }]);
  const invoke = (label, args, input) => success(label, process.execPath, [cli, ...args], { env: baseEnv, input });
  invoke("investigate", ["investigate", program, sorter]);
  const catalogue = JSON.parse(invoke("catalogue", ["capabilities", "--json"]));
  const explanations = catalogue.map(c => JSON.parse(invoke(`explain:${c.id}`, ["explain", c.id, "--full"])));
  const cap = explanations.map(e => e.capability).find(c => c.invoke.kind === "cli" && c.invoke.bin === program && c.invoke.output === "text" && c.invoke.stdin && c.invoke.options);
  assert.ok(cap, "normally discovered raw-output mode with structured options and files");
  const sortCap = explanations.map(e => e.capability).find(c => c.invoke.kind === "cli" && c.invoke.bin === sorter && c.invoke.output === "text" && c.invoke.filesPort && c.invoke.operandsPort && c.invoke.options);
  assert.ok(sortCap, "normally discovered sort interface accepts options and named file operands");
  save("discovered.json", { catalogue, selected: cap, sort: sortCap });
  const initial = JSON.parse(readFileSync(state, "utf8"));
  save("initial-state.json", initial);
  const docs = [{ label: "first", values: [1, 2], enabled: false }, { label: "fresh", values: [3], exact: "00123" }, { label: "stdin", values: [], nested: { text: "雪\n" } }];
  const controls = ["-f", "json", "-t", "json-pretty"];
  const argumentsFor = doc => ({ [cap.invoke.stdin]: JSON.stringify(doc), [cap.invoke.options.port]: controls });
  const file = `${stage}/arguments.json`;
  writeFileSync(file, JSON.stringify(argumentsFor(docs[0])));
  writeFileSync(`${out}/file-arguments.json`, readFileSync(file), { flag: "wx" });
  const outputs = [
    JSON.parse(invoke("file-input", ["run", cap.id, "--args-file", file])),
    JSON.parse(invoke("inline-fresh-reuse", ["run", cap.id, "--args", JSON.stringify(argumentsFor(docs[1]))])),
    JSON.parse(invoke("stdin-fresh-reuse", ["run", cap.id, "--args-file", "-"], JSON.stringify({ [cap.invoke.stdin]: JSON.stringify(docs[2]), [cap.invoke.options.port]: controls }))),
  ];
  outputs.forEach((result, i) => {
    assert.equal(result.status, "completed", result.error);
    assert.deepEqual(JSON.parse(result.output), docs[i]);
    assert.match(result.output, /\n\s{2,}/);
    assert.equal(result.verification.status, "unverified", "fixture oracle is separate from runtime evidence grade");
  });
  const namedInputs = [
    { files: { "a input.txt": "orange\nbanana\n", "b input.txt": "pear\napple\n" }, expected: "pear\norange\nbanana\napple\n" },
    { files: { "a input.txt": "grape\n", "b input.txt": "cherry\nfig\n" }, expected: "grape\nfig\ncherry\n" },
  ];
  const namedOutputs = namedInputs.map((task, i) => {
    const args = { [sortCap.invoke.filesPort]: task.files, [sortCap.invoke.options.port]: ["-r"], [sortCap.invoke.operandsPort]: ["b input.txt", "a input.txt"] };
    save(`named-arguments-${i}.json`, args);
    const result = JSON.parse(invoke(`named-file-${i}`, ["run", sortCap.id, "--args-file", "-"], JSON.stringify(args)));
    assert.equal(result.status, "completed", result.error);
    assert.equal(result.output, task.expected);
    assert.equal(result.verification.status, "unverified");
    return result;
  });
  const after = JSON.parse(readFileSync(state, "utf8"));
  assert.deepEqual(after.reflections, initial.reflections, "fresh processes reuse the existing reflection");
  save("after-state.json", after);
  const refused = run("operator-refusal", process.execPath, [cli, "run", cap.id, "--args", JSON.stringify(argumentsFor(docs[0]))],
    { env: { ...baseEnv, RCX_EXECUTION_POLICY: '{"allowedRisks":[]}' } });
  assert.notEqual(refused.status, 0);
  assert.equal(JSON.parse(refused.stdout).status, "failed");
  const mcp = JSON.parse(invoke("thirteen-tools", ["mcp"], '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n').trim());
  assert.equal(mcp.result.tools.length, 13);
  npm("uninstall", ["uninstall", "--prefix", install, "rightclick-x"]);
  assert.equal(existsSync(`${install}/node_modules/rightclick-x`), false);
  assert.deepEqual(checkSource(), sourceHashes);
  save("result.json", { verdict: "PASS", correctOutputs: 5, expected: docs, outputs, namedInputs, namedOutputs, retainedReflectionUnchanged: true,
    separateFreshProcesses: true, postDiscoveryInvestigationPermission: false, operatorRefusal: true,
    toolCount: 13, uninstall: true, packageBytes: packed.size, packageSha256: hash(readFileSync(`${out}/${packed.filename}`)),
    limitations: ["Exposed two-program developer check, not an unfamiliar-user trial or economic comparison.", "No independent-author review or universal containment claim.", "The aliases are staged outside the home-directory sandbox exclusion; private installed program paths remain unresolved."] });
} catch (error) {
  save("failure.json", { message: String(error), stack: error.stack });
  throw error;
} finally { rmSync(stage, { recursive: true, force: true }); }
