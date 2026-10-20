// Acceptance checks are deliberately outside npm test: failures record promotion blockers.
// Run against an exact source snapshot: node acceptance.mjs <checkout> <output.json>
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const [checkout, output] = process.argv.slice(2);
const { discover } = await import(resolve(checkout, 'src/reflectors/discover.ts'));
const { Authority, request } = await import(resolve(checkout, 'src/reflectors/net.ts'));
const { McpClient } = await import(resolve(checkout, 'src/reflectors/mcp.ts'));
const { SERVICES } = await import(resolve(checkout, 'demo/services.ts'));
const url = 'https://stream.test/capabilities';
const rows = [];
let trace;
const mark = (event, data = {}) => trace.push({ event, ...data });
async function check(name, fn) {
  trace = [];
  const t = performance.now();
  try { await fn(); rows.push({ name, ok: true, ms: performance.now() - t, trace }); }
  catch (e) { rows.push({ name, ok: false, ms: performance.now() - t, error: e.message, trace }); }
}
async function bounded(p, ms = 180) {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`external watchdog after ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
function stream(text = '', options = {}) {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      if (data.length) {
        if (options.fragment) for (let i = 0; i < data.length; i++) c.enqueue(data.slice(i, i + 1));
        else c.enqueue(data);
      }
      if (options.finite) c.close();
    },
    cancel() { mark('cancel'); options.onCancel?.(); if (options.cancelReject) return Promise.reject(new Error('cancel failed')); if (options.cancelPending) return new Promise(() => {}); },
  });
}
const tools = [{ name: 'read_record', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } }];
function fixture(options = {}) {
  const auth = new Authority(); auth.set(url, { authorization: 'Bearer fixture-only' });
  const net = { auth, timeoutMs: 25, fetch: async (input, init = {}) => {
    const address = String(input); const headers = new Headers(init.headers);
    const msg = init.body ? JSON.parse(String(init.body)) : {};
    mark('request', { address, method: init.method ?? 'GET', rpc: msg.method, authorized: headers.get('authorization') === 'Bearer fixture-only', session: headers.get('mcp-session-id') });
    if (options.unavailable?.()) throw new Error('provider unavailable');
    if (options.unauthorized) return new Response('Unauthorized', { status: 401 });
    if (!init.method || init.method === 'GET') {
      if (options.get405) return new Response('Method not allowed', { status: 405 });
      return new Response(stream(options.getText, options), { headers: { 'content-type': options.getType ?? 'Text/Event-Stream; charset=utf-8' } });
    }
    if (msg.query && options.graphql) return SERVICES.atlas(new Request('https://atlas.test/graphql', init));
    if (!msg.method || options.notMcp) return new Response('Method not allowed', { status: 405 });
    const response = result => {
      const json = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (!options.postSSE) return Response.json(JSON.parse(json), { headers: { 'mcp-session-id': 'fixture-session' } });
      const text = `: keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":999,"result":{}}\r\n\r\nevent: message\r\ndata: ${json}\r\n\r\n`;
      return new Response(stream(text, { finite: options.postFinite, fragment: true }), { headers: { 'content-type': options.postType ?? 'text/event-stream', 'mcp-session-id': 'fixture-session' } });
    };
    if (msg.method === 'initialize') return response({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'generic-test', version: '1' } });
    assert.equal(headers.get('mcp-session-id'), 'fixture-session');
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (msg.method === 'tools/list') return response({ tools });
    if (msg.method === 'tools/call') return response({ content: [{ type: 'text', text: 'record-17' }] });
    return new Response('unsupported', { status: 400 });
  } };
  return net;
}
function has(d, source) { return d.reflections.flatMap(r => r.capabilities).filter(c => c.source === source); }
async function mcp(net, opts) {
  const d = await bounded(discover(net, url, opts));
  assert.deepEqual(has(d, 'mcp').map(c => c.title), ['read_record']);
  assert.equal(trace.filter(t => t.rpc === 'tools/call').length, 0, 'discovery executes no tool');
  return d;
}
await check('long-lived SSE GET: discover exact MCP tool and cancel', async () => { await mcp(fixture()); assert.equal(trace.filter(t => t.event === 'cancel').length, 1); });
await check('finite JSON: MCP initialize/list remain compatible', async () => { await mcp(fixture({ get405: true })); });
await check('OpenAPI JSON: exact REST operation', async () => {
  const net = fixture(); net.fetch = (input, init) => SERVICES.polyglot(new Request(String(input), init));
  const d = await discover(net, 'https://polyglot.test/openapi.json');
  assert.ok(has(d, 'openapi').some(c => c.id.endsWith(':translatetext')));
});
await check('finite JSON mislabeled as text/plain: still reflects OpenAPI', async () => {
  const spec = await (await SERVICES.polyglot(new Request('https://polyglot.test/openapi.json'))).text();
  const net = fixture(); net.fetch = async () => new Response(spec, { headers: { 'content-type': 'text/plain' } });
  assert.ok(has(await discover(net, url), 'openapi').some(c => c.id.endsWith(':translatetext')));
});
await check('YAML compatibility resolution preserves OpenAPI support', async () => {
  const net = fixture(); net.fetch = async () => new Response('openapi: 3.0.0\ninfo:\n  title: YAML\n  version: "1"\nservers:\n  - url: https://stream.test\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n', { headers: { 'content-type': 'application/yaml' } });
  assert.ok(has(await discover(net, url), 'openapi').some(c => c.id.endsWith(':listitems')));
});
await check('GraphQL introspection still discovers geocode', async () => {
  const net = fixture(); net.fetch = (input, init) => SERVICES.atlas(new Request(String(input), init));
  assert.ok(has(await discover(net, 'https://atlas.test/graphql'), 'graphql').some(c => c.id.endsWith('query:geocode')));
});
await check('finite valid MCP SSE responses, notifications, unrelated IDs, fragmented CRLF', async () => { await mcp(fixture({ get405: true, postSSE: true, postFinite: true })); });
await check('MCP SSE response without EOF: match response and stop reading', async () => { await mcp(fixture({ get405: true, postSSE: true })); });
await check('mixed-case MCP SSE media type remains valid', async () => { await mcp(fixture({ get405: true, postSSE: true, postFinite: true, postType: 'Text/Event-Stream; charset=utf-8' })); });
await check('SSE is not proof of MCP capability', async () => { assert.equal(has(await bounded(discover(fixture({ notMcp: true }), url)), 'mcp').length, 0); });
await check('finite SSE GET with GraphQL POST: retain protocol fallback', async () => {
  const d = await bounded(discover(fixture({ finite: true, getText: ': subscription ended\n\n', graphql: true, notMcp: true }), url));
  assert.ok(has(d, 'graphql').some(c => c.id.endsWith('query:geocode')), 'GraphQL capability must remain discoverable');
});
await check('provider unavailable then recovers using same MCP client', async () => {
  let offline = true; const net = fixture({ unavailable: () => offline }); const client = new McpClient(url, net);
  const opts = { mcp: () => client };
  assert.equal((await bounded(discover(net, url, opts))).reflections.length, 0);
  offline = false; await mcp(net, opts);
});
await check('401 refuses discovery without executing tools', async () => {
  assert.equal((await bounded(discover(fixture({ unauthorized: true }), url))).reflections.length, 0);
  assert.equal(trace.filter(t => t.rpc === 'tools/call').length, 0);
});
await check('incorrect JSON content type on infinite body: deadline must bound read', async () => { await mcp(fixture({ getType: 'application/json', getText: ': heartbeat\n\n' })); });
await check('pending body cancellation must not hang discovery', async () => { await mcp(fixture({ cancelPending: true })); });
await check('rejected body cancellation can still negotiate MCP', async () => { await mcp(fixture({ cancelReject: true })); });
await check('headers stall: existing request timeout aborts fetch', async () => {
  const net = fixture(); net.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { mark('aborted'); reject(init.signal.reason); }, { once: true }));
  await assert.rejects(bounded(request(net, url)), /timeout after 25ms/); assert.equal(trace.filter(t => t.event === 'aborted').length, 1);
});
await check('MCP finite SSE tool call executes exactly once', async () => {
  const net = fixture({ get405: true, postSSE: true, postFinite: true }); const client = new McpClient(url, net);
  await mcp(net, { mcp: () => client }); assert.equal(await client.call('read_record', { id: '17' }), 'record-17');
  assert.equal(trace.filter(t => t.rpc === 'tools/call').length, 1);
});
for (const [name, target, policy] of [
  ['egress allowlist', url, { blockPrivate: false, origins: ['https://allowed.test'] }],
  ['deny host', url, { blockPrivate: false, deny: ['stream.test'] }],
  ['private address', 'http://127.0.0.1/capabilities', { blockPrivate: true }],
  ['non-HTTP scheme', 'file:///capabilities', { blockPrivate: false }],
]) await check(`security: ${name} blocks all discovery requests`, async () => {
  const net = fixture(); net.policy = policy;
  assert.equal((await bounded(discover(net, target))).reflections.length, 0);
  assert.equal(trace.filter(t => t.event === 'request').length, 0);
});
await check('security: redirect cannot bypass egress policy', async () => {
  const net = fixture(); net.policy = { blockPrivate: false, origins: ['https://stream.test'] };
  net.fetch = async (input) => { mark('request', { address: String(input) }); return new Response(null, { status: 302, headers: { location: 'https://other.test/x' } }); };
  assert.equal((await bounded(discover(net, url))).reflections.length, 0);
  assert.ok(trace.every(t => t.address === url));
});
await check('security: SSE redirect receives only destination-pinned credentials', async () => {
  const net = fixture(); const inner = net.fetch; net.auth.set('https://other.test', { authorization: 'Bearer destination-only' });
  net.fetch = async (input, init) => {
    if (String(input) === url && !init.method) return new Response(null, { status: 302, headers: { location: 'https://other.test/x' } });
    if (String(input).startsWith('https://other.test')) { mark('redirect-header', { authorization: new Headers(init.headers).get('authorization') }); return new Response(stream(), { headers: { 'content-type': 'text/event-stream' } }); }
    return inner(input, init);
  };
  await mcp(net); assert.deepEqual(trace.filter(t => t.event === 'redirect-header').map(t => t.authorization), ['Bearer destination-only']);
  assert.ok(trace.filter(t => t.rpc).every(t => t.address === url && t.authorized));
});
const report = { checkout: resolve(checkout), node: process.version, passed: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length, checks: rows };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ': ' + r.error}`);
console.log(`${report.passed}/${rows.length} passed`); process.exitCode = report.failed ? 1 : 0;
