// Autonomous binary acquisition: format validators, specification-derived fixtures, empirical
// transformation acquisition, typed composition, and run-time re-establishment of the contract.
//
// Synthetic programs are shell or Node scripts (test fixtures, written here). Real programs
// (ppm2tiff, cwebp, dwebp, tiffcp) are development cases from the earlier evaluations: they run
// where they are installed and skip visibly otherwise. None of the code under test knows them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { FORMATS, formatOf, identify } from "../src/core/formats.ts";
import { fixtureFor, invalidFixtureFor, mutate, GENERATED_FORMATS } from "../src/core/fixtures.ts";
import { accepts, distance } from "../src/core/semantics.ts";
import { documentedFormats } from "../src/reflectors/binary-acquisition.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
function program(dir: string, name: string, body: string, shebang = "#!/bin/sh"): string {
  const p = join(dir, name);
  writeFileSync(p, `${shebang}\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

// Can the sandbox run this Node binary? (It cannot when Node lives under a read-denied home.)
const nodeInSandbox = sandbox ? await (async () => {
  const d = tmp("rcx-node-probe-");
  const p = program(d, "probe", `process.stdout.write("ok")`, `#!${process.execPath}`);
  const r = await sandbox.run(p, [], {});
  rmSync(d, { recursive: true, force: true });
  return r.code === 0 && r.stdout === "ok";
})() : false;
const skipNode = skip || (!nodeInSandbox && "the sandbox cannot execute this Node binary (it lives under a read-denied root)");

// ------------------------------------------------------------------ formats and fixtures

test("every generated fixture validates as exactly its own format; every refused mutation is refused", () => {
  for (const mt of GENERATED_FORMATS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const b = fixtureFor(mt, seed)!;
      assert.ok(b && b.length <= 64 * 1024, `${mt} seed ${seed}`);
      assert.equal(identify(b).mediaType, mt, `${mt} seed ${seed} identifies as itself and nothing else`);
      for (const k of ["truncated", "bad-magic", "corrupt-checksum"] as const) {
        assert.equal(formatOf(mt)!.validate(mutate(b, k, mt)).ok, false, `${mt} ${k} is refused`);
        assert.ok(invalidFixtureFor(mt, seed, k), `${mt} ${k} gives an invalid fixture`);
      }
    }
  }
  // Trailing bytes are allowed by TIFF's specification: that mutation is not offered as invalid.
  assert.equal(invalidFixtureFor("image/tiff", 1, "trailing-bytes"), undefined);
});

test("identification: structure decides, never a magic number alone; unknown bytes stay opaque", () => {
  const png = fixtureFor("image/png", 2)!;
  assert.equal(identify(png).type, "bytes:image/png");
  assert.equal(identify(Buffer.concat([png.subarray(0, 8), Buffer.from("not a png at all")])).type, "bytes", "a PNG signature on garbage is not a PNG");
  assert.equal(identify(Buffer.from("plain text")).type, "bytes");
  // A format with a validator but no generator (WebP) is recognised from its structure.
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([22, 0, 0, 0]), Buffer.from("WEBPVP8L"), Buffer.from([10, 0, 0, 0, 0x2f, 2, 64, 0, 0, 0, 0, 0, 0, 0])]);
  assert.equal(identify(webp).type, "bytes:image/webp");
  assert.ok(!GENERATED_FORMATS.includes("image/webp"));
});

test("the pixels fact is format-independent: the same picture in PPM, TIFF-like and grey forms", () => {
  const ppm = fixtureFor("image/x-portable-pixmap", 3)!;
  const v = formatOf("image/x-portable-pixmap")!.validate(ppm);
  assert.ok(v.ok && typeof v.facts.pixels === "string");
  const pgm = fixtureFor("image/x-portable-graymap", 3)!;
  const g = formatOf("image/x-portable-graymap")!.validate(pgm);
  assert.ok(g.ok && typeof g.facts.pixels === "string" && g.facts.pixels !== v.facts.pixels);
});

test("bytes types form their own lattice: never text or JSON, opaque never fills a typed port", () => {
  assert.equal(distance("bytes:image/png", "bytes:image/png"), 0);
  assert.equal(distance("bytes", "bytes:image/png"), 1, "an opaque bytes port takes typed bytes");
  assert.equal(distance("bytes:image/png", "bytes"), -1, "opaque bytes never fill a typed port");
  assert.equal(distance("bytes:image/png", "bytes:image/tiff"), -1);
  assert.equal(distance("json", "bytes:image/png"), -1);
  assert.equal(distance("text", "bytes:image/png"), -1);
  assert.equal(accepts("input", "text", "bytes:image/png", true), false, "a program reading any text does not take bytes");
  assert.equal(accepts("input", "bytes:image/png", "text"), false);
});

test("candidate formats come from the documentation only", () => {
  assert.deepEqual(documentedFormats("usage: foo [-o out] in.tif\nReads TIFF, writes PNG.").map((f) => f.slug), ["tiff", "png"]);
  assert.deepEqual(documentedFormats("usage: foo FILE\nCount lines."), []);
  assert.equal(FORMATS.length, 10);
});

// ------------------------------------------------------------------ acquisition (synthetic programs)

test("acquisition establishes a transformation only from experiments: two inputs, a repeat, validated outputs", { skip, timeout: 120_000 }, async () => {
  const d = tmp("rcx-acq-");
  const tifcat = program(d, "tifcat", `if [ "$1" = "--help" ]; then echo "usage: tifcat FILE.tif   copy a TIFF image to standard output"; exit 0; fi\nexec cat "$1"`);
  const fixed = join(d, "fixed.png"); writeFileSync(fixed, fixtureFor("image/png", 9)!);
  const pngconst = program(d, "pngconst", `if [ "$1" = "--help" ]; then echo "usage: pngconst FILE.png   write a PNG to standard output"; exit 0; fi\nexec cat "${fixed}"`);
  const pngcut = program(d, "pngcut", `if [ "$1" = "--help" ]; then echo "usage: pngcut FILE.png   write a PNG to standard output"; exit 0; fi\nexec head -c 40 "$1"`);
  const lines = program(d, "lines", `if [ "$1" = "--help" ]; then echo "usage: lines FILE   count lines"; exit 0; fi\nwc -l < "$1"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [tifcat, pngconst, pngcut, lines], execute: [tifcat] } });
  for (const p of [tifcat, pngconst, pngcut, lines]) await rc.learn({ source: `cli:${p}` });
  const cap = rc.graph.get("cli:tifcat:tiff-to-tiff");
  assert.ok(cap, rc.graph.list().map((c) => c.id).join(", "));
  const bin: any = (cap.invoke as any).binary;
  assert.deepEqual(bin.argv, ["input.tif"]);
  assert.equal(bin.output.via, "stdout");
  assert.deepEqual(bin.preserves, ["width", "height", "pages", "pixels"]);
  assert.equal(bin.deterministic, "bytes");
  assert.ok(bin.trials.length >= 3 && bin.trials.every((t: any) => /^[0-9a-f]{64}$/.test(t.input.sha256)));
  assert.ok(cap.tags.includes("lossless") && !cap.tags.includes("unsupported"));
  assert.equal(cap.inputs[0].type, "bytes:image/tiff");
  assert.equal(cap.outputs[0].type, "bytes:image/tiff");
  // Constant output (does not depend on the input) and invalid output are never established.
  assert.ok(!rc.graph.list().some((c) => c.provider === "cli:pngconst" && (c.invoke as any).binary));
  assert.ok(!rc.graph.list().some((c) => c.provider === "cli:pngcut" && (c.invoke as any).binary));
  const inv: any = (rc as any).investigations.get(pngconst);
  assert.ok(inv.claims.some((c: any) => c.status === "contradicted" && /does not depend on the input/.test(c.evidence)));
  // No documented format: nothing is tried, and that is recorded as unknown.
  assert.ok((rc as any).investigations.get(lines).claims.some((c: any) => c.claim.includes("binary format") && c.status === "unknown"));
  rmSync(d, { recursive: true, force: true });
});

test("run time re-establishes the contract: invalid input runs nothing; a mismatched output returns nothing", { skip, timeout: 120_000 }, async () => {
  const d = tmp("rcx-acq-run-");
  const tifcat = program(d, "tifcat", `if [ "$1" = "--help" ]; then echo "usage: tifcat FILE.tif   copy a TIFF image to standard output"; exit 0; fi\nexec cat "$1"`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [tifcat], execute: [tifcat] } });
  await rc.learn({ source: `cli:${tifcat}` });
  const id = "cli:tifcat:tiff-to-tiff";
  const tif = fixtureFor("image/tiff", 7)!;
  const ok: any = await rc.run(id, { input: { type: "bytes", base64: b64(tif) } });
  assert.equal(ok.status, "completed", String(ok.error));
  assert.equal(ok.output.mediaType, "image/tiff");
  assert.ok((await rc.artefacts.get(ok.output.ref)).equals(tif), "byte-exact");
  assert.equal(ok.cliValidity.outputCheck.mediaType, "image/tiff");
  assert.deepEqual(ok.cliValidity.invocation.argv, [{ kind: "file", role: "read", name: "input.tif", sha256: ok.cliValidity.artefacts.inputs[0].sha256, bytes: tif.length }]);
  // Input that is not a valid TIFF: refused before anything runs.
  const png: any = await rc.run(id, { input: { type: "bytes", base64: b64(fixtureFor("image/png", 1)!) } });
  assert.equal(png.status, "failed");
  assert.match(String(png.error), /not a valid image\/tiff.*nothing was run/);
  const cut: any = await rc.run(id, { input: { type: "bytes", base64: b64(mutate(tif, "truncated", "image/tiff")) } });
  assert.match(String(cut.error), /not a valid image\/tiff/);
  // A contract whose output format the program does not produce: no result, nothing stored.
  (rc.graph.get(id)!.invoke as any).binary.output.mediaType = "image/png";
  const usage = await rc.artefacts.usage();
  const wrong: any = await rc.run(id, { input: { type: "bytes", base64: b64(tif) } });
  assert.equal(wrong.status, "failed");
  assert.match(String(wrong.error), /not a valid image\/png/);
  assert.equal(wrong.cliValidity.outcome, "not-established");
  assert.deepEqual(await rc.artefacts.usage(), usage, "nothing was stored");
  rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------------------------ composition (synthetic converters)

const PGM2PPM = `const fs = require("fs");
if (process.argv[2] === "--help") { console.log("usage: pgm2ppm in.pgm out.ppm   expand a PGM greymap to a PPM pixmap"); process.exit(0); }
const b = fs.readFileSync(process.argv[2]);
const m = /^P5\\s+(?:#[^\\n]*\\n\\s*)*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s/.exec(b.subarray(0, 200).toString("latin1"));
if (!m) { console.error("not a PGM"); process.exit(1); }
const w = +m[1], h = +m[2], g = b.subarray(m[0].length, m[0].length + w * h);
if (g.length !== w * h) { console.error("short PGM"); process.exit(1); }
const out = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = g[i];
fs.writeFileSync(process.argv[3], Buffer.concat([Buffer.from("P6\\n" + w + " " + h + "\\n255\\n"), out]));`;

const PPM2TIF = `const fs = require("fs");
if (process.argv[2] === "--help") { console.log("usage: ppm2tif in.ppm out.tif   write a PPM pixmap as an uncompressed TIFF"); process.exit(0); }
const b = fs.readFileSync(process.argv[2]);
const m = /^P6\\s+(?:#[^\\n]*\\n\\s*)*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s/.exec(b.subarray(0, 200).toString("latin1"));
if (!m) { console.error("not a PPM"); process.exit(1); }
const w = +m[1], h = +m[2], px = b.subarray(m[0].length, m[0].length + w * h * 3);
if (px.length !== w * h * 3) { console.error("short PPM"); process.exit(1); }
const e = [[256,3,1,w],[257,3,1,h],[258,3,1,8],[259,3,1,1],[262,3,1,2],[273,4,1,0],[277,3,1,3],[278,3,1,h],[279,4,1,px.length]];
const ifd = Buffer.alloc(2 + e.length * 12 + 4); ifd.writeUInt16LE(e.length, 0);
const dataAt = 8 + ifd.length;
e.forEach(([t, ty, c, v], i) => { const o = 2 + i * 12; ifd.writeUInt16LE(t, o); ifd.writeUInt16LE(ty, o + 2); ifd.writeUInt32LE(c, o + 4); if (t === 273) ifd.writeUInt32LE(dataAt, o + 8); else if (ty === 3) ifd.writeUInt16LE(v, o + 8); else ifd.writeUInt32LE(v, o + 8); });
const hdr = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
fs.writeFileSync(process.argv[3], Buffer.concat([hdr, ifd, px]));`;

test("composition: a new artefact is identified and two acquired capabilities are chained by type, each step re-checked", { skip: skipNode, timeout: 180_000 }, async () => {
  const d = tmp("rcx-compose-");
  const g2c = program(d, "pgm2ppm", PGM2PPM, `#!${process.execPath}`);
  const c2t = program(d, "ppm2tif", PPM2TIF, `#!${process.execPath}`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [g2c, c2t], execute: [g2c, c2t] } });
  for (const p of [g2c, c2t]) await rc.learn({ source: `cli:${p}` });
  assert.ok(rc.graph.get("cli:pgm2ppm:pgm-to-ppm")?.tags.includes("lossless"));
  assert.ok(rc.graph.get("cli:ppm2tif:ppm-to-tiff")?.tags.includes("lossless"));
  const pgm = fixtureFor("image/x-portable-graymap", 21)!;
  // Nothing in the request names a capability or a step: only the bytes and the wanted type.
  const r: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:image/tiff", run: true } as any);
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.executed?.error ?? r.planningRefusal ?? r.plans?.length));
  assert.deepEqual(r.plans[0].steps.map((s: any) => s.capability), ["cli:pgm2ppm:pgm-to-ppm", "cli:ppm2tif:ppm-to-tiff"]);
  const out = await rc.artefacts.get(r.executed.output.ref);
  const v = formatOf("image/tiff")!.validate(out);
  const src = formatOf("image/x-portable-graymap")!.validate(pgm);
  assert.ok(v.ok && src.ok);
  assert.equal(v.facts.pixels, src.facts.pixels, "the TIFF shows exactly the scanned picture");
  for (const id of r.executed.runs) assert.equal((rc.runs.get(id) as any).cliValidity.outcome, "result-established");
  // Bytes that are not any known format stay opaque, and nothing is planned for them.
  const none: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(Buffer.from("not an image")) } }, want: "bytes:image/tiff" } as any);
  assert.equal(none.plans.length, 0);
  // A declared type that contradicts the bytes is refused.
  await assert.rejects(rc.compose({ have: { scan: { type: "bytes:image/png", value: { type: "bytes", base64: b64(pgm) } } }, want: "bytes:image/tiff" } as any), /declared bytes:image\/png, but its bytes validate as image\/x-portable-graymap/);
  rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------------------------ real programs (development cases)

const REAL = ["/opt/homebrew/bin/ppm2tiff", "/opt/homebrew/bin/cwebp", "/opt/homebrew/bin/dwebp"];
test("development case: ppm2tiff, cwebp and dwebp are acquired; dwebp's WebP inputs come from cwebp's validated outputs", { skip: skip || (!REAL.every(existsSync) && "ppm2tiff, cwebp or dwebp is not installed"), timeout: 300_000 }, async () => {
  const rc = await RightClick.create({ directories: [], authority: { investigate: REAL, execute: REAL } });
  for (const p of REAL) await rc.learn({ source: `cli:${p}` });
  assert.ok(rc.graph.get("cli:ppm2tiff:ppm-to-tiff")?.tags.includes("lossless"));
  // Which inputs cwebp reads depends on how it was built (the CI runner's build differs from a
  // developer's): some conversion to WebP must be established, not a particular one.
  const toWebp = rc.graph.list().filter((c) => c.id.startsWith("cli:cwebp:") && c.id.endsWith("-to-webp"));
  assert.ok(toWebp.length, rc.graph.list().filter((c) => c.provider === "cli:cwebp").map((c) => c.id).join(", "));
  const dw = rc.graph.get("cli:dwebp:webp-to-png");
  assert.ok(dw, "a decoder for a format with no generator, acquired from an acquired encoder's outputs");
  assert.match((dw!.invoke as any).binary.fixtures, /output of cli:cwebp:/);
  // cwebp's -d dump has none of the input's dimensions: established, but never composed.
  const dump = rc.graph.list().find((c) => c.id.startsWith("cli:cwebp:") && c.id.endsWith("-to-pgm"));
  if (dump) assert.ok(dump.tags.includes("unsupported"));
  // PGM to PNG has no single capability; cwebp (pgm to webp) then dwebp (webp to png) exists on
  // every host where these programs are installed, so the composer must find and run it.
  const pgm = fixtureFor("image/x-portable-graymap", 11)!;
  const r: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:image/png", run: true } as any);
  assert.equal(r.executed?.status, "completed", JSON.stringify(r.executed?.error ?? r.planningRefusal ?? toWebp.map((c) => c.id)));
  assert.equal(r.plans[0].steps.length, 2);
  const png = formatOf("image/png")!.validate(await rc.artefacts.get(r.executed.output.ref));
  const src = formatOf("image/x-portable-graymap")!.validate(pgm);
  assert.ok(png.ok && src.ok);
  assert.deepEqual([png.facts.width, png.facts.height], [src.facts.width, src.facts.height]);
  // PPM to WebP needs a TIFF-reading cwebp, which not every build is: with a route it must
  // complete; without one, nothing is planned or run (never a guessed route).
  const ppm = fixtureFor("image/x-portable-pixmap", 11)!;
  const w: any = await rc.compose({ have: { photo: { type: "bytes", base64: b64(ppm) } }, want: "bytes:image/webp", run: true } as any);
  if (rc.graph.get("cli:cwebp:tiff-to-webp") || rc.graph.get("cli:cwebp:ppm-to-webp")) assert.equal(w.executed?.status, "completed", JSON.stringify(w.executed?.error));
  else { assert.equal(w.plans.length, 0); assert.equal(w.executed, undefined); }
});
