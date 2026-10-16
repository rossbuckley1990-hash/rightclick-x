// Capability investigation for command-line programs that publish no machine-readable contract.
//
// Given only a program the operator authorised (discovery authority), this learns what the
// program can do from what it declares (usage text, manual page) and from bounded, sandboxed
// experiments with synthetic inputs, and turns behaviour it can support with evidence into
// typed capabilities. Nothing here knows any particular program.
//
// Evidence statuses: declared (the program's own documentation says so), observed (seen in a
// run), inferred (derived from declarations or observations, not tested), experimentally
// supported (consistent across distinct inputs and repeat runs), contradicted (declared but not
// what was observed), unknown. "verified" is never set here: only independent checks set it.

import type { Capability, CliInvoke, Port, Reflection, SemType } from "../core/types.ts";
import { inferType } from "../core/semantics.ts";
export type { CliInvoke };
import type { Sandbox, SandboxRun } from "../core/sandbox.ts";

export type EvidenceStatus = "declared" | "observed" | "inferred" | "experimentally-supported" | "verified" | "contradicted" | "unknown";

export interface Claim {
  subject: string;
  claim: string;
  status: EvidenceStatus;
  evidence: string;
}


export interface Investigation {
  program: { bin: string; name: string; sha256: string; size: number; version?: string; description?: string };
  sandbox: string;
  runs: Array<{ id: number; purpose: string; args: string[]; stdinBytes: number; files: string[]; code: number | null; timedOut: boolean; stdoutBytes: number; stderrPreview: string; stdoutPreview: string; created: string[]; ms: number }>;
  options: Array<{ flags: string[]; arg?: string; description: string }>;
  operands: { required: string[]; optional: string[]; variadic: boolean };
  claims: Claim[];
  limits: { maxRuns: number; timeoutMs: number; maxOutputBytes: number };
  summary: string;
}

const MAX_RUNS = 60;

// ---------------------------------------------------------------- declared documentation

export function parseUsage(text: string): { options: Investigation["options"]; synopsis: string[] } {
  const clean = text.replace(/.\x08/g, "");
  const options: Investigation["options"] = [];
  const seen = new Set<string>();
  for (const line of clean.split("\n")) {
    const m = /^\s{0,12}((?:-{1,2}[A-Za-z0-9?][\w-]*(?:[ =](?:<[^>]+>|[A-Z][A-Z_]+|\[[^\]]+\]))?(?:,\s*|\s+or\s+|\s+))+)(.*)$/.exec(line);
    if (!m) continue;
    const flags = [...m[1].matchAll(/-{1,2}[A-Za-z0-9?][\w-]*/g)].map((x) => x[0]);
    if (!flags.length || seen.has(flags[0])) continue;
    const arg = /(?:[ =])(<[^>]+>|[A-Z][A-Z_]+|\[[^\]]+\])/.exec(m[1])?.[1];
    seen.add(flags[0]);
    options.push({ flags, ...(arg ? { arg } : {}), description: m[2].trim().slice(0, 200) });
  }
  const synopsis = clean.split("\n").filter((l) => /^\s*(usage:|\s*[a-z][\w-]*\s+\[-)/i.test(l)).map((l) => l.trim()).slice(0, 6);
  return { options: options.slice(0, 120), synopsis };
}

/** Operands named in a synopsis line: required ones outside brackets, optional ones inside. */
export function parseOperands(synopsis: string[], name: string): Investigation["operands"] {
  const required: string[] = [];
  const optional: string[] = [];
  let variadic = false;
  for (const raw of synopsis) {
    const line = raw.replace(/^usage:\s*/i, "");
    const after = line.slice(line.indexOf(name) >= 0 ? line.indexOf(name) + name.length : 0);
    // Drop option groups, then read what is left.
    const noOpts = after.replace(/\[\s*-[^\]]*\]/g, " ");
    for (const m of noOpts.matchAll(/\[([^\]]+)\]|([A-Za-z][\w.-]*)/g)) {
      if (m[1]) {
        const word = /[A-Za-z][\w-]*/.exec(m[1])?.[0];
        if (word && !/^-/.test(m[1].trim())) optional.push(word);
        if (/\.\.\./.test(m[1])) variadic = true;
      } else if (m[2] && !/^(options?|flags?)$/i.test(m[2])) required.push(m[2].replace(/\.+$/, ""));
    }
    if (/\.\.\./.test(noOpts)) variadic = true;
    if (required.length || optional.length) break;
  }
  return { required: [...new Set(required)].slice(0, 4), optional: [...new Set(optional)].slice(0, 4), variadic };
}

// ---------------------------------------------------------------- synthetic samples (generic)

interface Sample { kind: string; content: string }

/** Generic sample documents, chosen by words the program's own documentation uses. */
export function samplesFor(docs: string, seed: number): Sample[] {
  const d = docs.toLowerCase();
  const pick = <T,>(xs: T[], i: number) => xs[(seed + i) % xs.length];
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
  const sentence = (i: number) => `${pick(words, i)} ${pick(words, i + 3)} ${pick(words, i + 7)} line ${i + seed % 7}`;
  const out: Sample[] = [];
  if (/\bx?html\b/.test(d)) {
    out.push({ kind: "html", content: `<html><head><title>${sentence(1)}</title></head><body><h1>${sentence(2)}</h1><p>${sentence(3)}<p>${sentence(4)}<ul><li>${pick(words, 5)}<li>${pick(words, 6)}</ul></body></html>\n` });
    out.push({ kind: "html", content: `<!DOCTYPE html>\n<html>\n<head><title>${sentence(5)}</title></head>\n<body>\n<div><b>${sentence(6)}</div>\n<table><tr><td>${pick(words, 8)}<td>${pick(words, 9)}</table>\n</body>\n</html>\n` });
  }
  if (/\bxml\b/.test(d)) out.push({ kind: "xml", content: `<?xml version="1.0"?>\n<items><item id="${seed % 97}">${sentence(1)}</item><item id="${(seed + 1) % 97}">${sentence(2)}</item></items>\n` });
  if (/\bjson\b/.test(d)) out.push({ kind: "json", content: JSON.stringify({ name: pick(words, 1), count: seed % 50, tags: [pick(words, 2), pick(words, 3)] }) + "\n" });
  if (/\bcsv\b|comma.separated/.test(d)) out.push({ kind: "csv", content: `name,count\n${pick(words, 1)},${seed % 9}\n${pick(words, 2)},${(seed + 3) % 9}\n` });
  // Plain text, in related pairs that differ in some lines (useful to compare/merge tools).
  for (const v of [0, 11]) {
    const base = Array.from({ length: 6 + (v % 3) }, (_, i) => sentence(i + v));
    const changed = base.map((l, i) => (i === 2 ? `${l} changed` : i === 4 ? sentence(i + 20 + v) : l));
    out.push({ kind: "text", content: base.join("\n") + "\n" });
    out.push({ kind: "text", content: changed.join("\n") + "\n" });
  }
  return out;
}

// ---------------------------------------------------------------- observations

/** JSON output: fields present with the same kind in every observed result become ports (marked observed). */
export function observedFields(outputs: string[]): Port[] {
  const parsed = outputs.map((o) => {
    try {
      return JSON.parse(o);
    } catch {
      return undefined;
    }
  });
  if (parsed.some((p) => p === undefined)) return [];
  const leaves = (v: unknown, prefix: string, depth: number, out: Map<string, unknown>) => {
    if (depth > 3 || !v || typeof v !== "object" || Array.isArray(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (x && typeof x === "object" && !Array.isArray(x)) leaves(x, path, depth + 1, out);
      else out.set(path, x);
    }
    return out;
  };
  const maps = parsed.map((p) => leaves(p, "", 0, new Map()) ?? new Map());
  const first = maps[0];
  const ports: Port[] = [];
  for (const [path, value] of first) {
    const kinds = maps.map((m) => (m.has(path) ? typeof m.get(path) : "missing"));
    if (kinds.some((k) => k !== kinds[0] || k === "missing")) continue;
    const name = path.split(".").pop()!;
    const type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : Array.isArray(value) ? "list:json" : inferType(name, { type: "string" });
    ports.push({ name: path, type: type === "id" ? "text" : type, required: true, observed: true });
  }
  return ports.slice(0, 40);
}

const visibleText = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function outputKind(stdout: string): CliInvoke["output"] {
  const t = stdout.trim();
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* not json */
    }
  }
  if (/^<\?xml\b/i.test(t) && !/<html\b/i.test(t)) return "xml";
  if (/<(!doctype html|html|body|head|p|div)\b/i.test(t)) return "html";
  return "text";
}

const SEM: Record<string, SemType> = { html: "html", xml: "text", json: "json", csv: "text", text: "text" };

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";
}

const OUTPUT_WORDS = /\b(output|print|show|display|format|indent|pretty|quiet|suppress|error|warning|report|count|side|column|wrap|sort|unique|case|upper|lower|number|summary|xml|xhtml|json|clean|strip|compact|width|minimal|verbose|ignore|merge|left|right|common|only)\b/i;

export async function investigateCli(bin: string, sandbox: Sandbox, opts: { seed?: number } = {}): Promise<{ reflection: Reflection | null; investigation: Investigation }> {
  const fs = await import("node:fs");
  const crypto = await import("node:crypto");
  const path = await import("node:path");
  const name = path.basename(bin);
  const seed = opts.seed ?? 7;
  const inv: Investigation = {
    program: { bin, name, sha256: "", size: 0 },
    sandbox: sandbox.kind,
    runs: [],
    options: [],
    operands: { required: [], optional: [], variadic: false },
    claims: [],
    limits: { maxRuns: MAX_RUNS, timeoutMs: 5000, maxOutputBytes: 1_000_000 },
    summary: "",
  };
  const claim = (subject: string, c: string, status: EvidenceStatus, evidence: string) => inv.claims.push({ subject, claim: c, status, evidence });
  if (!fs.existsSync(bin)) {
    inv.summary = `${bin} is not installed`;
    claim(name, "program is present", "contradicted", `no file at ${bin}`);
    return { reflection: null, investigation: inv };
  }
  const bytes = fs.readFileSync(bin);
  inv.program.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  inv.program.size = bytes.length;

  let budget = MAX_RUNS;
  const run = async (purpose: string, args: string[], o: { stdin?: string; files?: Record<string, string> } = {}): Promise<SandboxRun | null> => {
    if (budget-- <= 0) return null;
    const r = await sandbox.run(bin, args, o);
    inv.runs.push({ id: inv.runs.length + 1, purpose, args, stdinBytes: (o.stdin ?? "").length, files: Object.keys(o.files ?? {}), code: r.code, timedOut: r.timedOut, stdoutBytes: r.stdout.length, stdoutPreview: r.stdout.slice(0, 300), stderrPreview: r.stderr.slice(0, 300), created: r.created, ms: r.durationMs });
    return r;
  };

  // 1. Declared: usage text and manual page.
  let usage = "";
  for (const a of [["--help"], ["-h"], []]) {
    const r = await run("read usage text", a);
    const text = `${r?.stdout ?? ""}\n${r?.stderr ?? ""}`;
    if (r && !r.timedOut && /usage|options?:|synopsis/i.test(text) && text.trim().length > usage.trim().length) usage = text;
    if (usage) break;
  }
  let manual = "";
  const m = await sandbox.run("/usr/bin/man", ["-P", "cat", name]).catch(() => null);
  if (m && m.code === 0) manual = m.stdout.replace(/.\x08/g, "");
  // Purpose: the manual's NAME line; without a manual, the first prose line of the usage text.
  const prose = usage.split("\n").map((l) => l.trim()).find((l) => l && !/^(usage|options?|synopsis)\b/i.test(l) && !/^-/.test(l) && /[a-z]{3,}\s+[a-z]{3,}/i.test(l));
  inv.program.description = /NAME\s*\n\s*(.+?)\n\s*\n/s.exec(manual)?.[1]?.replace(/\s+/g, " ").trim() ?? (prose ? `${name} - ${prose}` : undefined);
  const version = await run("read version", ["--version"]);
  if (version && version.code === 0 && version.stdout.trim()) inv.program.version = version.stdout.trim().split("\n")[0].slice(0, 120);
  const docs = `${usage}\n${manual}`;
  if (!docs.trim()) {
    claim(name, "documents its usage", "unknown", "no usage text or manual page");
  } else {
    claim(name, "documents its usage", "declared", usage ? "usage text" + (manual ? " and manual page" : "") : "manual page");
  }
  const parsed = parseUsage(docs);
  inv.options = parsed.options;
  const synopsis = [...parsed.synopsis, ...(/SYNOPSIS\s*\n([\s\S]*?)\n\s*\n/.exec(manual)?.[1]?.split("\n").map((l) => l.trim()) ?? [])];
  inv.operands = parseOperands(synopsis, name);
  if (inv.program.description) claim(name, `purpose: ${inv.program.description}`, "declared", "manual page NAME section");
  claim(name, `options: ${inv.options.length} declared`, inv.options.length ? "declared" : "unknown", "usage/manual option lines");
  claim(name, `operands: required [${inv.operands.required.join(", ")}], optional [${inv.operands.optional.join(", ")}]${inv.operands.variadic ? ", variadic" : ""}`, synopsis.length ? "inferred" : "unknown", synopsis.slice(0, 2).join(" | "));

  // 2. Experiments with synthetic inputs (never the evaluator's inputs).
  const samples = samplesFor(docs, seed);
  const kinds = [...new Set(samples.map((s) => s.kind))];
  const required = inv.operands.required.length;
  const channels: Array<{ id: string; arity: number }> = required >= 2 ? [{ id: "files", arity: required }] : required === 1 ? [{ id: "files", arity: 1 }] : [{ id: "stdin", arity: 1 }, { id: "files", arity: 1 }];

  interface Trial { mode: string; flags: string[]; channel: string; kind: string; inputs: string[]; r: SandboxRun }
  const trials: Trial[] = [];
  // variant selects a different sample (or a different pair of samples for two-operand programs).
  const attempt = async (mode: string, flags: string[], channel: { id: string; arity: number }, kind: string, variant = 0): Promise<Trial | null> => {
    const pool = samples.filter((s) => s.kind === kind);
    const pairs = Math.max(1, Math.floor(pool.length / 2));
    const texts = channel.arity === 2
      ? pool.length >= 2 ? [pool[(variant % pairs) * 2].content, pool[(variant % pairs) * 2 + 1].content] : [pool[0]?.content, samples.find((s) => s.kind === "text")?.content]
      : [pool[variant % pool.length]?.content];
    if (texts.some((t) => !t)) return null;
    const files = channel.id === "files" ? Object.fromEntries(texts.map((t, i) => [`input${i + 1}.${kind === "text" ? "txt" : kind}`, t!])) : undefined;
    const args = [...flags, ...(files ? Object.keys(files) : [])];
    const r = await run(`mode ${mode}: ${kind} via ${channel.id}`, args, { stdin: channel.id === "stdin" ? texts[0] : undefined, files });
    if (!r) return null;
    const t = { mode, flags, channel: channel.id, kind, inputs: texts as string[], r };
    trials.push(t);
    return t;
  };
  const works = (t: Trial | null) => !!t && !t.r.timedOut && !t.r.truncated && t.r.stdout.trim().length > 0;

  // Default mode on every channel and kind; keep the channels that work.
  const okChannels: Array<{ id: string; arity: number }> = [];
  for (const ch of channels) {
    let ok = false;
    for (const k of kinds) for (const v of [0, 1]) if (works(await attempt("default", [], ch, k, v))) ok = true;
    if (ok) okChannels.push(ch);
  }
  const best = okChannels[0];
  if (!best) {
    inv.summary = `no input channel produced output for ${name} (${trials.length} trials)`;
    claim(name, "produces output for supplied input", trials.length ? "contradicted" : "unknown", inv.summary);
    return { reflection: null, investigation: inv };
  }
  // Modes: flags without arguments whose own description is about the output.
  const candidates = inv.options.filter((o) => !o.arg && OUTPUT_WORDS.test(o.description) && !/version|help|usage|modify|in.place|write|output file|outfile|overwrite|save/i.test(o.description)).slice(0, 8);
  const primaryKind = kinds.find((k) => trials.some((t) => t.mode === "default" && t.channel === best.id && t.kind === k && works(t))) ?? kinds[0];
  for (const o of candidates) {
    const flag = o.flags[o.flags.length - 1];
    if (works(await attempt(flag.replace(/^-+/, ""), [flag], best, primaryKind, 0))) await attempt(flag.replace(/^-+/, ""), [flag], best, primaryKind, 1);
  }

  // Failure behaviour: empty input.
  const empty = await run("probe empty input", best.id === "files" ? Array.from({ length: best.arity }, (_, i) => `empty${i + 1}.txt`) : [], best.id === "files" ? { files: Object.fromEntries(Array.from({ length: best.arity }, (_, i) => [`empty${i + 1}.txt`, ""])) } : { stdin: "" });

  // 3. Behaviours: group working trials by mode; keep modes whose output differs from default.
  const okExit = [...new Set(trials.filter(works).map((t) => t.r.code ?? -1))].sort();
  const defaultOut = trials.find((t) => t.mode === "default" && t.channel === best.id && t.kind === primaryKind && works(t))?.r.stdout;
  const modes = [...new Set(trials.map((t) => t.mode))];
  const capabilities: Capability[] = [];
  const providerId = `cli:${slug(name)}`;
  for (const mode of modes) {
    const mt = trials.filter((t) => t.mode === mode && t.channel === best.id && works(t));
    if (!mt.length) {
      if (mode !== "default") claim(`${providerId}:${slug(mode)}`, `option ${trials.find((t) => t.mode === mode)?.flags.join(" ")} produces output`, "contradicted", "ran with a valid sample; no output");
      continue;
    }
    if (mode !== "default" && mt.every((t) => t.r.stdout === defaultOut)) {
      claim(`${providerId}:${slug(mode)}`, `option ${mt[0].flags.join(" ")} changes the output`, "contradicted", "output identical to the default mode");
      continue;
    }
    // Determinism: repeat the first working trial.
    const first = mt[0];
    const again = await run(`repeat for determinism (${mode})`, [...first.flags, ...(first.channel === "files" ? first.inputs.map((_, i) => `input${i + 1}.${first.kind === "text" ? "txt" : first.kind}`) : [])], first.channel === "stdin" ? { stdin: first.inputs[0] } : { files: Object.fromEntries(first.inputs.map((t, i) => [`input${i + 1}.${first.kind === "text" ? "txt" : first.kind}`, t])) });
    const deterministic = !!again && again.stdout === first.r.stdout;
    const outKinds = [...new Set(mt.map((t) => outputKind(t.r.stdout)))];
    const out = outKinds.length === 1 ? outKinds[0] : "text";
    const id = `${providerId}:${slug(mode)}`;
    const inKinds = [...new Set(mt.map((t) => t.kind))];
    const inType: SemType = inKinds.length === 1 ? SEM[inKinds[0]] ?? "text" : "text";
    // Relations between input and output, computed generically.
    const preserves = mt.every((t) => {
      const want = new Set(t.inputs.flatMap(visibleText));
      const got = new Set(visibleText(t.r.stdout));
      return [...want].every((w) => got.has(w));
    });
    const echoes = mt.every((t) => t.r.stdout.trim() === t.inputs[0].trim());
    const option = inv.options.find((o) => o.flags.some((f) => f.replace(/^-+/, "") === mode));
    const portNames = best.id === "stdin" ? [inType === "html" ? "html" : inType === "json" ? "json" : "input"] : (inv.operands.required.length ? inv.operands.required : ["file"]).slice(0, best.arity).map((n, i) => (/^[a-z][\w]*$/i.test(n) ? n : `file${i + 1}`));
    const inputs: Port[] = portNames.map((n) => ({ name: n, type: inType, required: true, description: best.id === "stdin" ? "Content given on standard input" : "Content passed as a file operand" }));
    const invoke: CliInvoke = {
      kind: "cli",
      bin,
      args: [...first.flags, ...(best.id === "files" ? portNames.map((n) => ({ input: n })) : [])],
      ...(best.id === "stdin" ? { stdin: portNames[0] } : {}),
      // Exit 0 is success by convention; other codes count only where observed with real output
      // (diff-like programs exit 1 when inputs differ).
      okExit: [...new Set([0, ...mt.map((t) => t.r.code ?? -1)])].sort(),
      output: out,
      sha256: inv.program.sha256,
    };
    const what = option ? option.description.replace(/\.$/, "") : inv.program.description?.replace(/^[^-–]+[-–]\s*/, "") ?? `run ${name}`;
    const supported = mt.length >= 2 && deterministic && new Set(mt.map((t) => t.inputs.join("\u0000"))).size >= 2;
    capabilities.push({
      id,
      title: `${name}${mode === "default" ? "" : ` ${mt[0].flags.join(" ")}`}: ${what}`,
      description: `${inv.program.description ?? name}. ${mode === "default" ? "Default behaviour" : `With ${mt[0].flags.join(" ")}: ${option?.description ?? ""}`}. Learned by sandboxed investigation of ${bin} (sha256 ${inv.program.sha256.slice(0, 12)}), not from a contract; runs only in the sandbox.`.slice(0, 400),
      provider: providerId,
      source: "cli",
      inputs,
      outputs: [{ name: "", type: SEM[out] ?? "text", required: true }, ...(out === "json" ? observedFields(mt.map((t) => t.r.stdout)) : [])],
      risk: "read",
      tags: [name, ...(inv.program.description ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? [], ...(option ? option.description.toLowerCase().match(/[a-z]{3,}/g) ?? [] : [])].slice(0, 30),
      invoke,
    });
    claim(id, `accepts ${inKinds.join("/")} input via ${best.id} and prints ${out}`, supported ? "experimentally-supported" : "observed", `${mt.length} run(s) with distinct inputs; exit ${invoke.okExit.join("/")}`);
    claim(id, "deterministic for identical input", again ? (deterministic ? "experimentally-supported" : "contradicted") : "unknown", again ? "repeated run compared byte for byte" : "no budget for a repeat");
    if (preserves) claim(id, "output keeps every word of the input", supported ? "experimentally-supported" : "observed", "word sets compared");
    if (echoes) claim(id, "output equals the input (no transformation)", "observed", "byte comparison");
    if (mt.some((t) => t.r.created.length)) claim(id, `creates files: ${[...new Set(mt.flatMap((t) => t.r.created))].join(", ")}`, "observed", "contained in the sandbox's temporary directory");
    claim(id, "side effects outside the sandbox", "unknown", "the sandbox prevents them; not observable");
    if (!deterministic) (capabilities[capabilities.length - 1].tags as string[]).push("nondeterministic");
  }
  if (empty) claim(name, `on empty input exits ${empty.code}${empty.stdout.trim() ? " with output" : " without output"}`, "observed", empty.stderr.slice(0, 120));
  inv.summary = `${capabilities.length} capabilit${capabilities.length === 1 ? "y" : "ies"} from ${inv.runs.length} sandboxed runs (${okChannels.map((c) => c.id).join(", ")}; ok exit ${okExit.join("/")})`;
  if (!capabilities.length) return { reflection: null, investigation: inv };
  return {
    reflection: {
      provider: {
        id: providerId,
        title: `${name} (command-line program)`,
        source: "cli",
        origin: bin,
        learnedAt: new Date().toISOString(),
        capabilityIds: capabilities.map((c) => c.id),
        meta: { investigation: inv, sha256: inv.program.sha256, version: inv.program.version },
      },
      capabilities,
    },
    investigation: inv,
  };
}
