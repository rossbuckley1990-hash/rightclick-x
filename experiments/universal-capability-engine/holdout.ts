// Stage G (holdout), phase 1: investigate the seeded holdout draws, in order, on the frozen build,
// until two yield at least one capability. Draws that cannot be investigated are recorded as
// failures for that program and the next draw of the same seeded sequence is used (pre-registered).
//   node experiments/universal-capability-engine/holdout.ts <freeze-tag>
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, frozenBuild, serverFiles } from "../life-science/harness.ts";

const TAG = process.argv[2];
const OUT = "experiments/universal-capability-engine/evidence";
const sel = JSON.parse(readFileSync(`${OUT}/selection-g.json`, "utf8"));
const build = frozenBuild(TAG);
const env = realpathSync(mkdtempSync(join(tmpdir(), "uce-holdout-")));
const BIN = `${env}/bin`;
mkdirSync(BIN);
process.env.RCX_INVESTIGATE = `${BIN}/`;
const f = serverFiles(`${env}/server`);
const m = new Mcp(build.rcx, f);
await m.init();
const ev: any = { tag: TAG, commit: build.commit, seedFrom: sel.seedFrom, attempts: [] as any[], chosen: [] as string[], state: f.state, bin: BIN };
for (const name of sel.order as string[]) {
  if (ev.chosen.length >= 2) break;
  symlinkSync(`/usr/bin/${name}`, `${BIN}/${name}`);
  const t0 = Date.now();
  const r = await m.tool("context_learn", { source: `cli:${BIN}/${name}` });
  const res = r.value?.results?.[0];
  const caps = (await m.tool("context_graph", { op: "export" })).value.capabilities.filter((c: any) => c.provider === `cli:${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "")}`);
  const cards = [];
  for (const c of caps) cards.push((await m.tool("context_explain", { id: c.id })).value.card);
  const attempt = {
    program: name,
    description: sel.descriptions[name],
    ms: Date.now() - t0,
    probes: res?.probes,
    error: res?.error,
    capabilities: cards.map((c: any) => ({ id: c.identity.id, title: c.identity.title, inputs: c.inputs, outputs: c.outputs, evidence: c.verification?.evidence, limitations: c.limitations })),
    investigable: caps.length > 0,
    supported: cards.some((c: any) => (c.verification?.evidence ?? []).some((e: string) => /experimentally-supported/.test(e))),
  };
  ev.attempts.push(attempt);
  if (attempt.investigable) ev.chosen.push(name);
  console.log(`${name}: ${attempt.investigable ? `${caps.length} capabilities (supported: ${attempt.supported})` : `not investigable — ${res?.probes?.[0]?.detail ?? res?.error}`} · ${attempt.ms} ms`);
}
await m.close();
writeFileSync(`${OUT}/holdout-phase1-${TAG}.json`, JSON.stringify(ev, null, 2));
console.log(`chosen: ${ev.chosen.join(", ")}`);
