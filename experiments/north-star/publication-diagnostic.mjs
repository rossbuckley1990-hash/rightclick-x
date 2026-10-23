// Development diagnostic only: deterministic in-memory demo, no model/economics claim.
import { Session } from 'node:inspector/promises';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [source, out, countArg = '25', mode = 'default'] = process.argv.slice(2);
const { world, learnAll } = await import(pathToFileURL(resolve(source, 'test/helpers.ts')));
const { rc } = await world();
await learnAll(rc);
const compose = rc.compose.bind(rc), run = rc.run.bind(rc);
let compositions = 0, runs = 0, maxActive = 0;
rc.compose = async opts => {
  compositions++;
  if ((opts.activeGoals?.length ?? 0) > maxActive) {
    maxActive = opts.activeGoals.length;
    console.log(JSON.stringify({ event: 'depth', maxActive, compositions, runs }));
  }
  return compose(opts);
};
rc.run = async (...args) => { runs++; return run(...args); };
const profiler = new Session();
profiler.connect();
await profiler.post('Profiler.enable');
await profiler.post('Profiler.start');
for (let i = 0; i < Number(countArg); i++) {
  console.log(JSON.stringify({ event: 'start', index: i, capabilities: rc.graph.list().length }));
  const t0 = performance.now(), c0 = compositions, r0 = runs;
  const result = await rc.compose({ have: { place: 'Lima', language: 'es' }, want: 'text', intent: 'weather translated', run: true, publish: `weather-${i}`, ...(mode === 'no-crystallize' ? { crystallize: false } : {}) });
  console.log(JSON.stringify({ event: 'end', index: i, ms: performance.now() - t0, compositions: compositions - c0, runs: runs - r0, maxActive, published: result.published, executed: result.executed }));
  // Each completed prefix has a profile even if the next publication is stopped.
  const { profile } = await profiler.post('Profiler.stop');
  writeFileSync(resolve(out, `prefix-${i + 1}.cpuprofile`), JSON.stringify(profile), { flag: 'wx' });
  await profiler.post('Profiler.start');
}
await profiler.post('Profiler.stop');
profiler.disconnect();
