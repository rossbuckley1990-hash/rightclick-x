#!/usr/bin/env node
// Held-out acceptance of autonomous binary acquisition (harness code, not product code).
//
//   node generalisation.mjs <frozen-tree> <selection.json> <work-dir>
//
// For each program an independent selector chose after the source was frozen:
//   1. learn it through the frozen MCP server (context_learn), in one shared state, so a decoder
//      can be investigated with an acquired encoder's outputs;
//   2. run every binary capability RightClick established on held-out inputs made by other tools
//      (ffmpeg, zip, gzip: never RightClick's own fixtures);
//   3. judge each output with an oracle independent of RightClick (ffprobe for images, unzip -t
//      and gzip -t for archives): the right format, and for images the input's width and height.
// Nothing here adapts to a program: the steps are the same for all of them.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [frozen, selectionFile, work] = process.argv.slice(2);
const selection = JSON.parse(readFileSync(selectionFile, "utf8"));
const programs = selection.programs.map((p) => p.path);
mkdirSync(join(work, "state"), { recursive: true });
mkdirSync(join(work, "held-out"), { recursive: true });
mkdirSync(join(work, "outputs"), { recursive: true });
const harness = new URL("./harness/rcx.mjs", import.meta.url).pathname;
const env = { ...process.env, RCX_FROZEN: frozen, RCX_STATE_FILE: join(work, "state/state.json"), RCX_INVESTIGATE: programs.join(","), RCX_EXECUTE: programs.join(","), CALL_LOG: join(work, "calls.jsonl") };
const rcx = (...args) => {
  const r = spawnSync(process.execPath, [harness, ...args], { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Held-out inputs, made by other tools, by media type.
const FF = "/opt/homebrew/bin/ffmpeg", FFPROBE = "/opt/homebrew/bin/ffprobe";
const MAKERS = {
  "image/png": ["png", []], "image/tiff": ["tif", []], "image/x-portable-pixmap": ["ppm", []],
  "image/x-portable-graymap": ["pgm", ["-pix_fmt", "gray"]], "image/bmp": ["bmp", []],
  "image/webp": ["webp", []], "image/jpeg": ["jpg", []], "image/gif": ["gif", []],
};
function heldOut(mediaType) {
  const d = join(work, "held-out");
  if (MAKERS[mediaType]) {
    const [ext, extra] = MAKERS[mediaType];
    const p = join(d, `held.${ext}`);
    if (!existsSync(p)) execFileSync(FF, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=52x36:rate=1", "-frames:v", "1", ...extra, p]);
    return { path: p, width: 52, height: 36 };
  }
  if (mediaType === "application/zip") { const p = join(d, "held.zip"); if (!existsSync(p)) execFileSync("/bin/sh", ["-c", `cd '${d}' && printf 'held-out entry\\n' > entry.txt && /usr/bin/zip -q -X held.zip entry.txt`]); return { path: p }; }
  if (mediaType === "application/gzip") { const p = join(d, "held.gz"); if (!existsSync(p)) execFileSync("/bin/sh", ["-c", `printf 'held-out payload\\n' | /usr/bin/gzip -n > '${p}'`]); return { path: p }; }
  return undefined;
}
const FFCODEC = { "image/png": "png", "image/tiff": "tiff", "image/x-portable-pixmap": "ppm", "image/x-portable-graymap": "pgm", "image/bmp": "bmp", "image/webp": "webp", "image/jpeg": "mjpeg", "image/gif": "gif" };
function oracle(mediaType, path, expect) {
  if (FFCODEC[mediaType]) {
    const r = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", path], { encoding: "utf8" });
    let s; try { s = JSON.parse(r.stdout).streams?.[0]; } catch { s = undefined; }
    const ok = !!s && s.codec_name === FFCODEC[mediaType] && (!expect.width || (s.width === expect.width && s.height === expect.height));
    return { ok, by: "ffprobe", saw: s ?? r.stderr.slice(0, 120) };
  }
  if (mediaType === "application/zip") { const r = spawnSync("/usr/bin/unzip", ["-tq", path], { encoding: "utf8" }); return { ok: r.status === 0, by: "unzip -t", saw: (r.stdout + r.stderr).trim().slice(0, 120) }; }
  if (mediaType === "application/gzip") { const r = spawnSync("/usr/bin/gzip", ["-t", path], { encoding: "utf8" }); return { ok: r.status === 0, by: "gzip -t", saw: r.stderr.trim().slice(0, 120) }; }
  return { ok: null, by: "none", saw: "no independent oracle for this format" };
}

const results = [];
for (const p of selection.programs) {
  const t0 = Date.now();
  const learned = rcx("call", "context_learn", JSON.stringify({ source: `cli:${p.path}` }));
  let detail = "";
  try { detail = JSON.parse(learned.out).results?.[0]?.probes?.[0]?.detail ?? learned.out.slice(0, 300); } catch { detail = (learned.out || learned.err).slice(0, 300); }
  const graph = rcx("call", "context_graph", JSON.stringify({ op: "search", query: p.path.split("/").pop() }));
  results.push({ program: p.path, selectorCategory: p.category, selectorFormats: `${p.inputFormat} -> ${p.outputFormat}`, learnMs: Date.now() - t0, learnExit: learned.code, detail, graphExcerpt: graph.out.slice(0, 1500) });
}
// The established binary capabilities, from the persisted state (what a later agent inherits).
const state = JSON.parse(readFileSync(join(work, "state/state.json"), "utf8"));
const caps = JSON.stringify(state).match(/"id":"cli:[^"]+:[a-z0-9]+-to-[a-z0-9]+"/g) ?? [];
const ids = [...new Set(caps.map((c) => c.slice(6, -1)))];
const runs = [];
for (const id of ids) {
  const m = /^cli:([^:]+):([a-z0-9]+)-to-([a-z0-9]+)$/.exec(id);
  const slugToType = { png: "image/png", tiff: "image/tiff", ppm: "image/x-portable-pixmap", pgm: "image/x-portable-graymap", bmp: "image/bmp", zip: "application/zip", gzip: "application/gzip", webp: "image/webp", jpeg: "image/jpeg", gif: "image/gif" };
  const inT = slugToType[m[2]], outT = slugToType[m[3]];
  const input = heldOut(inT);
  if (!input) { runs.push({ capability: id, status: "not-tested", why: `no independent way to make a held-out ${inT}` }); continue; }
  const bytes = readFileSync(input.path);
  const argsFile = join(work, "outputs", `${id.replace(/[^\w]+/g, "_")}.args.json`);
  writeFileSync(argsFile, JSON.stringify({ id, args: { input: { type: "bytes", base64: bytes.toString("base64") } } }));
  const r = rcx("call", "context_run", "--args-file", argsFile);
  let run; try { run = JSON.parse(r.out); } catch { run = { status: "harness-error", error: (r.out || r.err).slice(0, 300) }; }
  const ref = run?.output?.ref;
  const out = join(work, "outputs", `${id.replace(/[^\w]+/g, "_")}.out`);
  let judged = { ok: false, by: "none", saw: "no output" };
  if (run.status === "completed" && typeof ref === "string") {
    rcx("save", ref, out);
    judged = existsSync(out) ? oracle(outT, out, input) : judged;
  }
  runs.push({ capability: id, input: { path: input.path, sha256: sha(bytes), bytes: bytes.length }, status: run.status, error: run.error?.slice?.(0, 200), outcome: run.cliValidity?.outcome, oracle: judged });
}
const report = { at: new Date().toISOString(), frozen, selection: selectionFile, selectionSha256: sha(readFileSync(selectionFile)), results, established: ids, runs };
writeFileSync(join(work, "generalisation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ established: ids, runs: runs.map((r) => ({ capability: r.capability, status: r.status, oracle: r.oracle?.ok ?? null })) }, null, 1));
