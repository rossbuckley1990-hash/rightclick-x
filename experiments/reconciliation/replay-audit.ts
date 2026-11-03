// Executes the external suites unchanged. Never calls their master runner,
// which overwrites its original report, or their finance suite's unbounded CLI.
import { pathToFileURL } from "node:url";
const [audit] = process.argv.slice(2);
if (!audit) throw new Error("usage: node replay-audit.ts /path/to/unchanged/audit");
const suites = [["a-semantic", "runSemanticSuite"], ["b-consequential", "runConsequentialSuite"],
  ["c-recovery", "runRecoverySuite"], ["d-fallback", "runFallbackSuite"], ["e-durable", "runDurableSuite"]];
for (const [file, method] of suites) {
  const module = await import(pathToFileURL(`${audit}/suite-${file}.ts`).href);
  if (typeof module[method] !== "function") throw new Error(`missing suite ${method}`);
  console.log(JSON.stringify({ suite: file, results: await module[method]() }));
}
