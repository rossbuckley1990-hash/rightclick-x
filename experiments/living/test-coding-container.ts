// Offline actual-boundary smoke test. Uses the identical public-read mediator.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { startContainedSession } from "./challenge-session.ts";
import { publicReadTransport } from "./public-read-transport.ts";
const [destination, image] = process.argv.slice(2);
if (!destination || !image) throw new Error("usage: test-coding-container.ts NEW_OUTPUT IMAGE");
const out = resolve(destination); mkdirSync(out);
const observations: any[] = [], denied: any[] = [], checks: string[] = [];
const net = publicReadTransport([{ url: "https://unit.invalid/graphql", kind: "graphql" }], row => observations.push(row), {
  spacingMs: 0, fetch: async () => new Response('{"value":7}') });
let retained: any;
for (const phase of ["first", "restart"]) {
  const directory = join(out, phase); mkdirSync(directory);
  const session = await startContainedSession({ output: directory, image, host: "coding", config: { state: retained }, fetch: async wire => {
    try {
      const r = await net(wire.url, { method: wire.method, headers: wire.headers, ...(!["GET", "HEAD"].includes(wire.method) ? { body: Buffer.from(wire.body, "base64") } : {}) });
      return { response: { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()).toString("base64") } };
    } catch (error) { denied.push(String(error)); return { refused: true, reason: String(error) }; }
  } });
  const call = async (name: string, args: object = {}) => {
    const r = await session.peer.http("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    return (await r.json()).result;
  };
  try {
    if (phase === "first") await call("write_file", { name: "work.js", content: "return (await (await fetch('https://unit.invalid/data')).json()).value * input" });
    const result = await call("run_code", { file: "work.js", input: phase === "first" ? 2 : 3 });
    assert.equal(result.isError, undefined); assert.equal(JSON.parse(result.content[0].text).value, phase === "first" ? 14 : 21);
    checks.push(phase + "-saved-code");
    if (phase === "first") {
      for (const [name, code] of [
        ["origin", "return await fetch('https://denied.invalid/')"],
        ["mutation", "return await fetch('https://unit.invalid/graphql',{method:'POST',body:JSON.stringify({query:'mutation { delete }'})})"],
        ["credentials", "return await fetch('https://unit.invalid/data',{headers:{authorization:'test-only'}})"],
      ]) { assert.equal((await call("run_code", { code })).isError, true); checks.push(name + "-refused"); }
      const direct = await call("run_code", { code: "try { await globalThis.fetch('https://example.com',{signal:AbortSignal.timeout(800)}); return 'escaped' } catch { return 'blocked' }" });
      assert.equal(JSON.parse(direct.content[0].text).value, "blocked"); checks.push("direct-network-blocked");
      const mount = await call("run_code", { code: "const fs=await import('node:fs'); return {host:fs.existsSync('/Users/ross/src'),socket:fs.existsSync('/var/run/docker.sock'),keys:Object.keys(process.env).filter(k=>/TOKEN|API_KEY|SECRET|CREDENTIAL/.test(k))}" });
      assert.deepEqual(JSON.parse(mount.content[0].text).value, { host: false, socket: false, keys: [] }); checks.push("host-custody-absent");
    }
    const snapshot = await session.peer.call("snapshot"); retained = snapshot.state;
    writeFileSync(join(directory, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  } finally { await session.close(); }
}
assert.equal(observations.length, 2); assert.equal(denied.length, 3);
writeFileSync(join(out, "result.json"), JSON.stringify({ status: "PASS", checks, observations, denied }, null, 2));
console.log(JSON.stringify({ status: "PASS", checks: checks.length }));
