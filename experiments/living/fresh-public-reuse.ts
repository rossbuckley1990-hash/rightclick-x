// Four fresh included-subscription sessions. No retry/resume or API fallback.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { codexSession } from "../north-star/codex-session.ts";

const [configFile, destination] = process.argv.slice(2);
if (!configFile || !destination) throw new Error("usage: fresh-public-reuse.ts CONFIG NEW_OUTPUT_DIRECTORY");
const root = process.cwd(), out = resolve(destination), configPath = resolve(configFile);
const configRaw = readFileSync(configPath), config = JSON.parse(configRaw.toString());
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const state = readFileSync(resolve(config.retained));
if (hash(state) !== config.retainedSha256) throw new Error("retained acquisition state changed");
const paths = ["src", "bin", "experiments/living/public-read-transport.ts", "experiments/living/public-reuse-host.ts",
  "experiments/living/fresh-public-reuse.ts", "experiments/living/fresh-public-reuse.json",
  "experiments/living/check-fresh-public-reuse.py", "experiments/living/test-fresh-public-checker.py", "docs/adaptive/FRESH-PUBLIC-REUSE-PLAN.md",
  "package.json", "package-lock.json", "tsconfig.json", "test/public-read-transport.test.ts",
  "experiments/north-star/codex-session.ts", "experiments/north-star/codex-preflight.py", "experiments/north-star/common.ts", "experiments/north-star/quota.ts"];
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const names = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", ...paths], { encoding: "utf8" }).trim().split("\n");
const sources = Object.fromEntries(names.map(name => {
  const bytes = readFileSync(name), frozen = execFileSync("git", ["show", `${revision}:${name}`]);
  if (hash(bytes) !== hash(frozen)) throw new Error(`unfrozen source: ${name}`);
  return [name, hash(bytes)];
}));
for (const path of paths.filter(p => p.includes("."))) if (!sources[path]) throw new Error(`uncommitted evaluation source: ${path}`);
mkdirSync(out);
const save = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n");
save("provenance.json", { revision, sources, config, configSha256: hash(configRaw), retainedSha256: hash(state),
  scope: "same-author public development reuse, two models from one vendor; no cold-acquisition or economic comparison" });
const results: unknown[] = [];
for (const task of config.sessions) {
  if (!/^[a-z0-9-]+$/.test(task.id) || !/^[A-Z0-9]{4}$/.test(task.entryId) || !["allowed", "denied"].includes(task.mode)) throw new Error("invalid session");
  const directory = join(out, task.id); mkdirSync(directory);
  execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(directory, "preflight")], { stdio: "pipe" });
  const preflight = JSON.parse(readFileSync(join(directory, "preflight/preflight.json"), "utf8"));
  const allowance = preflight.responses?.["account/rateLimits/read"], bucket = allowance?.rateLimitsByLimitId?.codex;
  if (preflight.responses?.["account/read"]?.type !== "chatgpt" || allowance?.ordinaryUsageAllowed !== true ||
      !["plus", "pro", "prolite"].includes(bucket?.planType) || bucket?.credits?.hasCredits !== false ||
      bucket?.credits?.unlimited !== false || bucket?.credits?.balance !== "0" || !(bucket?.primary?.usedPercent < 90) ||
      !preflight.responses?.["model/list"]?.some((m: any) => m.model === task.model)) throw new Error("no-spend/model preflight not established");
  copyFileSync(resolve(config.retained), join(directory, "state.json"));
  const prompt = `Use only the connected RightClick X context_* tools. The runtime holds a previously established capability; find and reuse it without repeating discovery or constructing a replacement.
Task: obtain the PRIMARY RESEARCH PUBLICATION for structure ${task.entryId}: its DOI, exact publication title (as a JSON array), and publisher.
Use actual tool execution; do not answer from memory or infer a publication from the structure identifier. Check that the returned publication is the requested primary research paper, not the structure dataset.
The operator permits read-only access to the two configured public services when the current execution policy allows it. A stored capability never overrides current policy.
Return a JSON object with exactly entry_id, doi, title and publisher between lines BEGIN and END. If the capability cannot execute, the identifier is unavailable, permission is denied or the required result cannot be established, return UNABLE: followed by the reason. Do not change policy or use another route.`;
  writeFileSync(join(directory, "prompt.txt"), prompt);
  const session = await codexSession({ prompt, model: task.model, allowed: "rightclick-x", evidenceDir: directory, timeoutMs: 600_000,
    servers: { "rightclick-x": { command: process.execPath,
      args: [join(root, "experiments/living/public-reuse-host.ts"), configPath, directory, join(directory, "state.json"), task.mode],
      startup_timeout_sec: 40, tool_timeout_sec: 90 } } });
  results.push({ task, ...session }); save("sessions.json", results);
  console.log(JSON.stringify({ id: task.id, seconds: session.seconds, tokens: session.tokens, blocked: session.blocked ?? null }));
  if (session.blocked || session.timedOut || session.exit !== 0) throw new Error("stopped after invalid session; preserve evidence, no automatic retry");
}
execFileSync("python3", [resolve("experiments/north-star/codex-preflight.py"), join(out, "postflight")], { stdio: "pipe" });
