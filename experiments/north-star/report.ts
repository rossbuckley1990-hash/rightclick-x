// Read-only re-scoring: existing reports are never overwritten.
// node experiments/north-star/report.ts benchmark.json [holdout.json]
//   [--domain2 file] [--safety file] [--out new-report.json]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { reportBenchmark } from "./report-core.ts";
const args = process.argv.slice(2);
const option = (key: string) => {
  const i = args.indexOf(`--${key}`);
  if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith("--"))) throw new Error(`missing value for --${key}`);
  return i < 0 ? undefined : args[i + 1];
};
const file = args[0];
if (!file) throw new Error("benchmark file required");
const inputs: Record<string, { path: string; sha256: string }> = {};
const read = (kind: string, path?: string) => {
  if (!path) return undefined;
  const raw = readFileSync(path);
  inputs[kind] = { path: resolve(path), sha256: createHash("sha256").update(raw).digest("hex") };
  return JSON.parse(raw.toString());
};
const bench = read("benchmark", file);
const holdout = read("holdout", args[1] && !args[1].startsWith("--") ? args[1] : undefined);
const domain2 = read("domain2", option("domain2"));
const safety = read("safety", option("safety"));
const report = reportBenchmark(bench, { holdout, domain2, safety, benchmarkSha256: inputs.benchmark.sha256, domain2Sha256: inputs.domain2?.sha256 });
const out = option("out") ?? `${file.replace(/\.json$/, "")}.corrected-report.json`;
if (Object.values(inputs).some((i) => i.path === resolve(out))) throw new Error("output must differ from every input");
const result = JSON.stringify({ ...report, inputs }, null, 2) + "\n";
writeFileSync(out, result, { flag: "wx" });
console.log(result);
