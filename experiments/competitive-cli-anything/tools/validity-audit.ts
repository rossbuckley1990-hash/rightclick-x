import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidence = "docs/adaptive/evidence/competitive-cli-anything";
const gitBin = process.env.GIT ?? "/Library/Developer/CommandLineTools/usr/bin/git";
const git = (...args: string[]) => execFileSync(gitBin, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const hash = (path: string) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
const paths = (text: string) => text.split("\0").filter(Boolean);
const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const path = `${dir}/${entry.name}`;
  return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
});
const frozenManifest = readFileSync(join(root, evidence, "trials/SHA256SUMS"), "utf8").trim().split("\n");
const frozenProblems = frozenManifest.flatMap(line => {
  const [, expected, relative] = /^(\w+)\s+(.+)$/.exec(line)!;
  const path = `${evidence}/trials/${relative}`;
  return !existsSync(join(root, path)) || hash(path) !== expected ? [relative] : [];
});
const candidates = [...new Set([
  ...paths(git("diff", "--name-only", "-z", "origin/programme/adaptive-capability-plane")),
  ...paths(git("ls-files", "--others", "--exclude-standard", "-z")),
  ...walk(evidence).filter(path => path.endsWith(".log")),
])].filter(path => existsSync(join(root, path)) && statSync(join(root, path)).isFile());
const sizes = candidates.map(path => ({ path, bytes: statSync(join(root, path)).size })).sort((a, b) => b.bytes - a.bytes);
const trials = ["trials", "validity-frozen", "validity-corrected-first", "validity-final", "validity-reviewed"].flatMap(series =>
  ["C", "D"].flatMap(arm => ["cold", "warm", "r1", "r2", "r3"].flatMap(phase => {
    const path = `${evidence}/${series}/${arm}/${phase}/result.json`;
    if (!existsSync(join(root, path))) return [];
    const result = JSON.parse(readFileSync(join(root, path), "utf8"));
    return [{ series, arm, phase, product: result.environment.product,
      wallMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
      acquisition: (result.learning ?? []).map((r: any) => ({ label: r.label, wallMs: r.wallMs, capabilities: r.totalNewCapabilities })),
      tasks: result.tasks.map((t: any) => ({ task: t.task, status: t.status, wallMs: t.wallMs, note: t.note })) }];
  })));
const objects = git("rev-list", "--objects", "HEAD", "--not", "--remotes=origin").trim();
const objectSizes = objects ? execFileSync(gitBin, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize) %(rest)"],
  { cwd: root, encoding: "utf8", input: objects + "\n", maxBuffer: 32 * 1024 * 1024 }).trim().split("\n").flatMap(line => {
    const match = /^(\w+) blob (\d+) (.*)$/.exec(line);
    return match ? [{ object: match[1], bytes: Number(match[2]), path: match[3] }] : [];
  }) : [];
const scanPath = `${evidence}/validity-reviewed-docs-adaptive-evidence-competitive-cli-anything-gitleaks.json`;
const findings = JSON.parse(readFileSync(join(root, scanPath), "utf8")) as Array<{ File: string; RuleID: string; StartLine: number }>;
const classifications = findings.map(finding => {
  const allowed = ["validity-proof-results.json", "validity-proof-reviewed-results.json"].some(name => finding.File === `${evidence}/${name}`);
  const text = allowed ? readFileSync(join(root, finding.File), "utf8") : "";
  const match = /^\s*"(src\/[^"\n]+\.ts)": "([a-f0-9]{64})",?$/.exec(text.split("\n")[finding.StartLine - 1] ?? "");
  const proof = text ? JSON.parse(text) : {};
  const verified = finding.RuleID === "generic-api-key" && !!match && hash(match[1]) === match[2] &&
    proof.sourceBefore?.files?.[match[1]] === match[2] && proof.sourceAfter?.files?.[match[1]] === match[2];
  return { file: finding.File, line: finding.StartLine, rule: finding.RuleID,
    classification: verified ? "verified source SHA-256, not a credential" : "unresolved",
    ...(verified && match ? { source: match[1], sha256: match[2] } : {}) };
});
const product = ["src/runtime.ts", "src/core/cli-environment.ts", "src/core/cli-outcome.ts", "src/core/cli-continuity.ts",
  "src/core/state-format.ts", "src/core/sandbox.ts", "src/core/types.ts", "src/core/ledger.ts", "src/core/verify.ts", "src/reflectors/cli.ts"];
const result = {
  auditedAt: new Date().toISOString(), branch: git("branch", "--show-current").trim(), head: git("rev-parse", "HEAD").trim(),
  main: git("rev-parse", "origin/main").trim(), adaptive: git("rev-parse", "origin/programme/adaptive-capability-plane").trim(),
  mainBehindAhead: git("rev-list", "--left-right", "--count", "origin/main...HEAD").trim(),
  adaptiveBehindAhead: git("rev-list", "--left-right", "--count", "origin/programme/adaptive-capability-plane...HEAD").trim(),
  mainDiff: git("diff", "--shortstat", "origin/main...HEAD").trim(),
  incrementalDiff: git("diff", "--shortstat", "origin/programme/adaptive-capability-plane").trim(),
  frozenEvidence: { checked: frozenManifest.length, problems: frozenProblems },
  incrementalWorkingFiles: { count: sizes.length, bytes: sizes.reduce((n, r) => n + r.bytes, 0), largest: sizes.slice(0, 10),
    over10MiB: sizes.filter(r => r.bytes > 10 * 1024 * 1024),
    credentialLikeNames: candidates.filter(path => /(?:^|\/)(?:\.env(?:\.|$)|id_rsa|id_ed25519|credentials\.json|[^/]*\.(?:pem|p12|pfx)$)/i.test(path)) },
  unpublishedCommittedBlobs: { count: objectSizes.length, bytes: objectSizes.reduce((n, r) => n + r.bytes, 0),
    over10MiB: objectSizes.filter(r => r.bytes > 10 * 1024 * 1024) },
  product: Object.fromEntries(product.map(path => [path, hash(path)])),
  reviewedStateBytes: Object.fromEntries(["C", "D"].map(arm => [arm, statSync(join(root, evidence, "validity-reviewed/state", `${arm}.json`)).size])),
  credentialScan: { report: scanPath, classifications, unresolved: classifications.filter(f => f.classification === "unresolved").length },
  trials,
};
console.log(JSON.stringify(result, null, 2));
if (frozenProblems.length || result.incrementalWorkingFiles.credentialLikeNames.length || result.incrementalWorkingFiles.over10MiB.length || result.credentialScan.unresolved) process.exitCode = 1;
