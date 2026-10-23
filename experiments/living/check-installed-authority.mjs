// Exercise actual installed exports, without importing the engineering checkout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const [installedArg, python, evidenceArg] = process.argv.slice(2);
const installed = resolve(installedArg), evidence = resolve(evidenceArg);
const require = createRequire(join(installed, "package.json"));
const load = async name => {
  const file = require.resolve(name);
  assert.ok(file.startsWith(join(installed, "node_modules", "rightclick-x") + "/"));
  return import(pathToFileURL(file).href);
};
const { RightClick, createHandler } = await load("rightclick-x");
const { actenonAuthorityEvidence } = await load("rightclick-x/actenon-evidence");
const origin = JSON.parse(readFileSync(join(evidence, "boundary-ready.json"), "utf8")).origin;
const source = actenonAuthorityEvidence({
  python, attestations: join(evidence, "boundary/attestations.jsonl"),
  publicKey: join(evidence, "boundary/public.json"), origin,
  issuer: "resource-edge", boundary: "Installed package fixture",
});
const runtime = await RightClick.create({ directories: [], sandbox: null,
  authority: { execution: { allowedRisks: [] } } });
const handler = createHandler(runtime, { token: "local-install-check", authorityEvidence: source });
const request = path => new Request("https://installation.test" + path,
  { headers: { authorization: "Bearer local-install-check" } });
assert.equal((await handler(new Request(request("/api/authority-evidence").url))).status, 401);
const expected = JSON.parse(readFileSync(join(evidence, "authority-evidence.json"), "utf8")).records;
const measurements = [];
for (let i = 0; i < 5; i++) {
  const before = performance.now();
  const response = await handler(request("/api/authority-evidence"));
  const text = await response.text(), value = JSON.parse(text);
  measurements.push({ durationMs: performance.now() - before, bytes: Buffer.byteLength(text) });
  assert.equal(response.status, 200);
  assert.equal(value.status, "available");
  assert.equal(value.currentAuthority, "unknown");
  assert.equal(value.runtimeLinkage, "not-established");
  assert.deepEqual(value.records, expected);
}
const tools = await (await handler(request("/api/tools"))).json();
assert.equal(tools.length, 13);
assert.equal((await runtime.run("builtin:text.sha256", { text: "must remain denied" })).status, "failed");
console.log(JSON.stringify({ status: "PASS", records: expected.length, tools: tools.length, measurements,
  scope: "Offline locally packed installation; existing source-pinned Actenon environment, not a clean-machine or independent developer trial" }, null, 2));
