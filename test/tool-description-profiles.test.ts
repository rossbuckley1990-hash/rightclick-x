// The slimmer-description experiment (experiments/slim-descriptions/) may change descriptions and
// nothing else: the same 13 tools, schemas, required fields, enums, titles and annotations, the same
// startup instructions, and the server's own answers to every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANNOTATED_TOOLS } from "../src/interface/tools.ts";
import { applyProfile, PROFILE_NAMES, PROFILES, withoutDescriptions } from "../experiments/slim-descriptions/profiles.ts";
import { transformer } from "../experiments/slim-descriptions/proxy.ts";
import { mcpClient } from "../experiments/slim-descriptions/client.ts";

const served = (profile: (typeof PROFILE_NAMES)[number]) => applyProfile(ANNOTATED_TOOLS, profile) as any[];
const descriptions = (x: unknown, out: string[] = []): string[] => {
  if (Array.isArray(x)) x.forEach((y) => descriptions(y, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) k === "description" && typeof v === "string" ? out.push(v) : descriptions(v, out);
  return out;
};

test("description profiles: identical tool contracts once descriptions are removed", () => {
  const contract = withoutDescriptions(ANNOTATED_TOOLS);
  assert.deepEqual(served("original"), structuredClone(ANNOTATED_TOOLS), "original is the production list exactly");
  for (const profile of PROFILE_NAMES) {
    const tools = served(profile);
    assert.equal(tools.length, 13);
    assert.deepEqual(withoutDescriptions(tools), contract, profile);
    assert.equal(descriptions(tools).length, descriptions(ANNOTATED_TOOLS).length, `${profile} removes no description`);
  }
  assert.ok(JSON.stringify(withoutDescriptions(ANNOTATED_TOOLS)).includes('"enum":["run","full"]'), "the stripped contract still carries enums");
});

test("description profiles: only shorter text, and compact-full keeps compact-top's top-level text", () => {
  const original = served("original");
  for (const profile of ["compact-top", "compact-full"] as const) {
    const tools = served(profile);
    for (const [i, t] of tools.entries()) assert.ok(t.description.length < original[i].description.length, `${profile} ${t.name}`);
    const [a, b] = [descriptions(original), descriptions(tools)];
    assert.ok(b.every((d, i) => d.length <= a[i].length), `${profile} lengthens nothing`);
  }
  assert.deepEqual(served("compact-full").map((t) => t.description), served("compact-top").map((t) => t.description));
  assert.ok(Object.values(PROFILES["compact-top"]).every((at) => Object.keys(at).every((k) => k === "/description")), "compact-top touches top-level descriptions only");
});

test("description profiles: every profile keeps the safety-critical statements", () => {
  for (const profile of PROFILE_NAMES) {
    const t = Object.fromEntries(served(profile).map((x) => [x.name, x]));
    const prop = (tool: string, name: string) => t[tool].inputSchema.properties[name];
    const msg = `${profile}`;
    // Execution authority and destructive confirmation.
    assert.match(prop("context_run", "confirm").description, /destructive/, msg);
    assert.match(prop("context_compose", "confirm").description, /destructive/, msg);
    assert.match(prop("context_run", "id").description, /current authority/, msg);
    assert.match(t.context_graph.description, /cannot change policy/, msg);
    // Discovery never grants execution authority.
    for (const tool of ["context_research", "context_learn"]) assert.match(t[tool].description, /[Dd]iscovery never grants execution authority/, `${msg} ${tool}`);
    // Checked versus verified, and what an independent witness requires.
    for (const verify of [prop("context_run", "verify"), prop("context_compose", "verify"), prop("context_compose", "witnesses").items.properties.verify])
      assert.match(verify.description, /"checked".*only an independent witness makes it "verified"/, msg);
    assert.match(prop("context_compose", "publish").description, /"checked".*witness.*"verified"/, msg);
    const w = prop("context_compose", "witnesses").description;
    for (const must of [/separate/, /read-only/, /fails closed/, /pinned/]) assert.match(w, must, msg);
    assert.match(prop("context_compose", "witnesses").items.properties.capability.description, /read-only/, msg);
    // Provider changes: re-read and retry the same operation once; a changed operation stays refused.
    for (const must of [/re-reads?/, /same operation/, /refused/, /acknowledgement cannot authori[sz]e/]) assert.match(t.context_run.description, must, msg);
    // Reading recorded output is not executing again.
    assert.match(t.context_run_status.description, /without running it again/, msg);
    assert.match(prop("context_run", "id").description, /never replayed/, msg);
    // A saved goal repeats its stored checks and witnesses; added checks never remove them.
    assert.match(t.context_run.description, /stored (result )?checks and (independent )?witnesses/, msg);
    assert.match(t.context_run.description, /never removes? (stored checks|them)/, msg);
  }
});

test("description profiles: a stale override fails closed instead of serving the original text", () => {
  const stale = structuredClone(ANNOTATED_TOOLS) as any[];
  delete stale.find((t) => t.name === "context_compose").inputSchema.properties.witnesses.description;
  assert.throws(() => applyProfile(stale, "compact-full"), /context_compose\/inputSchema\/properties\/witnesses\/description is not a description/);
  assert.throws(() => applyProfile(stale.filter((t) => t.name !== "context_watch"), "compact-top"), /no tool context_watch/);
  assert.throws(() => applyProfile(stale, "terse" as any), /unknown description profile/);
});

test("description proxy: only a requested tools/list result changes, line for line", () => {
  const seen: any[] = [];
  const t = transformer("compact-full", (e) => seen.push(e));
  const call = JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [{ name: "not-a-list" }] } });
  assert.equal(t.response(call), call, "a result for an id that did not ask tools/list passes untouched");
  t.request(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list" }));
  const list = JSON.parse(t.response(JSON.stringify({ jsonrpc: "2.0", id: 8, result: { tools: ANNOTATED_TOOLS } })));
  assert.deepEqual(list.result.tools, served("compact-full"));
  assert.equal(t.response('{"jsonrpc":"2.0","id":8,"result":{"tools":[]}}'), '{"jsonrpc":"2.0","id":8,"result":{"tools":[]}}', "each request is rewritten once");
  for (const line of ["not json", '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}']) assert.equal(t.response(line), line);
  assert.deepEqual(seen.map((e) => [e.event, e.profile]), [["tools/list", "compact-full"]]);
});

test("description proxy: same instructions, contract and call results as the server itself", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcx-profiles-"));
  const env = (name: string) => ({ RCX_STATE_FILE: join(dir, `${name}.json`), RCX_WORKSPACE: dir });
  const ask = async (c: Awaited<ReturnType<typeof mcpClient>>) => ({
    tools: (await c.req("tools/list")).result.tools,
    inspect: (await c.req("tools/call", { name: "context_inspect", arguments: { value: "https://example.com/a.html" } })).result,
    refused: (await c.req("tools/call", { name: "context_run", arguments: { id: "goal:none", acknowledgeChange: true } })).result,
    unknown: await c.req("tools/call", { name: "context_shell", arguments: {} }),
  });
  const direct = await mcpClient(env("direct"));
  const base = await ask(direct);
  await direct.close();
  assert.equal(base.refused.isError, true);
  for (const profile of PROFILE_NAMES) {
    const c = await mcpClient(env(profile), profile);
    const got = await ask(c);
    await c.close();
    assert.deepEqual(c.init.result, direct.init.result, `${profile}: initialize, and so the startup instructions, unchanged`);
    assert.deepEqual(got.tools, served(profile), profile);
    assert.deepEqual(withoutDescriptions(got.tools), withoutDescriptions(base.tools), profile);
    assert.deepEqual(got.inspect, base.inspect, profile);
    assert.deepEqual(got.refused, base.refused, profile);
    assert.deepEqual(got.unknown, { ...base.unknown, id: got.unknown.id }, profile);
  }
});
