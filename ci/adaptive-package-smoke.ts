// Offline pack/install/audit/MCP/uninstall check in a fresh directory and npm cache.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const stage = mkdtempSync(join(tmpdir(), "rcx-stage1-package-"));
const cache = join(stage, "cache");
const npm = (args: string[]) => execFileSync("npm", [...args, "--cache", cache], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const pack = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", stage]))[0];
const install = join(stage, "install");
mkdirSync(install);
writeFileSync(join(install, "package.json"), '{"private":true}\n');
npm(["install", "--prefix", install, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(stage, pack.filename)]);
const cli = join(install, "node_modules/rightclick-x/dist/rcx.mjs");
const env = { PATH: process.env.PATH, RCX_STATE_FILE: join(stage, "state.json"), RCX_EXECUTION_POLICY: '{"allowedRisks":["read"]}' };
const version = execFileSync(process.execPath, [cli, "version"], { env, encoding: "utf8" }).trim();
const audit = JSON.parse(execFileSync(process.execPath, [cli, "audit"], { env, encoding: "utf8" }));
assert.deepEqual(audit.policy, { allowedRisks: ["read"] });
const p = spawnSync(process.execPath, [cli, "mcp"], { env, encoding: "utf8", input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n', timeout: 15000 });
assert.equal(p.status, 0, p.stderr);
const reply = p.stdout.trim().split("\n").map((x) => JSON.parse(x)).find((x) => x.id === 1);
assert.equal(reply.result.tools.length, 13);
npm(["uninstall", "--prefix", install, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "rightclick-x"]);
assert.equal(existsSync(join(install, "node_modules/rightclick-x")), false);
const result = { stage, version, packageBytes: pack.size, unpackedBytes: pack.unpackedSize,
  tools: reply.result.tools.map((t: any) => t.name), auditCounts: audit.counts, policy: audit.policy, uninstall: "PASS",
  limitations: ["Clean package directory under the current user; not an independent developer usability test.", "No live AI model was invoked."] };
console.log(JSON.stringify(result, null, 2));
