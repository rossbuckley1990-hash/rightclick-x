// Capability bootstrapping: formats established by witnesses rather than validators, samples from
// other acquired capabilities, documented flags tested for their effect, re-acquisition when new
// evidence appears, goal-aware composition with hard fidelity constraints, honest reachability,
// and actionable errors. These are regressions for the five defects the PR #60 research
// evaluation found, plus the engine that addresses its 1/6 generalisation result.
//
// The programs here are test fixtures written below (Node scripts). They define a private image
// format, ".xyz", that no part of RightClick knows: everything RightClick learns about it comes
// from its own experiments. No real program is named in the code under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { fixtureFor } from "../src/core/fixtures.ts";
import { documentedOperandExtensions, formatOf, normaliseDocs } from "../src/core/formats.ts";
import { dispatch } from "../src/interface/tools.ts";

const sandbox = await hostSandbox();
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
function program(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!${process.execPath}\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
const nodeInSandbox = sandbox ? await (async () => {
  const d = tmp("rcx-node-probe-");
  const p = program(d, "probe", `process.stdout.write("ok")`);
  const r = await sandbox.run(p, [], {});
  rmSync(d, { recursive: true, force: true });
  return r.code === 0 && r.stdout === "ok";
})() : false;
const skip = !sandbox ? "no host sandbox on this platform" : !nodeInSandbox ? "the sandbox cannot execute this Node binary (it lives under a read-denied root)" : false;

// A private format: "XYZ1", width and height (u16 LE), then one byte per grey sample. The encoder
// is lossy by default (it clears each sample's low bit) and exact with --exact; the decoder writes
// a PGM by default and a PPM with --ppm.
const COMMON = `const fs = require("fs");
const args = process.argv.slice(2); const flags = args.filter((a) => a.startsWith("--")); const ops = args.filter((a) => !a.startsWith("--"));
function pgm(b) { const m = /^P5\\s+(?:#[^\\n]*\\n\\s*)*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s/.exec(b.subarray(0, 200).toString("latin1")); if (!m) return null; const w = +m[1], h = +m[2]; const px = b.subarray(m[0].length, m[0].length + w * h); return px.length === w * h ? { w, h, px } : null; }`;
const XYZENC = `${COMMON}
if (args[0] === "--help") { console.log("usage: xyzenc [--exact] input.pgm output.xyz\\nEncode a greyscale PGM image as XYZ.\\n  --exact   keep every sample exactly (default: drop the lowest bit)"); process.exit(0); }
const g = pgm(fs.readFileSync(ops[0])); if (!g) { console.error("not a PGM"); process.exit(1); }
const px = flags.includes("--exact") ? g.px : Buffer.from(g.px.map((v) => v & 0xfe));
const head = Buffer.alloc(8); head.write("XYZ1", 0, "latin1"); head.writeUInt16LE(g.w, 4); head.writeUInt16LE(g.h, 6);
fs.writeFileSync(ops[1], Buffer.concat([head, px]));`;
const XYZDEC = `${COMMON}
if (args[0] === "--help") { console.log("usage: xyzdec [--ppm] input.xyz output.pgm\\nDecode an XYZ image.\\n  --ppm   write a colour PPM pixmap instead of a PGM"); process.exit(0); }
const b = fs.readFileSync(ops[0]); if (b.length < 8 || b.subarray(0, 4).toString("latin1") !== "XYZ1") { console.error("not XYZ"); process.exit(1); }
const w = b.readUInt16LE(4), h = b.readUInt16LE(6), px = b.subarray(8, 8 + w * h); if (px.length !== w * h) { console.error("short XYZ"); process.exit(1); }
if (flags.includes("--ppm")) { const o = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) o[3 * i] = o[3 * i + 1] = o[3 * i + 2] = px[i]; fs.writeFileSync(ops[1], Buffer.concat([Buffer.from("P6\\n" + w + " " + h + "\\n255\\n"), o])); }
else fs.writeFileSync(ops[1], Buffer.concat([Buffer.from("P5\\n" + w + " " + h + "\\n255\\n"), px]));`;

// The same encoder without its exact mode: only a lossy encoding exists.
const XYZENC_LOSSY = XYZENC.replace(" [--exact]", "").replace("\\n  --exact   keep every sample exactly (default: drop the lowest bit)", "").replace('flags.includes("--exact")', "false");

async function world(authoriseDir = false, encoder = XYZENC) {
  const dir = tmp("rcx-boot-");
  const enc = program(dir, "xyzenc", encoder), dec = program(dir, "xyzdec", XYZDEC);
  const authority = authoriseDir ? { investigate: [dir + "/"], execute: [dir + "/"] } : { investigate: [enc, dec], execute: [enc, dec] };
  const rc = await RightClick.create({ directories: [], authority });
  return { dir, enc, dec, rc };
}
const binary = (rc: RightClick, id: string) => (rc.graph.get(id)?.invoke as { binary?: { preserves: string[]; witnessed?: Array<{ how: string; capability: string }>; output: { signature?: string }; flag?: string } } | undefined)?.binary;

// ------------------------------------------------------------------ documentation reading

test("documentation: CamelCase format words and operand extensions, with their roles", () => {
  assert.match(normaliseDocs("Usage: giffix [-v] GifFile"), /\bGif File\b/);
  assert.deepEqual(documentedOperandExtensions("Syntax: foo [options] input.[jpg|png] output.abc", "foo"), [{ ext: "jpg", role: "input" }, { ext: "png", role: "input" }, { ext: "abc", role: "output" }]);
  assert.deepEqual(documentedOperandExtensions("Usage: foo filename.png filename.gd", "foo").map((x) => x.role), ["any", "any"]);
  assert.deepEqual(documentedOperandExtensions("FOO 1.0 (https://foo.example.io)\nusage: foo <in>", "foo"), [], "URLs and versions are not operands");
});

// ------------------------------------------------------------------ the engine, and defect 1

test("a format no library knows is established by a witness: an encoder's outputs that a decoder turns back", { skip, timeout: 240_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  const r: any = await rc.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const e = binary(rc, "cli:xyzenc:pgm-to-xyz"), d = binary(rc, "cli:xyzdec:xyz-to-pgm");
  assert.ok(e && d, rc.graph.list().filter((c) => c.provider.startsWith("cli:xyz")).map((c) => c.id).join(", "));
  assert.ok(e!.output.signature?.startsWith("58595a31"), "recognised by the leading bytes every witnessed output shared (XYZ1)");
  assert.ok(e!.witnessed?.some((w) => w.capability === "cli:xyzdec:xyz-to-pgm"));
  assert.ok(d!.witnessed?.some((w) => w.how === "round-trip"));
  assert.ok(r.bootstrapped?.length, "the loop after the learn established what neither program alone could");
  // The default encoding is lossy, and the experiments say so; the --exact variant is witnessed lossless.
  assert.ok(!e!.preserves.includes("pixels"));
  const exact = binary(rc, "cli:xyzenc:pgm-to-xyz-exact");
  assert.ok(exact?.preserves.includes("pixels") && exact.flag === "--exact", "a fidelity flag, tested and witnessed by decoding");
  // A format-selecting flag on the decoder: another output format, established on its own.
  assert.ok(binary(rc, "cli:xyzdec:xyz-to-ppm")?.flag === "--ppm");
  rmSync(dir, { recursive: true, force: true });
});

test("defect 1: a program learned before its evidence existed is acquired when the evidence appears", { skip, timeout: 240_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  await rc.learn({ source: `cli:${dec}` });
  assert.equal(rc.graph.get("cli:xyzdec:xyz-to-pgm"), undefined, "no XYZ samples exist yet");
  // Learning the encoder later supplies the samples; the decoder is revisited without being asked.
  await rc.learn({ source: `cli:${enc}` });
  assert.ok(rc.graph.get("cli:xyzdec:xyz-to-pgm"), "the decoder was acquired from the encoder's outputs");
  // A plain re-learn of an unchanged program continues rather than rediscovering.
  const again: any = await rc.learn({ source: `cli:${dec}` });
  assert.match(JSON.stringify(again.results[0].probes), /already learned and unchanged/);
  rmSync(dir, { recursive: true, force: true });
});

test("helper programs in an authorised directory are found by the format a program needs", { skip, timeout: 240_000 }, async () => {
  const { dir, dec, rc } = await world(true);
  await rc.learn({ source: `cli:${dec}` });
  assert.ok(rc.graph.get("cli:xyzenc:pgm-to-xyz"), "xyzenc was investigated because xyzdec needs .xyz samples and its name carries the format");
  assert.ok(rc.graph.get("cli:xyzdec:xyz-to-pgm"));
  rmSync(dir, { recursive: true, force: true });
});

test("run time: a witnessed format is checked by its signature; facts it cannot show are re-checked through the witness", { skip, timeout: 240_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  await rc.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const pgm = fixtureFor("image/x-portable-graymap", 41)!;
  const ok: any = await rc.run("cli:xyzenc:pgm-to-xyz-exact", { input: { type: "bytes", base64: b64(pgm) } });
  assert.equal(ok.status, "completed", String(ok.error));
  assert.equal(ok.output.mediaType, "x-ext/xyz");
  assert.ok(ok.cliValidity.outputCheck.kept.includes("pixels"), "pixels re-checked by decoding the output with xyzdec");
  assert.match(ok.cliValidity.outputCheck.validator, /decoded by cli:xyzdec/);
  const notXyz: any = await rc.run("cli:xyzdec:xyz-to-pgm", { input: { type: "bytes", base64: b64(Buffer.from("not an xyz file at all")) } });
  assert.equal(notXyz.status, "failed");
  assert.match(String(notXyz.error), /not the witnessed signature.*nothing was run/);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ defect 2: goal-aware composition

test("defect 2: lossless is a hard constraint; an exact route wins; with none, the answer says why", { skip, timeout: 300_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  await rc.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const pgm = fixtureFor("image/x-portable-graymap", 43)!;
  // Without a requirement, the default ranking still prefers proven-exact steps.
  const any: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:x-ext/xyz", run: true });
  assert.equal(any.executed?.status, "completed", JSON.stringify(any.executed?.error));
  assert.deepEqual(any.plans[0].steps.map((s: any) => s.capability), ["cli:xyzenc:pgm-to-xyz-exact"]);
  // "Without losing information": only the exact variant qualifies, and the result is checked.
  const exact: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:x-ext/xyz", run: true, preserve: ["pixels"] });
  assert.equal(exact.executed?.status, "completed");
  assert.deepEqual(exact.executed.preserved.confirmed, ["pixels"]);
  rmSync(dir, { recursive: true, force: true });
  // An encoder with no exact mode: a lossy route exists, and it is refused for the hard requirement.
  const lossy = await world(false, XYZENC_LOSSY);
  await lossy.rc.learn({ sources: [`cli:${lossy.enc}`, `cli:${lossy.dec}`] });
  assert.equal(lossy.rc.graph.get("cli:xyzenc:pgm-to-xyz-exact"), undefined);
  const plain: any = await lossy.rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:x-ext/xyz", run: true });
  assert.equal(plain.executed?.status, "completed", `without a requirement the lossy route runs: ${JSON.stringify({ caps: lossy.rc.graph.list().filter((c) => c.provider.startsWith("cli:xyz")).map((c) => c.id), plans: plain.plans?.length, err: plain.executed?.error })}`);
  const refused: any = await lossy.rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:x-ext/xyz", run: true, preserve: ["pixels"] });
  assert.equal(refused.plans.length, 0, JSON.stringify(refused.plans.map((p: any) => p.steps.map((s: any) => s.capability))));
  assert.equal(refused.executed, undefined, "nothing ran");
  assert.match(refused.planningRefusal.reason, /no route is proven to keep pixels.*cli:xyzenc:pgm-to-xyz/);
  rmSync(lossy.dir, { recursive: true, force: true });
});

test("defect 2: a saved pipeline does not beat a shorter exact route because it ran first", { skip, timeout: 300_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  await rc.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const pgm = fixtureFor("image/x-portable-graymap", 44)!;
  // A lossy round trip, saved as a pipeline with a track record: pgm > xyz (lossy) > pgm.
  rc.graph.forget("cli:xyzenc:pgm-to-xyz-exact");
  const roundTrip: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:image/x-portable-pixmap", run: true, through: ["cli:xyzenc:pgm-to-xyz", "cli:xyzdec:xyz-to-ppm"] } as any);
  assert.equal(roundTrip.executed?.status, "completed", JSON.stringify(roundTrip.executed?.error));
  // Learn again: the exact encoder returns. The pipeline exists, but the exact steps rank first.
  await rc.learn({ sources: [`cli:${enc}`] });
  (rc.graph.providers.get("cli:xyzenc")!.meta!.binary as any).evidence = "";
  await rc.learn({ sources: [`cli:${dec}`] });
  const next: any = await rc.compose({ have: { scan: { type: "bytes", base64: b64(pgm) } }, want: "bytes:image/x-portable-pixmap" });
  const first = next.plans[0].steps.map((s: any) => s.capability);
  assert.ok(!first.some((id: string) => id.startsWith("composite:")), `chose ${first.join(" > ")}`);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ defect 3: honest reachability

test("defect 3: context_actions reaches only through capabilities that run now, and says why others do not", { skip, timeout: 240_000 }, async () => {
  const { dir, enc, dec, rc } = await world();
  await rc.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const pgm = { type: "bytes", base64: b64(fixtureFor("image/x-portable-graymap", 45)!) };
  const a: any = await rc.actions({ value: pgm });
  assert.equal(a.inspected.type, "bytes:image/x-portable-graymap", "bytes are typed by their structure");
  assert.ok(a.reachableTypes.some((t: any) => t.type === "bytes:x-ext/xyz" && t.route.length === 1));
  // Withdraw execution authority from the decoder: what only it could reach is no longer reachable.
  const rc2 = await RightClick.create({ directories: [], authority: { investigate: [enc, dec], execute: [enc] } });
  await rc2.learn({ sources: [`cli:${enc}`, `cli:${dec}`] });
  const b: any = await rc2.actions({ value: pgm });
  assert.ok(!b.reachableTypes.some((t: any) => t.type === "bytes:image/x-portable-pixmap"), "a PPM is reachable only through the decoder, which may not run here");
  const xyz: any = await rc2.actions({ type: "bytes:x-ext/xyz" });
  assert.ok(xyz.actions.every((x: any) => x.availability === "not-authorised"));
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ defect 5: actionable errors

test("defect 5: a run without an id, or with an unknown one, is refused with what to do, never guessed", async () => {
  const rc = await RightClick.create({ directories: [] });
  await assert.rejects(dispatch(rc, "context_run", {}), /context_run needs "id".*context_graph.*nothing was run/);
  await assert.rejects(rc.run(undefined as unknown as string), /a run needs "id"/);
  await assert.rejects(rc.run("builtin:text.revers"), /unknown capability: builtin:text\.revers; similar ids: .*builtin:/);
});

// ------------------------------------------------------------------ sample sources

test("operator sample roots: files are recognised by structure, never by extension, with provenance", async () => {
  const root = tmp("rcx-roots-");
  mkdirSync(join(root, "deep"));
  writeFileSync(join(root, "deep", "photo.dat"), fixtureFor("image/png", 5)!);
  writeFileSync(join(root, "fake.png"), Buffer.from("not a png"));
  const rc: any = await RightClick.create({ directories: [], sampleRoots: [root] });
  const samples = await rc.binaryRootSamples();
  assert.deepEqual(samples.map((s: any) => s.mediaType), ["image/png"]);
  assert.match(samples[0].source, /operator sample root .*photo\.dat \(sha256 [0-9a-f]{16}\)/);
  assert.ok(formatOf("image/png")!.validate(samples[0].bytes).ok);
  rmSync(root, { recursive: true, force: true });
});
