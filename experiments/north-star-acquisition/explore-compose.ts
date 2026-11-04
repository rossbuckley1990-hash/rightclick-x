// Exploratory: can the composer build a MULTISTEP pipeline through the acquired capability?
import { readFileSync } from "node:fs";
import { connect } from "./mcp-client.ts";
const HERE = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;
const LYCHEE = "/opt/homebrew/bin/lychee";
const c = await connect({ repo: REPO, state: process.argv[2]!, investigate: LYCHEE, execute: LYCHEE });
const md = readFileSync(`${HERE}fixtures/abs-links.md`, "utf8");

for (const want of ["list:url", "list:domain", "domain", "list:text", "number"]) {
  const r = await c.callTool("context_compose", { have: { document: { type: "markdown", value: md } }, want, intent: "hosts linked from a markdown document", run: false });
  const plans = r?.plans ?? [];
  console.log(`\nwant=${want.padEnd(12)} plans=${Array.isArray(plans) ? plans.length : "?"}`);
  for (const p of (Array.isArray(plans) ? plans : []).slice(0, 4)) {
    console.log(`   ${JSON.stringify(p.titles ?? p.summary)}  cost=${p.cost} result=${p.result ?? ""}`);
  }
  if (r?.compositionDiagnostics?.length) {
    const rel = r.compositionDiagnostics.filter((d: any) => /lychee|url\.domain|list\.first/.test(d.capability));
    console.log(`   diagnostics(${r.compositionDiagnostics.length}), relevant: ${JSON.stringify(rel.slice(0, 4)).slice(0, 600)}`);
  }
  if (r?.planningRefusal) console.log(`   refusal: ${JSON.stringify(r.planningRefusal).slice(0, 300)}`);
}

// What does url.domain look like, and can it fan out over a list?
for (const id of ["builtin:url.domain", "builtin:list.first-url"]) {
  const e = await c.callTool("context_explain", { id });
  console.log(`\n${id}: inputs=${JSON.stringify(e?.capability?.inputs)} outputs=${JSON.stringify(e?.capability?.outputs)} risk=${e?.capability?.risk}`);
}
c.close();
