// How much of a normal context_explain response (detail "run") is not execution constraint or evidence?
//   node experiments/tool-loading/explain.ts [--out dir]
// Builds the operator states the agent sessions reuse and measures, for each capability those
// sessions explain, the response by section and three removable parts:
//   search    metadata for finding a capability, not for running it (capability.tags)
//   repeated  values the response already states elsewhere (execution.capability, reuse.id)
//   prose     fixed explanatory sentences that are the same in every response of their kind
// Prose carries caveats about authority and evidence, so it can be shortened but not dropped:
// removing all three parts bounds what any leaner response could save; it is not a proposal.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mcpClient } from "./client.ts";

const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
// Tokens per byte of these responses in the sessions: a saved goal's explain added 1,418 tokens for 3,384 bytes.
const BYTES_PER_TOKEN = 3384 / 1418;

async function responses() {
  const out: Record<string, any> = {};
  const dir = tmp("rcx-explain-");
  writeFileSync(`${dir}/overrides.json`, "{}");
  const svc = spawn(process.execPath, [resolve("experiments/tool-loading/services.mjs"), `${dir}/requests.jsonl`, `${dir}/overrides.json`], { stdio: ["ignore", "pipe", "inherit"] });
  const urls: Record<string, string> = await new Promise((done) => svc.stdout!.once("data", (d) => done(JSON.parse(String(d)))));
  const op = await mcpClient({ RCX_STATE_FILE: `${dir}/state.json`, RCX_WORKSPACE: dir });
  await op.tool("context_learn", { sources: ["fulfilment", "levy", "inspection"].map((s) => `${urls[s]}/contract`) });
  await op.tool("context_compose", { have: { order_id: "O-1006" }, want: "number", intent: "sales tax rate for an order", run: true, through: ["openapi:fulfilment:lookup", "openapi:levy:calculate"], publish: "order-tax-rate",
    witnesses: [{ capability: "openapi:inspection:validate", args: { order_id: { input: "order_id" }, candidate: { output: "" } }, verify: [{ op: "equals", path: "valid", value: true }] }] });
  for (const id of ["goal:order-tax-rate", "openapi:levy:calculate"]) out[id] = await op.tool("context_explain", { id });
  await op.close(); svc.kill();
  const env = tmp("rcx-explain-tidy-");
  mkdirSync(`${env}/bin`); symlinkSync("/usr/bin/tidy", `${env}/bin/tidy`);
  const input = `<html><head><title>Choir</title></head><body><h2>Rehearsal notes</h2>\n<p>Warm up slowly\n<p>Watch the tempo\n<ul><li>Sopranos<li>Altos</ul></body></html>\n`;
  const t = await mcpClient({ RCX_STATE_FILE: `${env}/state.json`, RCX_INVESTIGATE: `${env}/bin/tidy`, RCX_WORKSPACE: env });
  await t.tool("context_learn", { source: `cli:${env}/bin/tidy` });
  await t.tool("context_compose", { have: { html: { type: "html", value: input } }, want: "html", intent: "correct and pretty-print an html document", run: true, publish: "HTML cleanup" });
  for (const id of ["goal:html-cleanup", "cli:tidy:i"]) out[id] = await t.tool("context_explain", { id });
  await t.close();
  return out;
}

/** Every string of at least 120 characters, with its path. */
const prose = (x: any, path = "", found: [string, string][] = []): [string, string][] => {
  if (typeof x === "string" && x.length >= 120) found.push([path, x]);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) prose(v, path ? `${path}.${k}` : k, found);
  return found;
};

const all = await responses();
// Prose is "fixed" when the same text appears in both saved goals' responses, or (for the CLI) is not about this program.
const goalProse = (id: string) => new Set(prose(all[id]).map(([, s]) => s));
const shared = new Set([...goalProse("goal:order-tax-rate")].filter((s) => goalProse("goal:html-cleanup").has(s)));
const report: any = {};
for (const [id, ex] of Object.entries(all)) {
  const sections = Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, bytes(v)]));
  const search = bytes(ex.capability?.tags ?? []) + (ex.capability?.tags ? 9 : 0);
  const repeated = (ex.execution?.capability === ex.capability?.id ? bytes(ex.execution.capability) + 13 : 0) + (ex.reuse?.id === ex.capability?.id ? bytes(ex.reuse.id) + 6 : 0);
  const fixed = prose(ex).filter(([, s]) => shared.has(s));
  const fixedBytes = fixed.reduce((a, [, s]) => a + bytes(s), 0);
  const total = bytes(ex);
  report[id] = { total, sections, removable: { search, repeated, fixedProse: fixedBytes, fixedProsePaths: fixed.map(([p]) => p) },
    bound: { bytes: search + repeated + fixedBytes, share: (search + repeated + fixedBytes) / total, tokens: Math.round((search + repeated + fixedBytes) / BYTES_PER_TOKEN) } };
}
const i = process.argv.indexOf("--out");
if (i >= 0) { mkdirSync(process.argv[i + 1], { recursive: true }); writeFileSync(`${process.argv[i + 1]}/explain.json`, JSON.stringify({ bytesPerToken: BYTES_PER_TOKEN, report, responses: all }, null, 2)); }
for (const [id, r] of Object.entries(report) as any) console.log(`${id}: ${r.total} B; search ${r.removable.search}, repeated ${r.removable.repeated}, fixed prose ${r.removable.fixedProse} (${r.removable.fixedProsePaths.join(", ") || "none"}) => at most ${r.bound.bytes} B (${(r.bound.share * 100).toFixed(0)}%), about ${r.bound.tokens} tokens`);
