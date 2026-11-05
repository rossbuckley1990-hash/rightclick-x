// Empirical acquisition of binary transformations.
//
// A program's documentation says which formats to try, and experiments decide what is true. For
// each candidate input format with valid fixtures, the investigation tries the generic ways a
// program can take one file and produce another:
//
//   file in, file out, named by a documented write-role option    prog in.png -o out.tif
//   the same, with the option first                                prog -o out.tif in.png
//   file in, file out, as positional operands                      prog in.png out.tif
//   file in, standard output                                       prog in.png
//   standard input, standard output                                prog < in.png
//
// A transformation is established only when all of these hold, and is otherwise left unknown:
//
//   - the program exits 0 on a valid fixture and its output validates, in full, as exactly one
//     format (the validators in core/formats.ts, which share no code with the fixtures);
//   - a second, different valid fixture gives an output of the same format that differs from the
//     first (the output depends on the input);
//   - the first fixture again gives the same output, byte for byte or fact for fact;
//   - the format is the one the form asked for (the output name's extension) when the form names
//     one.
//
// It also records, as evidence, how the program treats an invalid fixture (a truncated one), and
// which facts (width, height, pages, ...) the output kept from the input in every confirming
// trial: those become checks repeated on every run.
//
// Nothing here is specific to a program. The formats come from a fixed library, the forms are
// generic, and a program can neither choose nor configure its fixtures.

import { FORMATS, bytesType, formatOf, identify, type BinaryFormat, type Facts } from "../core/formats.ts";
import { FIXTURE_MAX_BYTES, fixtureFor, mutate } from "../core/fixtures.ts";
import { normaliseSandboxPaths, type Sandbox, type SandboxRun } from "../core/sandbox.ts";
import type { BinaryContract, BinaryTrial, Capability } from "../core/types.ts";
import { fileRole, type Investigation } from "./cli.ts";

export const BINARY_LIMITS = Object.freeze({
  /** Sandboxed runs one program's binary acquisition may use. */
  maxTrials: 64,
  /** Per-run time limit. */
  timeoutMs: 5000,
  /** Candidate input formats tried per program. */
  maxInputFormats: 4,
  /** Candidate output formats tried per input format. */
  maxOutputFormats: 5,
});

/** Facts that are comparable across formats, so a transformation can be seen to keep them. */
const RELATION_FACTS = ["width", "height", "pages", "frames", "entries", "pixels"];

/** Valid samples of one format from somewhere other than a generator, with their provenance. */
export interface CorpusSample { mediaType: string; bytes: Uint8Array; source: string }

export interface BinaryAcquisition {
  capabilities: Capability[];
  claims: Investigation["claims"];
  trials: BinaryTrial[];
  summary: string;
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function sha256(b: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Formats the documentation names, in the order it first names them. Only words that stand alone
 * count ("TIFF", ".png", "PNG files"), so a format is tried because the program says it handles
 * it, never because RightClick has a generator for it.
 */
export function documentedFormats(docs: string): BinaryFormat[] {
  return FORMATS
    .map((f) => ({ f, at: docs.search(f.words) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.f);
}

export async function acquireBinary(
  bin: string,
  sandbox: Sandbox,
  inv: Investigation,
  docs: string,
  opts: { corpus?: CorpusSample[]; maxTrials?: number; timeoutMs?: number } = {},
): Promise<BinaryAcquisition> {
  const name = bin.split("/").pop() ?? bin;
  const providerId = `cli:${slugOf(name)}`;
  const claims: Investigation["claims"] = [];
  const trials: BinaryTrial[] = [];
  const claim = (subject: string, c: string, status: Investigation["claims"][number]["status"], evidence: string) => claims.push({ subject, claim: c, status, evidence });
  const documented = documentedFormats(docs);
  if (!documented.length) {
    claim(name, "handles a binary format RightClick can check", "unknown", "its documentation names none of the formats in the format library");
    return { capabilities: [], claims, trials, summary: "no documented binary format" };
  }
  // Valid inputs: generated fixtures, or validated samples from the corpus (never an unvalidated file).
  const samples = (f: BinaryFormat): Array<{ bytes: Uint8Array; source: string }> => {
    const out: Array<{ bytes: Uint8Array; source: string }> = [];
    for (const seed of [1, 2]) { const b = fixtureFor(f.mediaType, seed); if (b) out.push({ bytes: b, source: `generated ${f.slug} fixture, seed ${seed}` }); }
    for (const s of opts.corpus ?? []) {
      if (out.length >= 2) break;
      if (s.mediaType === f.mediaType && s.bytes.length <= FIXTURE_MAX_BYTES && f.validate(s.bytes).ok && !out.some((o) => equalBytes(o.bytes, s.bytes))) out.push({ bytes: s.bytes, source: s.source });
    }
    return out;
  };
  const inputs = documented.filter((f) => samples(f).length >= 2).slice(0, BINARY_LIMITS.maxInputFormats);
  for (const f of documented) if (!inputs.includes(f)) claim(name, `reads ${f.mediaType}`, "unknown", "documented, but no two valid samples of this format are available to test it with");
  if (!inputs.length) return { capabilities: [], claims, trials, summary: `documents ${documented.map((f) => f.slug).join(", ")}, but no valid samples are available` };

  // Options that may name the output file: a write role, or a one-value option the documentation
  // describes as the output file ("-o <string> ... output file name"). The documentation only
  // nominates them; the experiments below decide.
  const OUTPUT_OPTION = /\boutput\b[^.]{0,30}\b(file|name|path)\b|\b(file|name|path)\b[^.]{0,20}\boutput\b|\bwrite[sd]? (the )?(output|result)\b/i;
  // The placeholder's own name can say it too ("-o out_file" in a synopsis, with no description).
  const OUTPUT_ARG = /^(out|output)([_ -]?(file|name|path|filename))?$|^outfile$/i;
  const nominated = (o: Investigation["options"][number]) =>
    fileRole(o) === "write" ? 0 : OUTPUT_ARG.test((o.arg ?? "").replace(/[<>[\]{}]/g, "")) ? 1 : OUTPUT_OPTION.test(o.description) ? 2 : -1;
  const writeFlags = [...new Set(inv.options
    .filter((o) => o.arg && !o.optionalArg && !o.args?.length && nominated(o) >= 0)
    .sort((a, b) => nominated(a) - nominated(b))
    .map((o) => o.flags.find((f) => /^-[A-Za-z]$/.test(f)) ?? o.flags[0])
    .filter(Boolean))].slice(0, 2);

  let budget = opts.maxTrials ?? BINARY_LIMITS.maxTrials;
  const timeoutMs = opts.timeoutMs ?? BINARY_LIMITS.timeoutMs;
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
  const attempt = async (purpose: string, form: Form, inF: BinaryFormat, outF: BinaryFormat | undefined, sample: { bytes: Uint8Array; source: string }): Promise<{ r: SandboxRun; out?: Uint8Array; trial: BinaryTrial } | null> => {
    if (budget-- <= 0) return null;
    const inName = `input.${inF.ext}`, outName = `output.${(outF ?? inF).ext}`;
    const argv = form.argv(inName, outName);
    const r = await sandbox.run(bin, argv, {
      ...(form.input === "file" ? { files: { [inName]: sample.bytes } } : { stdin: sample.bytes }),
      ...(form.output === "file" ? { collect: [outName] } : {}),
      rawStdout: true,
      limits: { timeoutMs },
      purpose: "investigation",
    });
    const out = form.output === "file" ? r.outputs?.[outName] : r.stdoutRaw && r.stdoutRaw.length ? r.stdoutRaw : undefined;
    const trial: BinaryTrial = {
      purpose, argv,
      input: { sha256: await sha256(sample.bytes), bytes: sample.bytes.length, mediaType: inF.mediaType, valid: inF.validate(sample.bytes).ok, source: sample.source },
      exit: r.code,
      process: r.timedOut ? "timed-out" : r.truncated ? "truncated" : r.limit ? "limit" : "completed",
      ...(out ? { output: { sha256: await sha256(out), bytes: out.length, type: identify(out).type } } : {}),
      stderrPreview: normaliseSandboxPaths(r.stderr, r.workDir).slice(0, 200),
      ms: r.durationMs,
    };
    trials.push(trial);
    return { r, out, trial };
  };
  const clean = (x: { r: SandboxRun; out?: Uint8Array } | null) => !!x && x.r.code === 0 && !x.r.timedOut && !x.r.truncated && !x.r.limit && !!x.out;

  const capabilities: Capability[] = [];
  const established = new Set<string>();
  for (const inF of inputs) {
    const [s1, s2] = samples(inF);
    const fileOutputs = [...new Set([...documented.filter((f) => f !== inF), inF])].slice(0, BINARY_LIMITS.maxOutputFormats);
    const plans: Array<{ form: Form; outF?: BinaryFormat }> = [
      ...forms.filter((f) => f.output === "file").flatMap((form) => fileOutputs.map((outF) => ({ form, outF }))),
      ...forms.filter((f) => f.output === "stdout").map((form) => ({ form })),
    ];
    // A form the program refuses the same way for two different output names is not one it takes
    // for this input: it is not tried again with further names.
    const refusedForm = new Map<string, string>(), dropped = new Set<string>();
    for (const { form, outF } of plans) {
      if (budget <= 0) break;
      if (dropped.has(form.id)) continue;
      if (outF && established.has(`${inF.mediaType}>${outF.mediaType}`)) continue;
      const first = await attempt(`${inF.slug} via "${form.id}"${outF ? ` to .${outF.ext}` : ""}`, form, inF, outF, s1);
      if (!clean(first)) {
        if (first && !first.out) {
          const how = `${first.r.code}|${first.trial.stderrPreview.replace(/output\.\w+/g, "OUT")}`;
          if (refusedForm.get(form.id) === how) dropped.add(form.id);
          refusedForm.set(form.id, how);
        }
        continue;
      }
      const got = identify(first!.out!);
      // The form asked for a format by the output name's extension: anything else is not established.
      if (!got.mediaType || (outF && got.mediaType !== outF.mediaType)) continue;
      const outFormat = formatOf(got.mediaType)!;
      const key = `${inF.mediaType}>${outFormat.mediaType}`;
      if (established.has(key)) continue;
      const second = await attempt(`confirm with a second ${inF.slug} sample`, form, inF, outF, s2);
      if (!clean(second) || identify(second!.out!).mediaType !== outFormat.mediaType) {
        claim(providerId, `${inF.slug} → ${outFormat.slug} via "${form.id}"`, "contradicted", "a second valid sample did not give an output of the same format");
        continue;
      }
      if (equalBytes(first!.out!, second!.out!)) {
        claim(providerId, `${inF.slug} → ${outFormat.slug} via "${form.id}"`, "contradicted", "two different inputs gave identical output, so the output does not depend on the input");
        continue;
      }
      const again = await attempt(`repeat the first sample for determinism`, form, inF, outF, s1);
      if (!clean(again)) continue;
      const deterministic = equalBytes(again!.out!, first!.out!) ? "bytes" : JSON.stringify(identify(again!.out!).facts) === JSON.stringify(got.facts) ? "structure" : undefined;
      if (!deterministic) {
        claim(providerId, `${inF.slug} → ${outFormat.slug} via "${form.id}"`, "contradicted", "the same input gave structurally different outputs");
        continue;
      }
      // How the program treats input that is not valid (evidence only; RightClick validates every
      // input itself before a run, whatever the program does).
      const bad = mutate(s1.bytes, "truncated", inF.mediaType);
      let rejectsInvalid: BinaryContract["rejectsInvalid"] = "not-tested";
      if (!inF.validate(bad).ok) {
        const m = await attempt(`a truncated ${inF.slug} sample`, form, inF, outF, { bytes: bad, source: `truncated ${s1.source}` });
        if (m) rejectsInvalid = m.r.code !== 0 || !m.out || !identify(m.out).mediaType ? "yes" : "no";
      }
      const preserves = RELATION_FACTS.filter((k) => {
        const pairs = [[s1, first!], [s2, second!]] as const;
        return pairs.every(([s, x]) => {
          const a = inF.validate(s.bytes), b = outFormat.validate(x.out!);
          return a.ok && b.ok && a.facts[k] !== undefined && a.facts[k] === b.facts[k];
        });
      });
      // Facts both formats report for these samples. A transformation that changes any of them
      // (a different size, other pixels) is not a conversion of the input: it stays callable with
      // its evidence, but is never chosen by automatic composition.
      const shared = RELATION_FACTS.filter((k) => [[s1, first!], [s2, second!]].every(([s, x]) => {
        const a = inF.validate((s as { bytes: Uint8Array }).bytes), b = outFormat.validate((x as { out?: Uint8Array }).out!);
        return a.ok && b.ok && a.facts[k] !== undefined && b.facts[k] !== undefined;
      }));
      const changes = shared.filter((k) => !preserves.includes(k));
      established.add(key);
      const inName = form.input === "file" ? `input.${inF.ext}` : undefined;
      const outName = form.output === "file" ? `output.${(outF ?? inF).ext}` : undefined;
      const contract: BinaryContract = {
        v: 1,
        input: { mediaType: inF.mediaType, via: form.input, ...(inName ? { name: inName } : {}) },
        output: { mediaType: outFormat.mediaType, via: form.output, ...(outName ? { name: outName } : {}) },
        argv: form.argv(inName ?? "", outName ?? "").filter((a) => a !== ""),
        preserves,
        deterministic,
        rejectsInvalid,
        fixtures: [...new Set([s1.source, s2.source])].join("; "),
        trials: trials.filter((t) => [first, second, again].some((x) => x?.trial === t) || t.purpose.startsWith(`a truncated ${inF.slug}`)),
      };
      const id = `${providerId}:${inF.slug}-to-${outFormat.slug}`;
      const evidence = `${contract.trials.length} sandboxed trial(s): two distinct valid ${inF.slug} inputs (${contract.fixtures}) each gave a valid ${outFormat.slug} output; repeating the first gave ${deterministic === "bytes" ? "identical bytes" : "identical structure"}`;
      claim(id, `transforms ${inF.mediaType} into ${outFormat.mediaType} via "${form.id}"`, "experimentally-supported", evidence);
      if (preserves.length) claim(id, `keeps ${preserves.join(", ")}`, "experimentally-supported", "equal in input and output in both confirming trials; checked again on every run");
      if (changes.length) claim(id, `keeps the input's ${changes.join(", ")}`, "contradicted", `${changes.join(", ")} differ between input and output; not chosen by automatic composition`);
      if (!changes.includes("pixels") && preserves.includes("pixels")) claim(id, "lossless (the decoded pixels are identical)", "experimentally-supported", "pixel digests equal in both confirming trials; checked again on every run");
      claim(id, "rejects invalid input", rejectsInvalid === "yes" ? "experimentally-supported" : rejectsInvalid === "no" ? "contradicted" : "unknown", rejectsInvalid === "not-tested" ? "no invalid sample of this format" : `a truncated ${inF.slug} sample ${rejectsInvalid === "yes" ? "was refused" : "still gave a valid output"}; RightClick validates inputs before every run either way`);
      capabilities.push({
        id,
        provider: providerId,
        source: "cli",
        title: `${name}: ${inF.mediaType} to ${outFormat.mediaType}`,
        description: `${name} converts ${inF.mediaType} to ${outFormat.mediaType} (${form.id}), established by RightClick's own sandboxed experiments${preserves.length ? `; keeps ${preserves.join(", ")}` : ""}. ${inv.program.description ?? ""}`.slice(0, 400),
        inputs: [{ name: "input", type: bytesType(inF.mediaType), required: true, description: `Exact bytes of a ${inF.mediaType} file: {"type":"bytes","base64":…} or {"type":"artefact","ref":…}. It must validate as ${inF.mediaType} before anything runs.` }],
        outputs: [{ name: "", type: bytesType(outFormat.mediaType), required: true, description: `A ${outFormat.mediaType} artefact, returned only when it validates and keeps ${preserves.join(", ") || "its structure"}` }],
        risk: "read",
        tags: [name, "binary", "acquired", "experimentally-supported", inF.slug, outFormat.slug, "convert", ...(preserves.includes("pixels") ? ["lossless"] : []), ...(changes.length ? ["unsupported"] : [])],
        invoke: { kind: "cli", bin, args: [], okExit: [0], output: "text", sha256: inv.program.sha256, binary: contract },
      } as Capability);
    }
  }
  const summary = capabilities.length
    ? `${capabilities.length} binary transformation(s) established in ${trials.length} trial(s): ${capabilities.map((c) => c.id.split(":").pop()).join(", ")}`
    : `no binary transformation established in ${trials.length} trial(s) (documented: ${documented.map((f) => f.slug).join(", ")})`;
  claim(name, "binary acquisition", capabilities.length ? "experimentally-supported" : "unknown", summary);
  return { capabilities, claims, trials, summary };
}

export const _testing = { RELATION_FACTS };
export type { Facts };
