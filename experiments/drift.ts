// E10: self-maintaining integrations.
//
// The problem every integration team knows: the provider ships a breaking
// release and the client you wrote stops working. Here one service moves
// through four contracts (renamed REST fields, nested responses, then GraphQL,
// then MCP) behind one origin, over real HTTP. A hand-written v1 client is the
// control. The RightClick X integration is only a goal plus a check:
//
//   have {text, language} → want text, intent "summary translated",
//   verify: output contains "Hola mundo"
//
//   node experiments/drift.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { evolvingPolyglot, handWrittenClient, type Version } from "../demo/evolving.ts";
import { serve } from "../src/entry/node-host.ts";
import { RightClick } from "../src/runtime.ts";

const log = (...a: unknown[]) => console.log(...a);
const svc = evolvingPolyglot();
const server = await serve(svc.handler, 0);
const ORIGIN = server.url;
const rc = await RightClick.create({ name: "rcx-drift" });
await rc.learn({ source: `${ORIGIN}/` });

const GOAL = {
  have: { text: "Hello world. The weather is sunny today.", language: "es" },
  want: "text",
  intent: "summary translated",
  verify: [{ op: "contains" as const, value: "Hola mundo" }],
};

const CHANGES: Record<Version, string> = {
  1: "REST  POST /translate {text, target} → {translatedText}",
  2: "REST  POST /v2/translations {input, targetLanguage} → {result:{translation}}",
  3: "GraphQL  translate(input, to) { translation }",
  4: "MCP  tool translate_text {text, language} → {translation}",
};

const rows = [];
for (const v of [1, 2, 3, 4, 1] as Version[]) {
  svc.setVersion(v);
  let control: string;
  try {
    control = `✓ "${(await handWrittenClient(ORIGIN, "Hello world", "es")).slice(0, 20)}"`;
  } catch (e) {
    control = `✗ ${(e as Error).message}`;
  }
  const t = performance.now();
  const r = await rc.compose({ ...GOAL, run: true });
  const ms = Math.round(performance.now() - t);
  const translator = r.executed?.runs.map((id) => rc.runs.get(id)!).find((x) => !/^(builtin|composite)/.test(x.provider));
  const healing = r.executed?.attempts.map((a) => a.healing).filter(Boolean) ?? [];
  const row = {
    version: v,
    contract: CHANGES[v],
    handWrittenClient: control,
    rightclick: r.executed?.status === "completed" && r.executed.verification.status === "verified" ? "✓ verified" : `✗ ${r.executed?.status}`,
    via: translator ? `${rc.graph.providers.get(translator.provider)?.source ?? "?"} ${translator.capability.split(":").pop()}` : "-",
    pipeline: r.executed?.titles,
    healing,
    ms,
    output: String(r.executed?.output ?? ""),
    crystallized: r.crystallized?.id,
  };
  rows.push(row);
  log(`\nv${v}  ${CHANGES[v]}`);
  log(`  hand-written client  ${control}`);
  log(`  RightClick X         ${row.rightclick} in ${ms}ms via ${row.via}  →  "${row.output}"`);
  for (const h of healing) log(`    ↻ ${h}`);
}
const integrationCodeChanges = 0;
const chain = await rc.verifyReceipts();
log(`\nintegration code changed across 4 breaking releases and a rollback: ${integrationCodeChanges} lines · receipts ${chain.count}, intact ${chain.intact}`);
await server.close();

mkdirSync("experiments/results", { recursive: true });
writeFileSync("experiments/results/E10-drift.json", JSON.stringify({ at: new Date().toISOString(), goal: GOAL, rows, integrationCodeChanges, receipts: chain }, null, 2));
log("results → experiments/results/E10-drift.json");
