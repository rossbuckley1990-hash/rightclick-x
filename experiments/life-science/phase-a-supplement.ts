// Phase A supplement (post hoc, not pre-registered): on the build that fixed the
// GraphQL selection cap, is RCSB's method/resolution reachable through the new
// optional `selection` input, and does the input say which fields exist?
//   RCX_FREEZE=lifesci-freeze-3 node experiments/life-science/phase-a-supplement.ts

import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { frozenBuild, HERE, Mcp, serverFiles, TAG, WORK } from "./harness.ts";

const build = frozenBuild();
const dir = `${WORK}/${TAG}/phase-a-supplement`;
rmSync(dir, { recursive: true, force: true });
const f = serverFiles(dir);
copyFileSync(`${WORK}/${TAG}/phase-a-state.json`, f.state);
const mcp = new Mcp(build.rcx, f);
await mcp.init();
const id = "graphql:data-rcsb-org-graphql:query:entry";
const explained = (await mcp.tool("context_explain", { id })).value;
const port = explained.capability.inputs.find((p: any) => p.name === "selection");
const run = (await mcp.tool("context_run", { id, args: { entry_id: "4HHB", selection: "{ rcsb_id exptl { method } rcsb_entry_info { resolution_combined experimental_method } }" } })).value;
await mcp.close();
const out = { at: new Date().toISOString(), build: { tag: TAG, commit: build.commit }, posthoc: true, capability: id, selectionPortDescriptionMentions: { exptl: /exptl \{/.test(port?.description ?? ""), rcsb_entry_info: /rcsb_entry_info \{/.test(port?.description ?? "") }, selectionPortDescriptionLength: port?.description?.length, run: { status: run.status, output: run.output, error: run.error } };
writeFileSync(`${HERE}/evidence/phase-a-supplement-${TAG}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
