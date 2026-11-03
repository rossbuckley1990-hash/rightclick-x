// Observational wrapper around the frozen API. Original suites/assertions are untouched.
// This is an engineering diagnostic, not independent evaluation.
import { pathToFileURL } from "node:url";
const [candidate, audit] = process.argv.slice(2);
const { RecoveringWorkflow } = await import(pathToFileURL(`${candidate}/src/recovery.ts`).href);
const execute = RecoveringWorkflow.prototype.execute;
RecoveringWorkflow.prototype.execute = async function (inputs: unknown) {
  const result = await execute.call(this, inputs);
  console.log(JSON.stringify({ diagnostic: "recovery-route", route: result.route, status: result.status,
    fallbackCalls: result.measurements.fallbackCalls, reason: result.reason }));
  return result;
};
const { runFallbackSuite } = await import(pathToFileURL(`${audit}/suite-d-fallback.ts`).href);
console.log(JSON.stringify({ results: await runFallbackSuite() }));
