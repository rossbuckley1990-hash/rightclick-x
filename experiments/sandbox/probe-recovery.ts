// Preload trace-resources.mjs with RCX_RESOURCE_FAULT set. Asks whether a failed availability
// probe is remembered. "again" calls hostSandbox() twice. "runtime" has a runtime that detects the
// host sandbox itself learn one program twice. Nothing but the probes and that confined learn runs.
import { writeFileSync } from 'node:fs';
import { hostSandbox, hostSandboxProbeAttempts } from '../../src/core/sandbox.ts';
import { RightClick } from '../../src/runtime.ts';
const [out, mode] = process.argv.slice(2);
if (mode === 'runtime') {
  const program = '/usr/bin/sort';
  const rc = await RightClick.create({ directories: [], authority: { investigate: [program] } });
  const learn = async () => ({ error: (await rc.learn({ source: `cli:${program}` })).results[0]?.error ?? null, cliCapabilities: rc.graph.list().filter((c) => c.provider.startsWith('cli:')).length });
  const first = await learn();
  const second = await learn();
  writeFileSync(out, JSON.stringify({ first, second }, null, 2) + '\n');
} else {
  const calls = [];
  for (let i = 0; i < 2; i++) {
    const sb = await hostSandbox();
    calls.push({ sandbox: sb?.kind ?? null, attempts: hostSandboxProbeAttempts() });
  }
  writeFileSync(out, JSON.stringify({ calls }, null, 2) + '\n');
}
