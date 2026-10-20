// Real HTTP fixture; watchdog lives outside the runtime under test.
// Usage: node compare.mjs <checkout> <label> <output.json>
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [checkout, label, output] = process.argv.slice(2);
const rows = [];
for (const mode of ['get-subscription', 'post-stream', 'mislabeled-get', 'finite-json']) {
  const trace = [];
  const start = performance.now();
  const log = (event, data = {}) => trace.push({ ms: +(performance.now() - start).toFixed(2), event, ...data });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const msg = raw ? JSON.parse(raw) : undefined;
    log('request', { method: req.method, rpc: msg?.method, hasAuth: req.headers.authorization === 'Bearer fixture-only', session: req.headers['mcp-session-id'] ?? null });
    if (req.headers.authorization !== 'Bearer fixture-only') { res.writeHead(401).end(); return; }
    let timer;
    res.on('close', () => { clearInterval(timer); log('response-closed', { method: req.method, rpc: msg?.method }); });
    if (req.method === 'GET') {
      if (mode === 'finite-json' || mode === 'post-stream') { res.writeHead(405).end(); return; }
      res.writeHead(200, { 'content-type': mode === 'mislabeled-get' ? 'application/json' : 'Text/Event-Stream; charset=utf-8' });
      res.write(': heartbeat\n\n');
      timer = setInterval(() => res.write(': heartbeat\n\n'), 25);
      return;
    }
    if (!msg?.method) { res.writeHead(405).end(); return; }
    if (msg.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
    const result = msg.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wire-fixture', version: '1' } }
      : msg.method === 'tools/list'
        ? { tools: [{ name: 'read_record', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } }] }
        : { content: [{ type: 'text', text: `record-${msg.params.arguments.id}` }] };
    const response = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    res.writeHead(200, { 'content-type': mode === 'post-stream' ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'wire-session' });
    if (mode === 'post-stream') {
      res.write(`: heartbeat\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\ndata: ${response}\n\n`);
      timer = setInterval(() => res.write(': heartbeat\n\n'), 25);
    } else res.end(response);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/capabilities`;
  const code = `
    import { RightClick } from ${JSON.stringify(resolve(checkout, 'src/runtime.ts'))};
    import { handle } from ${JSON.stringify(resolve(checkout, 'src/interface/mcp-server.ts'))};
    const rc = await RightClick.create({ timeoutMs: 100, directories: [], network: { blockPrivate: true, allow: [new URL(${JSON.stringify(url)}).origin], origins: [new URL(${JSON.stringify(url)}).origin] } });
    rc.net.auth.set(${JSON.stringify(url)}, { Authorization: 'Bearer fixture-only' });
    const t = performance.now();
    const learned = await handle(rc, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'context_learn', arguments: { source: ${JSON.stringify(url)} } } });
    const caps = rc.graph.list().filter(c => c.source === 'mcp');
    const discoveryMs = performance.now() - t;
    const run = caps.length ? await rc.run(caps[0].id, { id: '17' }) : null;
    console.log(JSON.stringify({ discoveryMs, capabilities: caps.map(c => c.id), run: run && { status: run.status, output: run.output }, learned }));
  `;
  let stdout = '', stderr = '', timedOut = false;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: checkout });
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const guard = setTimeout(() => { timedOut = true; log('external-watchdog', { timeoutMs: 1500 }); child.kill('SIGKILL'); }, 1500);
  const exit = await new Promise(r => child.on('exit', (code, signal) => r({ code, signal })));
  clearTimeout(guard);
  await new Promise(r => setTimeout(r, 30));
  server.closeAllConnections(); await new Promise(r => server.close(r));
  const result = stdout.trim() ? JSON.parse(stdout.trim()) : null;
  rows.push({ label, checkout: resolve(checkout), node: process.version, mode, timeoutMs: 100, watchdogMs: 1500, timedOut, exit, result, stderr, trace });
}
await writeFile(output, JSON.stringify(rows, null, 2) + '\n');
for (const r of rows) console.log(JSON.stringify({ label, mode: r.mode, timedOut: r.timedOut, discoveryMs: r.result?.discoveryMs, capabilities: r.result?.capabilities, run: r.result?.run }));
