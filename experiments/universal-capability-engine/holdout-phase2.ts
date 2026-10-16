// Stage G (holdout), phase 2: Stage A's criteria on the two chosen holdout programs, on the frozen
// build, with no product change. The tasks and independent checks below were written after phase 1
// (which showed what RightClick X learned) and before any of these executions.
//   node experiments/universal-capability-engine/holdout-phase2.ts <freeze-tag>
import { readFileSync, writeFileSync } from "node:fs";
import { Mcp, frozenBuild, serverFiles } from "../life-science/harness.ts";

const TAG = process.argv[2];
const OUT = "experiments/universal-capability-engine/evidence";
const p1 = JSON.parse(readFileSync(`${OUT}/holdout-phase1-${TAG}.json`, "utf8"));
const build = frozenBuild(TAG);
process.env.RCX_INVESTIGATE = `${p1.bin}/`;

/** The harness's own tab expansion (tab stops every 8 columns). */
const expandTabs = (s: string) => s.split("\n").map((line) => {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(8 - (out.length % 8)) : ch;
  return out;
}).join("\n");

const words = (x: string) => x.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const balanced = (x: string) => {
  const st: string[] = [];
  for (const m of x.replace(/<\?[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, "").matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === "/") continue;
    if (!m[1]) st.push(m[2]);
    else if (st.pop() !== m[2]) return false;
  }
  return st.length === 0;
};

// Tasks for the uce-freeze-3 draws, written after phase 1 on uce-freeze-3 and before these executions.
const TASKS_FREEZE3: Record<string, any> = {
  zipinfo: {
    intent: "list detailed information about a zip archive",
    want: "text",
    // Text content cannot carry a ZIP archive; the check is whether the output is a listing at all.
    inputs: ["not an archive, just text\n", "PK this is still not a zip\n"],
    check: (outs: unknown[]) => {
      const error = outs.some((o) => /not a zipfile|signature not found|cannot find|error/i.test(String(o)));
      return { pass: !error && outs.every((o) => typeof o === "string" && o.trim().length > 0), detail: `output is an error report: ${error}` };
    },
  },
  xmllint: {
    intent: "check and reformat an xml document",
    want: "text",
    inputs: ['<?xml version="1.0"?><catalog><book id="b1"><title>Harbour lights</title><year>1998</year></book><book id="b2"><title>Salt roads</title></book></catalog>\n'],
    check: (outs: unknown[], ins: string[]) => {
      const o = String(outs[0] ?? "");
      const missing = [...new Set(words(ins[0]))].filter((w) => !words(o).includes(w));
      return { pass: !!o.trim() && balanced(o) && !missing.length, detail: `balanced ${balanced(o)}; words missing ${missing.join(",") || "none"}` };
    },
  },
};

// Tasks for the uce-freeze-4 draws, written after phase 1 on uce-freeze-4 and before these executions.
const TASKS_FREEZE4: Record<string, any> = {
  htmltree: {
    intent: "parse an html document and dump its parse tree",
    want: "text",
    inputs: ["<html><head><title>Garden log</title></head><body><h1>Spring</h1><p>Tulips <em>early</em></p><ul><li>water</li></ul></body></html>\n"],
    check: (outs: unknown[], ins: string[]) => {
      const o = String(outs[0] ?? "");
      const elements = [...new Set([...ins[0].matchAll(/<([a-z][a-z0-9]*)\b/gi)].map((m) => m[1].toLowerCase()))];
      const missingEl = elements.filter((e) => !new RegExp(`\\b${e}\\b`, "i").test(o));
      const missingW = [...new Set(words(ins[0]))].filter((w) => !words(o).includes(w));
      return { pass: !!o.trim() && !missingEl.length && !missingW.length, detail: `elements missing ${missingEl.join(",") || "none"}; words missing ${missingW.join(",") || "none"}` };
    },
  },
  mp2bug: {
    intent: "generate a mod_perl bug report",
    want: "text",
    inputs: ["Requests to the gallery handler hang after upgrading the server\n"],
    check: (outs: unknown[], ins: string[]) => {
      const o = String(outs[0] ?? "");
      const missing = [...new Set(words(ins[0]))].filter((w) => !words(o).includes(w));
      return { pass: !!o.trim() && !missing.length, detail: `description words missing from the report: ${missing.join(",") || "none"}` };
    },
  },
};

const TASKS: Record<string, { intent: string; want: string; inputs: string[]; check: (outputs: unknown[], inputs: string[]) => { pass: boolean; detail: string } }> = {
  expand: {
    intent: "expand tabs to spaces",
    want: "text",
    inputs: ["name\tqty\tprice\napple\t3\t0.5\nkiwi\t12\t0.25\n", "a\tbc\tdefghijkl\tm\n\tindented\n"],
    check: (outs, ins) => {
      const ok = outs.map((o, i) => o === expandTabs(ins[i]));
      return { pass: ok.every(Boolean), detail: `exact match with the harness's own expansion: ${ok.join(", ")}` };
    },
  },
  "cups-config": {
    intent: "get cups api, compiler, directory and link information",
    want: "text",
    // No input-derived property exists for this program; the check is whether the capability's output
    // depends on its input at all (a capability that ignores its input is not the claimed behaviour).
    inputs: ["alpha\n", "an entirely different input\n"],
    check: (outs) => {
      const usage = outs.some((o) => /^\s*Usage:/m.test(String(o)));
      const same = outs.length === 2 && outs[0] === outs[1];
      return { pass: !usage && !same, detail: `output is a usage message: ${usage}; identical for different inputs: ${same}` };
    },
  },
};

const ev: any = { tag: TAG, commit: build.commit, programs: {} };
const f = serverFiles(`${p1.bin}/../phase2`);
const { copyFileSync } = await import("node:fs");
copyFileSync(p1.state, f.state);
for (const name of p1.chosen as string[]) {
  const task = TASKS[name] ?? TASKS_FREEZE3[name] ?? TASKS_FREEZE4[name];
  if (!task) throw new Error(`no task written for ${name}`);
  const m = new Mcp(build.rcx, f);
  await m.init();
  const outputs: unknown[] = [];
  const runs: any[] = [];
  for (const input of task.inputs) {
    const r = await m.tool("context_compose", { have: { input: { type: "text", value: input } }, want: task.want, intent: task.intent, run: true, view: { full: true } });
    outputs.push(r.value?.executed?.output);
    runs.push({ status: r.value?.executed?.status, plan: r.value?.executed?.titles, attempts: r.value?.executed?.attempts });
  }
  await m.close();
  // Retained across a restart.
  const again = new Mcp(build.rcx, f);
  await again.init();
  const found = (await again.tool("context_graph", { op: "search", query: task.intent, limit: 10 })).value;
  const retained = (found.results ?? found).some((x: any) => String((x.capability ?? x).id).startsWith(`cli:${name}`));
  await again.close();
  const supported = p1.attempts.find((a: any) => a.program === name)?.supported;
  const check = task.check(outputs, task.inputs);
  const executed = runs.every((r) => r.status === "completed");
  const wrong = executed && !check.pass;
  ev.programs[name] = { runs, outputs, check, supported, retained, executed, wrongOutcome: wrong, pass: supported && executed && check.pass && retained };
  console.log(`${name}: ${ev.programs[name].pass ? "PASS" : "FAIL"} · executed ${executed} · ${check.detail} · retained ${retained}${wrong ? " · WRONG OUTCOME (presented as completed)" : ""}`);
}
writeFileSync(`${OUT}/holdout-phase2-${TAG}.json`, JSON.stringify(ev, null, 2));
