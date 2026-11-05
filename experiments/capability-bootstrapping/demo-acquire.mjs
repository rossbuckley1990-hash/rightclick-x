#!/usr/bin/env node
// Demonstration, part 1: an unfamiliar program is acquired (harness code, not product code).
//
//   node demo-acquire.mjs <frozen-tree> <lane-dir>
//
// Drives the frozen MCP server exactly as a host does (through ../binary-acquisition/harness/rcx.mjs)
// and records what a fresh agent will inherit:
//   - the unfamiliar software: avifenc and avifdec (libavif), whose format, AVIF, has no validator
//     or generator anywhere in RightClick's source;
//   - the investigation: one context_learn call naming the two programs, nothing else;
//   - the evidence: the trials, the witness that established AVIF, the flag that was found to be
//     lossless, and the capabilities that became available.
// The lane's state directory is what the fresh agent inherits.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [frozen, lane] = process.argv.slice(2);
const programs = ["/opt/homebrew/bin/avifenc", "/opt/homebrew/bin/avifdec"];
mkdirSync(join(lane, "state"), { recursive: true });
const harness = new URL("../binary-acquisition/harness/rcx.mjs", import.meta.url).pathname;
const env = { ...process.env, RCX_FROZEN: frozen, RCX_STATE_FILE: join(lane, "state/state.json"), RCX_INVESTIGATE: programs.join(","), RCX_EXECUTE: programs.join(","), CALL_LOG: join(lane, ".acquire-calls.jsonl") };
const rcx = (...a) => { const r = spawnSync(process.execPath, [harness, ...a], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return JSON.parse(r.stdout); };

const log = { frozen, programs, steps: [] };
// 0. RightClick's format library registers no AVIF validator and no AVIF generator.
const { FORMATS } = await import(join(frozen, "src/core/formats.ts"));
const { GENERATED_FORMATS } = await import(join(frozen, "src/core/fixtures.ts"));
log.formatLibrary = { validators: FORMATS.map((f) => f.mediaType), generators: GENERATED_FORMATS };
log.avifKnownToLibrary = [...log.formatLibrary.validators, ...log.formatLibrary.generators].some((m) => /avif/i.test(m));
// 1. One call: learn the two programs. Everything else is RightClick's own investigation.
const t0 = Date.now();
const learned = rcx("call", "context_learn", JSON.stringify({ sources: programs.map((p) => `cli:${p}`) }));
log.steps.push({ call: "context_learn", ms: Date.now() - t0, bootstrapped: learned.bootstrapped ?? [], probes: learned.results.map((r) => r.probes?.[0]?.detail) });
// 2. What became available, and the evidence behind the lossless encoder.
const avif = rcx("call", "context_graph", JSON.stringify({ op: "search", query: "avif", limit: 20 }));
log.steps.push({ call: "context_graph search avif", capabilities: (avif.results ?? avif).map?.((r) => r.id ?? r.capability?.id).filter(Boolean) });
const card = rcx("call", "context_explain", JSON.stringify({ id: "cli:avifenc:png-to-avif-lossless", detail: "full" }));
const b = card.capability?.invoke?.binary;
log.losslessEncoder = b ? {
  argv: b.argv, preserves: b.preserves, flag: b.flag, signature: b.output.signature, witnessed: b.witnessed,
  trials: b.trials.map((t) => ({ purpose: t.purpose, argv: t.argv.join(" "), exit: t.exit, input: t.input.source, output: t.output && `${t.output.bytes} bytes, sha256 ${t.output.sha256.slice(0, 16)}` })),
} : card;
const inv = card.provider?.meta?.investigation ?? "";
log.investigationSummary = typeof inv === "string" ? inv : inv.summary;
writeFileSync(join(lane, "acquisition.json"), JSON.stringify(log, null, 2));
console.log(JSON.stringify({ avifKnownToLibrary: log.avifKnownToLibrary, validators: log.formatLibrary.validators.length, bootstrapped: log.steps[0].bootstrapped, lossless: !!b, preserves: b?.preserves, witnessed: b?.witnessed }, null, 1));
