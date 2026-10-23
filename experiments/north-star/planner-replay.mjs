// Frozen development workload. Exact plan comparison, not a coding-agent benchmark.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [rootArg, revision, out, mode = 'plans'] = process.argv.slice(2);
const root = realpathSync(rootArg);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo });
const commit = git(['rev-parse', `${revision}^{commit}`]).toString().trim();
const sourceHashes = {};
for (const name of git(['ls-tree', '-r', '--name-only', commit, 'src', 'test/helpers.ts', 'demo/services.ts']).toString().trim().split('\n')) {
  const bytes = readFileSync(resolve(root, name));
  if (sha(bytes) !== sha(git(['show', `${commit}:${name}`]))) throw Error(`source mismatch: ${name}`);
  sourceHashes[name] = sha(bytes);
}
const harnessPath = 'experiments/north-star/planner-replay.mjs';
const harnessRevision = git(['rev-parse', 'HEAD']).toString().trim();
const harnessSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
if (harnessSha256 !== sha(git(['show', `${harnessRevision}:${harnessPath}`]))) throw Error('unfrozen harness');
mkdirSync(out, { recursive: false });
const save = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
save('manifest.json', { commit, harnessRevision, harnessPath, harnessSha256, sourceHashes, mode, node: process.version, platform: process.platform, arch: process.arch, startedAt: new Date().toISOString(), scope: 'exposed development fixtures; no model or comparative economic claim' });
const load = async name => import(pathToFileURL(resolve(root, name)));
const started = performance.now();
if (mode === 'plans') {
  const { CapabilityGraph } = await load('src/core/graph.ts');
  const { Ledger } = await load('src/core/ledger.ts');
  const { plan } = await load('src/core/planner.ts');
  let state = 20261018;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  const types = ['text', 'json', 'url', 'html', 'number', 'language', 'id.item', 'list:id.item', 'id.other'];
  const names = ['text', 'content', 'summary', 'item', 'url', 'body', 'name', 'metric', 'target'];
  const port = (name, type, required = true, more = {}) => ({ name, type, required, ...more });
  const rows = [];
  for (let seed = 0; seed < 64; seed++) {
    const graph = new CapabilityGraph(), ledger = new Ledger();
    const cap = (id, inputs, outputs, risk = 'read', tags = []) => ({ id, title: `summarize translate ${id}`, description: '', provider: 'fixture', source: 'openapi', inputs, outputs, risk, tags, invoke: { kind: 'http', url: `https://fixture.test/${id}`, method: 'POST' } });
    const caps = [
      cap('fetch', [port('url', 'url')], [port('body', 'html')]),
      cap('extract', [port('body', 'html')], [port('content', 'text')]),
      cap('translate', [port('text', 'text'), port('target', 'language')], [port('summary', 'text')]),
      cap('list', [port('url', 'url')], [port('items', 'list:id.item')]),
      cap('item', [port('item', 'id.item')], [port('summary', 'text')]),
    ];
    for (let i = 0; i < 12 + seed % 12; i++) {
      const inputs = Array.from({ length: 1 + random(2) }, (_, p) => port(names[random(names.length)] + (p || ''), types[random(types.length)], random(5) !== 0, random(8) === 0 ? { enum: ['one', 'two'] } : {}));
      caps.push(cap(`c${i}`, inputs, [port(names[random(names.length)], types[random(types.length)])], ['read', 'read', 'write', 'destructive'][random(4)], [['unsupported'], ['direct-only'], []][random(3)]));
    }
    graph.add({ provider: { id: 'fixture', title: 'Seeded development graph', source: 'openapi', origin: 'https://fixture.test', learnedAt: '', capabilityIds: [] }, capabilities: caps });
    for (const c of caps) for (let i = 0; i < seed % 4; i++) ledger.record(c.id, random(5) !== 0, random(1000));
    const queries = [
      { have: { url: 'url', target: 'language' }, want: 'text', intent: 'summarize translate', maxSteps: 4, limit: 10 },
      { have: { items: 'list:id.item', metric: 'text' }, want: 'text', risks: ['read'], maxSteps: 4, require: ['summary'] },
      { have: { url: 'url', target: 'language' }, want: 'text', through: ['fetch', 'extract'], exclude: new Set(['translate']), origins: ['https://fixture.test'], limit: 8 },
      { have: { item: 'id.other', text: 'text', target: 'language' }, want: seed % 2 ? 'json' : 'text', intent: 'translate', maxSteps: 3, risks: ['read'], limit: 5 },
    ];
    for (let q = 0; q < queries.length; q++) {
      // Reuse the graph after mutation: call-local metadata must not survive updates.
      if (q === 3) { caps[2].inputs[0].name = 'body'; caps[2].inputs[0].type = 'html'; caps[2].risk = 'write'; ledger.record('fetch', false, 500); }
      const t0 = performance.now();
      const plans = plan(graph, ledger, queries[q]);
      rows.push({ seed, q, query: { ...queries[q], exclude: [...(queries[q].exclude ?? [])] }, plans, ms: performance.now() - t0 });
    }
  }
  save('results.json', { rows, ms: performance.now() - started });
  console.log(JSON.stringify({ mode, cases: rows.length, nonempty: rows.filter(r => r.plans.length).length, ms: performance.now() - started }));
} else if (mode === 'publish') {
  const { world, learnAll, MemoryStore } = await load('test/helpers.ts');
  const store = new MemoryStore();
  const { rc } = await world({}, { store });
  await learnAll(rc);
  const rows = [];
  for (let i = 0; i < 25; i++) {
    const request = { have: { place: 'Lima', language: 'es' }, want: 'text', intent: 'weather translated', run: true, publish: `weather-${i}`, verify: [{ op: 'contains', value: '19°C' }] };
    const t0 = performance.now();
    const result = await rc.compose(request);
    rows.push({ index: i, request, result, ms: performance.now() - t0 });
    console.log(JSON.stringify({ event: 'published', index: i, status: result.executed?.status, ms: rows.at(-1).ms }));
  }
  await rc.flush();
  save('state.json', store.state);
  // Reload persisted state; no learn or investigation in this phase.
  const { rc: restored } = await world({}, { store });
  const reuse = [];
  for (let i = 0; i < 25; i++) {
    const t0 = performance.now();
    const result = await restored.run(`goal:weather-${i}`, { place: 'Lima', language: 'es' });
    reuse.push({ index: i, result, ms: performance.now() - t0 });
    console.log(JSON.stringify({ event: 'reuse', index: i, status: result.status, ms: reuse.at(-1).ms }));
  }
  save('results.json', { rows, reuse, ms: performance.now() - started, publications: restored.published.size });
} else throw Error(`unknown mode ${mode}`);
