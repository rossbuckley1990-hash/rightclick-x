// Structural validators for binary formats: the independent witnesses binary acquisition and
// binary execution rely on.
//
// A validator parses a file by its format specification and either accepts it, returning facts
// it established (dimensions, pages, entries), or refuses it with a reason. It never trusts a
// file extension, and a magic number alone is never enough: every length, offset and checksum it
// reads is checked against the bytes actually present. A file a validator cannot fully check
// (a feature it does not implement) is refused, not accepted on partial evidence.
//
// Nothing here knows about any program. The fixture generators live in `fixtures.ts`, and share
// no code with this file (they even compute CRC-32 differently), so a generator defect cannot hide
// itself by also being the validator's.

import { createHash } from "node:crypto";
import { inflateRawSync, inflateSync } from "node:zlib";

export type Facts = Record<string, number | string | boolean>;
export type Validation = { ok: true; mediaType: string; facts: Facts } | { ok: false; reason: string };

export interface BinaryFormat {
  /** IANA-style media type: the format part of the semantic type `bytes:<mediaType>`. */
  mediaType: string;
  /** A short slug used in capability ids ("png", "tiff"). */
  slug: string;
  /** The extension a staged file of this format is given. Programs often choose a parser by it. */
  ext: string;
  /** Words that, found in a program's documentation, make the format a candidate for it. */
  words: RegExp;
  validate(b: Uint8Array): Validation;
}

/** Most bytes any validator inflates while checking one file. */
const MAX_INFLATE = 64 * 1024 * 1024;

const fail = (reason: string): Validation => ({ ok: false, reason });
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

// CRC-32 (ISO-HDLC, as PNG, ZIP and gzip use it), computed with a table built here.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function inflate(kind: "zlib" | "raw", data: Uint8Array, limit = MAX_INFLATE): Uint8Array | string {
  try {
    const out = kind === "zlib" ? inflateSync(data, { maxOutputLength: limit }) : inflateRawSync(data, { maxOutputLength: limit });
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (e) {
    return `compressed data does not inflate (${String((e as Error).message).slice(0, 80)})`;
  }
}


/**
 * The `pixels` fact: a digest of the image's 8-bit RGB samples in row order, for images this file
 * decodes exactly (no alpha, 8 bits per sample). Two files with the same width, height and
 * `pixels` show the same picture, whatever their format, so a transformation that keeps `pixels`
 * is lossless and one that does not is visibly lossy. Formats this file cannot decode exactly
 * (WebP, JPEG, GIF, 16-bit or interlaced PNG, alpha) simply have no `pixels` fact.
 */
function pixelsDigest(rgb: Uint8Array): string {
  return createHash("sha256").update(rgb).digest("hex").slice(0, 32);
}
const grayToRgb = (g: Uint8Array) => { const o = new Uint8Array(g.length * 3); for (let i = 0; i < g.length; i++) o[3 * i] = o[3 * i + 1] = o[3 * i + 2] = g[i]; return o; };

// ------------------------------------------------------------------ PNG (ISO/IEC 15948)

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function validatePng(b: Uint8Array): Validation {
  if (b.length < 8 || PNG_SIG.some((x, i) => b[i] !== x)) return fail("no PNG signature");
  let o = 8, ihdr: Facts | undefined, sawIdat = false, idatDone = false, plte = false;
  const idat: Uint8Array[] = [];
  for (;;) {
    if (o + 12 > b.length) return fail("truncated: chunk header past the end of the file");
    const len = u32be(b, o), type = ascii(b, o + 4, 4);
    if (len > 0x7fffffff || o + 12 + len > b.length) return fail(`truncated: chunk ${type} runs past the end of the file`);
    if (!/^[A-Za-z]{4}$/.test(type)) return fail("invalid chunk type");
    if (crc32(b, o + 4, o + 8 + len) !== u32be(b, o + 8 + len)) return fail(`chunk ${type} fails its CRC`);
    const d = b.subarray(o + 8, o + 8 + len);
    if (!ihdr && type !== "IHDR") return fail("first chunk is not IHDR");
    if (type === "IHDR") {
      if (ihdr || len !== 13) return fail("invalid IHDR");
      const width = u32be(d, 0), height = u32be(d, 4), depth = d[8], color = d[9];
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) return fail("invalid dimensions");
      if (!PNG_DEPTHS[color]?.includes(depth)) return fail("invalid bit depth / colour type");
      if (d[10] !== 0 || d[11] !== 0 || d[12] > 1) return fail("unsupported compression, filter or interlace method");
      ihdr = { width, height, bitDepth: depth, colourType: color, channels: PNG_CHANNELS[color], interlaced: d[12] === 1 };
    } else if (type === "PLTE") plte = true;
    else if (type === "IDAT") {
      if (idatDone) return fail("IDAT chunks are not consecutive");
      sawIdat = true; idat.push(d);
    } else if (sawIdat) idatDone = true;
    if (type === "IEND") {
      if (len !== 0) return fail("invalid IEND");
      if (o + 12 !== b.length) return fail("bytes after IEND");
      break;
    }
    if ((type.charCodeAt(0) & 0x20) === 0 && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) return fail(`unknown critical chunk ${type}`);
    o += 12 + len;
  }
  if (!ihdr || !sawIdat) return fail("no image data");
  if (ihdr.colourType === 3 && !plte) return fail("palette image without PLTE");
  const raw = inflate("zlib", concat(idat));
  if (typeof raw === "string") return fail(raw);
  // The decompressed scanlines must be exactly the size the header implies, each with a valid filter byte.
  const w = ihdr.width as number, h = ihdr.height as number, bpp = (ihdr.bitDepth as number) * (ihdr.channels as number);
  const passes = ihdr.interlaced
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]].map(([x0, y0, dx, dy]) => [Math.ceil((w - x0) / dx), Math.ceil((h - y0) / dy)])
    : [[w, h]];
  let at = 0;
  for (const [pw, ph] of passes) {
    if (pw <= 0 || ph <= 0) continue;
    const row = Math.ceil((pw * bpp) / 8);
    for (let y = 0; y < ph; y++) {
      if (at >= raw.length || raw[at] > 4) return fail("image data does not match the header (scanline filter or length)");
      at += 1 + row;
    }
  }
  if (at !== raw.length) return fail("image data does not match the header (length)");
  const px = ihdr.bitDepth === 8 && !ihdr.interlaced && ihdr.colourType !== 3 ? pngRgb(raw, w, h, ihdr.channels as number) : undefined;
  if (px === null) return fail("a scanline uses an invalid filter");
  return { ok: true, mediaType: "image/png", facts: { ...ihdr, ...(px ? { pixels: pixelsDigest(px) } : {}) } };
}

/** Unfiltered 8-bit RGB of a non-interlaced 8-bit PNG; undefined with alpha other than opaque or a palette; null if a filter is invalid. */
function pngRgb(raw: Uint8Array, w: number, h: number, ch: number): Uint8Array | undefined | null {
  const stride = w * ch, cur = new Uint8Array(stride), prev = new Uint8Array(stride), out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) return null;
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3, s = x * ch;
      if (ch === 1 || ch === 2) { out[o] = out[o + 1] = out[o + 2] = cur[s]; if (ch === 2 && cur[s + 1] !== 255) return undefined; }
      else { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; if (ch === 4 && cur[s + 3] !== 255) return undefined; }
    }
    prev.set(cur);
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ TIFF (TIFF 6.0, baseline structure)

const TIFF_TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

/** PackBits (TIFF compression 32773). */
function unpackBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < src.length;) {
    const n = src[i++] << 24 >> 24;
    if (n >= 0) { for (let k = 0; k <= n && i < src.length; k++) out.push(src[i++]); }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n; k++) out.push(v); }
  }
  return Uint8Array.from(out);
}

function validateTiff(b: Uint8Array): Validation {
  if (b.length < 8) return fail("too short for a TIFF header");
  const le = b[0] === 0x49 && b[1] === 0x49, be = b[0] === 0x4d && b[1] === 0x4d;
  if (!le && !be) return fail("no TIFF byte-order mark");
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
  if (r16(2) === 43) return fail("BigTIFF is not supported by this validator");
  if (r16(2) !== 42) return fail("no TIFF magic number");
  let ifd = r32(4), pages = 0;
  const seen = new Set<number>();
  let first: Facts | undefined;
  while (ifd !== 0) {
    if (seen.has(ifd) || pages >= 256) return fail("IFD chain loops or is too long");
    seen.add(ifd);
    if (ifd % 2 || ifd + 2 > b.length) return fail("truncated: IFD offset past the end of the file");
    const n = r16(ifd);
    if (!n || ifd + 2 + n * 12 + 4 > b.length) return fail("truncated: IFD entries past the end of the file");
    const tags = new Map<number, number[]>();
    let last = -1;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = r16(e), type = r16(e + 2), count = r32(e + 4);
      if (tag <= last) return fail("IFD tags are not in ascending order");
      last = tag;
      const size = TIFF_TYPE_SIZE[type];
      if (!size) continue; // an unknown field type is skipped, as the specification requires
      const bytes = size * count;
      const at = bytes <= 4 ? e + 8 : r32(e + 8);
      if (at + bytes > b.length) return fail(`truncated: tag ${tag}'s values past the end of the file`);
      if ([3, 4].includes(type) && count <= 1 << 16) {
        const vals: number[] = [];
        for (let k = 0; k < count; k++) vals.push(type === 3 ? r16(at + 2 * k) : r32(at + 4 * k));
        tags.set(tag, vals);
      }
    }
    const width = tags.get(256)?.[0], height = tags.get(257)?.[0];
    if (!width || !height) return fail("a page has no ImageWidth or ImageLength");
    if (!tags.has(262)) return fail("a page has no PhotometricInterpretation");
    const offs = tags.get(273) ?? tags.get(324), counts = tags.get(279) ?? tags.get(325);
    if (!offs || !counts || offs.length !== counts.length || !offs.length) return fail("a page has no consistent strip or tile offsets and byte counts");
    for (let k = 0; k < offs.length; k++) if (offs[k] + counts[k] > b.length) return fail("truncated: image data past the end of the file");
    const compression = tags.get(259)?.[0] ?? 1, spp = tags.get(277)?.[0] ?? 1, bps = tags.get(258)?.[0] ?? 1;
    if (compression === 1 && tags.has(273)) {
      const rps = Math.min(tags.get(278)?.[0] ?? height, height);
      const rowBytes = Math.ceil((width * spp * bps) / 8);
      const need = rps * rowBytes * Math.floor(height / rps) + (height % rps) * rowBytes;
      if (counts.reduce((a, x) => a + x, 0) < need) return fail("uncompressed strips are shorter than the image");
    }
    if (!first) {
      first = { width, height, compression, samplesPerPixel: spp, bitsPerSample: bps };
      const photometric = tags.get(262)?.[0], planar = tags.get(284)?.[0] ?? 1, allBps = tags.get(258) ?? [bps];
      if (tags.has(273) && (compression === 1 || compression === 32773) && allBps.every((x) => x === 8) && planar === 1 && ((spp === 3 && photometric === 2) || (spp === 1 && photometric === 1))) {
        const parts: Uint8Array[] = [];
        for (let k = 0; k < offs.length; k++) {
          const strip = b.subarray(offs[k], offs[k] + counts[k]);
          parts.push(compression === 1 ? strip : unpackBits(strip));
        }
        const all = concat(parts), need = width * height * spp;
        if (all.length >= need) first.pixels = pixelsDigest(spp === 3 ? all.subarray(0, need) : grayToRgb(all.subarray(0, need)));
      }
    }
    pages++;
    ifd = r32(ifd + 2 + n * 12);
  }
  if (!pages || !first) return fail("no image file directory");
  return { ok: true, mediaType: "image/tiff", facts: { ...first, pages } };
}

// ------------------------------------------------------------------ Netpbm: PPM (P6) and PGM (P5)

function validatePnm(kind: "P6" | "P5", mediaType: string) {
  return (b: Uint8Array): Validation => {
    if (b.length < 2 || ascii(b, 0, 2) !== kind) return fail(`no ${kind} magic number`);
    let o = 2;
    const tokens: number[] = [];
    while (tokens.length < 3) {
      while (o < b.length && (b[o] === 0x20 || (b[o] >= 0x09 && b[o] <= 0x0d) || b[o] === 0x23)) {
        if (b[o] === 0x23) while (o < b.length && b[o] !== 0x0a) o++;
        else o++;
      }
      let t = "";
      while (o < b.length && b[o] >= 0x30 && b[o] <= 0x39 && t.length < 10) t += String.fromCharCode(b[o++]);
      if (!t) return fail("truncated or invalid header");
      tokens.push(Number(t));
    }
    if (o >= b.length || !(b[o] === 0x20 || (b[o] >= 0x09 && b[o] <= 0x0d))) return fail("no whitespace after the header");
    o++;
    const [width, height, maxval] = tokens;
    if (!width || !height || !maxval || maxval > 65535) return fail("invalid dimensions or maximum value");
    const need = width * height * (kind === "P6" ? 3 : 1) * (maxval > 255 ? 2 : 1);
    if (b.length - o < need) return fail("truncated: fewer samples than the header declares");
    if (b.length - o > need) return fail("bytes after the image (a multi-image file is not accepted)");
    const data = b.subarray(o, o + need);
    const pixels = maxval === 255 ? pixelsDigest(kind === "P6" ? data : grayToRgb(data)) : undefined;
    return { ok: true, mediaType, facts: { width, height, maxval, ...(pixels ? { pixels } : {}) } };
  };
}

// ------------------------------------------------------------------ BMP (Windows bitmap)

function validateBmp(b: Uint8Array): Validation {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return fail("no BMP signature");
  const size = u32le(b, 2), offset = u32le(b, 10), dib = u32le(b, 14);
  if (size !== b.length) return fail(size < b.length ? "bytes after the declared file size" : "truncated: shorter than the declared file size");
  if (![12, 40, 52, 56, 108, 124].includes(dib) || 14 + dib > b.length) return fail("unknown or truncated DIB header");
  const core = dib === 12;
  const width = core ? u16le(b, 18) : u32le(b, 18) | 0, rawH = core ? u16le(b, 20) : u32le(b, 22) | 0;
  const planes = core ? u16le(b, 22) : u16le(b, 26), bpp = core ? u16le(b, 24) : u16le(b, 28);
  const compression = core ? 0 : u32le(b, 30);
  if (width <= 0 || rawH === 0 || planes !== 1) return fail("invalid dimensions or planes");
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return fail("invalid bits per pixel");
  if (compression !== 0 && compression !== 3) return fail("compressed BMP is not supported by this validator");
  const height = Math.abs(rawH), stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (offset < 14 + dib || offset + stride * height > b.length) return fail("truncated: pixel array past the end of the file");
  let pixels: string | undefined;
  if ((bpp === 24 || bpp === 32) && compression === 0) {
    const rgb = new Uint8Array(width * height * 3), step = bpp / 8;
    for (let y = 0; y < height; y++) {
      const row = offset + (rawH < 0 ? y : height - 1 - y) * stride;
      for (let x = 0; x < width; x++) { const s0 = row + x * step, o = (y * width + x) * 3; rgb[o] = b[s0 + 2]; rgb[o + 1] = b[s0 + 1]; rgb[o + 2] = b[s0]; }
    }
    pixels = pixelsDigest(rgb);
  }
  return { ok: true, mediaType: "image/bmp", facts: { width, height, bitsPerPixel: bpp, topDown: rawH < 0, ...(pixels ? { pixels } : {}) } };
}

// ------------------------------------------------------------------ ZIP (APPNOTE 6.3.x, no Zip64)

function validateZip(b: Uint8Array): Validation {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32le(b, i) === 0x06054b50 && i + 22 + u16le(b, i + 20) === b.length) { eocd = i; break; }
  }
  if (eocd < 0) return fail("no end-of-central-directory record at the end of the file");
  if (eocd >= 20 && u32le(b, eocd - 20) === 0x07064b50) return fail("Zip64 is not supported by this validator");
  const entries = u16le(b, eocd + 10), cdSize = u32le(b, eocd + 12), cdOff = u32le(b, eocd + 16);
  if (entries === 0xffff || cdOff === 0xffffffff) return fail("Zip64 is not supported by this validator");
  if (u16le(b, eocd + 4) !== 0 || u16le(b, eocd + 8) !== entries) return fail("multi-disk archives are not supported");
  if (cdOff + cdSize !== eocd) return fail("central directory does not end where the end record says");
  let o = cdOff, total = 0;
  const names: string[] = [];
  for (let k = 0; k < entries; k++) {
    if (o + 46 > eocd || u32le(b, o) !== 0x02014b50) return fail("invalid central directory entry");
    const flags = u16le(b, o + 8), method = u16le(b, o + 10), crc = u32le(b, o + 16), csize = u32le(b, o + 20), usize = u32le(b, o + 24);
    const nlen = u16le(b, o + 28), xlen = u16le(b, o + 30), clen = u16le(b, o + 32), local = u32le(b, o + 42);
    if (flags & 1) return fail("encrypted entries are not supported");
    if (method !== 0 && method !== 8) return fail(`compression method ${method} is not supported`);
    const name = ascii(b, o + 46, nlen);
    if (local + 30 > b.length || u32le(b, local) !== 0x04034b50) return fail(`entry ${name}: no local header`);
    const lnlen = u16le(b, local + 26), lxlen = u16le(b, local + 28);
    if (ascii(b, local + 30, lnlen) !== name) return fail(`entry ${name}: local name differs from the directory`);
    if (u16le(b, local + 8) !== method) return fail(`entry ${name}: local compression method differs from the directory`);
    // Without a data descriptor (flag bit 3), the local header repeats the CRC and sizes.
    if (!(flags & 8) && (u32le(b, local + 14) !== crc || u32le(b, local + 18) !== csize || u32le(b, local + 22) !== usize)) return fail(`entry ${name}: local header disagrees with the directory`);
    const data = local + 30 + lnlen + lxlen;
    if (data + csize > cdOff) return fail(`truncated: entry ${name}'s data runs into the directory`);
    const raw = method === 0 ? b.subarray(data, data + csize) : inflate("raw", b.subarray(data, data + csize), Math.min(MAX_INFLATE - total, usize + 1));
    if (typeof raw === "string") return fail(`entry ${name}: ${raw}`);
    if (raw.length !== usize) return fail(`entry ${name}: size differs from the directory`);
    if (crc32(raw) !== crc) return fail(`entry ${name}: CRC mismatch`);
    total += usize;
    if (total > MAX_INFLATE) return fail("archive expands beyond this validator's limit");
    if (names.length < 32) names.push(name);
    o += 46 + nlen + xlen + clen;
  }
  if (o !== eocd) return fail("central directory size does not match its entries");
  return { ok: true, mediaType: "application/zip", facts: { entries, uncompressedBytes: total, firstName: names[0] ?? "" } };
}

// ------------------------------------------------------------------ gzip (RFC 1952)

function validateGzip(b: Uint8Array): Validation {
  let o = 0, members = 0, total = 0;
  while (o < b.length) {
    if (o + 18 > b.length || b[o] !== 0x1f || b[o + 1] !== 0x8b || b[o + 2] !== 8) return members ? fail("bytes after the last member") : fail("no gzip header");
    const flg = b[o + 3];
    if (flg & 0xe0) return fail("reserved header flags set");
    let p = o + 10;
    if (flg & 4) { if (p + 2 > b.length) return fail("truncated header"); p += 2 + u16le(b, p); }
    for (const bit of [8, 16]) if (flg & bit) { while (p < b.length && b[p] !== 0) p++; p++; }
    if (flg & 2) p += 2;
    if (p >= b.length) return fail("truncated header");
    // The deflate stream's end is found by inflating; the trailer follows it.
    let out: Buffer, used: number;
    try {
      const r = inflateRawSync(b.subarray(p, b.length), { maxOutputLength: MAX_INFLATE - total, info: true } as never) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      out = r.buffer; used = r.engine.bytesWritten;
    } catch (e) { return fail(`compressed data does not inflate (${String((e as Error).message).slice(0, 80)})`); }
    const t = p + used;
    if (t + 8 > b.length) return fail("truncated: no trailer");
    if (crc32(out) !== u32le(b, t)) return fail("CRC mismatch");
    if ((out.length >>> 0) !== u32le(b, t + 4)) return fail("size mismatch");
    total += out.length; members++;
    o = t + 8;
  }
  return members ? { ok: true, mediaType: "application/gzip", facts: { members, uncompressedBytes: total } } : fail("empty");
}

// ------------------------------------------------------------------ validator-only formats (no generator)

/** WebP container (RIFF): chunk structure and the frame header's dimensions; the bitstream is not decoded. */
function validateWebp(b: Uint8Array): Validation {
  if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return fail("no RIFF/WEBP header");
  if (u32le(b, 4) + 8 !== b.length) return fail(u32le(b, 4) + 8 > b.length ? "truncated: shorter than the RIFF size" : "bytes after the RIFF size");
  let o = 12, width = 0, height = 0, lossless = false, frame = false;
  while (o < b.length) {
    if (o + 8 > b.length) return fail("truncated chunk header");
    const type = ascii(b, o, 4), len = u32le(b, o + 4);
    if (o + 8 + len > b.length) return fail(`truncated: chunk ${type} past the end`);
    const d = b.subarray(o + 8, o + 8 + len);
    if (type === "VP8 ") {
      if (len < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) return fail("invalid VP8 frame header");
      width = u16le(d, 6) & 0x3fff; height = u16le(d, 8) & 0x3fff; frame = true;
    } else if (type === "VP8L") {
      if (len < 5 || d[0] !== 0x2f) return fail("invalid VP8L header");
      const bits = u32le(d, 1);
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; lossless = true; frame = true;
    } else if (type === "VP8X") {
      if (len < 10) return fail("invalid VP8X header");
      width = (d[4] | (d[5] << 8) | (d[6] << 16)) + 1; height = (d[7] | (d[8] << 8) | (d[9] << 16)) + 1;
    } else if (type === "ANMF") frame = true;
    o += 8 + len + (len & 1);
  }
  if (!frame || !width || !height) return fail("no image frame");
  return { ok: true, mediaType: "image/webp", facts: { width, height, lossless } };
}

/** JPEG (ITU T.81): marker segments, a frame header, a scan and the end-of-image marker. */
function validateJpeg(b: Uint8Array): Validation {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return fail("no SOI marker");
  let o = 2, width = 0, height = 0, components = 0, progressive = false, scans = 0;
  while (o < b.length) {
    if (b[o] !== 0xff) return fail("marker expected");
    while (b[o] === 0xff) o++;
    const m = b[o++];
    if (m === 0xd9) { if (!scans || !width) return fail("no frame or scan before EOI"); if (o !== b.length) return fail("bytes after EOI"); return { ok: true, mediaType: "image/jpeg", facts: { width, height, components, progressive } }; }
    if (m >= 0xd0 && m <= 0xd7) continue;
    if (o + 2 > b.length) return fail("truncated segment");
    const len = u16be(b, o);
    if (len < 2 || o + len > b.length) return fail("truncated segment");
    if ((m >= 0xc0 && m <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(m)) {
      if (len < 8) return fail("invalid frame header");
      height = u16be(b, o + 3); width = u16be(b, o + 5); components = b[o + 7]; progressive = m === 0xc2 || m === 0xc6;
      if (!width || !components) return fail("invalid frame dimensions");
    }
    o += len;
    if (m === 0xda) {
      scans++;
      // Entropy-coded data runs to the next marker that is not a stuffed byte or a restart.
      while (o < b.length && !(b[o] === 0xff && b[o + 1] !== 0x00 && !(b[o + 1] >= 0xd0 && b[o + 1] <= 0xd7))) o++;
      if (o >= b.length) return fail("truncated: scan data without an end");
    }
  }
  return fail("truncated: no EOI marker");
}

/** GIF (87a/89a): screen descriptor, colour tables, image and extension blocks, and the trailer. */
function validateGif(b: Uint8Array): Validation {
  if (b.length < 13 || !/^GIF8[79]a$/.test(ascii(b, 0, 6))) return fail("no GIF header");
  const width = u16le(b, 6), height = u16le(b, 8), flags = b[10];
  let o = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0), frames = 0;
  const blocks = () => { for (;;) { if (o >= b.length) return false; const n = b[o++]; if (!n) return true; o += n; } };
  while (o < b.length) {
    const t = b[o++];
    if (t === 0x3b) { if (o !== b.length) return fail("bytes after the trailer"); if (!frames) return fail("no image"); return { ok: true, mediaType: "image/gif", facts: { width, height, frames } }; }
    if (t === 0x21) { o++; if (!blocks()) return fail("truncated extension"); continue; }
    if (t !== 0x2c) return fail("unknown block");
    if (o + 9 > b.length) return fail("truncated image descriptor");
    const lf = b[o + 8];
    o += 9 + (lf & 0x80 ? 3 * (1 << ((lf & 7) + 1)) : 0);
    o++; // LZW minimum code size
    if (!blocks()) return fail("truncated image data");
    frames++;
  }
  return fail("truncated: no trailer");
}

export const FORMATS: readonly BinaryFormat[] = Object.freeze([
  { mediaType: "image/png", slug: "png", ext: "png", words: /\bpng\b/i, validate: validatePng },
  { mediaType: "image/tiff", slug: "tiff", ext: "tif", words: /\btiff?\b/i, validate: validateTiff },
  { mediaType: "image/x-portable-pixmap", slug: "ppm", ext: "ppm", words: /\b(ppm|pnm|pbmplus|netpbm|pixmap)\b/i, validate: validatePnm("P6", "image/x-portable-pixmap") },
  { mediaType: "image/x-portable-graymap", slug: "pgm", ext: "pgm", words: /\b(pgm|pnm|graymap)\b/i, validate: validatePnm("P5", "image/x-portable-graymap") },
  { mediaType: "image/bmp", slug: "bmp", ext: "bmp", words: /\b(bmp|bitmap)\b/i, validate: validateBmp },
  { mediaType: "application/zip", slug: "zip", ext: "zip", words: /\bzip\b/i, validate: validateZip },
  { mediaType: "application/gzip", slug: "gzip", ext: "gz", words: /\b(gzip|gz|gunzip)\b/i, validate: validateGzip },
  { mediaType: "image/webp", slug: "webp", ext: "webp", words: /\bwebp\b/i, validate: validateWebp },
  { mediaType: "image/jpeg", slug: "jpeg", ext: "jpg", words: /\b(jpe?g|jfif)\b/i, validate: validateJpeg },
  { mediaType: "image/gif", slug: "gif", ext: "gif", words: /\bgif\b/i, validate: validateGif },
]);

export const formatOf = (mediaType: string) => FORMATS.find((f) => f.mediaType === mediaType);

/** The semantic type of exact bytes whose format is not established. */
export const OPAQUE_BYTES = "bytes";
export const bytesType = (mediaType: string) => `bytes:${mediaType}`;
export const mediaTypeOf = (t: string) => (t.startsWith("bytes:") ? t.slice(6) : undefined);

/**
 * What exact bytes structurally are: every format whose validator accepts them in full. More than
 * one can accept the same bytes only in contrived cases (for example a polyglot file). An
 * identification is then ambiguous and is refused, so bytes are typed only by exactly one
 * format, and stay opaque otherwise.
 */
export function identify(b: Uint8Array): { type: string; mediaType?: string; facts?: Facts; refusals: Record<string, string> } {
  const accepted: Array<{ f: BinaryFormat; v: Extract<Validation, { ok: true }> }> = [];
  const refusals: Record<string, string> = {};
  for (const f of FORMATS) {
    const v = f.validate(b);
    if (v.ok) accepted.push({ f, v });
    else refusals[f.mediaType] = v.reason;
  }
  if (accepted.length !== 1) return { type: OPAQUE_BYTES, refusals };
  return { type: bytesType(accepted[0].f.mediaType), mediaType: accepted[0].f.mediaType, facts: accepted[0].v.facts, refusals };
}
