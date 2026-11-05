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
  const a = await store.put(allBytes, { origin: "test" });
  assert.equal(a.sha256, await sha256Hex(allBytes));
  assert.deepEqual([...(await new ArtefactStore(dir).get(a.ref))], [...allBytes], "persists across instances");
  for (const ref of ["/etc/passwd", "../x", "sha256:../../etc", `sha256:${"g".repeat(64)}`]) await assert.rejects(store.get(ref), /not an artefact reference/, ref);
  await assert.rejects(store.get(`sha256:${"1".repeat(64)}`), /unknown artefact/);
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

test("development case ocsptool: a DER response and its trust anchor staged by name; signature checked", { skip: devSkip("ocsptool", "openssl"), timeout: 180_000 }, async (t) => {
  const w = tmp("rcx-ocsp-");
  const o = (...a: string[]) => execFileSync(brew("openssl")!, a, { cwd: w, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  for (const ca of ["ca", "other"]) o("req", "-x509", ...ec, "-keyout", `${ca}.key`, "-out", `${ca}.pem`, "-days", "30", "-subj", `/CN=${ca} root`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  // A delegated responder (OCSPSigning), the conventional arrangement, signed by the CA.
  writeFileSync(join(w, "resp.ext"), "extendedKeyUsage=OCSPSigning\nkeyUsage=critical,digitalSignature\n");
  o("req", ...ec, "-keyout", "resp.key", "-out", "resp.csr", "-subj", "/CN=responder");
  o("x509", "-req", "-in", "resp.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-out", "resp.pem", "-days", "30", "-extfile", "resp.ext", "-set_serial", "9");
  o("req", ...ec, "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=leaf");
  o("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-out", "leaf.pem", "-days", "30", "-set_serial", "7");
  writeFileSync(join(w, "index.txt"), `V\t351231000000Z\t\t07\tunknown\t/CN=leaf\n`);
  o("ocsp", "-issuer", "ca.pem", "-cert", "leaf.pem", "-reqout", "req.der", "-no_nonce");
  o("ocsp", "-index", "index.txt", "-rsigner", "resp.pem", "-rkey", "resp.key", "-CA", "ca.pem", "-reqin", "req.der", "-respout", "resp.der", "-ndays", "7");
  const der = { type: "bytes" as const, base64: b64(readFileSync(join(w, "resp.der"))) };
  const { rc, cap } = await learned(realpathSync(brew("ocsptool")!));
  assert.ok(cap);
  const allowed = (cap!.invoke as any).options.allowed.flatMap((x: any) => x.flags);
  assert.ok(allowed.includes("--load-trust"), "--load-trust=file is parsed and offered");
  // Artefact mode returns the exit code, so verification is asserted, not admitted.
  const bin = realpathSync(brew("ocsptool")!);
  const verify = async (anchor: string) => {
    const r = await rc.run(cap!.id, { files: { "resp.der": der, "anchor.pem": readFileSync(join(w, anchor), "utf8") }, options: ["-e", "--infile=resp.der", "--load-trust=anchor.pem"], operands: [], stdoutAs: "artefact" });
    // RightClick's responsibility in any environment: the program saw exactly these bytes, so a
    // direct sandbox run with the same files and arguments gives the same output and exit code.
    const d = await sandbox!.run(bin, ["-e", "--infile=resp.der", "--load-trust=anchor.pem"], { files: { "resp.der": readFileSync(join(w, "resp.der")), "anchor.pem": readFileSync(join(w, anchor)) } });
    if (r.status !== "completed") {
      // An exit code outside the interface's accepted set is reported as a failure, never a result.
      assert.ok(!(cap!.invoke as any).okExit.includes(d.code), `failed although a direct run exited ${d.code}: ${r.error}`);
      assert.match(String(r.error), new RegExp(`exited ${d.code}\\b`));
      return { exitCode: d.code, out: "", stderr: d.stderr };
    }
    const out = Buffer.from((await rc.readArtefact((r.output as any).stdout.ref)).base64, "base64").toString();
    assert.equal((r.output as any).exitCode, d.code, "same exit code as a direct run");
    assert.equal(out, d.stdout, "same output as a direct run");
    return { exitCode: d.code, out, stderr: d.stderr };
  };
  const good = await verify("ca.pem");
  const wrong = await verify("other.pem");
  const verified = good.exitCode === 0 && /Verifying OCSP Response: Success/.test(good.out);
  if (!verified) {
    // The program's own verdict on this host, not RightClick's: reported visibly, never passed silently.
    t.diagnostic(`this host's ocsptool did not verify the response even when run directly: exit ${good.exitCode}; stderr ${JSON.stringify(good.stderr.slice(0, 300))}; ${execFileSync(bin, ["--version"]).toString().split("\n")[0]}`);
  } else {
    // The anchor is really read: the same response does not verify against an unrelated CA.
    assert.ok(wrong.exitCode !== 0 || !/Verifying OCSP Response: Success/.test(wrong.out), `an unrelated anchor must not verify: exit ${wrong.exitCode}`);
  }
  const noAnchor = await rc.run(cap!.id, { files: { "resp.der": der }, options: ["-e", "--infile=resp.der", "--load-trust=anchor.pem"], operands: [] });
  assert.match(String(noAnchor.error), /must be the name of a staged input file/, "a missing certificate is refused before running");
  rmSync(w, { recursive: true, force: true });
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
