import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostSandbox } from "../../../src/core/sandbox.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const exp = `${root}/experiments/competitive-cli-anything`;
const env = `${exp}/env`;
const python = realpathSync(`${env}/venv/bin/python`);
process.env.RCX_SANDBOX_READ = [env, `${exp}/harness`, resolve(python, "../..")].join(":");
process.env.RCX_SANDBOX_PATH = `${env}/bin:${env}/venv/bin`;
process.env.RCX_SANDBOX_NET = "allow";
const port = 18084;
const base = `http://127.0.0.1:${port}`;
try {
  await fetch(`${base}/health`, { signal: AbortSignal.timeout(300) });
  throw new Error("fixture port is already in use");
} catch (error) {
  if (String(error).includes("already in use")) throw error;
}
const api = spawn(process.execPath, [`${env}/api/server.mjs`], {
  env: { ...process.env, API_PORT: String(port), API_VERSION: "2" }, stdio: ["ignore", "pipe", "pipe"],
});
try {
  const ready = await Promise.race([
    once(api.stdout!, "data"),
    once(api, "exit").then(() => { throw new Error("fixture exited before readiness"); }),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("fixture readiness timeout")), 5000); timer.unref(); }),
  ]);
  assert.match(String(ready), /listening/);
  const sandbox = await hostSandbox();
  assert.ok(sandbox, "host sandbox required");
  const args = ["exposure", "--input", `${env}/fixtures/invoices.csv`, "--api-base", base, "--region", "EMEA", "--min-amount", "500"];
  const result = await sandbox.run(`${env}/venv/bin/cli-anything-mlr`, args, { purpose: "execution" });
  const evidence = { scenario: "frozen harness / API v2, raw process result", processExit: result.code,
    stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut, limit: result.limit,
    interpretation: "The frozen harness exits 1, not 0. Frozen declared-subcommand okExit [0,1] masks it. A separate regression covers genuine exit-zero errors." };
  writeFileSync(`${root}/docs/adaptive/evidence/competitive-cli-anything/frozen-process-exit.json`, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(evidence, null, 2));
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).error);
} finally {
  const exited = once(api, "exit");
  api.kill("SIGTERM");
  await exited;
}
