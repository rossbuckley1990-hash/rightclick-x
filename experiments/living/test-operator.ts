// Actual disposable operator/resource regression, without Docker or public I/O.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcPeer, type Wire } from "./challenge-session.ts";
import { approvedCompression } from "./operator-request.ts";

const [destination, python] = process.argv.slice(2);
if (!destination || !python) throw new Error("usage: test-operator.ts NEW_OUTPUT PYTHON");
const output = resolve(destination);
mkdirSync(output, { recursive: false });
const save = (name: string, value: unknown) =>
  writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n");
const child = spawn(python, ["-B", fileURLToPath(new URL("../actenon/challenge-boundary.py", import.meta.url)),
  join(output, "boundary")], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", data => appendFileSync(join(output, "stderr.log"), data));
const peer = new RpcPeer(child, join(output, "session.jsonl"));
try {
  const { origin } = await peer.ready;
  const exact = approvedCompression(origin, { label: "first", document: "Exact operator request regression." });
  save("approved", exact);
  await peer.call("authorize", { requests: [exact] });
  const mutate = (change: Partial<Wire>) => ({ ...exact, ...change });
  const cases: Record<string, Wire> = {
    "changed-header": mutate({ headers: { ...exact.headers, accept: "text/plain" } }),
    "missing-header": mutate({ headers: { "content-type": "application/json", accept: exact.headers.accept } }),
    "extra-header": mutate({ headers: { ...exact.headers, "x-unapproved": "yes" } }),
    "changed-body": mutate({ body: Buffer.from('{"label":"first","document":"changed"}').toString("base64") }),
    "changed-target": mutate({ url: origin + "/deliveries" }),
    "changed-method": mutate({ method: "PUT" }),
  };
  for (const [name, request] of Object.entries(cases)) {
    const result = await peer.call("fetch", { request });
    save(name, { request, result });
    save("effects-" + name, await peer.call("snapshot"));
    assert.equal(result.refused, true, name + " must not receive a proof or dispatch");
    assert.deepEqual((await peer.call("snapshot")).effects, []);
  }
  const result = await peer.call("fetch", { request: mutate({
    headers: Object.fromEntries(Object.entries(exact.headers).reverse()) }) });
  save("exact", result);
  assert.equal(result.response?.status, 202);
  assert.equal((await peer.call("snapshot")).effects.length, 1);
  await peer.call("revoke");
  const revoked = await peer.call("fetch", { request: exact });
  save("revoked", revoked);
  assert.equal(revoked.refused, true);
  assert.equal((await peer.call("snapshot")).effects.length, 1);
  save("result", { status: "PASS", refusedChanges: Object.keys(cases), equivalentHeaderOrderAccepted: true,
    revokedRefused: true, effects: 1 });
} finally {
  try { await peer.call("close"); child.stdin.end(); await peer.exited; }
  finally { child.kill("SIGTERM"); }
}
