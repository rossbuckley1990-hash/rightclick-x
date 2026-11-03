import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
/** Hash actual source bytes, including untracked implementation files. Generated
 * benchmark outputs are evidence, not source, and cannot overflow a git-diff pipe. */
export async function sourceIdentity(cwd = process.cwd()) {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--",
    "src", "bin", "test", "experiments/reconciliation", "package.json", "package-lock.json", "tsconfig*.json", ".github/workflows"],
    { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim().split("\n").filter(Boolean);
  const files: Record<string, string> = {};
  for (const name of [...new Set(names)].sort()) files[name] = createHash("sha256").update(await readFile(join(cwd, name))).digest("hex");
  return { digest: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files };
}
