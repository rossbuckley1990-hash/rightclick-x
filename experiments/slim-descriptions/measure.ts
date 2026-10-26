// What each description profile's tools/list costs, measured from the proxy a session would use.
//   node experiments/slim-descriptions/measure.ts [--out dir]
// Sizes are UTF-8 bytes of the JSON-RPC result. Each component's share is measured by removal, in
// this order, so the shares add up to the total exactly: top-level descriptions, then
// parameter/schema descriptions, then titles and annotations, then names; what remains is the
// schema structure and JSON framing. "Model-visible" is the part an MCP client gives the model
// as a tool definition (prefixed name, description, input schema); the exact token cost of each
// profile comes from the sessions' first-request usage, not from here.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpClient } from "./client.ts";
import { PROFILE_NAMES } from "./profiles.ts";
import { digest } from "./proxy.ts";

const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
const omit = (x: any, drop: (k: string, v: unknown, depth: number) => boolean, depth = 0): any =>
  Array.isArray(x) ? x.map((y) => omit(y, drop, depth + 1))
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k, v]) => !drop(k, v, depth)).map(([k, v]) => [k, omit(v, drop, depth + 1)])) : x;
// depth 2 is a tool object: result -> tools array -> tool.
const top = (k: string, v: unknown, d: number) => d === 2 && k === "description" && typeof v === "string";
const nested = (k: string, v: unknown, d: number) => d > 2 && k === "description" && typeof v === "string";
const labels = (k: string, _v: unknown, d: number) => d === 2 && (k === "title" || k === "annotations");
const names = (k: string, _v: unknown, d: number) => d === 2 && k === "name";

export async function measure() {
  const state = realpathSync(mkdtempSync(join(tmpdir(), "rcx-measure-")));
  const out: any = {};
  for (const profile of PROFILE_NAMES) {
    const c = await mcpClient({ RCX_STATE_FILE: `${state}/${profile}.json`, RCX_WORKSPACE: state }, profile);
    const result = (await c.req("tools/list")).result;
    await c.close();
    const a = result, b = omit(a, top), c2 = omit(b, nested), d = omit(c2, labels), e = omit(d, names);
    const visible = result.tools.map((t: any) => ({ name: `mcp__rightclick-x__${t.name}`, description: t.description, input_schema: t.inputSchema }));
    let descriptions = 0, chars = { top: 0, nested: 0 };
    omit(result, (k, v, depth) => { if (k === "description" && typeof v === "string") { descriptions++; chars[depth === 2 ? "top" : "nested"] += v.length; } return false; });
    out[profile] = {
      tools: result.tools.length, digest: digest(result.tools), instructions: digest(c.init.result.instructions),
      bytes: { total: bytes(a), topDescriptions: bytes(a) - bytes(b), schemaDescriptions: bytes(b) - bytes(c2), titlesAndAnnotations: bytes(c2) - bytes(d), names: bytes(d) - bytes(e), schemaAndFraming: bytes(e) },
      descriptionStrings: descriptions, descriptionChars: chars, modelVisibleBytes: bytes(visible),
      perTool: Object.fromEntries(result.tools.map((t: any) => [t.name, { description: t.description.length, inputSchema: bytes(t.inputSchema) }])),
    };
    // The most any description profile could save: the same tools with no descriptions at all.
    if (profile === "original") out.bound = { modelVisibleBytesWithoutDescriptions: bytes(omit(visible, (k, v) => k === "description" && typeof v === "string")) };
  }
  return out;
}

if (import.meta.main) {
  const i = process.argv.indexOf("--out");
  const m = await measure();
  if (i >= 0) { mkdirSync(process.argv[i + 1], { recursive: true }); writeFileSync(`${process.argv[i + 1]}/payload.json`, JSON.stringify(m, null, 2)); }
  console.log(JSON.stringify(m, null, 2));
}
