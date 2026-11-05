// Byte-exact artefacts and file roles for command-line capabilities.
//
// Root causes this guards against (found by an independent evaluation, reproduced here):
//   1. file and stdin content was always a JS string written as UTF-8, so binary bytes >= 0x80
//      were re-encoded; 2. files a program created were listed by name and deleted unread;
//   3. "--opt=file" options were not parsed at all; 4. option values were passed unchecked, so a
//   host path reached the sandboxed program. The six programs used below are development cases
//   from that evaluation, not held-out acceptance; each is skipped visibly when not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";
import { ArtefactStore, decodeBase64Strict, encodeText, isArtefactValue, sha256Hex } from "../src/core/artefacts.ts";
import { fileRole, parseUsage, validateOptions } from "../src/reflectors/cli.ts";
import { redact } from "../src/core/secrets.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);

// ------------------------------------------------------------------ values, encodings, store

test("artefact values are exact tagged shapes; any other object keeps its old meaning", () => {
  assert.ok(isArtefactValue({ type: "bytes", base64: "AA==" }));
  assert.ok(isArtefactValue({ type: "text", text: "é", encoding: "latin-1" }));
  assert.ok(isArtefactValue({ type: "artefact", ref: `sha256:${"0".repeat(64)}` }));
  assert.ok(!isArtefactValue({ type: "bytes", base64: "AA==", extra: 1 }), "extra keys: not an artefact");
  assert.ok(!isArtefactValue({ base64: "AA==" }), "untagged: not an artefact");
  assert.ok(!isArtefactValue("AA=="), "a string stays UTF-8 text");
});

test("base64 must be strict and canonical; declared encodings refuse what they cannot represent", () => {
  assert.deepEqual([...decodeBase64Strict(b64(allBytes))], [...allBytes]);
  assert.equal(decodeBase64Strict("").length, 0, "an empty artefact is valid");
  for (const bad of ["AA=", "A A=", "AA==\n", "AB==", "@@@@"]) assert.throws(() => decodeBase64Strict(bad), /malformed|canonical/, bad);
  assert.deepEqual([...encodeText("é", "latin-1")], [0xe9]);
  assert.throws(() => encodeText("€", "latin-1"), /cannot be encoded as latin-1/);
  assert.throws(() => encodeText("\uD800", "utf-8"), /unpaired surrogates/);
  assert.throws(() => encodeText("x", "ebcdic"), /unsupported text encoding/);
});

test("the store is content-addressed: refs never name paths, and a tampered file is refused", async () => {
  const dir = tmp("rcx-art-");
  const store = new ArtefactStore(dir);
  const a = await store.put(allBytes, { holder: "run:test" });
  assert.equal(a.sha256, await sha256Hex(allBytes));
  assert.match(a.ref, new RegExp(`^sha256:${a.sha256}\\.[A-Za-z0-9_-]{22}$`), "the ref is a read grant on the digest");
  assert.deepEqual([...(await new ArtefactStore(dir).get(a.ref))], [...allBytes], "persists across instances");
  for (const ref of ["/etc/passwd", "../x", "sha256:../../etc", `sha256:${"g".repeat(64)}`]) await assert.rejects(store.get(ref), /not an artefact reference/, ref);
  await assert.rejects(store.get(`sha256:${a.sha256}`), /content digest, not a read grant/, "the digest alone reads nothing");
  await assert.rejects(store.get(`sha256:${"1".repeat(64)}.${"A".repeat(22)}`), /unknown artefact/);
  writeFileSync(join(dir, a.sha256), "tampered");
  await assert.rejects(new ArtefactStore(dir).get(a.ref), /failed its content check/);
  rmSync(dir, { recursive: true, force: true });
});

test("artefact payloads never appear in logs, records or exports", () => {
  const secret = b64(Buffer.from("private key material"));
  const out = JSON.stringify(redact({ files: { "k.bin": { type: "bytes", base64: secret }, "t.txt": { type: "text", text: "confidential", encoding: "utf-8" } } }));
  assert.ok(!out.includes(secret) && !out.includes("confidential"), out);
  assert.match(out, /"bytes":20/);
});

// ------------------------------------------------------------------ documentation: file roles and option values

test("'--opt=file' options are parsed, and file-valued arguments get a read or write role", () => {
  const help = `Usage: certx [ -<flag> [<val>] ]...
       --infile=file          Input file
       --outfile=str          Output file
       --load-trust=file      Read trust anchors from file
   -S, --load-response=file   Reads the DER encoded response from file
       --keyring FILE         take the keys from the keyring FILE
   -k keyfile                 read the key from keyfile
   -n num                     number of items`;
  const { options } = parseUsage(help);
  const role = (flag: string) => { const o = options.find((x) => x.flags.includes(flag)); assert.ok(o, `${flag} parsed`); return fileRole(o!); };
  assert.equal(role("--infile"), "read");
  assert.equal(role("--outfile"), "write");
  assert.equal(role("--load-trust"), "read");
  assert.equal(role("--load-response"), "read");
  assert.equal(role("--keyring"), "read");
  assert.equal(role("-k"), "read");
  assert.equal(role("-n"), undefined, "a number is not a file");
});

test("option values never name host paths; file roles must name staged inputs or declared outputs", () => {
  const allowed = [{ flags: ["--load-trust"], arg: true, file: "read" as const }, { flags: ["--outfile"], arg: true, file: "write" as const }, { flags: ["-n"], arg: true }];
  const files = { inputs: ["ca.pem"], outputs: ["out.der"] };
  assert.deepEqual(validateOptions(["--load-trust=ca.pem", "--outfile", "out.der", "-n", "3"], allowed, [], files), ["--load-trust=ca.pem", "--outfile", "out.der", "-n", "3"]);
  assert.deepEqual(validateOptions(["--load-trust=./ca.pem"], allowed, [], files), ["--load-trust=./ca.pem"], "./name is the staged file");
  for (const bad of [["--load-trust=/etc/ssl/cert.pem"], ["--load-trust", "~/.ssh/id"], ["-n", "../../x"], ["--outfile=/tmp/x"]]) assert.throws(() => validateOptions(bad, allowed, [], files), /host path/, bad.join(" "));
  assert.throws(() => validateOptions(["--load-trust=other.pem"], allowed, [], files), /must be the name of a staged input file/);
  assert.throws(() => validateOptions(["--outfile=ca.pem"], allowed, [], files), /must be a name declared in "outputs"/);
});

// ------------------------------------------------------------------ sandbox: exact bytes in and out

test("sandbox: every byte value survives staging, stdin and output collection exactly", { skip, timeout: 60_000 }, async () => {
  const viaFile = await sandbox!.run("/bin/cp", ["in.bin", "out.bin"], { files: { "in.bin": allBytes }, collect: ["out.bin"] });
  assert.equal(viaFile.code, 0, viaFile.stderr);
  assert.deepEqual([...viaFile.outputs!["out.bin"]], [...allBytes]);
  const viaStdin = await sandbox!.run("/bin/cat", [], { stdin: allBytes, rawStdout: true });
  assert.deepEqual([...viaStdin.stdoutRaw!], [...allBytes]);
  assert.equal(viaStdin.stdoutEncoding, "unsupported", "the text view still refuses invalid UTF-8");
  const empty = await sandbox!.run("/bin/cp", ["e", "e2"], { files: { e: new Uint8Array() }, collect: ["e2"] });
  assert.equal(empty.outputs!["e2"].length, 0, "an empty file is a valid output");
  const big = Buffer.alloc(5 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 4096) big.writeUInt32LE((i * 2654435761) >>> 0, i);
  const large = await sandbox!.run("/bin/cp", ["big", "big2"], { files: { big }, collect: ["big2"], limits: { timeoutMs: 20_000 } });
  assert.equal(await sha256Hex(large.outputs!["big2"]), await sha256Hex(big));
});

test("sandbox: outputs are regular files the program wrote; links, collisions and interrupted runs return nothing", { skip, timeout: 60_000 }, async () => {
  const link = await sandbox!.run("/bin/ln", ["-s", "/etc/hosts", "out.txt"], { collect: ["out.txt"] });
  assert.equal(link.outputs!["out.txt"], undefined);
  assert.match(link.outputRefusals!["out.txt"], /symbolic link/);
  const missing = await sandbox!.run("/usr/bin/true", [], { collect: ["never.txt"] });
  assert.match(missing.outputRefusals!["never.txt"], /was not created/);
  await assert.rejects(sandbox!.run("/bin/cp", ["a", "a"], { files: { a: "x" }, collect: ["A"] }), /same name as an input/);
  await assert.rejects(sandbox!.run("/bin/cp", [], { collect: ["../escape"] }), /invalid input file name/);
  const cut = await sandbox!.run("/bin/sh", ["-c", "echo partial > out.txt; sleep 10"], { collect: ["out.txt"], limits: { timeoutMs: 800 } });
  assert.ok(cut.timedOut);
  assert.equal(cut.outputs!["out.txt"], undefined);
  assert.match(cut.outputRefusals!["out.txt"], /did not complete cleanly/);
});

// ------------------------------------------------------------------ runtime: a generic program, end to end

function program(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
const BINCOPY = `if [ "$1" = "--help" ]; then cat <<'EOF'
usage: bincopy [-k keyfile] input output
Copy input to output, then append the key file when given.
  -k keyfile   read the key from keyfile and append it to the output
EOF
exit 0; fi
key=""
if [ "$1" = "-k" ]; then key="$2"; shift 2; fi
/bin/cat "$1" > "$2" || exit 2
if [ -n "$key" ]; then /bin/cat "$key" >> "$2" || exit 3; fi
echo "copied"`;

async function learned(bin: string) {
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin] } });
  await rc.learn({ source: `cli:${bin}` });
  const name = bin.split("/").pop()!;
  const cap = rc.graph.list().find((c) => c.provider === `cli:${name}` && c.invoke.kind === "cli" && (c.invoke as any).outputsPort);
  return { rc, cap };
}

test("runtime: binary input, auxiliary file and output operand round-trip exactly, with provenance", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-bin-");
  const bin = program(dir, "bincopy", BINCOPY);
  const { rc, cap } = await learned(bin);
  assert.ok(cap, rc.graph.list().map((c) => c.id).join(", "));
  const key = Buffer.from([0xff, 0x00, 0xfe]);
  const r = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: b64(allBytes) }, "key.bin": { type: "bytes", base64: b64(key) } }, options: ["-k", "key.bin"], operands: ["in.bin", "out.bin"], outputs: ["out.bin"] });
  assert.equal(r.status, "completed", String(r.error));
  const out: any = r.output;
  const expected = Buffer.concat([Buffer.from(allBytes), key]);
  assert.equal(out.outputs["out.bin"].sha256, await sha256Hex(expected));
  assert.equal(out.stdout, "copied\n");
  const read = await rc.readArtefact(out.outputs["out.bin"].ref);
  assert.equal(read.base64, b64(expected));
  assert.ok(read.complete);
  // Provenance: the build that was checked, what was consumed, what was produced.
  const prov = (r as any).cliValidity.artefacts;
  assert.equal(prov.program.bin, bin);
  assert.equal(prov.program.sha256, (cap!.invoke as any).sha256);
  assert.deepEqual(prov.inputs.map((i: any) => [i.name, i.sha256]).sort(), [["in.bin", await sha256Hex(allBytes)], ["key.bin", await sha256Hex(key)]].sort());
  assert.deepEqual(prov.outputs.map((o: any) => [o.name, o.sha256]), [["out.bin", await sha256Hex(expected)]]);
  rmSync(dir, { recursive: true, force: true });
});

test("runtime: host paths, missing outputs and missing programs are explicit refusals, never results", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-bin-");
  const bin = program(dir, "bincopy", BINCOPY);
  const { rc, cap } = await learned(bin);
  assert.ok(cap);
  const hostKey = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: "AA==" } }, options: ["-k", "/etc/hosts"], operands: ["in.bin", "out.bin"], outputs: ["out.bin"] });
  assert.equal(hostKey.status, "failed");
  assert.match(String(hostKey.error), /host path/);
  const unstaged = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: "AA==" } }, options: ["-k", "key.bin"], operands: ["in.bin", "out.bin"], outputs: ["out.bin"] });
  assert.match(String(unstaged.error), /must be the name of a staged input file/);
  const notMade = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: "AA==" } }, operands: ["in.bin", "other.bin"], outputs: ["out.bin", "other.bin"] });
  assert.equal(notMade.status, "failed");
  assert.match(String(notMade.error), /declared output "out\.bin" was not created/);
  const badB64 = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: "not base64!" } }, operands: ["in.bin", "out.bin"], outputs: ["out.bin"] });
  assert.match(String(badB64.error), /base64 is malformed/);
  rmSync(bin);
  const gone = await rc.run(cap!.id, { files: { "in.bin": { type: "bytes", base64: "AA==" } }, operands: ["in.bin", "out.bin"], outputs: ["out.bin"] });
  assert.equal(gone.status, "failed");
  assert.match(String(gone.error), /nothing was run/);
  assert.equal((gone as any).cliValidity?.artefacts?.outputs?.length ?? 0, 0, "no output is attributed to a program that did not run");
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ development cases: the six evaluated programs

const brew = (p: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map((d) => `${d}/${p}`).find((x) => existsSync(x));
const devSkip = (p: string, ...needs: string[]) => !sandbox ? "no host sandbox on this platform" : !brew(p) ? `${p} is not installed` : (needs.find((n) => !brew(n)) ? `${needs.find((n) => !brew(n))} (fixture tool) is not installed` : false);

function tiff(width: number, height: number, desc: string): Buffer {
  const d = Buffer.from(`${desc}\0`, "utf8");
  const pix = Buffer.alloc(width * height, 0x80);
  const ifdAt = 8 + pix.length + d.length + ((pix.length + d.length) % 2);
  const entries: Array<[number, number, number, number]> = [[256, 3, 1, width], [257, 3, 1, height], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 1], [270, 2, d.length, 8 + pix.length], [273, 4, 1, 8], [277, 3, 1, 1], [278, 3, 1, height], [279, 4, 1, pix.length]];
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach(([tag, type, count, value], i) => { const o = 2 + i * 12; ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(type, o + 2); ifd.writeUInt32LE(count, o + 4); if (type === 3) ifd.writeUInt16LE(value, o + 8); else ifd.writeUInt32LE(value, o + 8); });
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]);
  head.writeUInt32LE(ifdAt, 4);
  return Buffer.concat([head, pix, d, Buffer.alloc(ifdAt - 8 - pix.length - d.length), ifd]);
}

function zip(entries: Array<[string, string]>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name, "utf8"); const raw = Buffer.from(text, "utf8"); const data = deflateRawSync(raw); const c = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
function zipNames(b: Buffer): string[] {
  const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const names: string[] = [];
  for (let i = 0; i < count; i++) { const nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32); names.push(b.subarray(p + 46, p + 46 + nl).toString("utf8")); p += 46 + nl + el + cl; }
  return names;
}
function topAtoms(b: Buffer): string[] {
  const out: string[] = []; let i = 0;
  while (i + 8 <= b.length) { let size = b.readUInt32BE(i); if (size === 1) size = Number(b.readBigUInt64BE(i + 8)); if (size < 8) break; out.push(b.subarray(i + 4, i + 8).toString("latin1")); i += size; }
  return out;
}

test("development case tiffdump: a binary TIFF reaches the program byte for byte", { skip: devSkip("tiffdump"), timeout: 180_000 }, async () => {
  const { rc, cap } = await learned(realpathSync(brew("tiffdump")!));
  assert.ok(cap);
  const r = await rc.run(cap!.id, { files: { "scan.tif": { type: "bytes", base64: b64(tiff(37, 5, "Kraków ✓")) } }, operands: ["scan.tif"], stdoutAs: "text" });
  assert.equal(r.status, "completed", String(r.error));
  assert.match(String(r.output), /ImageWidth \(256\) SHORT \(3\) 1<37>/);
  assert.match(String(r.output), /Krak\\303\\263w/);
});

// tiffcp and nettle-hash were held-out programs in the independent acceptance of 20bc3a7; its
// counterexamples CE3 and CE2 made them development cases.
test("development case tiffcp (CE3): a truncated input fails the run, and its partial output is never returned", { skip: devSkip("tiffcp"), timeout: 180_000 }, async () => {
  const { rc, cap } = await learned(realpathSync(brew("tiffcp")!));
  assert.ok(cap);
  const good = tiff(4, 2, "page");
  const run = (second: Buffer) => rc.run(cap!.id, { files: { "a.tif": { type: "bytes", base64: b64(good) }, "b.tif": { type: "bytes", base64: b64(second) } }, operands: ["a.tif", "b.tif", "out.tif"], outputs: ["out.tif"] });
  const cut = await run(good.subarray(0, 20));
  assert.equal(cut.status, "failed", `a truncated page must not complete: ${String(cut.error)}`);
  assert.equal(cut.output, undefined);
  assert.equal((cut as any).cliValidity.outcome, "not-established");
  assert.deepEqual((cut as any).cliValidity.artefacts.outputs, []);
  assert.equal((await rc.artefacts.usage()).artefacts, 0, "the partial TIFF was not stored");
  const both = await run(good);
  assert.equal(both.status, "completed", String(both.error));
  const out = Buffer.from((await rc.readArtefact((both.output as any).outputs["out.tif"].ref)).base64, "base64");
  // Two directories: the first IFD's next-IFD pointer is non-zero.
  const ifd = out.readUInt32LE(4);
  assert.notEqual(out.readUInt32LE(ifd + 2 + out.readUInt16LE(ifd) * 12), 0, "both pages are in the output");
});

test("development case nettle-hash (CE2): an unknown algorithm fails, a known one returns its raw digest exactly", { skip: devSkip("nettle-hash"), timeout: 180_000 }, async () => {
  const { createHash } = await import("node:crypto");
  const { rc, cap } = await learned(realpathSync(brew("nettle-hash")!));
  assert.ok(cap);
  const bad = await rc.run(cap!.id, { options: ["-a", "no-such-algorithm", "--raw"], input: { type: "bytes", base64: b64(allBytes) }, stdoutAs: "artefact" });
  assert.equal(bad.status, "failed", `exit ${(bad as any).cliValidity?.processExit} must not complete`);
  assert.equal(bad.output, undefined, "no empty digest artefact");
  const ok = await rc.run(cap!.id, { options: ["-a", "sha256", "--raw"], input: { type: "bytes", base64: b64(allBytes) }, stdoutAs: "artefact" });
  assert.equal(ok.status, "completed", String(ok.error));
  const raw = Buffer.from((await rc.readArtefact((ok.output as any).stdout.ref)).base64, "base64");
  assert.ok(raw.equals(createHash("sha256").update(allBytes).digest()), raw.toString("hex"));
});

test("development case zipmerge: binary archives in, merged archive out, -I documented and accepted", { skip: devSkip("zipmerge"), timeout: 180_000 }, async () => {
  const { rc, cap } = await learned(realpathSync(brew("zipmerge")!));
  assert.ok(cap);
  assert.ok((cap!.invoke as any).options.allowed.some((o: any) => o.flags.includes("-I")), "-I is a documented option");
  const r = await rc.run(cap!.id, { files: { "a.zip": { type: "bytes", base64: b64(zip([["Readme.txt", "old"], ["données/été.txt", "chaud"]])) }, "b.zip": { type: "bytes", base64: b64(zip([["README.TXT", "new"]])) } }, options: ["-I"], operands: ["merged.zip", "a.zip", "b.zip"], outputs: ["merged.zip"] });
  assert.equal(r.status, "completed", String(r.error));
  const merged = Buffer.from((await rc.readArtefact((r.output as any).outputs["merged.zip"].ref)).base64, "base64");
  const names = zipNames(merged).map((n) => n.toLowerCase()).sort();
  assert.deepEqual(names, ["données/été.txt", "readme.txt"], names.join(","));
});

test("development case qt-faststart: an MP4 in, a rewritten MP4 out with moov before mdat", { skip: devSkip("qt-faststart", "ffmpeg"), timeout: 180_000 }, async () => {
  const dir = tmp("rcx-mp4-");
  execFileSync(brew("ffmpeg")!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=10", "-t", "1", "-pix_fmt", "yuv420p", join(dir, "in.mp4")]);
  const input = readFileSync(join(dir, "in.mp4"));
  assert.ok(topAtoms(input).indexOf("moov") > topAtoms(input).indexOf("mdat"), "fixture starts with moov at the end");
  const { rc, cap } = await learned(realpathSync(brew("qt-faststart")!));
  assert.ok(cap);
  const r = await rc.run(cap!.id, { files: { "in.mp4": { type: "bytes", base64: b64(input) } }, operands: ["in.mp4", "out.mp4"], outputs: ["out.mp4"] });
  assert.equal(r.status, "completed", String(r.error));
  const out = Buffer.from((await rc.readArtefact((r.output as any).outputs["out.mp4"].ref)).base64, "base64");
  const atoms = topAtoms(out);
  assert.ok(atoms.indexOf("moov") >= 0 && atoms.indexOf("moov") < atoms.indexOf("mdat"), atoms.join(","));
  rmSync(dir, { recursive: true, force: true });
});

test("development case msguniq: latin-1 text declared as such, catalog returned as exact bytes", { skip: devSkip("msguniq"), timeout: 180_000 }, async () => {
  const { rc, cap } = await learned(realpathSync(brew("msguniq")!));
  assert.ok(cap);
  const po = 'msgid ""\nmsgstr "Content-Type: text/plain; charset=ISO-8859-1\\n"\n\nmsgid "Size"\nmsgstr "Größe"\n\nmsgid "Size"\nmsgstr "Maß"\n';
  const r = await rc.run(cap!.id, { files: { "de.po": { type: "text", text: po, encoding: "latin-1" } }, options: ["--use-first"], operands: ["de.po"], stdoutAs: "artefact" });
  assert.equal(r.status, "completed", String(r.error));
  const out = Buffer.from((await rc.readArtefact((r.output as any).stdout.ref)).base64, "base64");
  assert.ok(out.includes(Buffer.from("Gr\xf6\xdfe", "latin1")), "first translation kept, still latin-1");
  assert.ok(!out.includes(Buffer.from("Ma\xdf", "latin1")), "duplicate removed");
});

test("development case gpgv: a binary keyring staged as an auxiliary file, never a host path", { skip: devSkip("gpgv", "gpg"), timeout: 180_000 }, async () => {
  const home = tmp("rcx-gpg-");
  const g = (...a: string[]) => execFileSync(brew("gpg")!, ["--homedir", home, "--batch", "--pinentry-mode", "loopback", "--passphrase", "", ...a]);
  g("--quick-gen-key", "Dev Case <dev@example.test>", "ed25519", "sign", "never");
  const fpr = /fpr:+([0-9A-F]{40})/.exec(g("--with-colons", "--fingerprint", "dev@example.test").toString())![1];
  writeFileSync(join(home, "data.txt"), "release 1\n");
  g("--detach-sign", "-o", join(home, "data.sig"), join(home, "data.txt"));
  const keyring = g("--export", "dev@example.test");
  const { rc, cap } = await learned(realpathSync(brew("gpgv")!));
  assert.ok(cap);
  const run = (data: string) => rc.run(cap!.id, { files: { "keys.gpg": { type: "bytes", base64: b64(keyring) }, "data.sig": { type: "bytes", base64: b64(readFileSync(join(home, "data.sig"))) }, "data.txt": data }, options: ["--status-fd", "1", "--keyring", "./keys.gpg"], operands: ["data.sig", "data.txt"] });
  const good = await run("release 1\n");
  assert.equal(good.status, "completed", String(good.error));
  assert.match(String(good.output), new RegExp(`VALIDSIG ${fpr}`));
  const bad = await run("release 2\n");
  assert.ok(bad.status !== "completed" || /BADSIG/.test(String(bad.output)), `a tampered file is not reported valid: ${bad.status} ${String(bad.output).slice(0, 200)}`);
  rmSync(home, { recursive: true, force: true });
});

// ocsptool fixture. It is built with whatever `openssl` the host has: the macos-15 CI image links
// Homebrew openssl@1.1 (1.1.1w) at /opt/homebrew/bin/openssl. Extensions therefore come only from
// an explicit config section, never `-addext`: OpenSSL 1.1.1 does not let `-addext` replace the
// default config's v3_ca basicConstraints, so it wrote that extension twice. RFC 5280 §4.2 forbids
// that and GnuTLS refuses it ("error parsing CAs: Duplicate extension in X.509 certificate").

/** Version and extension OIDs of a PEM certificate, by a direct DER walk: no OpenSSL or GnuTLS. */
function certExtensions(pem: string): { version: number; oids: string[] } {
  const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
  const tlv = (p: number, tag?: number) => {
    if (tag !== undefined) assert.equal(der[p], tag, `DER tag at ${p}`);
    let len = der[p + 1], start = p + 2;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + der[start + i]; start += n; }
    assert.ok(start + len <= der.length, "DER length within the certificate");
    return { tag: der[p], start, end: start + len };
  };
  const children = (s: number, e: number) => { const out = []; for (let p = s; p < e; p = out[out.length - 1].end) out.push(tlv(p)); return out; };
  const cert = tlv(0, 0x30), tbs = tlv(cert.start, 0x30);
  const fields = children(tbs.start, tbs.end);
  const version = fields[0].tag === 0xa0 ? der[tlv(fields[0].start, 0x02).start] + 1 : 1;
  const exts = fields.find((f) => f.tag === 0xa3);
  const oids: string[] = [];
  if (exts) {
    const seq = tlv(exts.start, 0x30);
    for (const ext of children(seq.start, seq.end)) {
      assert.equal(ext.tag, 0x30, "an Extension is a SEQUENCE");
      const oid = tlv(ext.start, 0x06);
      const subs: number[] = []; let v = 0;
      for (const x of der.subarray(oid.start, oid.end)) { v = v * 128 + (x & 0x7f); if (!(x & 0x80)) { subs.push(v); v = 0; } }
      const [first, ...rest] = subs;
      oids.push([first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80, ...rest].join("."));
    }
  }
  return { version, oids };
}

/** A CA, an unrelated CA, a delegated OCSPSigning responder and a "good" OCSP response; validated. */
function ocspFixture(t: { diagnostic(m: string): void }) {
  const w = tmp("rcx-ocsp-");
  const o = (...a: string[]) => execFileSync(brew("openssl")!, a, { cwd: w, stdio: "pipe" });
  writeFileSync(join(w, "fixture.cnf"), "[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = fixture\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n");
  writeFileSync(join(w, "resp.ext"), "basicConstraints = critical,CA:FALSE\nextendedKeyUsage = OCSPSigning\nkeyUsage = critical,digitalSignature\n");
  writeFileSync(join(w, "leaf.ext"), "basicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\n");
  for (const k of ["ca", "other", "resp", "leaf"]) o("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${k}.key`);
  for (const ca of ["ca", "other"]) o("req", "-config", "fixture.cnf", "-extensions", "v3_ca", "-new", "-x509", "-key", `${ca}.key`, "-out", `${ca}.pem`, "-days", "30", "-subj", `/CN=${ca} root`);
  for (const [c, serial] of [["resp", "9"], ["leaf", "7"]]) {
    o("req", "-config", "fixture.cnf", "-new", "-key", `${c}.key`, "-out", `${c}.csr`, "-subj", `/CN=${c}`);
    o("x509", "-req", "-in", `${c}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-out", `${c}.pem`, "-days", "30", "-extfile", `${c}.ext`, "-set_serial", serial);
  }
  writeFileSync(join(w, "index.txt"), "V\t351231000000Z\t\t07\tunknown\t/CN=leaf\n");
  o("ocsp", "-issuer", "ca.pem", "-cert", "leaf.pem", "-reqout", "req.der", "-no_nonce");
  o("ocsp", "-index", "index.txt", "-rsigner", "resp.pem", "-rkey", "resp.key", "-CA", "ca.pem", "-reqin", "req.der", "-respout", "resp.der", "-ndays", "7");
  // The fixture is checked independently of the tool that made it and of the program under test.
  for (const c of ["ca", "other", "resp", "leaf"]) {
    const { version, oids } = certExtensions(readFileSync(join(w, `${c}.pem`), "utf8"));
    assert.equal(version, 3, `fixture ${c}.pem is X.509 v3`);
    assert.deepEqual(oids.filter((x, i) => oids.indexOf(x) !== i), [], `fixture defect: ${c}.pem repeats an extension (RFC 5280 §4.2): ${oids.join(" ")}`);
    assert.ok(oids.includes("2.5.29.19"), `fixture ${c}.pem states its basic constraints`);
  }
  t.diagnostic(`fixture built with ${o("version").toString().trim()}`);
  return { file: (n: string) => readFileSync(join(w, n)), done: () => rmSync(w, { recursive: true, force: true }) };
}

const OCSP_ARGS = ["-e", "--infile=resp.der", "--load-trust=anchor.pem"];
const ocspInputs = (der: Buffer, anchor: Buffer) => ({ "resp.der": { type: "bytes" as const, base64: b64(der) }, "anchor.pem": anchor.toString("utf8") });

test("fixture check: the DER walk finds the duplicate basicConstraints OpenSSL 1.1.1w wrote with -addext", () => {
  // Reproduced with OpenSSL 1.1.1w (Debian 11) and the previous fixture's `req -x509 … -addext
  // basicConstraints=critical,CA:TRUE`; Go's crypto/x509 and GnuTLS's certtool both reject it too.
  const dup = "MIIBmzCCAUCgAwIBAgIUFIWvdPE253oqpiajA9d1zjwwgbgwCgYIKoZIzj0EAwIwEjEQMA4GA1UEAwwHY2Egcm9vdDAeFw0yNjExMDUwOTI3NTVaFw0yNjEyMDUwOTI3NTVaMBIxEDAOBgNVBAMMB2NhIHJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATQBKdBtZ54Ni5HJ7Tcv+3mH0ooyurzGyAfG7no+y5JCsm/qdt0EFTA89zop7lWQ9gcLv92kQy9T2P7XxqkButro3QwcjAdBgNVHQ4EFgQUij/Kdp1irLgIcfrl4VSMSVmPNBwwHwYDVR0jBBgwFoAUij/Kdp1irLgIcfrl4VSMSVmPNBwwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEA+FzpDBkN+TReuof2muQEr5qZVqkRDSJQLngAiyOpK2YCIQCJhcBLX5jj+ZEwVDWKOcO5578iGq10P+uWkWhtaU83dw==";
  assert.deepEqual(certExtensions(`-----BEGIN CERTIFICATE-----\n${dup}\n-----END CERTIFICATE-----\n`), { version: 3, oids: ["2.5.29.14", "2.5.29.35", "2.5.29.19", "2.5.29.19", "2.5.29.15"] });
});

test("development case ocsptool, transport: a binary DER response and its trust anchor reach the program byte-exact", { skip: devSkip("ocsptool", "openssl"), timeout: 180_000 }, async (t) => {
  const fx = ocspFixture(t);
  const der = fx.file("resp.der");
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(der), "the response is not UTF-8, so a text channel would have altered it");
  const bin = realpathSync(brew("ocsptool")!);
  const { rc, cap } = await learned(bin);
  assert.ok(cap);
  const inv = cap!.invoke as any;
  assert.ok(inv.options.allowed.flatMap((x: any) => x.flags).includes("--load-trust"), "--load-trust=file is parsed and offered");
  // RightClick's responsibility whatever the program concludes: it consumed exactly the staged
  // bytes, and a direct sandbox run of the same files and arguments is byte-identical.
  for (const anchor of ["ca.pem", "other.pem"]) {
    const a = fx.file(anchor);
    const r = await rc.run(cap!.id, { files: ocspInputs(der, a), options: OCSP_ARGS, operands: [], stdoutAs: "artefact" });
    const d = await sandbox!.run(bin, OCSP_ARGS, { files: { "resp.der": der, "anchor.pem": a }, rawStdout: true });
    const prov = (r as any).cliValidity?.artefacts;
    assert.deepEqual(prov?.inputs.map((i: any) => [i.name, i.sha256, i.bytes]).sort(), [["anchor.pem", await sha256Hex(a), a.length], ["resp.der", await sha256Hex(der), der.length]], `${anchor}: the consumed bytes are the staged bytes`);
    assert.equal(prov.program.sha256, inv.sha256, "the checked build ran");
    assert.equal((r as any).cliValidity.processExit, d.code, `${anchor}: same exit code as a direct run`);
    if (r.status === "completed") {
      const out = Buffer.from((await rc.readArtefact((r.output as any).stdout.ref)).base64, "base64");
      assert.equal((r.output as any).exitCode, d.code);
      assert.ok(out.equals(Buffer.from(d.stdoutRaw!)), `${anchor}: stdout is byte-identical to a direct run`);
      assert.equal(prov.stdout.sha256, await sha256Hex(d.stdoutRaw!), `${anchor}: the recorded stdout digest is the direct run's`);
    } else {
      // An exit code outside the interface's accepted set is reported as a failure, never a result.
      assert.ok(!inv.okExit.includes(d.code), `${anchor}: failed although a direct run exited ${d.code}: ${r.error}`);
      assert.match(String(r.error), new RegExp(`exited ${d.code}\\b`));
    }
  }
  const noAnchor = await rc.run(cap!.id, { files: { "resp.der": ocspInputs(der, Buffer.alloc(0))["resp.der"] }, options: OCSP_ARGS, operands: [] });
  assert.match(String(noAnchor.error), /must be the name of a staged input file/, "a missing certificate is refused before running");
  fx.done();
});

test("development case ocsptool, verification: the issuing CA verifies the response and an unrelated CA does not", { skip: devSkip("ocsptool", "openssl"), timeout: 180_000 }, async (t) => {
  const bin = realpathSync(brew("ocsptool")!);
  const { rc, cap } = await learned(bin);
  assert.ok(cap);
  // Support is decided from the program's documented interface before anything runs, never from
  // the verdict under test. Where it is supported, both outcomes are required.
  const flags = (cap!.invoke as any).options.allowed.flatMap((x: any) => x.flags);
  const missing = ["-e", "--infile", "--load-trust"].filter((f) => !flags.includes(f));
  if (missing.length) { t.skip(`unsupported: this ocsptool does not document ${missing.join(", ")}`); return; }
  const fx = ocspFixture(t);
  const der = fx.file("resp.der");
  const verdict = async (anchor: string) => {
    const r = await rc.run(cap!.id, { files: ocspInputs(der, fx.file(anchor)), options: OCSP_ARGS, operands: [], stdoutAs: "artefact" });
    if (r.status !== "completed") return { r, exitCode: (r as any).cliValidity?.processExit, out: "" };
    return { r, exitCode: (r.output as any).exitCode, out: Buffer.from((await rc.readArtefact((r.output as any).stdout.ref)).base64, "base64").toString() };
  };
  const good = await verdict("ca.pem");
  assert.equal(good.r.status, "completed", `the issuing CA must verify: ${good.r.error}`);
  assert.equal(good.exitCode, 0, `the issuing CA must verify: exit ${good.exitCode}`);
  assert.match(good.out, /^Verifying OCSP Response: Success\.$/m, "the issuing CA must verify");
  const wrong = await verdict("other.pem");
  assert.notEqual(wrong.exitCode, 0, "an unrelated CA must not verify");
  if (wrong.r.status === "completed") {
    // A real negative: the response and the anchor were both read and the signature check ran and
    // failed. A parse error, which also exits non-zero, prints no verdict and does not count.
    assert.match(wrong.out, /^Verifying OCSP Response: Failure\b/m, `an unrelated CA must fail the signature check: ${JSON.stringify(wrong.out.slice(-200))}`);
    assert.doesNotMatch(wrong.out, /Verifying OCSP Response: Success/);
  } else {
    // This interface does not accept the failing exit code, so the verdict is read from a direct run
    // of the same bytes (the transport test establishes that equivalence).
    assert.match(String(wrong.r.error), /exited [1-9]\d*\b/);
    const d = await sandbox!.run(bin, OCSP_ARGS, { files: { "resp.der": der, "anchor.pem": fx.file("other.pem") } });
    assert.match(d.stdout, /^Verifying OCSP Response: Failure\b/m, `an unrelated CA must fail the signature check: ${JSON.stringify(d.stderr.slice(0, 200))}`);
  }
  fx.done();
});

// ------------------------------------------------------------------ MCP transport

test("MCP: bytes cross the tool interface exactly, are read back in bounded slices, and never reach the audit log", { skip, timeout: 120_000 }, async () => {
  const { dispatch } = await import("../src/interface/tools.ts");
  const dir = tmp("rcx-bin-");
  const bin = program(dir, "bincopy", BINCOPY);
  const { rc, cap } = await learned(bin);
  assert.ok(cap);
  const logged: unknown[] = [];
  rc.toolCallSink = (e) => logged.push(e);
  const payload = Buffer.concat([Buffer.from(allBytes), Buffer.from("tail")]);
  // Through the real MCP request handler, which writes the audit log.
  const { handle } = await import("../src/interface/mcp-server.ts");
  const reply: any = await handle(rc, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_run", arguments: { id: cap!.id, args: { files: { "in.bin": { type: "bytes", base64: b64(payload) } }, operands: ["in.bin", "out.bin"], outputs: ["out.bin"] } } } });
  const run: any = JSON.parse(reply.result.content[0].text);
  assert.equal(run.status, "completed", String(run.error));
  assert.equal(logged.length, 1, "the call was audited");
  const audit = JSON.stringify(logged);
  assert.ok(!audit.includes(b64(payload)), "the payload is not in the audit log");
  assert.match(audit, /"bytes":260/, "its size is");
  const ref = run.output.outputs["out.bin"].ref;
  const first: any = await dispatch(rc, "context_run_status", { artefact: ref, offset: 0, length: 100 });
  const rest: any = await dispatch(rc, "context_run_status", { artefact: ref, offset: 100 });
  assert.ok(!first.complete && rest.complete);
  assert.deepEqual(Buffer.concat([Buffer.from(first.base64, "base64"), Buffer.from(rest.base64, "base64")]), payload);
  await assert.rejects(dispatch(rc, "context_run_status", { artefact: "/etc/passwd" }), /not an artefact reference/);
  await assert.rejects(dispatch(rc, "context_run_status", { artefact: ref, runId: "x" }), /take only artefact/);
  // Plain objects keep their historical meaning: JSON text, not bytes.
  const legacy: any = await dispatch(rc, "context_run", { id: cap!.id, args: { files: { "in.json": { a: 1 } }, operands: ["in.json", "out.json"], outputs: ["out.json"] } });
  assert.equal(Buffer.from((await rc.readArtefact(legacy.output.outputs["out.json"].ref)).base64, "base64").toString(), '{"a":1}');
  rmSync(dir, { recursive: true, force: true });
});
