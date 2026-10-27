// Two real, fresh subscription clients and one shared RightClick X state file.
// No capability is seeded by the operator. Run only after confirming that the
// local CLI sandbox works; each model turn is independently preflighted.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { codexSession } from "../north-star/codex-session.ts";
import { includedModelAvailable } from "../living/session-models.ts";
import { decodeState } from "../../src/core/state-format.ts";
import { ReceiptChain } from "../../src/core/ledger.ts";
import { hostSandbox } from "../../src/core/sandbox.ts";
import { receiptBindsRun, sameGoalDefinition } from "./guards.ts";

const [destination, model = "gpt-6.1-sol"] = process.argv.slice(2);
if (!destination) throw new Error("usage: node experiments/inheritance/fresh-agents.ts NEW_OUTPUT_DIR [MODEL]");
const out = resolve(destination);
if (existsSync(out)) throw new Error("output directory must not already exist");
mkdirSync(out, { recursive: true });
const save = (path: string, value: unknown) => writeFileSync(join(out, path), JSON.stringify(value, null, 2) + "\n");
const programs: Record<string, string> = {
  jq: "/opt/homebrew/bin/jq", sha1sum: "/sbin/sha1sum", json_pp: "/usr/bin/json_pp", shasum: "/usr/bin/shasum",
};
const dir = join(out, "bin"); mkdirSync(dir);
for (const [name, path] of Object.entries(programs)) symlinkSync(realpathSync(path), join(dir, name));
const state = join(out, "state.json");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const tracked = execFileSync("git", ["ls-files", "src", "bin", "experiments/north-star/codex-session.ts", "experiments/north-star/codex-preflight.py", "experiments/north-star/common.ts", "experiments/north-star/quota.ts", "experiments/living/session-models.ts", "package.json", "package-lock.json"], { encoding: "utf8" }).trim().split("\n");
const sourceFiles = [...new Set([...tracked, "experiments/inheritance/fresh-agents.ts", "experiments/inheritance/local-host.ts", "experiments/inheritance/guards.ts"])];
const hashes = () => Object.fromEntries([...sourceFiles, ...Object.values(programs)].map(path => [path, hash(readFileSync(path))]));
const baselineHashes = hashes();
save("provenance.json", { gitRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), files: baselineHashes,
  node: process.version, caveat: "hashes do not cover interpreter libraries, operating system, or model service" });
const sandbox = await hostSandbox();
if (!sandbox || sandbox.policy.network || sandbox.policy.writeRoots.length || sandbox.policy.readRoots.length)
  throw new Error("no working, un-widened, network-denied CLI sandbox: refusing model calls");
const manifests = [
  { name: "registry-api", build: 103, version: "1.2.0", artifacts: [{ os: "linux", sha: "003f" }] },
  { version: "2.5.7", artifacts: [{ sha: "00ae", os: "darwin" }, { sha: "01bf", os: "linux" }], name: "mail-router", build: 281 },
];
function oracle(m: object) {
  const input = JSON.stringify(m);
  const calc = (canonicalizer: string, args: string[], digest: string) => {
    const canonical = execFileSync(programs[canonicalizer], args, { input });
    return execFileSync(programs[digest], [], { input: canonical, encoding: "utf8" }).trim();
  };
  const first = calc("jq", ["-S", "-c", "-j", "."], "sha1sum");
  const second = calc("json_pp", ["-json_opt", "canonical"], "shasum");
  if (first !== second || !/^[0-9a-f]{40}  -$/.test(first)) throw new Error("independent oracle implementations disagree");
  return first;
}
const truth = manifests.map(oracle);
const paths = Object.keys(programs).map(name => join(dir, name));
const prompt = (m: object, creator: boolean) => `Use only the connected RightClick X context_* tools. The operator has authorised these local programs: ${paths.join(", ")}.
A release manifest needs its fingerprint: the SHA-1 of its canonical JSON (object keys sorted, no insignificant whitespace, and no trailing newline), printed as a sha1sum standard-input line. Confirm the complete calculation with a second independent implementation.
${creator ? "Discover the authorised tools, execute the calculation, and save a parameterised reusable capability with a stored independent agreement witness covering the complete calculation, for another agent to use on a new manifest. Do not save the current answer as the capability." : "Find and run the capability already saved by another agent. Use its stored verification; do not rediscover programs or construct a replacement."}
Manifest: ${JSON.stringify(m)}
Return only the fingerprint between lines BEGIN and END. If the task cannot be completed and verified, respond UNABLE: followed by the reason.`;
const readAudit = (path: string) => existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).map(row => ({
  tool: row.request?.params?.name, args: row.request?.params?.arguments ?? {}, result: row.response?.result?.structuredContent,
  error: row.response?.error ?? (row.response?.result?.isError ? row.response.result.content : undefined),
})) : [];
const answer = (reply: string) => /^BEGIN\s*$\n([\s\S]*?)^END\s*$/m.exec(reply)?.[1].trim();
save("inputs.json", { manifests, expected: truth, programs, model, scope: "same-machine development fixture; two fresh sessions; no independent-author review" });
for (let i = 0; i < 2; i++) {
  const name = i ? "reuser" : "creator", sessionDir = join(out, name); mkdirSync(sessionDir);
  execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(sessionDir, "preflight")], { stdio: "pipe" });
  const preflight = JSON.parse(readFileSync(join(sessionDir, "preflight/preflight.json"), "utf8"));
  if (!includedModelAvailable(preflight, model)) throw new Error(`${name}: included-subscription allowance/model preflight failed; no model call made`);
  const auditFile = join(sessionDir, "mcp-audit.jsonl");
  const sessionPrompt = prompt(manifests[i], !i);
  writeFileSync(join(sessionDir, "prompt.txt"), sessionPrompt);
  const session = await codexSession({ prompt: sessionPrompt, model, allowed: "mcp__rightclick-x", evidenceDir: sessionDir, timeoutMs: 300_000,
    servers: { "rightclick-x": { command: process.execPath, args: [resolve("experiments/inheritance/local-host.ts"), state, sessionDir, auditFile, name, ...paths], startup_timeout_sec: 40, tool_timeout_sec: 90 } } });
  save(`${name}/result.json`, session);
  if (session.blocked || session.timedOut || session.exit !== 0 || !existsSync(state)) throw new Error(`${name} session failed; retained evidence is not a pass`);
  copyFileSync(state, join(sessionDir, "state.json"));
  const calls = readAudit(auditFile);
  const snapshot = decodeState(JSON.parse(readFileSync(state, "utf8")));
  if (!isDeepStrictEqual(hashes(), baselineHashes)) throw new Error("source or authorised program changed during session");
  if (await ReceiptChain.verify(snapshot.receipts) !== null) throw new Error("persisted receipt chain is invalid");
  save(`${name}/observation.json`, { answer: answer(session.reply), expected: truth[i], correct: answer(session.reply) === truth[i], calls,
    goals: snapshot.published ?? [] });
  if (answer(session.reply) !== truth[i]) throw new Error(`${name} returned a wrong or missing answer; retained evidence is not a pass`);
  if (!i) {
    const goals = (snapshot.published ?? []).filter(g => g.trust === "verified" && g.have?.json &&
      g.witnesses?.some(w => w.agree && Object.values(w.args ?? {}).some(v => (v as any)?.input === "json")));
    if (goals.length !== 1) throw new Error("creator did not save exactly one verified goal with an agreement witness bound to the manifest input");
    if (!calls.some(c => c.tool === "context_compose" && c.args?.publish && c.result?.published?.id === `goal:${goals[0].slug}` &&
      c.result?.executed?.verification?.status === "verified" && String(c.result?.executed?.output ?? "").trim() === truth[i]))
      throw new Error("creator did not publish a verified goal in its actual session");
    save("created-goal.json", goals[0]);
  } else {
    const goal = JSON.parse(readFileSync(join(out, "created-goal.json"), "utf8"));
    const creatorAudit = JSON.parse(readFileSync(join(out, "creator/agent-audit.json"), "utf8"));
    const reuserAudit = JSON.parse(readFileSync(join(out, "reuser/agent-audit.json"), "utf8"));
    if (!creatorAudit.threadId || !reuserAudit.threadId || creatorAudit.threadId === reuserAudit.threadId)
      throw new Error("fresh agent identities were not established");
    const current = snapshot.published?.find(g => g.slug === goal.slug);
    if (!sameGoalDefinition(goal, current)) throw new Error("saved goal definition changed during reuse");
    const used = calls.filter(c => c.tool === "context_run" && c.args?.id === `goal:${goal.slug}` &&
      isDeepStrictEqual(c.args?.args?.json, manifests[i]) && c.result?.status === "completed" && c.result?.verification?.status === "verified" &&
      String(c.result?.output ?? "").trim() === truth[i]);
    if (!used.length || calls.some(c => ["context_learn", "context_research", "context_compose", "context_forget"].includes(c.tool)))
      throw new Error("reuser did not execute the same verified goal on the new manifest without rediscovery or replacement");
    const observed = used[used.length - 1];
    const receipt = snapshot.receipts.find(r => r.runId === observed.result.runId);
    if (!receiptBindsRun(receipt, `goal:${goal.slug}`, observed.args.args, observed.result))
      throw new Error("verified run output was not bound to its persisted receipt");
  }
}
// A verified witness alone does not establish that both retained pipelines cover
// canonicalisation; inspect the retained goal and referenced pipeline manually.
save("result.json", { status: "REVIEW_REQUIRED", reason: "Inspect created-goal.json and the witness pipeline in creator/state.json to establish full independent canonicalisation, plus agent and runtime traces. A verified label by itself is insufficient.", scope: "No process-kill recovery or independent-author review is claimed." });
console.log("Two sessions completed; manual inspection of retained pipelines is required before claiming full inheritance.");
