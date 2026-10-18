// Live HTTP control for the fallback regression; response bodies are finite.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { SERVICES } from '../../demo/services.ts';
const [baseline, imported, output] = process.argv.slice(2);
const rows = [];
for (const [label, checkout] of [['baseline', baseline], ['imported', imported]]) {
  const trace = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const msg = body ? JSON.parse(body) : {};
    trace.push({ method: req.method, rpc: msg.method, graphql: !!msg.query });
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/event-stream' }).end(': finite subscription\n\n'); return; }
    if (!msg.query) { res.writeHead(405).end(); return; }
    const response = await SERVICES.atlas(new Request('https://atlas.test/graphql', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/capabilities`;
  const code = `
    import { RightClick } from ${JSON.stringify(resolve(checkout, 'src/runtime.ts'))};
    const rc = await RightClick.create({ timeoutMs: 100, directories: [] });
    const t = performance.now(); await rc.learn({ source: ${JSON.stringify(url)} });
    const caps = rc.graph.list().filter(c => c.source === 'graphql');
    const geo = caps.find(c => c.id.endsWith('query:geocode'));
    const run = geo ? await rc.run(geo.id, { place: 'Tokyo' }) : null;
    console.log(JSON.stringify({ ms: performance.now() - t, capabilities: caps.map(c => c.id), run: run && { status: run.status, output: run.output } }));
  `;
  let stdout = '', stderr = '';
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: checkout });
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const guard = setTimeout(() => child.kill('SIGKILL'), 2000);
  const exit = await new Promise(r => child.on('exit', (code, signal) => r({ code, signal })));
  clearTimeout(guard); server.closeAllConnections(); await new Promise(r => server.close(r));
  rows.push({ label, checkout, node: process.version, exit, trace, stderr, result: stdout.trim() ? JSON.parse(stdout.trim()) : null });
}
await writeFile(output, JSON.stringify(rows, null, 2) + '\n');
for (const row of rows) console.log(JSON.stringify(row));
if (!rows[0].result?.capabilities.some(c => c.endsWith('query:geocode')) || rows[0].result?.run?.output?.countryCode !== 'JP') throw new Error('baseline control failed');
if (!rows[1].result?.capabilities.some(c => c.endsWith('query:geocode'))) { console.error('PROMOTION FAILURE: imported source lost GraphQL capability'); process.exitCode = 1; }
