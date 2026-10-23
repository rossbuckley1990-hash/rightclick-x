// Exposed launch-cost diagnostic, not agent economics. Sequential harmless calls.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output] = process.argv.slice(2);
if (!root || !output || existsSync(output)) throw new Error('usage: measure-invocation.ts SOURCE_ROOT NEW_OUTPUT');
const source = resolve(root, 'src/core/sandbox.ts');
const { hostSandbox } = await import(pathToFileURL(source).href);
const start = performance.now();
const sandbox = await hostSandbox();
const availabilityMs = performance.now() - start;
if (!sandbox) throw new Error('sandbox unavailable');
const rows = [];
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  const result = await sandbox.run('/bin/echo', ['bounded-launch-cost']);
  rows.push({ index: i, elapsedMs: performance.now() - start, result });
  writeFileSync(output, JSON.stringify({ scope: 'exposed echo invocation overhead; no model or commercial claim', sourceSHA256: createHash('sha256').update(readFileSync(source)).digest('hex'), node: process.version, availabilityMs, rows }, null, 2) + '\n');
  if (result.code !== 0 || result.limit || result.stdout !== 'bounded-launch-cost\n') throw new Error('invocation failed; preserved partial result');
}
