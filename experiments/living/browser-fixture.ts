// Development UI fixture, NOT the public-provider Living Capability Challenge.
// All provider traffic uses the existing in-memory demo router; no real account.
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, learnAll, MemoryStore } from '../../test/helpers.ts';
import { serve } from '../../src/entry/node-host.ts';
import { createHandler } from '../../src/interface/http.ts';
const out = process.argv[2];
if (!out) throw new Error('usage: node experiments/living/browser-fixture.ts NEW_EVIDENCE_DIRECTORY');
mkdirSync(out, { recursive: true });
const store = new MemoryStore();
let rc = (await world({}, { store, name: 'Development fixtures · not a holdout' })).rc;
await learnAll(rc);
let handler = createHandler(rc, { open: true }), fault = false;
const server = await serve(req => fault ? Promise.resolve(new Response('fixture outage', { status: 503 })) : handler(req), 0);
process.stdout.write(JSON.stringify({ url: server.url, pid: process.pid })+'\n');
const lines = createInterface({ input: process.stdin });
for await (const command of lines) {
  if (command === 'restart') { await rc.flush(); rc = (await world({}, { store, name: 'Development fixtures · restarted' })).rc; handler = createHandler(rc, { open: true }); }
  if (command === 'withdraw') { const p = [...rc.graph.providers.values()].find(p => p.id.includes('skycast')); if (!p) throw new Error('skycast fixture missing'); rc.graph.forget(p.id); await rc.flush(); }
  if (command === 'fault') fault = true;
  if (command === 'recover') fault = false;
  if (command === 'hostile-label') {
    const cap = structuredClone(rc.graph.get('builtin:html.text')!);
    cap.id = 'fixture:hostile'; cap.provider = 'fixture:labels'; cap.title = '\"><img src=x onerror="document.title=\'INJECTED\'">';
    rc.graph.add({ provider: { id: cap.provider, title: cap.title, source: 'builtin', origin: 'fixture', learnedAt: new Date().toISOString(), capabilityIds: [cap.id] }, capabilities: [cap] });
  }
  if (command === 'save' || command === 'stop') { await rc.flush(); writeFileSync(join(out, 'runtime-activity.json'), JSON.stringify(rc.activity.snapshot(), null, 2)); writeFileSync(join(out, 'runtime-state.json'), JSON.stringify(store.state, null, 2)); }
  process.stdout.write(JSON.stringify({ command, entries: rc.activity.read().cursor })+'\n');
  if (command === 'stop') { await server.close(); lines.close(); break; }
}
