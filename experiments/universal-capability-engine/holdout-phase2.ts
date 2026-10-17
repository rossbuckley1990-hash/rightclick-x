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

/** Reconstruct bytes from an od dump: octal bytes, octal/decimal 16-bit words (little-endian) or escaped chars. */
function odBytes(dump: string): number[] | null {
  const rows = dump.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^\*$/.test(l));
  const body = rows.map((l) => l.split(/\s+/).slice(1)).filter((x) => x.length);
  if (!body.length) return null;
  const tokens = body.flat();
  if (tokens.every((t) => /^[0-7]{3}$/.test(t))) return tokens.map((t) => parseInt(t, 8));
  const words16 = (base: number) => tokens.flatMap((t) => { const v = parseInt(t, base); return [v & 0xff, (v >> 8) & 0xff]; });
  if (tokens.every((t) => /^[0-7]{6}$/.test(t))) return words16(8);
  if (tokens.every((t) => /^\d{5}$/.test(t))) return words16(10);
  const esc: Record<string, number> = { "\\n": 10, "\\t": 9, "\\r": 13, "\\0": 0, "\\\\": 92 };
  const chars = rows.map((l) => l.replace(/^\d+\s*/, "")).join(" ");
  const parts = chars.match(/\\[ntr0\\]|\S/g);
  return parts ? parts.map((c) => esc[c] ?? c.charCodeAt(0)) : null;
}

// Tasks for the uce-freeze-5 draws, written after phase 1 on uce-freeze-5 and before these executions.
const TASKS_FREEZE5: Record<string, any> = {
  mandoc: {
    intent: "format a manual page",
    want: "text",
    inputs: [".Dd October 17, 2026\n.Dt LANTERN 1\n.Os\n.Sh NAME\n.Nm lantern\n.Nd light the harbour path\n.Sh DESCRIPTION\nThe\n.Nm\nutility guides boats home at dusk.\n"],
    check: (outs: unknown[], ins: string[]) => {
      const o = String(outs[0] ?? "");
      const content = ["lantern", "light", "harbour", "path", "utility", "guides", "boats", "home", "dusk"];
      const missing = content.filter((w) => !o.toLowerCase().includes(w));
      const rawMacros = o.split("\n").some((l) => /^\.[A-Z][a-z]\b/.test(l.trim()));
      return { pass: !!o.trim() && !missing.length && !rawMacros, detail: `words missing ${missing.join(",") || "none"}; raw macro lines left ${rawMacros}` };
    },
  },
  od: {
    intent: "octal dump of the bytes of a text",
    want: "text",
    inputs: ["Harbour lights\tat dusk\n"],
    check: (outs: unknown[], ins: string[]) => {
      const bytes = odBytes(String(outs[0] ?? ""));
      const want = [...new TextEncoder().encode(ins[0])];
      const got = bytes ? (bytes.length === want.length + 1 && bytes[bytes.length - 1] === 0 ? bytes.slice(0, -1) : bytes) : null;
      const ok = !!got && got.length === want.length && got.every((b, i) => b === want[i]);
      return { pass: ok, detail: `bytes reconstructed from the dump equal the input: ${ok}${got ? "" : " (dump not parseable)"}` };
    },
  },
};

// Tasks for the uce-freeze-6 draws, written after phase 1 on uce-freeze-6 (and the programs'
// documented usage), before these executions.
const expandTabsAt = (s: string, n: number) => s.split("\n").map((line) => {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(n - (out.length % n)) : ch;
  return out;
}).join("\n");
const TASKS_FREEZE6: Record<string, any> = {
  "net-snmp-create-v3-user": {
    intent: "create a snmpv3 user named harbourwatch",
    want: "text",
    inputs: ["harbourwatch\n"],
    check: (outs: unknown[]) => {
      const o = String(outs[0] ?? "");
      const created = /createUser\s+harbourwatch|adding the following line/i.test(o);
      return { pass: created, detail: `output shows the user being created: ${created}` };
    },
  },
  tab2space: {
    intent: "expand tabs to spaces",
    want: "text",
    inputs: ["name\tqty\tprice\napple\t3\t0.5\n", "a\tbc\tdefghijkl\tm\n"],
    check: (outs: unknown[], ins: string[]) => {
      // Documented default: tabs set to 4 spaces, CRLF line ends; line ends are normalised here.
      const ok = outs.map((o, i) => String(o ?? "").replace(/\r/g, "") === expandTabsAt(ins[i], 4));
      return { pass: ok.every(Boolean), detail: `exact match with the harness's own 4-column expansion: ${ok.join(", ")}` };
    },
  },
};

// Tasks for the uce-freeze-7 draws, written after phase 1 on uce-freeze-7, before these executions.
const TASKS_FREEZE7: Record<string, any> = {
  base64: {
    intent: "base64 encode a text",
    want: "text",
    inputs: ["Harbour lights at dusk\n", "Copper wire, brass hinges\n"],
    check: (outs: unknown[], ins: string[]) => {
      const ok = outs.map((o, i) => String(o ?? "").replace(/\s+/g, "") === Buffer.from(ins[i]).toString("base64"));
      return { pass: ok.every(Boolean), detail: `equal to the harness's own base64 encoding: ${ok.join(", ")}` };
    },
  },
  uuname: {
    intent: "list remote uucp sites",
    want: "text",
    // Takes no input data: a listing must be stable across inputs, not echo them, and not be an error.
    inputs: ["first unrelated input\n", "second unrelated input\n"],
    check: (outs: unknown[], ins: string[]) => {
      const o = outs.map((x) => String(x ?? ""));
      const stable = o.length === 2 && o[0] === o[1];
      const echoes = o.some((x, i) => x.includes(ins[i].trim()));
      const error = o.some((x) => /usage|error|not found|cannot|unable|invalid/i.test(x));
      return { pass: stable && !echoes && !error && !!o[0].trim(), detail: `stable ${stable}; echoes input ${echoes}; error text ${error}` };
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
  const task = TASKS[name] ?? TASKS_FREEZE3[name] ?? TASKS_FREEZE4[name] ?? TASKS_FREEZE5[name] ?? TASKS_FREEZE6[name] ?? TASKS_FREEZE7[name];
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
