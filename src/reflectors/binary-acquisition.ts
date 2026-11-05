// Empirical acquisition of binary transformations, and the bootstrapping that lets one acquired
// capability supply the evidence that acquires the next.
//
// A program's documentation nominates formats (format words and the file extensions its usage
// gives its operands) and output options; experiments decide what is true. For each candidate
// input format with two valid samples, the investigation tries the generic ways a program can take
// one file and produce another (an output option, positional operands, standard output, standard
// input). A transformation is established only when all of these hold, and stays unknown
// otherwise:
//
//   - the program exits 0 on a valid sample and its output is recognised as one format;
//   - a second, different sample gives an output of the same format that differs from the first;
//   - the first sample again gives the same output, byte for byte or fact for fact;
//   - for a form that names its output (an extension), the output is that format;
//   - facts the output kept from the input (width, height, pages, decoded pixels, ...) are equal in
//     both confirming trials; they become checks repeated on every run.
//
// Samples come from a pool with recorded provenance: generated fixtures (core/fixtures.ts),
// operator-approved sample corpora, and the outputs of capabilities already acquired. That last
// source is what makes acquisition accumulate:
//
//   - a format RightClick has no validator for (a provisional `x-ext/<ext>` type named by the
//     documentation) is witnessed when one program turns a known format into it and another turns
//     it back, keeping the original's facts: both transformations are then established;
//   - a fact a format cannot show directly (the pixels of a WebP or AVIF file) is witnessed by
//     decoding the output with an acquired decoder;
//   - documented flags are tested on controlled inputs; one that changes the output format, or
//     makes a transformation keep more (exact pixels), becomes its own established variant.
//
// Nothing here is specific to a program, and nothing is promoted on one demonstration.

import { FORMATS, bytesType, documentedOperandExtensions, formatForExt, formatOf, identify, isProvisional, normaliseDocs, provisionalType, type BinaryFormat, type Facts } from "../core/formats.ts";
import { FIXTURE_MAX_BYTES, fixtureFor, mutate } from "../core/fixtures.ts";
import { normaliseSandboxPaths, type Sandbox, type SandboxRun } from "../core/sandbox.ts";
import type { BinaryContract, BinaryTrial, Capability } from "../core/types.ts";
import { fileRole, type Investigation } from "./cli.ts";

export const BINARY_LIMITS = Object.freeze({
  /** Sandboxed runs one program's acquisition may use, per round. */
  maxTrials: 80,
  /** Per-run time limit. */
  timeoutMs: 5000,
  /** Candidate input formats tried per program. */
  maxInputFormats: 5,
  /** Candidate output formats tried per input format. */
  maxOutputFormats: 6,
  /** Documented flags tested per established transformation. */
  maxFlags: 10,
});

/** Facts that are comparable across formats, so a transformation can be seen to keep them. */
const RELATION_FACTS = ["width", "height", "pages", "frames", "entries", "pixels"];

/** An available sample of one format, with where it came from. */
export interface Sample {
  mediaType: string;
  bytes: Uint8Array;
  source: string;
  /**
   * For a sample of a format RightClick cannot read (a provisional type, or one whose facts it
   * cannot decode): the facts of the known input it was made from, and the capability that made
   * it. A consumer that recovers those facts witnesses both itself and that producer.
   */
  origin?: { mediaType: string; facts: Facts; via: string; lossless?: boolean };
}
/** Kept for callers of the earlier interface: a validated sample from another source. */
export type CorpusSample = Sample;

/** A transformation whose output format is not yet witnessed: kept as evidence, never executed. */
export interface Candidate {
  id: string;
  provider: string;
  bin: string;
  sha256: string;
  contract: BinaryContract;
}

export interface AcquisitionContext {
  /** Samples available to test with, from every recorded source. */
  pool?: Sample[];
  /** Decode bytes of a format through an acquired decoder: facts of the result, and who decoded it. */
  decode?: (mediaType: string, bytes: Uint8Array) => Promise<{ facts: Facts; by: string } | undefined>;
  maxTrials?: number;
  timeoutMs?: number;
}

export interface BinaryAcquisition {
  capabilities: Capability[];
  /** Transformations into a format nobody has witnessed yet. */
  candidates: Candidate[];
  /** Samples this investigation produced (outputs of its confirming trials), for other programs. */
  produced: Sample[];
  /** Producers (capability or candidate ids) whose outputs this investigation witnessed. */
  witnessed: Array<{ producer: string; facts: string[]; by: string }>;
  /** Formats the documentation names that no sample was available for. */
  needs: string[];
  claims: Investigation["claims"];
  trials: BinaryTrial[];
  summary: string;
}

/** A format as acquisition sees it: one with a validator, or one named only by documentation. */
interface Fmt { mediaType: string; slug: string; ext: string; known?: BinaryFormat; role?: "input" | "output" | "any" }
const fmtOf = (mediaType: string): Fmt => {
  const k = formatOf(mediaType);
  return k ? { mediaType, slug: k.slug, ext: k.ext, known: k } : { mediaType, slug: mediaType.slice(6), ext: mediaType.slice(6) };
};

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function sha256(b: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/** The leading bytes all of these share (at most 16), as hex. */
export function commonPrefix(bs: Uint8Array[]): string {
  let n = 0;
  while (n < 16 && bs.every((b) => n < b.length && b[n] === bs[0][n])) n++;
  return hex(bs[0].subarray(0, n));
}
/** Does a provisional format's sample carry the signature its witnesses shared? */
export const matchesSignature = (b: Uint8Array, signature: string) => b.length > signature.length / 2 && hex(b.subarray(0, signature.length / 2)) === signature;

/**
 * Formats the documentation names, in the order it first names them: format words (CamelCase
 * split, so "GifFile" names GIF) and the extensions its usage gives operands. An extension the
 * format library does not know becomes a provisional format; it can be established only by a
 * witness, never by its name.
 */
export function documentedFormats(docs: string, program = ""): BinaryFormat[] {
  return candidateFormats(docs, program).flatMap((f) => (f.known ? [f.known] : []));
}
function candidateFormats(docs: string, program: string): Fmt[] {
  const split = normaliseDocs(docs);
  // A format word counts in the text as written ("WebP") or with CamelCase split ("Gif File").
  const at = (re: RegExp) => { const a = docs.search(re), b = split.search(re); return a < 0 ? b : b < 0 ? a : Math.min(a, b); };
  const out: Array<{ f: Fmt; at: number }> = FORMATS.map((f) => ({ f: fmtOf(f.mediaType), at: at(f.words) })).filter((x) => x.at >= 0);
  for (const { ext, role } of documentedOperandExtensions(docs, program)) {
    const known = formatForExt(ext);
    const mt = known?.mediaType ?? provisionalType(ext);
    const existing = out.find((x) => x.f.mediaType === mt);
    if (!existing) out.push({ f: { ...fmtOf(mt), role }, at: Math.max(0, docs.toLowerCase().indexOf(`.${ext}`)) });
    else if (!known) existing.f.role = role;
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.f).filter((f, i, all) => all.findIndex((g) => g.mediaType === f.mediaType) === i);
}

/** Run an established contract once in the sandbox: its output, or undefined. Used to make samples and decode. */
export async function runContract(sandbox: Sandbox, bin: string, c: BinaryContract, input: Uint8Array, timeoutMs = BINARY_LIMITS.timeoutMs): Promise<Uint8Array | undefined> {
  const r = await sandbox.run(bin, c.argv, {
    ...(c.input.via === "file" ? { files: { [c.input.name!]: input } } : { stdin: input }),
    ...(c.output.via === "file" ? { collect: [c.output.name!] } : {}),
    rawStdout: true, limits: { timeoutMs }, purpose: "investigation",
  });
  if (r.code !== 0 || r.timedOut || r.truncated || r.limit) return undefined;
  const out = c.output.via === "file" ? r.outputs?.[c.output.name!] : r.stdoutRaw;
  return out && out.length ? out : undefined;
}

export async function acquireBinary(bin: string, sandbox: Sandbox, inv: Investigation, docs: string, ctx: AcquisitionContext = {}): Promise<BinaryAcquisition> {
  const name = bin.split("/").pop() ?? bin;
  const providerId = `cli:${slugOf(name)}`;
  const claims: Investigation["claims"] = [];
  const trials: BinaryTrial[] = [];
  const result: BinaryAcquisition = { capabilities: [], candidates: [], produced: [], witnessed: [], needs: [], claims, trials, summary: "" };
  const claim = (subject: string, c: string, status: Investigation["claims"][number]["status"], evidence: string) => claims.push({ subject, claim: c, status, evidence });
  const documented = candidateFormats(docs, name);
  if (!documented.length) {
    claim(name, "handles a binary format", "unknown", "its documentation names no format RightClick knows and no operand file extension");
    result.summary = "no documented binary format";
    return result;
  }

  // Valid inputs: generated fixtures, then pool samples (validated if the format has a validator).
  const samples = (f: Fmt): Sample[] => {
    const out: Sample[] = [];
    if (f.known) for (const seed of [1, 2]) { const b = fixtureFor(f.mediaType, seed); if (b) out.push({ mediaType: f.mediaType, bytes: b, source: `generated ${f.slug} fixture, seed ${seed}` }); }
    // Samples made by a producer proven lossless come first: they let a decoder be shown exact.
    const pool = [...(ctx.pool ?? [])].sort((a, b) => Number(!!b.origin?.lossless) - Number(!!a.origin?.lossless));
    for (const s of pool) {
      if (out.length >= 2) break;
      if (s.mediaType !== f.mediaType || s.bytes.length > FIXTURE_MAX_BYTES || out.some((o) => equalBytes(o.bytes, s.bytes))) continue;
      if (f.known ? f.known.validate(s.bytes).ok : !!s.origin) out.push(s);
    }
    return out;
  };
  const sampled = documented.filter((f) => (f.known || f.role !== "output") && samples(f).length >= 2);
  const inputs = sampled.slice(0, BINARY_LIMITS.maxInputFormats);
  // A need is a format with no samples yet, not one left out by the per-program bound.
  for (const f of documented) if (!sampled.includes(f) && (f.known || f.role !== "output")) { result.needs.push(f.mediaType); claim(name, `reads ${f.mediaType}`, "unknown", "documented, but no two valid samples of this format are available yet"); }
  if (!inputs.length) {
    result.summary = `documents ${documented.map((f) => f.slug).join(", ")}, but no valid samples are available yet`;
    return result;
  }

  // Options that may name the output file: a write role, a placeholder named for output, or a
  // one-value option described as the output file. The documentation nominates; experiments decide.
  const OUTPUT_OPTION = /\boutput\b[^.]{0,30}\b(file|name|path)\b|\b(file|name|path)\b[^.]{0,20}\boutput\b|\bwrite[sd]? (the )?(output|result)\b/i;
  const OUTPUT_ARG = /^(out|output)([_ -]?(file|name|path|filename))?$|^outfile$/i;
  // The option's own name ("--output", "--dest"), or a filename-like placeholder ("<a.gif>") with a
  // description that speaks of writing or a destination, nominate it as well.
  const OUTPUT_FLAG = /^-{1,2}(o|out|output|outfile|output-file|dest|destination)$/i;
  const FILENAME_ARG = /^[\w-]+\.[A-Za-z0-9]{2,5}$/;
  const WRITES = /\b(destination|write[sd]?|save[sd]?|output)\b/i;
  const nominated = (o: Investigation["options"][number]) => {
    const arg = (o.arg ?? "").replace(/[<>[\]{}]/g, "");
    return fileRole(o) === "write" ? 0 : OUTPUT_ARG.test(arg) || o.flags.some((f) => OUTPUT_FLAG.test(f)) && o.flags.some((f) => f.startsWith("--")) ? 1 : (FILENAME_ARG.test(arg) && WRITES.test(o.description)) || OUTPUT_OPTION.test(o.description) ? 2 : -1;
  };
  const writeFlags = [...new Set(inv.options
    .filter((o) => o.arg && !o.optionalArg && !o.args?.length && nominated(o) >= 0)
    .sort((a, b) => nominated(a) - nominated(b))
    .map((o) => o.flags.find((f) => /^-[A-Za-z]$/.test(f)) ?? o.flags[0])
    .filter(Boolean))].slice(0, 2);
  // Flags to test for their effect: documented, taking no value, and not about the program itself.
  const NOT_EFFECT = /^-{1,2}(h|help|v|V|version|verbose|quiet|q|silent|info|list|debug|license|usage|\?)$/;
  const RISKY = /\b(delete|remove|overwrite|in[- ]place|daemon|server|listen|network|connect|execute|shell)\b/i;
  const flags = [...new Set(inv.options
    .filter((o) => !o.arg && !o.optionalArg && !o.args?.length && !o.fixed?.length && !RISKY.test(o.description))
    .map((o) => o.flags.find((f) => f.startsWith("--")) ?? o.flags[0])
    .filter((f) => f && !NOT_EFFECT.test(f) && !writeFlags.includes(f)))]
    // Flags whose documentation speaks of fidelity or of a format are the informative experiments.
    .map((f) => { const d = inv.options.find((o) => o.flags.includes(f))?.description ?? ""; return { f, rank: /\b(lossless(ly)?|exact(ly)?|identical|lossy|uncompressed|quality|fidelity)\b/i.test(d) ? 0 : documented.some((x) => x.known?.words.test(d) || new RegExp(`\\b${x.ext}\\b`, "i").test(d)) || /\bformat\b/i.test(d) ? 1 : 2 }; })
    .sort((a, b) => a.rank - b.rank).map((x) => x.f).slice(0, BINARY_LIMITS.maxFlags);

  let budget = ctx.maxTrials ?? BINARY_LIMITS.maxTrials;
  const timeoutMs = ctx.timeoutMs ?? BINARY_LIMITS.timeoutMs;
  type Form = { id: string; argv: (inName: string, outName: string) => string[]; output: "file" | "stdout"; input: "file" | "stdin" };
  const forms: Form[] = [
    ...writeFlags.flatMap((w) => [
      { id: `in ${w} out`, argv: (i: string, o: string) => [i, w, o], output: "file" as const, input: "file" as const },
      { id: `${w} out in`, argv: (i: string, o: string) => [w, o, i], output: "file" as const, input: "file" as const },
    ]),
    { id: "in out", argv: (i, o) => [i, o], output: "file", input: "file" },
    { id: "in > stdout", argv: (i) => [i], output: "stdout", input: "file" },
    { id: "stdin > stdout", argv: () => [], output: "stdout", input: "stdin" },
  ];
  const attempt = async (purpose: string, argv: string[], form: Form, inF: Fmt, outName: string, sample: Sample): Promise<{ r: SandboxRun; out?: Uint8Array; trial: BinaryTrial } | null> => {
    if (budget-- <= 0) return null;
    const inName = `input.${inF.ext}`;
    const r = await sandbox.run(bin, argv, {
      ...(form.input === "file" ? { files: { [inName]: sample.bytes } } : { stdin: sample.bytes }),
      ...(form.output === "file" ? { collect: [outName] } : {}),
      rawStdout: true, limits: { timeoutMs }, purpose: "investigation",
    });
    const out = form.output === "file" ? r.outputs?.[outName] : r.stdoutRaw && r.stdoutRaw.length ? r.stdoutRaw : undefined;
    const trial: BinaryTrial = {
      purpose, argv,
      input: { sha256: await sha256(sample.bytes), bytes: sample.bytes.length, mediaType: inF.mediaType, valid: inF.known ? inF.known.validate(sample.bytes).ok : !!sample.origin, source: sample.source },
      exit: r.code,
      process: r.timedOut ? "timed-out" : r.truncated ? "truncated" : r.limit ? "limit" : "completed",
      ...(out ? { output: { sha256: await sha256(out), bytes: out.length, type: identify(out).type } } : {}),
      stderrPreview: normaliseSandboxPaths(r.stderr, r.workDir).slice(0, 200),
      ms: r.durationMs,
    };
    trials.push(trial);
    return { r, out, trial };
  };
  const clean = (x: { r: SandboxRun; out?: Uint8Array } | null): x is { r: SandboxRun; out: Uint8Array; trial: BinaryTrial } => !!x && x.r.code === 0 && !x.r.timedOut && !x.r.truncated && !x.r.limit && !!x.out;

  // What can be read from a sample or an output: the validator's facts, the origin facts a
  // provisional sample carries, or what an acquired decoder recovers.
  // The pixels a sample shows, when its own format cannot say, are its origin's only if the
  // producer was proven lossless; otherwise a later difference could be the producer's loss.
  const originFacts = (s: Sample): Facts | undefined => s.origin && (s.origin.lossless ? s.origin.facts : Object.fromEntries(Object.entries(s.origin.facts).filter(([k]) => k !== "pixels")));
  const inFacts = (f: Fmt, s: Sample): Facts | undefined => (f.known ? (() => { const v = f.known.validate(s.bytes); return v.ok ? { ...v.facts, ...(v.facts.pixels === undefined && s.origin?.lossless ? pick(s.origin.facts, ["pixels"]) : {}) } : undefined; })() : originFacts(s));
  const outFacts = async (f: Fmt, b: Uint8Array): Promise<{ facts?: Facts; decodedBy?: string }> => {
    const own = f.known ? f.known.validate(b) : undefined;
    if (own && !own.ok) return {};
    const facts: Facts = own?.ok ? { ...own.facts } : {};
    if (facts.pixels === undefined && ctx.decode) {
      const d = await ctx.decode(f.mediaType, b).catch(() => undefined);
      if (d) { for (const [k, v] of Object.entries(d.facts)) if (facts[k] === undefined) facts[k] = v; return { facts, decodedBy: d.by }; }
    }
    return f.known ? { facts } : {};
  };

  const established = new Set<string>();
  const done = (inF: Fmt, outF: Fmt) => established.has(`${inF.mediaType}>${outF.mediaType}`);

  /** Confirm a first clean run into `outF`; establish it (or keep it as a candidate) with its evidence. */
  const confirm = async (inF: Fmt, outF: Fmt, form: Form, argv: string[], outName: string, first: { out: Uint8Array; trial: BinaryTrial }, s1: Sample, s2: Sample, flag?: string, base?: Capability) => {
    const label = `${inF.slug} → ${outF.slug} via "${form.id}"${flag ? ` with ${flag}` : ""}`;
    const second = await attempt(`confirm with a second ${inF.slug} sample${flag ? ` (${flag})` : ""}`, argv, form, inF, outName, s2);
    if (!clean(second)) return;
    if (outF.known && identify(second.out).mediaType !== outF.mediaType) return void claim(providerId, label, "contradicted", "a second valid sample did not give an output of the same format");
    if (equalBytes(first.out, second.out)) return void claim(providerId, label, "contradicted", "two different inputs gave identical output, so the output does not depend on the input");
    const again = await attempt(`repeat the first sample for determinism${flag ? ` (${flag})` : ""}`, argv, form, inF, outName, s1);
    if (!clean(again)) return;
    const [f1, f2, fa] = [await outFacts(outF, first.out), await outFacts(outF, second.out), await outFacts(outF, again.out)];
    const deterministic = equalBytes(again.out, first.out) ? "bytes" : f1.facts && JSON.stringify(fa.facts) === JSON.stringify(f1.facts) ? "structure" : undefined;
    if (!deterministic) return void claim(providerId, label, "contradicted", "the same input gave different outputs");
    const i1 = inFacts(inF, s1), i2 = inFacts(inF, s2);
    const signature = outF.known ? undefined : commonPrefix([first.out, second.out, again.out]);
    const provenance = [...new Set([s1.source, s2.source])].join("; ");
    const conf = [first.trial, second.trial, again.trial];
    // A format nobody can read yet: kept as a candidate whose outputs other programs may witness.
    if (!f1.facts || !f2.facts) {
      if (outF.known) return;
      if (!signature || signature.length < 8) return void claim(providerId, label, "unknown", "the outputs share no stable leading bytes to recognise the format by");
      const id = `${providerId}:${inF.slug}-to-${outF.slug}${flag ? `-${slugOf(flag)}` : ""}`;
      const contract = makeContract(inF, outF, form, argv, outName, [], deterministic, "not-tested", provenance, conf, signature, flag);
      if (result.candidates.some((c) => c.id === id)) return;
      result.candidates.push({ id, provider: providerId, bin, sha256: inv.program.sha256, contract });
      for (const [s, o] of [[s1, first.out], [s2, second.out]] as const) {
        const facts = inFacts(inF, s);
        if (facts) result.produced.push({ mediaType: outF.mediaType, bytes: o, source: `output of candidate ${id} on ${s.source}`, origin: { mediaType: inF.mediaType, facts, via: id } });
      }
      claim(id, `turns ${inF.mediaType} into ${outF.mediaType} (${outF.slug} is not a format RightClick can read)`, "observed", `${conf.length} trial(s) gave deterministic output with leading bytes ${signature}; it becomes a capability only when another capability recovers the input's facts from these outputs`);
      return;
    }
    if (!i1 || !i2) return;
    const preserves = RELATION_FACTS.filter((k) => i1[k] !== undefined && i1[k] === f1.facts![k] && i2[k] !== undefined && i2[k] === f2.facts![k]);
    const shared = RELATION_FACTS.filter((k) => i1[k] !== undefined && f1.facts![k] !== undefined && i2[k] !== undefined && f2.facts![k] !== undefined);
    // For samples made by another program, a fact that did not come back may have been lost by that
    // producer (a lossy encoder), not by this program: it is not counted against this program.
    const changes = shared.filter((k) => !preserves.includes(k) && k !== "pixels");
    // Different decoded pixels mean a lossy encoding, not a different picture: allowed, ranked
    // below exact routes, and refused when the caller requires the pixels kept. (For samples made
    // by another program the difference may be that producer's, so it is not charged here.)
    const lossy = inF.known && shared.includes("pixels") && !preserves.includes("pixels");
    // A sample from a producer we could not read: it is witnessed only if its facts come back.
    if (!inF.known && !preserves.length) return void claim(providerId, label, "contradicted", "the output does not recover any fact of the image the samples were made from");
    // A flag variant is established only when it differs in kind: another format, or keeping more.
    if (base && outF.mediaType === (base.invoke as { binary?: BinaryContract }).binary?.output.mediaType && preserves.every((k) => (base.invoke as { binary?: BinaryContract }).binary!.preserves.includes(k))) return void claim(providerId, label, "observed", "the flag changed the bytes but not the format or the facts kept");
    // How the program treats input that is not valid (evidence only; inputs are validated before every run).
    let rejectsInvalid: BinaryContract["rejectsInvalid"] = "not-tested";
    if (inF.known) {
      const bad = mutate(s1.bytes, "truncated", inF.mediaType);
      if (!inF.known.validate(bad).ok) {
        const m = await attempt(`a truncated ${inF.slug} sample`, argv, form, inF, outName, { mediaType: inF.mediaType, bytes: bad, source: `truncated ${s1.source}` });
        if (m) rejectsInvalid = m.r.code !== 0 || !m.out || !identify(m.out).mediaType ? "yes" : "no";
      }
    }
    const witnessed: NonNullable<BinaryContract["witnessed"]> = [];
    if (f1.decodedBy && preserves.some((k) => !(outF.known?.validate(first.out) as { facts?: Facts })?.facts?.[k])) witnessed.push({ facts: preserves.filter((k) => !(outF.known?.validate(first.out) as { facts?: Facts })?.facts?.[k]), capability: f1.decodedBy, how: "decoded" });
    if (!inF.known && s1.origin && s2.origin) {
      for (const via of new Set([s1.origin.via, s2.origin.via])) result.witnessed.push({ producer: via, facts: preserves, by: `${providerId}:${inF.slug}-to-${outF.slug}` });
      witnessed.push({ facts: preserves, capability: s1.origin.via, how: "round-trip" });
    }
    const fidelityVariant = !!flag && !!base;
    const id = `${providerId}:${inF.slug}-to-${outF.slug}${fidelityVariant ? `-${slugOf(flag!)}` : ""}`;
    established.add(`${inF.mediaType}>${outF.mediaType}${fidelityVariant ? `+${flag}` : ""}`);
    const inSignature = inF.known ? undefined : commonPrefix([s1.bytes, s2.bytes]);
    const contract = makeContract(inF, outF, form, argv, outName, preserves, deterministic, rejectsInvalid, provenance, [...conf, ...trials.filter((t) => t.purpose === `a truncated ${inF.slug} sample` && t.argv === argv)], signature, flag, inSignature, witnessed);
    const evidence = `${contract.trials.length} sandboxed trial(s): two distinct ${inF.slug} inputs (${provenance}) each gave a ${outF.slug} output; repeating the first gave ${deterministic === "bytes" ? "identical bytes" : "identical facts"}${witnessed.length ? `; ${witnessed.map((w) => `${w.facts.join(", ")} witnessed (${w.how}) through ${w.capability}`).join("; ")}` : ""}`;
    claim(id, `transforms ${inF.mediaType} into ${outF.mediaType} via "${form.id}"${flag ? ` with ${flag}` : ""}`, "experimentally-supported", evidence);
    if (preserves.length) claim(id, `keeps ${preserves.join(", ")}`, "experimentally-supported", "equal in input and output in both confirming trials; checked again on every run where it can be read");
    if (changes.length) claim(id, `keeps the input's ${changes.join(", ")}`, "contradicted", `${changes.join(", ")} differ between input and output; not chosen by automatic composition`);
    if (preserves.includes("pixels")) claim(id, "lossless (the decoded pixels are identical)", "experimentally-supported", witnessed.some((w) => w.facts.includes("pixels")) ? `witnessed through ${witnessed.find((w) => w.facts.includes("pixels"))!.capability}` : "pixel digests equal in both confirming trials");
    else if (lossy) claim(id, "lossy (the decoded pixels differ)", "experimentally-supported", `pixel digests differ between input and output${f1.decodedBy ? ` (output decoded by ${f1.decodedBy})` : ""}`);
    for (const [s, o] of [[s1, first.out], [s2, second.out]] as const) {
      const facts = inFacts(inF, s);
      result.produced.push({ mediaType: outF.mediaType, bytes: o, source: `output of ${id} on ${s.source}`, ...(facts && (!outF.known || f1.decodedBy || f1.facts?.pixels === undefined) ? { origin: { mediaType: inF.mediaType, facts, via: id, lossless: preserves.includes("pixels") } } : {}) });
    }
    result.capabilities.push({
      id, provider: providerId, source: "cli",
      title: `${name}: ${inF.mediaType} to ${outF.mediaType}${flag ? ` (${flag})` : ""}`,
      description: `${name} converts ${inF.mediaType} to ${outF.mediaType} (${form.id}${flag ? `, ${flag}` : ""}), established by RightClick's own sandboxed experiments${preserves.length ? `; keeps ${preserves.join(", ")}` : ""}. ${inv.program.description ?? ""}`.slice(0, 400),
      inputs: [{ name: "input", type: bytesType(inF.mediaType), required: true, description: `Exact bytes of a ${inF.mediaType} file: {"type":"bytes","base64":…} or {"type":"artefact","ref":…}. It must be recognised as ${inF.mediaType} before anything runs.` }],
      outputs: [{ name: "", type: bytesType(outF.mediaType), required: true, description: `A ${outF.mediaType} artefact, returned only when it is recognised as that format and keeps ${preserves.join(", ") || "its structure"}` }],
      risk: "read",
      tags: [name, "binary", "acquired", "experimentally-supported", inF.slug, outF.slug, "convert", ...(preserves.includes("pixels") ? ["lossless"] : lossy ? ["lossy"] : []), ...(changes.length ? ["unsupported"] : []), ...(flag ? ["variant"] : [])],
      invoke: { kind: "cli", bin, args: [], okExit: [0], output: "text", sha256: inv.program.sha256, binary: contract },
    } as Capability);
    return result.capabilities[result.capabilities.length - 1];
  };

  for (const inF of inputs) {
    const [s1, s2] = samples(inF);
    const fileOutputs = [...new Set([...documented.filter((f) => f !== inF && (f.known || f.role !== "input")), inF])].filter((f) => f.known || f.role !== "input").slice(0, BINARY_LIMITS.maxOutputFormats);
    const plans: Array<{ form: Form; outF?: Fmt }> = [
      ...forms.filter((f) => f.output === "file").flatMap((form) => fileOutputs.map((outF) => ({ form, outF }))),
      ...forms.filter((f) => f.output === "stdout").map((form) => ({ form })),
    ];
    // A form refused the same way for two different output names is not tried with further names.
    const refusedForm = new Map<string, string>(), dropped = new Set<string>();
    // A form that writes one format whatever the output is named is tried again under that format's
    // name only, not with every other name.
    const writes = new Map<string, string>();
    for (const plan of plans) {
      const { form } = plan;
      let { outF } = plan;
      if (budget <= 0) break;
      if (dropped.has(form.id) || (outF && done(inF, outF))) continue;
      if (outF && writes.has(form.id)) { if (writes.get(form.id) !== outF.mediaType) continue; }
      const outName = `output.${(outF ?? inF).ext}`;
      const argv = form.argv(`input.${inF.ext}`, outName);
      const first = await attempt(`${inF.slug} via "${form.id}"${outF ? ` to .${outF.ext}` : ""}`, argv, form, inF, outName, s1);
      if (!clean(first)) {
        if (first && !first.out) {
          const how = `${first.r.code}|${first.trial.stderrPreview.replace(/output\.\w+/g, "OUT")}`;
          if (refusedForm.get(form.id) === how) dropped.add(form.id);
          refusedForm.set(form.id, how);
        }
        continue;
      }
      // Which format came out: a validator decides; a form that named a format the library does not
      // know expects exactly that (provisional) format; standard output must be recognisable.
      let got = identify(first.out);
      if (got.mediaType && outF && got.mediaType !== outF.mediaType) {
        // It wrote another format than the name asked for: name the output for what it writes.
        writes.set(form.id, got.mediaType);
        const actual = fmtOf(got.mediaType);
        if (done(inF, actual)) continue;
        outF = actual;
        const renamed = `output.${actual.ext}`;
        const again = await attempt(`${inF.slug} via "${form.id}" to .${actual.ext}`, form.argv(`input.${inF.ext}`, renamed), form, inF, renamed, s1);
        if (!clean(again) || identify(again.out).mediaType !== actual.mediaType) continue;
        got = identify(again.out);
        Object.assign(first, again);
      }
      const name2 = `output.${(outF ?? inF).ext}`;
      const argv2 = form.argv(`input.${inF.ext}`, name2);
      const target = got.mediaType ? fmtOf(got.mediaType) : outF && !outF.known ? outF : undefined;
      if (!target || (outF?.known && target.mediaType !== outF.mediaType) || (outF && !outF.known && got.mediaType)) continue;
      if (done(inF, target)) continue;
      const base = await confirm(inF, target, form, argv2, name2, first, s1, s2);
      if (!base) continue;
      // Documented flags, tested for their effect on this established transformation.
      const baseOut = first.out;
      for (const flag of flags) {
        if (budget < 4) break;
        const v1 = await attempt(`effect of ${flag}`, [flag, ...argv2], form, inF, name2, s1);
        if (!clean(v1) || equalBytes(v1.out, baseOut)) continue;
        const g = identify(v1.out);
        const vt = g.mediaType ? fmtOf(g.mediaType) : target.known ? undefined : target;
        if (!vt) continue;
        if (vt.mediaType !== target.mediaType) {
          // The flag selects another format: name the output for it and confirm from the start.
          if (done(inF, vt)) continue;
          const vName = form.output === "file" ? `output.${vt.ext}` : name2;
          const vArgv = [flag, ...form.argv(`input.${inF.ext}`, vName)];
          const again = vName === name2 ? v1 : await attempt(`effect of ${flag}, output named .${vt.ext}`, vArgv, form, inF, vName, s1);
          if (!clean(again) || identify(again.out).mediaType !== (vt.known ? vt.mediaType : undefined)) continue;
          await confirm(inF, vt, form, vArgv, vName, again, s1, s2, flag);
        } else {
          await confirm(inF, vt, form, [flag, ...argv2], name2, v1, s1, s2, flag, base);
        }
      }
    }
  }
  const caps = result.capabilities.map((c) => c.id.split(":").pop()).join(", ");
  result.summary = result.capabilities.length || result.candidates.length
    ? `${result.capabilities.length} binary transformation(s) established${caps ? ` (${caps})` : ""}${result.candidates.length ? `, ${result.candidates.length} awaiting a witness` : ""}, in ${trials.length} trial(s)`
    : `no binary transformation established in ${trials.length} trial(s) (documented: ${documented.map((f) => f.slug).join(", ")})`;
  claim(name, "binary acquisition", result.capabilities.length ? "experimentally-supported" : "unknown", result.summary);
  return result;
}

function pick(f: Facts, keys: string[]): Facts {
  return Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
}

function makeContract(inF: Fmt, outF: Fmt, form: { input: "file" | "stdin"; output: "file" | "stdout"; id: string }, argv: string[], outName: string, preserves: string[], deterministic: "bytes" | "structure", rejectsInvalid: BinaryContract["rejectsInvalid"], fixtures: string, trials: BinaryTrial[], outSignature?: string, flag?: string, inSignature?: string, witnessed?: BinaryContract["witnessed"]): BinaryContract {
  const inName = form.input === "file" ? `input.${inF.ext}` : undefined;
  return {
    v: 1,
    input: { mediaType: inF.mediaType, via: form.input, ...(inName ? { name: inName } : {}), ...(inSignature && isProvisional(inF.mediaType) ? { signature: inSignature } : {}) },
    output: { mediaType: outF.mediaType, via: form.output, ...(form.output === "file" ? { name: outName } : {}), ...(outSignature && isProvisional(outF.mediaType) ? { signature: outSignature } : {}) },
    argv,
    preserves,
    deterministic,
    rejectsInvalid,
    fixtures,
    trials,
    ...(flag ? { flag } : {}),
    ...(witnessed?.length ? { witnessed } : {}),
  };
}

/**
 * Promote a candidate whose outputs another capability witnessed: the format it writes is now
 * recognised by the leading bytes its witnessed outputs shared, and it keeps what the witness
 * recovered from them.
 */
export function promoteCandidate(c: Candidate, w: { facts: string[]; by: string }, program: { description?: string }): Capability {
  const name = c.bin.split("/").pop() ?? c.bin;
  const inMt = c.contract.input.mediaType, outMt = c.contract.output.mediaType;
  const contract: BinaryContract = { ...c.contract, preserves: w.facts, witnessed: [{ facts: w.facts, capability: w.by, how: "decoded" }] };
  return {
    id: c.id, provider: c.provider, source: "cli",
    title: `${name}: ${inMt} to ${outMt}${contract.flag ? ` (${contract.flag})` : ""}`,
    description: `${name} converts ${inMt} to ${outMt}, a format RightClick has no validator for: established because ${w.by} recovered ${w.facts.join(", ")} from its outputs. ${program.description ?? ""}`.slice(0, 400),
    inputs: [{ name: "input", type: bytesType(inMt), required: true, description: `Exact bytes of a ${inMt} file.` }],
    outputs: [{ name: "", type: bytesType(outMt), required: true, description: `A ${outMt} artefact, recognised by its leading bytes ${contract.output.signature}` }],
    risk: "read",
    tags: [name, "binary", "acquired", "experimentally-supported", "witnessed", "convert", ...(w.facts.includes("pixels") ? ["lossless"] : []), ...(contract.flag ? ["variant"] : [])],
    invoke: { kind: "cli", bin: c.bin, args: [], okExit: [0], output: "text", sha256: c.sha256, binary: contract },
  } as Capability;
}

export const _testing = { RELATION_FACTS, candidateFormats };
export type { Facts };
