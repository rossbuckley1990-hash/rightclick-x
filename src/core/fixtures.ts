// Bounded, deterministic, specification-derived binary fixtures.
//
// Each generator writes a minimal valid instance of one container format from a seed: small
// dimensions or entries, pseudo-random content, at most FIXTURE_MAX_BYTES. Mutations derive
// invalid instances (truncated, wrong magic, a corrupted checksum or length, trailing bytes) so an
// investigation can contrast how a program treats valid and invalid input.
//
// Generators encode formats, not programs: none knows about any command-line tool, and a program
// can never choose or configure one. A fixture is used only after the independent validator in
// `formats.ts` accepts it (and a mutation only after it refuses it); see `fixtureFor`.
//
// CRC-32 comes from node:zlib here, never from formats.ts, so the generator and the validator
// share no code.

import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { formatOf, type BinaryFormat } from "./formats.ts";

export const FIXTURE_MAX_BYTES = 64 * 1024;

export type MutationKind = "truncated" | "bad-magic" | "corrupt-checksum" | "trailing-bytes";

/** Deterministic pseudo-random bytes (xorshift32) from a seed. */
function prng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 0x9e3779b9;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 0xff; };
}
const dims = (seed: number) => ({ w: 3 + (seed % 7), h: 2 + ((seed * 5) % 6) });
const be32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const le16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

function png(seed: number): Buffer {
  const { w, h } = dims(seed), r = prng(seed);
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (1 + w * 3) + 1 + x] = r(); }
  const chunk = (type: string, data: Buffer) => Buffer.concat([be32(data.length), Buffer.from(type, "ascii"), data, be32(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])))]);
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Baseline uncompressed RGB TIFF, little-endian, one strip per page; `pages` pages. */
function tiff(seed: number, pages = 1): Buffer {
  const parts: Buffer[] = [Buffer.from("II*\0", "ascii"), le32(8)];
  let at = 8;
  const out: Buffer[] = [];
  const r = prng(seed);
  for (let p = 0; p < pages; p++) {
    const { w, h } = dims(seed + p * 3);
    const data = Buffer.alloc(w * h * 3);
    for (let i = 0; i < data.length; i++) data[i] = r();
    const entries: Array<[number, number, number, number | Buffer]> = [
      [256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, Buffer.concat([le16(8), le16(8), le16(8)])], [259, 3, 1, 1], [262, 3, 1, 2],
      [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, data.length], [284, 3, 1, 1],
    ];
    const ifdSize = 2 + entries.length * 12 + 4;
    const extraAt = at + ifdSize;
    const bps = entries[2][3] as Buffer;
    const dataAt = extraAt + bps.length;
    const next = p + 1 < pages ? dataAt + data.length + (data.length & 1) : 0;
    const ifd = Buffer.alloc(ifdSize);
    ifd.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, count, v], i) => {
      const e = 2 + i * 12;
      ifd.writeUInt16LE(tag, e); ifd.writeUInt16LE(type, e + 2); ifd.writeUInt32LE(count, e + 4);
      if (tag === 273) ifd.writeUInt32LE(dataAt, e + 8);
      else if (Buffer.isBuffer(v)) ifd.writeUInt32LE(extraAt, e + 8);
      else if (type === 3) ifd.writeUInt16LE(v, e + 8);
      else ifd.writeUInt32LE(v, e + 8);
    });
    ifd.writeUInt32LE(next, ifdSize - 4);
    out.push(ifd, bps, data, Buffer.alloc(next ? data.length & 1 : 0));
    at = next;
  }
  return Buffer.concat([...parts, ...out]);
}

function pnm(kind: "P6" | "P5", seed: number): Buffer {
  const { w, h } = dims(seed), r = prng(seed);
  const data = Buffer.alloc(w * h * (kind === "P6" ? 3 : 1));
  for (let i = 0; i < data.length; i++) data[i] = r();
  return Buffer.concat([Buffer.from(`${kind}\n# rcx fixture ${seed}\n${w} ${h}\n255\n`, "ascii"), data]);
}

function bmp(seed: number): Buffer {
  const { w, h } = dims(seed), r = prng(seed);
  const stride = Math.floor((w * 24 + 31) / 32) * 4;
  const pixels = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) pixels[y * stride + x] = r();
  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii"); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14); header.writeInt32LE(w, 18); header.writeInt32LE(h, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28);
  header.writeUInt32LE(0, 30); header.writeUInt32LE(pixels.length, 34); header.writeInt32LE(2835, 38); header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

function zip(seed: number): Buffer {
  const r = prng(seed);
  const files = Array.from({ length: 1 + (seed % 3) }, (_, i) => ({ name: `entry${i + 1}.txt`, data: Buffer.from(Array.from({ length: 40 + ((seed + i) % 50) }, () => 97 + (r() % 26))) }));
  const locals: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [i, f] of files.entries()) {
    const method = i % 2 ? 8 : 0, body = method ? deflateRawSync(f.data) : f.data, crc = crc32(f.data), name = Buffer.from(f.name, "ascii");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0x5000, 10); lh.writeUInt16LE(0x5a21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0x5000, 12); ch.writeUInt16LE(0x5a21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, body); central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

function gzip(seed: number): Buffer {
  const r = prng(seed);
  const data = Buffer.from(Array.from({ length: 200 + (seed % 300) }, () => 97 + (r() % 26)));
  return Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), deflateRawSync(data), le32(crc32(data)), le32(data.length)]);
}

const GENERATORS: Record<string, (seed: number) => Buffer> = {
  "image/png": png,
  "image/tiff": (s) => tiff(s, 1 + (s % 2)),
  "image/x-portable-pixmap": (s) => pnm("P6", s),
  "image/x-portable-graymap": (s) => pnm("P5", s),
  "image/bmp": bmp,
  "application/zip": zip,
  "application/gzip": gzip,
};

/** Media types a fixture can be generated for. Validators exist for more (see `formats.ts`). */
export const GENERATED_FORMATS = Object.keys(GENERATORS);

export function mutate(b: Uint8Array, kind: MutationKind, mediaType: string): Buffer {
  const x = Buffer.from(b);
  switch (kind) {
    case "truncated": return x.subarray(0, Math.max(1, Math.floor(x.length * 0.6)));
    case "bad-magic": x[0] ^= 0xff; return x;
    case "trailing-bytes": return Buffer.concat([x, Buffer.from("RCX-TRAILING-BYTES")]);
    case "corrupt-checksum": {
      // The field that guards integrity in each format: a CRC, or a size the reader trusts.
      if (mediaType === "image/png") { x[29] ^= 0xff; return x; } // IHDR's CRC
      if (mediaType === "application/gzip") { x[x.length - 8] ^= 0xff; return x; } // the trailer's CRC
      if (mediaType === "application/zip") { x[30 + x.readUInt16LE(26)] ^= 0x01; return x; } // first entry's data: its CRC no longer matches
      if (mediaType === "image/bmp") { x.writeUInt32LE(x.readUInt32LE(2) + 7, 2); return x; }
      if (mediaType === "image/tiff") { x.writeUInt32LE(x.length + 1000, 4); return x; } // IFD offset
      x[x.length - 1] ^= 0xff; return x.subarray(0, x.length - 1);
    }
  }
}

/**
 * A validated fixture: the generator's output, accepted by the independent validator, or
 * undefined when the format has no generator or the validator refuses it (a generator defect is
 * then visible, not silently used).
 */
export function fixtureFor(mediaType: string, seed: number): Buffer | undefined {
  const gen = GENERATORS[mediaType], f = formatOf(mediaType);
  if (!gen || !f) return undefined;
  const b = gen(seed);
  if (b.length > FIXTURE_MAX_BYTES || !f.validate(b).ok) return undefined;
  return b;
}

/** A mutation of a valid fixture that its format's validator refuses, or undefined. */
export function invalidFixtureFor(mediaType: string, seed: number, kind: MutationKind, format: BinaryFormat | undefined = formatOf(mediaType)): Buffer | undefined {
  const b = fixtureFor(mediaType, seed);
  if (!b || !format) return undefined;
  const m = mutate(b, kind, mediaType);
  return format.validate(m).ok ? undefined : m;
}
